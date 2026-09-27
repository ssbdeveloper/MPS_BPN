"""Preview invariant alokasi terhadap production — READ-ONLY.

Memakai modul timesheet_allocation (sama dengan yang dipakai stager) supaya
angka preview dan angka produksi berasal dari satu implementasi.

Tidak ada UPDATE/DDL. Koneksi di-set read-only di level session.

Jalankan:
    python preview_allocation_invariant.py --from 2026-09-01 --to 2026-09-22
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras

from sap_staging_common import load_sap_rules
from stage_timesheet_transaction import allocate_staging_rows
from timesheet_allocation import Record, allocate_records
from timesheet_normalization import normalize_timesheet_rows

PLANTS = {
    "cikupa": {"host": "100.80.101.53", "plant": "5100", "tz": "Asia/Jakarta"},
    "bpn": {"host": "100.86.231.55", "plant": "5051", "tz": "Asia/Makassar"},
}

SQL = """
SELECT t.tsnumber, t.serialnumber, t.activitytype, t.order_no, t.workcentercode,
       date_trunc('second', t.longdate_checkin  AT TIME ZONE %(tz)s) AS ci,
       date_trunc('second', t.longdate_checkout AT TIME ZONE %(tz)s) AS co
FROM public.timesheet_transaction t
WHERE COALESCE(t.plant::text,'') = %(plant)s
  AND COALESCE(t.state_flag,0) <> 5
  AND COALESCE(t.activitytype,'') <> '0000'
  AND t.longdate_checkin IS NOT NULL
  AND t.longdate_checkout IS NOT NULL
  AND t.longdate_checkout > t.longdate_checkin
  -- #23: pilih setiap interval yang OVERLAP [from,to), bukan hanya check-in
  -- yang jatuh di dalam window. Clipping final dilakukan oleh normalizer.
  AND (t.longdate_checkout AT TIME ZONE %(tz)s) > %(from)s
  AND (t.longdate_checkin  AT TIME ZONE %(tz)s) < %(to)s
