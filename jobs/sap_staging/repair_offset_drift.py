"""Koreksi drift offset 1 jam dengan arah ditentukan bukti tetangga.

Latar
-----
Sebagian row menyimpan `longdate_*` dan kolom teks `date_*`/`hour_*` yang
selisih tepat 1 jam. Salah satu dari keduanya benar, tapi TIDAK seragam:

  ts 107440  ts=15:30->15:32  teks=16:30->16:32
             tetangga 89363 ts=15:33->17:18 (teks konsisten)
             => timestamp menyambung rapi; teks-lah yang melenceng.

  ts 108481  ts=15:30->16:37  teks=16:30->17:37
             tetangga 105107 ts=15:17->16:30 (teks konsisten)
             => teks menyambung tepat di 16:30; timestamp-lah yang melenceng.

Karena itu arah koreksi diputuskan per baris memakai bukti tetangga: untuk
tiap kandidat diuji dua hipotesis terhadap SELURUH record operator yang sama,
lalu dipilih hipotesis yang tidak menimbulkan tumpang tindih.

  SHIFT_TS  : timestamp digeser +offset agar cocok teks  (teks = benar)
  FIX_TEXT  : kolom teks ditulis ulang dari timestamp    (timestamp = benar)

Bila kedua hipotesis sama-sama bersih, atau kedua-duanya bertabrakan, baris
itu ditahan dan dilaporkan — bukan ditebak.

Guard: hanya row UNSTAGED, state_flag<>5, dan verifikasi pra-commit menolak
overlap operator baru maupun sisa ketidakcocokan.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

PLANTS = {
    "cikupa": {"host": "100.80.101.53", "plant": "5100", "tz": "Asia/Jakarta"},
    "bpn": {"host": "100.86.231.55", "plant": "5051", "tz": "Asia/Makassar"},
}

OFFSET_TOLERANCE_HOURS = 0.02

CANDIDATE_SQL = """
SELECT t.tsnumber, t.confirmationnumber, t.serialnumber, t.duration,
       (t.longdate_checkin  AT TIME ZONE %(tz)s) AS ci,
       (t.longdate_checkout AT TIME ZONE %(tz)s) AS co,
       t.date_checkin, t.hour_checkin, t.date_checkout, t.hour_checkout,
       COALESCE(st.status, 'UNSTAGED') AS exposure,
       EXTRACT(EPOCH FROM (
         to_timestamp(t.date_checkin || ' ' || t.hour_checkin, 'DD/MM/YYYY HH24:MI')
         - (t.longdate_checkin AT TIME ZONE %(tz)s)
       )) / 3600.0 AS off_ci,
       EXTRACT(EPOCH FROM (
         to_timestamp(t.date_checkout || ' ' || t.hour_checkout, 'DD/MM/YYYY HH24:MI')
         - (t.longdate_checkout AT TIME ZONE %(tz)s)
       )) / 3600.0 AS off_co
FROM public.timesheet_transaction t
LEFT JOIN public.sap_timesheet_staging st
       ON st.source_system = 'TIMESHEET'
      AND split_part(st.source_key, ':', 1) = %(plant)s
      AND split_part(st.source_key, ':', 2) = t.tsnumber::text
WHERE t.plant = %(plant)s
  AND COALESCE(t.state_flag, 0) <> 5
  AND t.longdate_checkin IS NOT NULL
  AND t.longdate_checkout IS NOT NULL
  AND t.date_checkin  ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
  AND t.hour_checkin  ~ '^[0-9]{2}:[0-9]{2}$'
  AND t.date_checkout ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
  AND t.hour_checkout ~ '^[0-9]{2}:[0-9]{2}$'
  AND EXTRACT(EPOCH FROM (
        to_timestamp(t.date_checkin || ' ' || t.hour_checkin, 'DD/MM/YYYY HH24:MI')
        - (t.longdate_checkin AT TIME ZONE %(tz)s)
      )) / 3600.0 BETWEEN %(lo)s AND %(hi)s
ORDER BY t.tsnumber
"""

NEIGHBOUR_SQL = """
SELECT tsnumber, serialnumber, confirmationnumber,
       (longdate_checkin  AT TIME ZONE %(tz)s) AS ci,
       (longdate_checkout AT TIME ZONE %(tz)s) AS co
