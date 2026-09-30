"""Uji fetch_rows terhadap production — READ-ONLY (hanya SELECT).

Membuktikan query SQL baru benar-benar jalan (placeholder cocok, companion
tertarik, alokasi terpakai) tanpa menulis apa pun ke staging.

Jalankan dari jobs/sap_staging:
    python verify_fetch_rows_readonly.py --target cikupa --from ... --to ...
"""
from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path


def load_env(target: str) -> None:
    """Set env koneksi source untuk plant terpilih.

    PENTING: sap_staging_common membaca DB_HOST/DB_PORT/DB_NAME/DB_USER/
    DB_PASSWORD — bukan SOURCE_DB_*. Memakai prefix yang salah membuat
    kedua target diam-diam menunjuk host yang sama di .env.
    """
    env = {}
    for line in Path("D:/MPS2/.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

    if target == "cikupa":
        host, plant, tz = "100.80.101.53", "5100", "Asia/Jakarta"
    else:
        host, plant, tz = "100.86.231.55", "5051", "Asia/Makassar"

    os.environ["DB_HOST"] = host
    os.environ["DB_PORT"] = "5433"
    os.environ["DB_NAME"] = env.get("DB_NAME", "ptssb")
    os.environ["DB_USER"] = env["DB_USER"]
    os.environ["DB_PASSWORD"] = env["DB_PASSWORD"]
    os.environ["PLANT_SSB"] = plant
    os.environ["TIMEZONE"] = tz


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["cikupa", "bpn"], required=True)
    ap.add_argument("--from", dest="from_ts", default="2026-09-20T00:00:00")
    ap.add_argument("--to", dest="to_ts", default="2026-09-21T00:00:00")
    ap.add_argument("--limit", type=int, default=100000)
    args = ap.parse_args()

    load_env(args.target)
    import stage_timesheet_transaction as mod

    rows = mod.fetch_rows(
        datetime.fromisoformat(args.from_ts),
        datetime.fromisoformat(args.to_ts),
        args.limit,
    )

    total = sum(int(r["total_seconds"]) for r in rows)
    prod = [r for r in rows if not (r.get("lstar") or "").strip()]
    nonprod = [r for r in rows if (r.get("lstar") or "").strip()]
    leftover = [k for r in rows for k in r if k.startswith("alloc_")]

    print(f"target          : {args.target}")
    print(f"window          : {args.from_ts} .. {args.to_ts}")
    print(f"baris di-emit   : {len(rows)}")
    print(f"  produktif     : {len(prod)}")
    print(f"  non-produktif : {len(nonprod)}")
    print(f"total detik     : {total} ({total/3600:.2f} jam)")
    print(f"sisa kolom alloc_: {len(leftover)} (harus 0)")

    assert not leftover, "kolom alloc_* bocor ke payload staging"
    assert all(int(r["total_seconds"]) > 0 for r in rows), "ada baris 0 detik"

    # Bandingkan dengan SUM(duration) mentah untuk menunjukkan efek alokasi.
    import psycopg2
    from sap_staging_common import connect_source, app_timezone, plant_code
    with connect_source() as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (
                         date_trunc('second', longdate_checkout)
                         - date_trunc('second', longdate_checkin)))), 0)::bigint
                FROM timesheet_transaction
                WHERE longdate_checkout >= (%s::timestamp AT TIME ZONE %s)
                  AND longdate_checkout <  (%s::timestamp AT TIME ZONE %s)
                  AND COALESCE(plant::text,'') = %s
                  AND COALESCE(state_flag,0) <> 5
                  AND COALESCE(activitytype,'') <> '0000'
                  AND longdate_checkin IS NOT NULL
                  AND longdate_checkout > longdate_checkin
                """,
                (args.from_ts, app_timezone(), args.to_ts, app_timezone(), plant_code()),
            )
            raw_total = int(cur.fetchone()[0])

    print(f"SUM(duration) mentah: {raw_total} detik ({raw_total/3600:.2f} jam)")
    delta = total - raw_total
    print(f"selisih         : {delta} detik ({delta/3600:.2f} jam)")
    print("OK: fetch_rows berjalan, read-only, tidak ada tulisan.")


if __name__ == "__main__":
    main()