"""


def calculate_preview(
    rows: list[dict],
    rules: dict,
    *,
    clip_start: datetime,
    clip_end: datetime,
) -> dict:
    """Hitung preview memakai normalizer + allocator stager yang sama persis."""
    normalized = normalize_timesheet_rows(
        rows, rules, clip_start=clip_start, clip_end=clip_end
    )
    allocated = allocate_staging_rows(normalized)
    records = {
        int(row["tsnumber"]): {
            "raw_seconds": int(row["raw_seconds"]),
            "allocated_seconds": int(row["allocated_seconds"]),
            "cap_minutes": row.get("cap_minutes"),
            "sap_effective_seconds": int(row["sap_effective_seconds"]),
            "activitytype": row.get("activitytype") or "",
            "order_no": row.get("order_no") or "",
            "serialnumber": row.get("serialnumber") or "",
            "alloc_start": row["alloc_start"],
            "alloc_end": row["alloc_end"],
        }
        for row in allocated
    }
    return {"records": records, "normalized": normalized, "allocated": allocated}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from", dest="from_d", required=True)
    ap.add_argument("--to", dest="to_d", required=True)
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()

    env = {}
    for line in Path("D:/MPS2/.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

    report = {}
    exit_code = 0
    for name, cfg in PLANTS.items():
        conn = psycopg2.connect(host=cfg["host"], port=5433, dbname=env["DB_NAME"],
                                user=env["DB_USER"], password=env["DB_PASSWORD"],
                                connect_timeout=15)
        conn.set_session(readonly=True)
        rules = load_sap_rules(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET LOCAL statement_timeout='300s'")
            cur.execute(SQL, {"plant": cfg["plant"], "tz": cfg["tz"],
                              "from": args.from_d, "to": args.to_d})
            db_rows = [dict(row) for row in cur.fetchall()]
        conn.close()

        clip_start = datetime.fromisoformat(args.from_d)
        clip_end = datetime.fromisoformat(args.to_d)
        input_rows = [{
            "tsnumber": row["tsnumber"],
            "serialnumber": row["serialnumber"] or "",
            "activitytype": row["activitytype"] or "",
            "order_no": row["order_no"] or "",
            "start": row["ci"],
            "end": row["co"],
        } for row in db_rows]
        calculation = calculate_preview(
            input_rows, rules, clip_start=clip_start, clip_end=clip_end
        )
        normalized = calculation["normalized"]
        calculated = calculation["records"]

        # Invariant memakai interval yang sudah di-trunc+clip oleh normalizer yang
        # sama. Ini mencegah query preview menghitung interval di luar window.
        records = [Record(
            tsnumber=r["tsnumber"], serialnumber=r["serialnumber"],
            start=r["alloc_start"], end=r["alloc_end"],
            activitytype=r["activitytype"], order_no=r["order_no"],
        ) for r in normalized]
        by_ts = {r.tsnumber: r for r in records}
        res = allocate_records(records)

        # --- INVARIANT: SUM(allocated) produktif per operator-tanggal == union ---
        per_day = defaultdict(int)
        for seg in res.segments:
            if by_ts[seg.tsnumber].is_productive:
                per_day[(seg.serialnumber, seg.allocation_date)] += seg.allocated_seconds
        checked = failed = 0
        worst = []
        for key, union_s in res.union_seconds.items():
            checked += 1
            got = per_day.get(key, 0)
            if got != union_s:
                failed += 1
                worst.append({"operator": key[0], "date": str(key[1]),
                              "union": union_s, "allocated": got})

        prod = [r for r in records if r.is_productive]
        nonprod = [r for r in records if not r.is_productive]
        prod_ids = {r.tsnumber for r in prod}
        nonprod_ids = {r.tsnumber for r in nonprod}
        raw_prod = sum(calculated[ts]["raw_seconds"] for ts in prod_ids if ts in calculated)
        alloc_prod = sum(calculated[ts]["allocated_seconds"] for ts in prod_ids if ts in calculated)
        sap_prod = sum(calculated[ts]["sap_effective_seconds"] for ts in prod_ids if ts in calculated)
        sap_np = sum(calculated[ts]["sap_effective_seconds"] for ts in nonprod_ids if ts in calculated)

        status = "LOLOS" if failed == 0 else f"GAGAL {failed}"
        print("=" * 74)
        print(f"{name.upper()}  plant={cfg['plant']}  tz={cfg['tz']}  {args.from_d}..{args.to_d}")
        print(f"  record produktif / non-produktif : {len(prod)} / {len(nonprod)}")
        print(f"  raw_seconds        produktif : {raw_prod/3600:>10.1f} jam")
        print(f"  allocated_seconds  produktif : {alloc_prod/3600:>10.1f} jam"
              f"   ({(alloc_prod-raw_prod)/3600:+.1f})")
        print(f"  sap_effective      produktif : {sap_prod/3600:>10.1f} jam"
              f"   (cap memotong {(alloc_prod-sap_prod)/3600:.1f})")
        print(f"  sap_effective  non-produktif : {sap_np/3600:>10.1f} jam")
        print(f"  INVARIANT operator-tanggal   : {checked-failed}/{checked} {status}")
        if worst:
            print(f"    contoh gagal: {worst[:3]}")
            exit_code = 1

        report[name] = {
            "plant": cfg["plant"], "tz": cfg["tz"],
            "window": [args.from_d, args.to_d],
            "records_productive": len(prod), "records_nonproductive": len(nonprod),
            "raw_hours": round(raw_prod / 3600, 2),
            "allocated_hours": round(alloc_prod / 3600, 2),
            "sap_effective_hours_productive": round(sap_prod / 3600, 2),
            "sap_effective_hours_nonproductive": round(sap_np / 3600, 2),
            "invariant_checked": checked, "invariant_failed": failed,
            "invariant_examples": worst[:10],
        }

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nJSON: {args.json_out}")
    print("\nHASIL:", "SEMUA INVARIANT LOLOS" if exit_code == 0 else "ADA INVARIANT GAGAL")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
