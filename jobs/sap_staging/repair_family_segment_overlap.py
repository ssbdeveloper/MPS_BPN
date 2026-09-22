"""Perbaiki overlap boundary antar segmen keluarga confirmation (RG/OV/RW).

Masalah yang diperbaiki
-----------------------
Dua segmen dalam satu keluarga confirmation (base sama, operator sama, order/op
sama) saling tumpang tindih karena batas potong internal salah. Contoh:

  BPN  171829 RG 15:40->17:01  vs  171914 OV 17:00->17:08   (overlap 60s)
  CKP   94629 OV 06:22->07:25  vs  107805 RG 06:25->07:25   (overlap 3600s)

Keluarga yang layak diperbaiki harus punya TEPAT SATU batas shift (shift_start
atau shift_end dari roster efektif) di dalam rentang gabungan kedua segmen.
Batas itulah satu-satunya titik potong yang sah, sehingga perbaikan bersifat
deterministik: segmen kiri berakhir di batas, segmen kanan mulai di batas.

Yang TIDAK disentuh
-------------------
* Pasangan tanpa batas shift tunggal (ambigu) -> dilaporkan, tidak diubah.
* Pasangan bersuffix sama (bukan hasil potong RG/OV) -> duplikat/anomali input.
* Duplikat scan dan segmen mikro (<60s) -> butuh keputusan bisnis.
* Row ber-state_flag 5 (dihapus).
* Row yang sudah POSTED di SAP. Row PENDING hanya ikut bila --include-staged.

Rentang gabungan (union span) keluarga selalu dipertahankan: hanya batas
internal yang digeser, sehingga total jam kerja operator tidak berubah.

Dry-run adalah default. Apply menulis backup table lebih dulu, lalu UPDATE
dalam satu transaksi, lalu memverifikasi ulang sebelum COMMIT.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

# Batas toleransi saat mencocokkan sebuah timestamp dengan batas shift.
BOUNDARY_MATCH_TOLERANCE = timedelta(seconds=1)

# Segmen lebih pendek dari ini dianggap mikro/duplikat scan, bukan hasil potong.
MIN_MEANINGFUL_SPAN = timedelta(seconds=60)

# Jarak maksimum dua timestamp agar dianggap duplikat scan.
DUPLICATE_TOLERANCE = timedelta(seconds=5)

PLANTS = {
    "cikupa": {"host": "100.80.101.53", "plant": "5100", "tz": "Asia/Jakarta"},
    "bpn": {"host": "100.86.231.55", "plant": "5051", "tz": "Asia/Makassar"},
}


@dataclass
class Segment:
    tsnumber: int
    serialnumber: str
    order_no: str | None
    operation_no: int | None
    confirmationnumber: str
    base: str
    suffix: str
    start: datetime          # waktu lokal (naive, sesuai tz plant)
    end: datetime
    duration: Decimal | None
    exposure: str
    shift_start: datetime | None
    shift_end: datetime | None

    @property
    def span(self) -> timedelta:
        return self.end - self.start


@dataclass
class PairPlan:
    left: Segment
    right: Segment
    boundary: datetime
    overlap_seconds: float
    new_left_end: datetime
    new_right_start: datetime
    blocked_reason: str | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def changed_rows(self) -> dict[int, dict]:
        out: dict[int, dict] = {}
        if self.new_left_end != self.left.end:
            out[self.left.tsnumber] = {
                "field": "longdate_checkout",
                "old": self.left.end,
                "new": self.new_left_end,
                "start": self.left.start,
                "end": self.new_left_end,
            }
        if self.new_right_start != self.right.start:
            out[self.right.tsnumber] = {
                "field": "longdate_checkin",
                "old": self.right.start,
                "new": self.new_right_start,
                "start": self.new_right_start,
                "end": self.right.end,
            }
        return out


def hours_2dp(delta: timedelta) -> Decimal:
    hours = Decimal(str(delta.total_seconds())) / Decimal("3600")
    return hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


LOAD_SQL = """
WITH seg AS (
  SELECT t.tsnumber, t.serialnumber, t.order_no, t.operation_no,
         t.confirmationnumber,
         regexp_replace(t.confirmationnumber, '(RG|OV|RW)$', '') AS base,
         right(t.confirmationnumber, 2) AS suffix,
         (t.longdate_checkin  AT TIME ZONE %(tz)s) AS ci_loc,
         (t.longdate_checkout AT TIME ZONE %(tz)s) AS co_loc,
         t.duration
  FROM public.timesheet_transaction t
  WHERE t.plant = %(plant)s
    AND t.confirmationnumber ~ '^[0-9]+(RG|OV|RW)$'
    AND t.longdate_checkin IS NOT NULL
    AND t.longdate_checkout IS NOT NULL
    AND COALESCE(t.state_flag, 0) <> 5
),
bad AS (
  SELECT DISTINCT a.tsnumber
  FROM seg a
  JOIN seg b
    ON b.base = a.base
   AND b.serialnumber = a.serialnumber
   AND b.order_no IS NOT DISTINCT FROM a.order_no
   AND b.operation_no IS NOT DISTINCT FROM a.operation_no
   AND b.tsnumber <> a.tsnumber
  WHERE a.co_loc > b.ci_loc AND b.ci_loc >= a.ci_loc
),
involved AS (
  SELECT s.*
  FROM seg s
  WHERE s.tsnumber IN (SELECT tsnumber FROM bad)
     OR EXISTS (
          SELECT 1 FROM seg o
          JOIN bad ON bad.tsnumber = o.tsnumber
          WHERE o.base = s.base
            AND o.serialnumber = s.serialnumber
            AND o.order_no IS NOT DISTINCT FROM s.order_no
            AND o.operation_no IS NOT DISTINCT FROM s.operation_no
        )
)
SELECT i.*,
       r.business_date, r.status AS roster_status,
       r.start_time, r.end_time, r.crosses_midnight