FROM public.timesheet_transaction
WHERE plant = %(plant)s
  AND COALESCE(state_flag, 0) <> 5
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NOT NULL
  AND serialnumber = ANY(%(serials)s::text[])
"""

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


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in Path("D:/MPS2/.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def family_base(confirmation: str | None) -> str | None:
    """Base keluarga confirmation, tanpa suffix RG/OV/RW."""
    if not confirmation:
        return None
    return re.sub(r"(RG|OV|RW)$", "", confirmation)


def count_conflicts(ci, co, tsnumber, neighbours, moved: dict[int, tuple],
                    skip_base: str | None = None) -> list[int]:
    """Daftar tsnumber tetangga yang bertabrakan dengan interval (ci, co).

    Tetangga sekeluarga confirmation dikecualikan bila `skip_base` diberikan:
    overlap antar segmen dalam satu keluarga adalah urusan perbaikan boundary
    (repair_family_segment_overlap.py), bukan bukti arah drift offset. Tanpa
    pengecualian ini, overlap yang justru ingin kita betulkan malah dihitung
    sebagai alasan untuk tidak menyentuh baris tersebut.
    """
    hits = []
    for n in neighbours:
        if n["tsnumber"] == tsnumber:
            continue
        if skip_base is not None and family_base(n["confirmationnumber"]) == skip_base:
            continue
        n_ci, n_co = moved.get(n["tsnumber"], (n["ci"], n["co"]))
        if ci < n_co and n_ci < co:
            hits.append(n["tsnumber"])
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(PLANTS))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--offset-hours", type=float, default=1.0)
    ap.add_argument("--report-dir", required=True, type=Path)
    args = ap.parse_args()

    cfg = PLANTS[args.target]
    env = load_env()
    off = args.offset_hours
    delta = timedelta(hours=off)

    conn = psycopg2.connect(host=cfg["host"], port=5433, dbname=env["DB_NAME"],
                            user=env["DB_USER"], password=env["DB_PASSWORD"],
                            connect_timeout=15)
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET LOCAL lock_timeout = '10s'")
            cur.execute("SET LOCAL statement_timeout = '600s'")

            cur.execute("SELECT plant_code, timezone FROM public.plant_config LIMIT 1")
            pc = cur.fetchone()
            if not pc or pc["plant_code"].strip() != cfg["plant"]:
                raise RuntimeError(f"plant_config {pc and pc['plant_code']} != {cfg['plant']}")
            if pc["timezone"].strip() != cfg["tz"]:
                raise RuntimeError(f"timezone {pc['timezone']} != {cfg['tz']}")

            params = {"plant": cfg["plant"], "tz": cfg["tz"],
                      "lo": off - OFFSET_TOLERANCE_HOURS, "hi": off + OFFSET_TOLERANCE_HOURS}
            cur.execute(CANDIDATE_SQL, params)
            cands = [dict(r) for r in cur.fetchall()]

            serials = sorted({c["serialnumber"] for c in cands})
            cur.execute(NEIGHBOUR_SQL, {"plant": cfg["plant"], "tz": cfg["tz"], "serials": serials})
            by_serial: dict[str, list[dict]] = defaultdict(list)
            for r in cur.fetchall():
                by_serial[r["serialnumber"]].append(dict(r))

            shift_ts, fix_text, blocked = [], [], []
            for c in cands:
                if c["exposure"] != "UNSTAGED":
                    c["reason"] = f"SAP_{c['exposure']}"
                    blocked.append(c)
                    continue
                if c["off_co"] is None or abs(float(c["off_co"]) - off) > OFFSET_TOLERANCE_HOURS:
                    c["reason"] = f"CHECKOUT_OFFSET_MISMATCH:{c['off_co']}"
                    blocked.append(c)
                    continue

                neighbours = by_serial[c["serialnumber"]]
                base = family_base(c["confirmationnumber"])
                hits_shift = count_conflicts(c["ci"] + delta, c["co"] + delta,
                                             c["tsnumber"], neighbours, {}, skip_base=base)
                hits_keep = count_conflicts(c["ci"], c["co"], c["tsnumber"],
                                            neighbours, {}, skip_base=base)

                c["conflicts_if_shift"] = len(hits_shift)
                c["conflicts_if_keep"] = len(hits_keep)

                if not hits_shift and hits_keep:
                    c["decision"] = "SHIFT_TS"
                    shift_ts.append(c)
                elif not hits_keep and hits_shift:
                    c["decision"] = "FIX_TEXT"
                    fix_text.append(c)
                elif not hits_shift and not hits_keep:
                    c["reason"] = "AMBIGUOUS_BOTH_CLEAN"
                    blocked.append(c)
                else:
                    c["reason"] = f"BOTH_CONFLICT:{len(hits_keep)}/{len(hits_shift)}"
                    blocked.append(c)

            baseline = operator_overlap_pairs(cur, cfg["plant"])

            meta = {
                "target": args.target, "plant": cfg["plant"], "timezone": cfg["tz"],
                "offset_hours": off, "mode": "apply" if args.apply else "dry-run",
                "candidates": len(cands),
                "decision_shift_ts": len(shift_ts),
                "decision_fix_text": len(fix_text),
                "blocked": len(blocked),
                "overlap_pairs_before": len(baseline),
                "created_at": datetime.now().isoformat(),
            }
            reasons: dict[str, int] = {}
            for b in blocked:
                key = str(b.get("reason", "UNKNOWN")).split(":")[0]
                reasons[key] = reasons.get(key, 0) + 1
            meta["blocked_by_reason"] = reasons

            print(f"[{args.target}] kandidat drift {off:+} jam : {len(cands)}")
            print(f"[{args.target}]   -> SHIFT_TS (teks benar)     : {len(shift_ts)}")
            print(f"[{args.target}]   -> FIX_TEXT (timestamp benar): {len(fix_text)}")
            print(f"[{args.target}]   -> ditahan                   : {len(blocked)} {reasons}")
            print(f"[{args.target}] overlap operator baseline      : {len(baseline)} pasang")

            args.report_dir.mkdir(parents=True, exist_ok=True)
            with (args.report_dir / "decisions.csv").open("w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["decision", "tsnumber", "confirmationnumber", "serialnumber",
                            "ts_checkin", "ts_checkout", "text_checkin", "text_checkout",
                            "conflicts_if_keep", "conflicts_if_shift", "duration"])
                for c in shift_ts + fix_text:
                    w.writerow([c["decision"], c["tsnumber"], c["confirmationnumber"],
                                c["serialnumber"], c["ci"], c["co"],
                                f"{c['date_checkin']} {c['hour_checkin']}",
                                f"{c['date_checkout']} {c['hour_checkout']}",
                                c["conflicts_if_keep"], c["conflicts_if_shift"], c["duration"]])
            with (args.report_dir / "blocked.csv").open("w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["reason", "tsnumber", "confirmationnumber", "serialnumber",
                            "ts_checkin", "ts_checkout", "text_checkin", "text_checkout",
                            "conflicts_if_keep", "conflicts_if_shift", "exposure"])
                for c in blocked:
                    w.writerow([c.get("reason"), c["tsnumber"], c["confirmationnumber"],
                                c["serialnumber"], c["ci"], c["co"],
                                f"{c['date_checkin']} {c['hour_checkin']}",
                                f"{c['date_checkout']} {c['hour_checkout']}",
                                c.get("conflicts_if_keep"), c.get("conflicts_if_shift"),
                                c["exposure"]])

            if not args.apply:
                (args.report_dir / "summary.json").write_text(
                    json.dumps(meta, indent=2, default=str), encoding="utf-8")
                conn.rollback()
                print(f"[{args.target}] DRY-RUN — laporan: {args.report_dir}")
                return 0

            targets = shift_ts + fix_text
            if not targets:
                (args.report_dir / "summary.json").write_text(
                    json.dumps(meta, indent=2, default=str), encoding="utf-8")
                conn.rollback()
                print(f"[{args.target}] tidak ada yang bisa dikoreksi otomatis.")
                return 0

            if not args.yes:
                conn.rollback()
                print("Gunakan --yes untuk mengeksekusi.")
                return 1

            ids = sorted(c["tsnumber"] for c in targets)
            cur.execute("""
                SELECT tsnumber FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[]) ORDER BY tsnumber FOR UPDATE
            """, (ids,))
            if len(cur.fetchall()) != len(ids):
                raise RuntimeError("jumlah row terkunci tidak sesuai")

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = f"timesheet_offset_repair_backup_{stamp}"
            cur.execute(
                sql.SQL("CREATE TABLE public.{} AS SELECT * FROM public.timesheet_transaction "
                        "WHERE tsnumber = ANY(%s::int[])").format(sql.Identifier(backup)),
                (ids,))
            cur.execute(sql.SQL("SELECT count(*) AS n FROM public.{}").format(sql.Identifier(backup)))
            if cur.fetchone()["n"] != len(ids):
                raise RuntimeError("backup tidak lengkap")
            meta["backup_table"] = f"public.{backup}"
            print(f"[{args.target}] backup: public.{backup} ({len(ids)} row)")

            # Hipotesis A: teks benar -> geser timestamp.
            if shift_ts:
                cur.execute("""
                    UPDATE public.timesheet_transaction
                    SET longdate_checkin  = longdate_checkin  + make_interval(secs => %(sec)s),
                        longdate_checkout = longdate_checkout + make_interval(secs => %(sec)s),
                        modified_at = now()
                    WHERE tsnumber = ANY(%(ids)s::int[])
                """, {"sec": off * 3600.0, "ids": [c["tsnumber"] for c in shift_ts]})
                print(f"[{args.target}] SHIFT_TS ter-UPDATE: {cur.rowcount}")

            # Hipotesis B: timestamp benar -> tulis ulang kolom teks.
            if fix_text:
                cur.execute("""
                    UPDATE public.timesheet_transaction
                    SET date_checkin  = to_char(longdate_checkin  AT TIME ZONE %(tz)s, 'DD/MM/YYYY'),
                        hour_checkin  = to_char(longdate_checkin  AT TIME ZONE %(tz)s, 'HH24:MI'),
                        date_checkout = to_char(longdate_checkout AT TIME ZONE %(tz)s, 'DD/MM/YYYY'),
                        hour_checkout = to_char(longdate_checkout AT TIME ZONE %(tz)s, 'HH24:MI'),
                        modified_at = now()
                    WHERE tsnumber = ANY(%(ids)s::int[])
                """, {"tz": cfg["tz"], "ids": [c["tsnumber"] for c in fix_text]})
                print(f"[{args.target}] FIX_TEXT ter-UPDATE: {cur.rowcount}")

            # --- Verifikasi pra-commit ---
            cur.execute("""
                SELECT count(*) AS n FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[])
                  AND (
                    date_checkin  IS DISTINCT FROM to_char(longdate_checkin  AT TIME ZONE %s, 'DD/MM/YYYY')
                 OR hour_checkin  IS DISTINCT FROM to_char(longdate_checkin  AT TIME ZONE %s, 'HH24:MI')
                 OR date_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE %s, 'DD/MM/YYYY')
                 OR hour_checkout IS DISTINCT FROM to_char(longdate_checkout AT TIME ZONE %s, 'HH24:MI')
                  )
            """, (ids, cfg["tz"], cfg["tz"], cfg["tz"], cfg["tz"]))
            residual = cur.fetchone()["n"]
            if residual:
                raise RuntimeError(f"guard: {residual} row masih tidak konsisten teks vs timestamp")

            cur.execute("""
                SELECT count(*) AS n FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[]) AND longdate_checkout <= longdate_checkin
            """, (ids,))
            if cur.fetchone()["n"]:
                raise RuntimeError("guard: interval nonpositif")

            after = operator_overlap_pairs(cur, cfg["plant"])
            new_pairs = after - baseline
            if new_pairs:
                raise RuntimeError(f"guard: {len(new_pairs)} pasang overlap BARU: {sorted(new_pairs)[:5]}")

            meta["overlap_pairs_after"] = len(after)
            meta["overlap_pairs_resolved"] = len(baseline - after)
            print(f"[{args.target}] overlap operator sesudah : {len(after)} pasang "
                  f"(terselesaikan {len(baseline - after)}, baru 0)")

            (args.report_dir / "summary.json").write_text(
                json.dumps(meta, indent=2, default=str), encoding="utf-8")
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
