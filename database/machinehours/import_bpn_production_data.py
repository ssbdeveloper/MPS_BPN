import argparse
import csv
import os
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_CSV = ROOT_DIR / "database" / "machinehours" / "BPN_ProductionData.csv"
TABLE_NAME = "public.mch_productiondata"
CSV_COLUMNS = [
    "ProdDataID",
    "StartDateTime",
    "EndDateTime",
    "MachineNo",
    "StatusID",
    "PreviousStatusID",
    "Duration",
    "Notes",
    "OperatorID",
    "JobID",
    "JobComplete",
]
DB_COLUMNS = [
    "proddataid",
    "startdatetime",
    "enddatetime",
    "machineno",
    "statusid",
    "previoustatusid",
    "duration",
    "Notes",
    "operatorid",
    "jobid",
    "JobComplete",
]
INT_COLUMNS = {"ProdDataID", "MachineNo", "StatusID", "PreviousStatusID", "Duration"}
BOOL_COLUMNS = {"JobComplete"}


def load_env(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def normalize_value(column: str, value: str):
    if value is None:
        return None

    cleaned = value.strip()
    if cleaned == "" or cleaned.upper() == "NULL":
        return None

    if column in INT_COLUMNS:
        return int(cleaned)

    if column in BOOL_COLUMNS:
        lowered = cleaned.lower()
        if lowered in {"1", "true", "t", "yes", "y"}:
            return True
        if lowered in {"0", "false", "f", "no", "n"}:
            return False
        raise ValueError(f"Invalid boolean value for {column}: {value!r}")

    return cleaned


def parse_record(buffer: str) -> list[str]:
    return next(csv.reader([buffer]))


def iter_records(csv_path: Path):
    # Source file contains non-UTF8 bytes in some note fields, so latin-1 keeps it readable.
    with csv_path.open("r", newline="", encoding="latin-1") as handle:
        header = parse_record(handle.readline().rstrip("\r\n"))
        if header != CSV_COLUMNS:
            raise ValueError(
                f"CSV columns do not match target table.\n"
                f"Expected: {CSV_COLUMNS}\n"
                f"Actual:   {header}"
            )

        for raw_line in handle:
            buffer = raw_line.rstrip("\r\n")
            if not buffer:
                continue

            fields = parse_record(buffer)
            while len(fields) < len(CSV_COLUMNS):
                next_line = handle.readline()
                if not next_line:
                    break
                buffer += next_line.rstrip("\r\n")
                fields = parse_record(buffer)

            if len(fields) == 1 and fields[0].startswith("(") and fields[0].endswith("rows affected)"):
                continue

            if len(fields) != len(CSV_COLUMNS):
                raise ValueError(f"Invalid field count {len(fields)} for record: {buffer[:250]}")

            yield dict(zip(CSV_COLUMNS, fields))


def iter_rows(csv_path: Path, limit: int | None):
    for index, row in enumerate(iter_records(csv_path)):
        if limit is not None and index >= limit:
            break
        yield tuple(normalize_value(column, row[column]) for column in CSV_COLUMNS)


def connect():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "ptssb"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )


def import_rows(
    csv_path: Path,
    limit: int | None,
    chunk_size: int,
    truncate: bool,
    dry_run: bool,
) -> int:
    quoted_columns = ", ".join(f'"{column}"' for column in DB_COLUMNS)
    insert_sql = f"INSERT INTO {TABLE_NAME} ({quoted_columns}) VALUES %s"
    delete_sql = f"DELETE FROM {TABLE_NAME} WHERE proddataid = ANY(%s)"
    total_count = 0
    chunk = []

    if dry_run:
        for _ in iter_rows(csv_path, limit):
            total_count += 1
        return total_count

    with connect() as conn:
        with conn.cursor() as cursor:
            if truncate:
                cursor.execute(f"TRUNCATE TABLE {TABLE_NAME};")

            for row in iter_rows(csv_path, limit):
                chunk.append(row)
                if len(chunk) < chunk_size:
                    continue

                if not truncate:
                    prod_data_ids = [item[0] for item in chunk]
                    cursor.execute(delete_sql, (prod_data_ids,))
                execute_values(cursor, insert_sql, chunk, page_size=chunk_size)
                total_count += len(chunk)
                chunk = []

            if chunk:
                if not truncate:
                    prod_data_ids = [item[0] for item in chunk]
                    cursor.execute(delete_sql, (prod_data_ids,))
                execute_values(cursor, insert_sql, chunk, page_size=chunk_size)
                total_count += len(chunk)

    return total_count


def main():
    parser = argparse.ArgumentParser(
        description="Import BPN_ProductionData.csv into public.mch_productiondata."
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="CSV file path.")
    parser.add_argument("--limit", type=int, default=None, help="Import only the first N rows.")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=5000,
        help="Rows per insert batch.",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Clear mch_productiondata before importing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse the CSV and print the row count without inserting data.",
    )
    args = parser.parse_args()

    load_env(ROOT_DIR / ".env")
    imported_count = import_rows(args.csv, args.limit, args.chunk_size, args.truncate, args.dry_run)
    mode = "sample" if args.limit else "full"
    action = "Validated" if args.dry_run else "Imported"
    print(f"{action} {imported_count} {mode} rows into {TABLE_NAME}.")


if __name__ == "__main__":
    main()