FROM involved i
LEFT JOIN ews.roster_effective r
       ON r.serialnumber = i.serialnumber
      AND r.business_date = i.ci_loc::date
ORDER BY i.serialnumber, i.base, i.ci_loc, i.tsnumber
"""

EXPOSURE_SQL = """
SELECT split_part(source_key, ':', 2)::int AS tsnumber, status
FROM public.sap_timesheet_staging
WHERE source_system = 'TIMESHEET'
  AND split_part(source_key, ':', 1) = %(plant)s
  AND split_part(source_key, ':', 2) = ANY(%(ids)s::text[])
"""


def load_segments(cur, plant: str, tz: str) -> list[Segment]:
    cur.execute(LOAD_SQL, {"plant": plant, "tz": tz})
    raw = cur.fetchall()
    ids = [str(r["tsnumber"]) for r in raw]
    exposure: dict[int, str] = {}
    if ids:
        cur.execute(EXPOSURE_SQL, {"plant": plant, "ids": ids})
        exposure = {r["tsnumber"]: r["status"] for r in cur.fetchall()}

    segments: list[Segment] = []
    for r in raw:
        shift_start = shift_end = None
        if r["business_date"] and r["start_time"] is not None and r["end_time"] is not None:
            bd = r["business_date"]
            shift_start = datetime.combine(bd, datetime.min.time()) + _to_delta(r["start_time"])
            shift_end = datetime.combine(bd, datetime.min.time()) + _to_delta(r["end_time"])
            if r["crosses_midnight"]:
                shift_end += timedelta(days=1)
        segments.append(
            Segment(
                tsnumber=r["tsnumber"],
                serialnumber=r["serialnumber"],
                order_no=r["order_no"],
                operation_no=r["operation_no"],
                confirmationnumber=r["confirmationnumber"],
                base=r["base"],
                suffix=r["suffix"],
                start=r["ci_loc"],
                end=r["co_loc"],
                duration=r["duration"],
                exposure=exposure.get(r["tsnumber"], "UNSTAGED"),
                shift_start=shift_start,
                shift_end=shift_end,
            )
        )
    return segments


def _to_delta(value) -> timedelta:
    if isinstance(value, timedelta):
        return value
    return timedelta(hours=value.hour, minutes=value.minute, seconds=value.second)


def candidate_boundaries(left: Segment, right: Segment) -> list[datetime]:
    """Batas shift yang jatuh STRICTLY di dalam rentang gabungan kedua segmen."""
    lo = min(left.start, right.start)
    hi = max(left.end, right.end)
    found: set[datetime] = set()
    for seg in (left, right):
        for anchor in (seg.shift_start, seg.shift_end):
            if anchor is None:
                continue
            for offset in (-1, 0, 1):
                candidate = anchor + timedelta(days=offset)
                if lo < candidate < hi:
                    found.add(candidate)
    return sorted(found)


def build_pair_plans(segments: list[Segment], include_staged: bool) -> tuple[list[PairPlan], list[PairPlan]]:
    families: dict[tuple, list[Segment]] = defaultdict(list)
    for seg in segments:
        families[(seg.serialnumber, seg.base, seg.order_no, seg.operation_no)].append(seg)

    plans: list[PairPlan] = []
    blocked: list[PairPlan] = []

    for members in families.values():
        members.sort(key=lambda s: (s.start, s.tsnumber))
        for i, left in enumerate(members):
            for right in members[i + 1:]:
                if right.start < left.start:
                    continue
                if left.end <= right.start:
                    continue  # tidak overlap

                overlap = (left.end - right.start).total_seconds()
                plan = PairPlan(
                    left=left,
                    right=right,
                    boundary=right.start,
                    overlap_seconds=overlap,
                    new_left_end=left.end,
                    new_right_start=right.start,
                )

                # --- Gate 1: exposure SAP ---
                exposures = {left.exposure, right.exposure}
                if "POSTED" in exposures:
                    plan.blocked_reason = "SAP_POSTED"
                    blocked.append(plan)
                    continue
                if not include_staged and exposures - {"UNSTAGED"}:
                    plan.blocked_reason = f"SAP_STAGED:{'/'.join(sorted(exposures))}"
                    blocked.append(plan)
                    continue

                # --- Gate 2: duplikat scan ---
                if (
                    abs((right.start - left.start)) <= DUPLICATE_TOLERANCE
                    and abs((right.end - left.end)) <= DUPLICATE_TOLERANCE
                ):
                    plan.blocked_reason = "DUPLICATE_SCAN"
                    blocked.append(plan)
                    continue

                # --- Gate 3: segmen mikro ---
                if left.span < MIN_MEANINGFUL_SPAN or right.span < MIN_MEANINGFUL_SPAN:
                    plan.blocked_reason = "MICRO_SEGMENT"
                    blocked.append(plan)
                    continue

                # --- Gate 4: harus hasil potong RG/OV/RW yang berbeda ---
                if left.suffix == right.suffix:
                    plan.blocked_reason = "SAME_SUFFIX"
                    blocked.append(plan)
                    continue

                # --- Gate 5: tepat satu batas shift di dalam span ---
                cands = candidate_boundaries(left, right)
                if len(cands) != 1:
                    plan.blocked_reason = f"AMBIGUOUS_BOUNDARY:{len(cands)}"
                    blocked.append(plan)
                    continue

                boundary = cands[0]
                plan.boundary = boundary
                plan.new_left_end = boundary
                plan.new_right_start = boundary

                # --- Gate 6: hasil harus interval yang masih bermakna ---
                # Cek span HASIL, bukan span lama: memotong di batas shift bisa
                # menyisakan sisa beberapa detik, dan itu bukan perbaikan.
                if plan.new_left_end - left.start < MIN_MEANINGFUL_SPAN:
                    plan.blocked_reason = "LEFT_WOULD_COLLAPSE"
                    blocked.append(plan)
                    continue
                if right.end - plan.new_right_start < MIN_MEANINGFUL_SPAN:
                    plan.blocked_reason = "RIGHT_WOULD_COLLAPSE"
                    blocked.append(plan)
                    continue

                # --- Gate 7: union span wajib lestari ---
                old_lo, old_hi = min(left.start, right.start), max(left.end, right.end)
                new_lo = min(left.start, plan.new_right_start)
                new_hi = max(plan.new_left_end, right.end)
                if (new_lo, new_hi) != (old_lo, old_hi):
                    plan.blocked_reason = "UNION_SPAN_CHANGED"
                    blocked.append(plan)
                    continue

                plans.append(plan)

    return plans, blocked


def collapse_row_changes(plans: list[PairPlan]) -> dict[int, dict]:
    """Gabungkan perubahan per tsnumber; tolak bila satu row diminta dua nilai beda."""
    merged: dict[int, dict] = {}
    for plan in plans:
        for tsnumber, change in plan.changed_rows.items():
            if tsnumber in merged:
                prev = merged[tsnumber]
                if prev["field"] != change["field"] or prev["new"] != change["new"]:
                    raise RuntimeError(
                        f"konflik rencana pada tsnumber {tsnumber}: "
                        f"{prev['field']}={prev['new']} vs {change['field']}={change['new']}"
                    )
                continue
            merged[tsnumber] = change
    return merged


OVERLAP_PAIRS_SQL = """
SELECT a.tsnumber AS ts_a, b.tsnumber AS ts_b
FROM public.timesheet_transaction a
JOIN public.timesheet_transaction b
  ON b.serialnumber = a.serialnumber
 AND b.tsnumber > a.tsnumber
 AND a.longdate_checkin < b.longdate_checkout
 AND b.longdate_checkin < a.longdate_checkout
