"""
etl_machine_conf.py
Update SQL Server ProductionData.JobID using confirmation_number
looked up from PostgreSQL via timesheet_transaction → ph3_order chain.

Usage:
    python etl_machine_conf.py              # live run
    python etl_machine_conf.py --dry-run    # preview only, no updates
"""
import argparse
import logging
import sys
from datetime import datetime

import psycopg2
import psycopg2.extras
import pyodbc

# ---------------------------------------------------------------------------
# Credentials - hardcoded per task_etl.md
# ---------------------------------------------------------------------------
SQLSERVER_CONFIG = {
    "server":   "10.169.2.76,61142",
    "database": "SSB_OEE",
    "username": "tag",
    "password": "@dminta9",
    "driver":   "ODBC Driver 17 for SQL Server",
}

POSTGRES_CONFIG = {
    "host":     "10.169.1.12",
    "port":     5433,
    "dbname":   "ptssb",
    "user":     "tag",
    "password": "@dminta9",
}

BATCH_SIZE = 200

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl_machine_conf")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def connect_sqlserver():
    conn_str = (
        f"DRIVER={{{SQLSERVER_CONFIG['driver']}}};"
        f"SERVER={SQLSERVER_CONFIG['server']};"
        f"DATABASE={SQLSERVER_CONFIG['database']};"
        f"UID={SQLSERVER_CONFIG['username']};"
        f"PWD={SQLSERVER_CONFIG['password']};"
    )
    return pyodbc.connect(conn_str, timeout=30)


def connect_postgres():
    return psycopg2.connect(**POSTGRES_CONFIG)


# ---------------------------------------------------------------------------
# Core ETL
# ---------------------------------------------------------------------------
def fetch_production_data(cursor: pyodbc.Cursor, offset: int) -> list[dict]:
    """
    Fetch a batch of ProductionData rows where:
      - JobID <> ''
      - JobID starts with '1' or '3'
    """
    sql = """
        SELECT ProdDataID, JobID, StartDateTime
        FROM ProductionData
        WHERE JobID <> ''
          AND (JobID LIKE '1%' OR JobID LIKE '3%')
        ORDER BY ProdDataID
        OFFSET ? ROWS
        FETCH NEXT ? ROWS ONLY
    """
    cursor.execute(sql, (offset, BATCH_SIZE))
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def lookup_timesheet(pg_cursor, job_id: str, start_dt: datetime | None) -> dict | None:
    """
    Find the timesheet_transaction row whose longdate_checkin is
    closest to start_dt among rows where order_no = job_id.
    """
    sql = """
        SELECT order_no, operation_no, longdate_checkin
        FROM timesheet_transaction
        WHERE order_no = %s
          AND longdate_checkin IS NOT NULL
        ORDER BY ABS(
            EXTRACT(EPOCH FROM (longdate_checkin - %s::timestamptz))
        )
        LIMIT 1
    """
    ts_value = start_dt.isoformat() if start_dt else None
    pg_cursor.execute(sql, (job_id, ts_value))
    row = pg_cursor.fetchone()
    if not row:
        return None
    return {"order_no": row[0], "operation_no": row[1]}


def lookup_confirmation(pg_cursor, order_no: str, operation_no: str | int | None) -> str | None:
    """Lookup confirmation_number from ph3_order."""
    sql = """
        SELECT confirmation_number
        FROM ph3_order
        WHERE order_no = %s
          AND operation_no = %s::integer
        LIMIT 1
    """
    pg_cursor.execute(sql, (order_no, operation_no))
    row = pg_cursor.fetchone()
    return row[0] if row else None


