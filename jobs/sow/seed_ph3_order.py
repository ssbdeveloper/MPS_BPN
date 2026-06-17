"""
seed_ph3_order.py
Seed data dari Excel ke table ph3_order di database ptssb.
Data mulai dari row 3 (row 1 = header kolom, row 2 = nama field SAP).
Optimized untuk data besar (300k+ rows) menggunakan bulk insert.
"""

import sys
from pathlib import Path
import openpyxl
import psycopg2
from psycopg2.extras import execute_values

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
EXCEL_FILE = str(PROJECT_ROOT / "samples" / "excel" / "List Final Order.xlsx")
DATA_START_ROW = 3  # row 1 = header, row 2 = SAP field names, row 3 = data

DB_CONFIG = {
    "host":     "100.86.231.55",
    "port":     5433,
    "dbname":   "ptssb",
    "user":     "tag",
    "password": "@dminta9",
}

TARGET_TABLE = "ph3_order"

COLUMNS = [
    "order_no",
    "operation_no",
    "sequence_number",
    "sequence_category",
    "branch_operation_no",
    "return_operation_no",
    "indicator_code",
    "confirmation_number",
    "operation_short_text",
    "material_no",
    "material_description",
    "operation_description",
    "work_center",
    "cost_center",
    "plant_code",
    "unit_of_measure",
    "standard_value",
    "order_type",
    "order_description",
]

UPDATE_COLS = [c for c in COLUMNS if c != "confirmation_number"]

BATCH_SIZE = 5000  # jumlah row per commit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean(value):
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v if v else None
    return value


def build_upsert_sql(table: str) -> str:
    col_list = ", ".join(COLUMNS)
    updates  = ", ".join(f"{c} = EXCLUDED.{c}" for c in UPDATE_COLS)
    return (
        f"INSERT INTO {table} ({col_list}) VALUES %s "
        f"ON CONFLICT (confirmation_number) DO UPDATE SET {updates}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    # 1. Baca Excel (streaming mode — hemat RAM)
    print(f"Membaca file: {EXCEL_FILE}")
    print("  (mode streaming, mohon tunggu...)")
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    ws = wb.active

    all_rows = []
    skipped  = 0
    for row in ws.iter_rows(min_row=DATA_START_ROW, values_only=True):
        if not any(cell is not None and str(cell).strip() != "" for cell in row):
            skipped += 1
            continue
        cleaned = [clean(cell) for cell in row]
        while len(cleaned) < len(COLUMNS):
            cleaned.append(None)
        all_rows.append(tuple(cleaned[:len(COLUMNS)]))

        if len(all_rows) % 50000 == 0:
            print(f"  Dibaca {len(all_rows):,} baris...")

    wb.close()
    total = len(all_rows)
    print(f"  Selesai baca: {total:,} baris data, {skipped} baris kosong dilewati.\n")

    if not all_rows:
        print("Tidak ada data. Selesai.")
        return

    # 2. Koneksi DB
    print(f"Koneksi ke {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['dbname']}...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
    except Exception as e:
        print(f"GAGAL koneksi: {e}")
        sys.exit(1)
    print("  Koneksi berhasil.\n")

    # 3. Bulk upsert per batch
    upsert_sql = build_upsert_sql(TARGET_TABLE)
    processed  = 0
    errors     = 0

    print(f"Mulai upsert ke {TARGET_TABLE} (batch size={BATCH_SIZE:,})...")
    try:
        with conn.cursor() as cur:
            for start in range(0, total, BATCH_SIZE):
                batch = all_rows[start:start + BATCH_SIZE]
                try:
                    execute_values(cur, upsert_sql, batch, page_size=BATCH_SIZE)
                    conn.commit()
                    processed += len(batch)
                    pct = processed / total * 100
                    print(f"  [{processed:>7,}/{total:,}] {pct:5.1f}% selesai")
                except Exception as e:
                    conn.rollback()
                    errors += len(batch)
                    print(f"  ERROR pada batch {start}–{start+len(batch)}: {e}")
    finally:
        conn.close()

    # 4. Ringkasan
    print(f"\n{'='*50}")
    print(f"Selesai!")
    print(f"  Berhasil : {processed:,}")
    print(f"  Error    : {errors:,}")
    print(f"  Total    : {total:,}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