WHERE a.plant = %(plant)s AND b.plant = %(plant)s
  AND COALESCE(a.state_flag, 0) <> 5
  AND COALESCE(b.state_flag, 0) <> 5
  AND a.longdate_checkout IS NOT NULL
  AND b.longdate_checkout IS NOT NULL
"""


def operator_overlap_pairs(cur, plant: str) -> set[tuple[int, int]]:
    cur.execute(OVERLAP_PAIRS_SQL, {"plant": plant})
    return {(r["ts_a"], r["ts_b"]) for r in cur.fetchall()}


def write_reports(report_dir: Path, plans: list[PairPlan], blocked: list[PairPlan],
                  row_changes: dict[int, dict], metadata: dict) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)

    with (report_dir / "planned_pairs.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "ts_left", "conf_left", "left_start", "left_end_old", "left_end_new",
            "ts_right", "conf_right", "right_start_old", "right_start_new", "right_end",
            "boundary", "overlap_seconds", "serialnumber", "order_no", "operation_no",
            "exposure_left", "exposure_right",
        ])
        for p in plans:
            w.writerow([
                p.left.tsnumber, p.left.confirmationnumber, p.left.start, p.left.end,
                p.new_left_end, p.right.tsnumber, p.right.confirmationnumber,
                p.right.start, p.new_right_start, p.right.end, p.boundary,
                f"{p.overlap_seconds:.0f}", p.left.serialnumber, p.left.order_no,
                p.left.operation_no, p.left.exposure, p.right.exposure,
            ])

    with (report_dir / "blocked_pairs.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "reason", "ts_left", "conf_left", "left_start", "left_end",
            "ts_right", "conf_right", "right_start", "right_end",
            "overlap_seconds", "serialnumber", "order_no", "operation_no",
            "exposure_left", "exposure_right",
        ])
        for p in sorted(blocked, key=lambda x: (x.blocked_reason or "", -x.overlap_seconds)):
            w.writerow([
                p.blocked_reason, p.left.tsnumber, p.left.confirmationnumber,
                p.left.start, p.left.end, p.right.tsnumber, p.right.confirmationnumber,
                p.right.start, p.right.end, f"{p.overlap_seconds:.0f}",
                p.left.serialnumber, p.left.order_no, p.left.operation_no,
                p.left.exposure, p.right.exposure,
            ])

    with (report_dir / "row_changes.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["tsnumber", "field", "old_value", "new_value", "new_start", "new_end", "new_duration"])
        for tsnumber, change in sorted(row_changes.items()):
            w.writerow([
                tsnumber, change["field"], change["old"], change["new"],
                change["start"], change["end"],
                hours_2dp(change["end"] - change["start"]),
            ])

    (report_dir / "summary.json").write_text(
        json.dumps(metadata, indent=2, default=str), encoding="utf-8"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(PLANTS), help="plant tujuan")
    ap.add_argument("--apply", action="store_true", help="tulis ke DB (default: dry-run)")
    ap.add_argument("--yes", action="store_true", help="lewati konfirmasi interaktif")
    ap.add_argument("--include-staged", action="store_true",
                    help="ikut perbaiki row yang sudah PENDING di staging (POSTED tetap ditolak)")
    ap.add_argument("--report-dir", required=True, type=Path)
    args = ap.parse_args()

    cfg = PLANTS[args.target]
    env: dict[str, str] = {}
    for line in Path("D:/MPS2/.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

    conn = psycopg2.connect(
        host=cfg["host"], port=5433, dbname=env["DB_NAME"],
        user=env["DB_USER"], password=env["DB_PASSWORD"], connect_timeout=10,
    )
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET LOCAL lock_timeout = '10s'")
            cur.execute("SET LOCAL statement_timeout = '600s'")

            cur.execute("SELECT plant_code, timezone FROM public.plant_config LIMIT 1")
            pc = cur.fetchone()
            if not pc or pc["plant_code"].strip() != cfg["plant"]:
                raise RuntimeError(
                    f"plant_config {pc and pc['plant_code']} != target {cfg['plant']} — koneksi salah?"
                )
            if pc["timezone"].strip() != cfg["tz"]:
                raise RuntimeError(f"timezone {pc['timezone']} != {cfg['tz']}")

            segments = load_segments(cur, cfg["plant"], cfg["tz"])
            plans, blocked = build_pair_plans(segments, include_staged=args.include_staged)
            row_changes = collapse_row_changes(plans)

            baseline_overlap = operator_overlap_pairs(cur, cfg["plant"])

            metadata = {
                "target": args.target,
                "host": cfg["host"],
                "plant": cfg["plant"],
                "timezone": cfg["tz"],
                "mode": "apply" if args.apply else "dry-run",
                "include_staged": args.include_staged,
                "segments_examined": len(segments),
                "pairs_planned": len(plans),
                "pairs_blocked": len(blocked),
                "rows_to_update": len(row_changes),
                "blocked_by_reason": {},
                "overlap_pairs_before": len(baseline_overlap),
                "created_at": datetime.now().isoformat(),
            }
            for p in blocked:
                key = (p.blocked_reason or "UNKNOWN").split(":")[0]
                metadata["blocked_by_reason"][key] = metadata["blocked_by_reason"].get(key, 0) + 1

            print(f"[{args.target}] segmen diperiksa      : {len(segments)}")
            print(f"[{args.target}] pasangan bisa dibetulkan: {len(plans)}")
            print(f"[{args.target}] pasangan ditahan        : {len(blocked)} {metadata['blocked_by_reason']}")
            print(f"[{args.target}] row akan di-UPDATE      : {len(row_changes)}")
            print(f"[{args.target}] overlap operator (baseline): {len(baseline_overlap)} pasang")

            if not args.apply:
                write_reports(args.report_dir, plans, blocked, row_changes, metadata)
                print(f"[{args.target}] DRY-RUN — laporan: {args.report_dir}")
                conn.rollback()
                return 0

            if not row_changes:
                print(f"[{args.target}] tidak ada yang perlu diperbaiki.")
                write_reports(args.report_dir, plans, blocked, row_changes, metadata)
                conn.rollback()
                return 0

            if not args.yes:
                print("Gunakan --yes untuk mengeksekusi.")
                conn.rollback()
                return 1

            ids = sorted(row_changes)

            # Lock baris target.
            cur.execute(
                """
                SELECT tsnumber, longdate_checkin, longdate_checkout, duration
                FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[])
                ORDER BY tsnumber
                FOR UPDATE
                """,
                (ids,),
            )
            locked = cur.fetchall()
            if len(locked) != len(ids):
                raise RuntimeError(f"terkunci {len(locked)} row, diharapkan {len(ids)}")

            # Backup sebelum menulis.
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = f"timesheet_family_overlap_backup_{stamp}"
            cur.execute(
                sql.SQL("CREATE TABLE public.{} AS SELECT * FROM public.timesheet_transaction WHERE tsnumber = ANY(%s::int[])")
                .format(sql.Identifier(backup)),
                (ids,),
            )
            cur.execute(sql.SQL("SELECT count(*) AS n FROM public.{}").format(sql.Identifier(backup)))
            backed = cur.fetchone()["n"]
            if backed != len(ids):
                raise RuntimeError(f"backup {backed} row != target {len(ids)}")
            metadata["backup_table"] = f"public.{backup}"
            print(f"[{args.target}] backup: public.{backup} ({backed} row)")

            # UPDATE per row — timestamp lokal dikonversi balik ke timestamptz.
            updated = 0
            for tsnumber, change in sorted(row_changes.items()):
                new_duration = hours_2dp(change["end"] - change["start"])
                if change["field"] == "longdate_checkout":
                    cur.execute(
                        """
                        UPDATE public.timesheet_transaction
                        SET longdate_checkout = %(new)s::timestamp AT TIME ZONE %(tz)s,
                            date_checkout = to_char(%(new)s::timestamp, 'DD/MM/YYYY'),
                            hour_checkout = to_char(%(new)s::timestamp, 'HH24:MI'),
                            duration = %(dur)s,
                            modified_at = now()
                        WHERE tsnumber = %(ts)s
                        """,
                        {"new": change["new"], "tz": cfg["tz"], "dur": new_duration, "ts": tsnumber},
                    )
                else:
                    cur.execute(
                        """
                        UPDATE public.timesheet_transaction
                        SET longdate_checkin = %(new)s::timestamp AT TIME ZONE %(tz)s,
                            date_checkin = to_char(%(new)s::timestamp, 'DD/MM/YYYY'),
                            hour_checkin = to_char(%(new)s::timestamp, 'HH24:MI'),
                            duration = %(dur)s,
                            modified_at = now()
                        WHERE tsnumber = %(ts)s
                        """,
                        {"new": change["new"], "tz": cfg["tz"], "dur": new_duration, "ts": tsnumber},
                    )
                updated += cur.rowcount
            metadata["rows_updated"] = updated
            print(f"[{args.target}] row ter-UPDATE: {updated}")

            # --- Verifikasi pra-commit ---
            after_overlap = operator_overlap_pairs(cur, cfg["plant"])
            new_pairs = after_overlap - baseline_overlap
            if new_pairs:
                raise RuntimeError(f"guard: {len(new_pairs)} pasang overlap BARU muncul: {sorted(new_pairs)[:5]}")

            cur.execute(
                """
                SELECT count(*) AS n FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[])
                  AND (longdate_checkout IS NULL OR longdate_checkout <= longdate_checkin)
                """,
                (ids,),
            )
            if cur.fetchone()["n"]:
                raise RuntimeError("guard: ada interval nonpositif setelah UPDATE")

            cur.execute(
                """
                SELECT count(*) AS n FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[])
                  AND (
                    date_checkin  IS DISTINCT FROM to_char(longdate_checkin  AT TIME ZONE %s, 'DD/MM/YYYY')
                 OR hour_checkin  IS DISTINCT FROM to_char(longdate_checkin  AT TIME ZONE %s, 'HH24:MI')
                 OR date_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE %s, 'DD/MM/YYYY')
                 OR hour_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE %s, 'HH24:MI')
                  )
                """,
                (ids, cfg["tz"], cfg["tz"], cfg["tz"], cfg["tz"]),
            )
            if cur.fetchone()["n"]:
                raise RuntimeError("guard: kolom teks jam tidak konsisten dengan timestamp")

            metadata["overlap_pairs_after"] = len(after_overlap)
            metadata["overlap_pairs_resolved"] = len(baseline_overlap - after_overlap)
            print(f"[{args.target}] overlap operator sesudah  : {len(after_overlap)} pasang "
                  f"(terselesaikan {len(baseline_overlap - after_overlap)}, baru 0)")

            write_reports(args.report_dir, plans, blocked, row_changes, metadata)
            conn.commit()
            print(f"[{args.target}] COMMIT sukses. Laporan: {args.report_dir}")
            return 0

    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print(f"[{args.target}] ROLLBACK — {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
