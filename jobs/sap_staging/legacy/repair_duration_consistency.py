"""Selaraskan kolom `duration` dengan (longdate_checkout - longdate_checkin).

`duration` adalah nilai turunan: jam kerja satu record = selisih checkout dan
checkin, dibulatkan 2 desimal. Bila nilainya menyimpang, setiap agregasi yang
memakai `duration` (dashboard, staging SAP, laporan) ikut salah.

Script ini menulis ulang `duration` dari timestamp untuk semua baris yang
menyimpang lebih dari setengah satuan pembulatan (0.005 jam). Timestamp TIDAK
pernah diubah — timestamp adalah sumber kebenaran, `duration` mengikutinya.

Guard: lock -> backup table -> UPDATE -> verifikasi (tidak ada sisa mismatch,
tidak ada nilai negatif, timestamp tidak tersentuh) -> COMMIT.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

PLANTS = {
    "cikupa": {"host": "100.80.101.53", "plant": "5100", "tz": "Asia/Jakarta"},
    "bpn": {"host": "100.86.231.55", "plant": "5051", "tz": "Asia/Makassar"},
}

# Ambang: setengah satuan pembulatan 2 desimal.
MISMATCH_EPSILON = 0.005

FIND_SQL = """
SELECT tsnumber, confirmationnumber, activitytype, state_flag, duration,
       ROUND((EXTRACT(EPOCH FROM (longdate_checkout - longdate_checkin)) / 3600.0)::numeric, 2) AS calc,
       (longdate_checkin  AT TIME ZONE %(tz)s) AS ci,
       (longdate_checkout AT TIME ZONE %(tz)s) AS co
FROM public.timesheet_transaction
WHERE plant = %(plant)s
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NOT NULL
  AND (
    duration IS NULL
    OR abs(duration - ROUND((EXTRACT(EPOCH FROM (longdate_checkout - longdate_checkin)) / 3600.0)::numeric, 2)) > %(eps)s
  )