def update_jobid(cursor: pyodbc.Cursor, prod_data_id: int, new_jobid: str) -> None:
    sql = "UPDATE ProductionData SET JobID = ? WHERE ProdDataID = ?"
    cursor.execute(sql, (new_jobid, prod_data_id))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="ETL: Update ProductionData.JobID from PostgreSQL lookup")
    parser.add_argument("--dry-run", action="store_true", help="Preview mode, no actual updates")
    args = parser.parse_args()

    dry_run: bool = args.dry_run

    log.info("Starting ETL machine confirmation%s", " (DRY RUN)" if dry_run else "")
    log.info("SQL Server: %s/%s", SQLSERVER_CONFIG["server"], SQLSERVER_CONFIG["database"])
    log.info("PostgreSQL:  %s:%s/%s", POSTGRES_CONFIG["host"], POSTGRES_CONFIG["port"], POSTGRES_CONFIG["dbname"])

    mssql_conn = None
    pg_conn = None
    mssql_cursor = None
    pg_cursor = None
    total_rows = 0
    updated = 0
    skipped_no_timesheet = 0
    skipped_no_confirmation = 0
    failed = 0

    try:
        mssql_conn = connect_sqlserver()
        mssql_conn.autocommit = False
        pg_conn = connect_postgres()

        mssql_cursor = mssql_conn.cursor()
        pg_cursor = pg_conn.cursor()

        offset = 0
        while True:
            rows = fetch_production_data(mssql_cursor, offset)
            if not rows:
                log.info("No more rows at offset %d.", offset)
                break

            log.info("Processing batch offset=%d, count=%d ...", offset, len(rows))

            for row in rows:
                total_rows += 1
                prod_id = row["ProdDataID"]
                job_id = row["JobID"]
                start_dt = row["StartDateTime"]

                # Step 1: Lookup closest timesheet_transaction
                ts = lookup_timesheet(pg_cursor, job_id, start_dt)
                if not ts:
                    skipped_no_timesheet += 1
                    log.debug(
                        "SKIP ProdDataID=%d JobID=%r — no matching timesheet_transaction",
                        prod_id, job_id,
                    )
                    continue

                # Step 2: Lookup confirmation_number from ph3_order
                order_no = ts["order_no"]
                operation_no = ts["operation_no"]
                confirmation = lookup_confirmation(pg_cursor, order_no, operation_no)

                if not confirmation:
                    skipped_no_confirmation += 1
                    log.debug(
                        "SKIP ProdDataID=%d JobID=%r order_no=%s op=%s — "
                        "no confirmation_number in ph3_order",
                        prod_id, job_id, order_no, operation_no,
                    )
                    continue

                # Step 3: Update
                confirmation_str = str(confirmation)
                if dry_run:
                    updated += 1
                    log.info(
                        "DRY-RUN ProdDataID=%d JobID %r -> %s  (order_no=%s op=%s)",
                        prod_id, job_id, confirmation_str, order_no, operation_no,
                    )
                else:
                    try:
                        update_jobid(mssql_cursor, prod_id, confirmation_str)
                        updated += 1
                        log.info(
                            "UPDATED ProdDataID=%d JobID %r -> %s  (order_no=%s op=%s)",
                            prod_id, job_id, confirmation_str, order_no, operation_no,
                        )
                    except Exception as exc:
                        failed += 1
                        log.error(
                            "FAILED ProdDataID=%d JobID=%r: %s",
                            prod_id, job_id, exc,
                        )

            if not dry_run and updated > 0:
                mssql_conn.commit()
                log.debug("Committed batch at offset %d.", offset)

            offset += BATCH_SIZE

    except KeyboardInterrupt:
        log.warning("Interrupted by user.")
    except Exception as exc:
        log.exception("Fatal error: %s", exc)
        sys.exit(1)
    finally:
        if mssql_cursor:
            try: mssql_cursor.close()
            except Exception: pass
        if pg_cursor:
            try: pg_cursor.close()
            except Exception: pass
        if mssql_conn:
            try: mssql_conn.close()
            except Exception: pass
        if pg_conn:
            try: pg_conn.close()
            except Exception: pass

    log.info("=" * 60)
    log.info("ETL Complete%s", " (DRY RUN)" if dry_run else "")
    log.info("  Total rows processed:        %d", total_rows)
    log.info("  Updated:                     %d", updated)
    log.info("  Skipped (no timesheet):      %d", skipped_no_timesheet)
    log.info("  Skipped (no confirmation):   %d", skipped_no_confirmation)
    log.info("  Failed updates:              %d", failed)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