ORDER BY tsnumber
"""


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in Path("D:/MPS2/.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(PLANTS))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--report-dir", required=True, type=Path)
    args = ap.parse_args()

    cfg = PLANTS[args.target]
    env = load_env()

    conn = psycopg2.connect(host=cfg["host"], port=5433, dbname=env["DB_NAME"],
                            user=env["DB_USER"], password=env["DB_PASSWORD"],
                            connect_timeout=15)
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET LOCAL lock_timeout = '15s'")
            cur.execute("SET LOCAL statement_timeout = '600s'")

            cur.execute("SELECT plant_code, timezone FROM public.plant_config LIMIT 1")
            pc = cur.fetchone()
            if not pc or pc["plant_code"].strip() != cfg["plant"]:
                raise RuntimeError(f"plant_config {pc and pc['plant_code']} != {cfg['plant']}")

            cur.execute(FIND_SQL, {"plant": cfg["plant"], "tz": cfg["tz"], "eps": MISMATCH_EPSILON})
            rows = [dict(r) for r in cur.fetchall()]

            meta = {
                "target": args.target, "plant": cfg["plant"],
                "mode": "apply" if args.apply else "dry-run",
                "mismatch_rows": len(rows),
                "created_at": datetime.now().isoformat(),
            }

            net = sum(float(r["calc"]) - float(r["duration"] or 0) for r in rows)
            meta["net_hours_change"] = round(net, 2)
            worst = max((abs(float(r["calc"]) - float(r["duration"] or 0)) for r in rows), default=0.0)
            meta["max_abs_change"] = round(worst, 2)

            print(f"[{args.target}] baris mismatch          : {len(rows)}")
            print(f"[{args.target}] perubahan neto jam      : {net:+.2f}")
            print(f"[{args.target}] selisih terbesar per row: {worst:.2f}")

            args.report_dir.mkdir(parents=True, exist_ok=True)
            with (args.report_dir / "duration_fix.csv").open("w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["tsnumber", "confirmationnumber", "activitytype", "state_flag",
                            "checkin", "checkout", "duration_lama", "duration_baru", "delta"])
                for r in rows:
                    old = float(r["duration"]) if r["duration"] is not None else None
                    w.writerow([r["tsnumber"], r["confirmationnumber"], r["activitytype"],
                                r["state_flag"], r["ci"], r["co"], r["duration"], r["calc"],
                                None if old is None else round(float(r["calc"]) - old, 2)])

            if not args.apply:
                (args.report_dir / "summary.json").write_text(
                    json.dumps(meta, indent=2, default=str), encoding="utf-8")
                conn.rollback()
                print(f"[{args.target}] DRY-RUN — laporan: {args.report_dir}")
                return 0

            if not rows:
                (args.report_dir / "summary.json").write_text(
                    json.dumps(meta, indent=2, default=str), encoding="utf-8")
                conn.rollback()
                print(f"[{args.target}] duration sudah konsisten, tidak ada yang diubah.")
                return 0

            if not args.yes:
                conn.rollback()
                print("Gunakan --yes untuk mengeksekusi.")
                return 1

            ids = [r["tsnumber"] for r in rows]

            cur.execute("""
                SELECT tsnumber FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[]) ORDER BY tsnumber FOR UPDATE
            """, (ids,))
            if len(cur.fetchall()) != len(ids):
                raise RuntimeError("jumlah row terkunci tidak sesuai target")

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = f"timesheet_duration_fix_backup_{stamp}"
            cur.execute(
                sql.SQL("CREATE TABLE public.{} AS SELECT * FROM public.timesheet_transaction "
                        "WHERE tsnumber = ANY(%s::int[])").format(sql.Identifier(backup)),
                (ids,))
            cur.execute(sql.SQL("SELECT count(*) AS n FROM public.{}").format(sql.Identifier(backup)))
            if cur.fetchone()["n"] != len(ids):
                raise RuntimeError("backup tidak lengkap")
            meta["backup_table"] = f"public.{backup}"
            print(f"[{args.target}] backup: public.{backup} ({len(ids)} row)")

            # Hanya duration yang ditulis; timestamp dibiarkan apa adanya.
            cur.execute("""
                UPDATE public.timesheet_transaction
                SET duration = ROUND((EXTRACT(EPOCH FROM (longdate_checkout - longdate_checkin)) / 3600.0)::numeric, 2),
                    modified_at = now()
                WHERE tsnumber = ANY(%s::int[])
            """, (ids,))
            meta["rows_updated"] = cur.rowcount
            print(f"[{args.target}] row ter-UPDATE: {cur.rowcount}")

            # --- Verifikasi pra-commit ---
            cur.execute(FIND_SQL, {"plant": cfg["plant"], "tz": cfg["tz"], "eps": MISMATCH_EPSILON})
            residual = cur.fetchall()
            if residual:
                raise RuntimeError(f"guard: masih ada {len(residual)} baris mismatch setelah UPDATE")

            cur.execute("""
                SELECT count(*) AS n FROM public.timesheet_transaction
                WHERE tsnumber = ANY(%s::int[]) AND duration < 0
            """, (ids,))
            if cur.fetchone()["n"]:
                raise RuntimeError("guard: ada duration negatif")

            # Timestamp wajib tidak berubah dibanding backup.
            cur.execute(
                sql.SQL("""
                    SELECT count(*) AS n
                    FROM public.timesheet_transaction t
                    JOIN public.{} b USING (tsnumber)
                    WHERE t.longdate_checkin  IS DISTINCT FROM b.longdate_checkin
                       OR t.longdate_checkout IS DISTINCT FROM b.longdate_checkout
                """).format(sql.Identifier(backup)))
            if cur.fetchone()["n"]:
                raise RuntimeError("guard: timestamp ikut berubah — seharusnya tidak")

            print(f"[{args.target}] verifikasi: 0 sisa mismatch, timestamp utuh")

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
