"""
etl_machine_conf.py
Update SQL Server ProductionData.JobID using confirmation_number
looked up from PostgreSQL via timesheet_transaction → ph3_order chain.

Performa: bulk lookup — hanya 2 query PostgreSQL per batch, bukan 20.000.

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

BATCH_SIZE = 5000

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
# Core ETL — bulk lookup strategy
# ---------------------------------------------------------------------------
def fetch_production_data(cursor: pyodbc.Cursor, offset: int) -> list[dict]:
    sql = """
        SELECT ProdDataID, JobID, StartDateTime
        FROM ProductionData
        WHERE JobID <> ''
          AND (JobID LIKE '1%' OR JobID LIKE '3%')
          AND StartDateTime >= '2026-01-01'
        ORDER BY ProdDataID
        OFFSET ? ROWS
        FETCH NEXT ? ROWS ONLY
    """
    cursor.execute(sql, (offset, BATCH_SIZE))
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _make_naive(dt):
    """Strip timezone so offset-naive and offset-aware datetimes can be compared."""
    if dt is None:
        return None
    if hasattr(dt, "tzinfo") and dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def bulk_lookup_timesheet(pg_cursor, rows: list[dict]) -> dict:
    """
    Given ProductionData rows [ {ProdDataID, JobID, StartDateTime}, ... ],
    find the closest timesheet_transaction per JobID in ONE query.
    Returns { ProdDataID: {"order_no": ..., "operation_no": ...} }
    """
    if not rows:
        return {}

    job_ids = list({r["JobID"].strip() for r in rows if r.get("JobID")})

    if not job_ids:
        return {}

    sql = """
        SELECT order_no, operation_no, longdate_checkin
        FROM timesheet_transaction
        WHERE order_no = ANY(%s)
          AND longdate_checkin IS NOT NULL
        ORDER BY order_no, longdate_checkin
    """
    pg_cursor.execute(sql, (job_ids,))
    pg_rows = pg_cursor.fetchall()

    by_order: dict[str, list[tuple]] = {}
    for r in pg_rows:
        order_no = (r[0] or "").strip()
        op_no = r[1]
        ts = _make_naive(r[2])
        by_order.setdefault(order_no, []).append((op_no, ts))

    result: dict[int, dict] = {}
    for row in rows:
        pid = row["ProdDataID"]
        order_no = (row["JobID"] or "").strip()
        start_dt = _make_naive(row["StartDateTime"])

        candidates = by_order.get(order_no)
        if not candidates:
            continue

        if start_dt and isinstance(start_dt, datetime):
            target = start_dt
            closest = min(
                candidates,
                key=lambda c: abs((c[1] - target).total_seconds()) if c[1] else float("inf"),
            )
        else:
            closest = candidates[0]

        result[pid] = {"order_no": order_no, "operation_no": closest[0]}

    return result


def _strip_zero(v):
    """Strip leading zeros, keep at least '0' if result would be empty."""
    s = str(v).lstrip("0")
    return s if s else "0"


def bulk_lookup_confirmation(pg_cursor, ts_map: dict[int, dict]) -> dict[int, str]:
    """
    Given { ProdDataID: {order_no, operation_no} },
    bulk lookup confirmation_number from ph3_order.
    Both order_no and operation_no have leading zeros stripped
    before matching because ph3_order stores them zero-padded.
    Returns { ProdDataID: confirmation_number }
    """
    if not ts_map:
        return {}

    pairs = list({
        (v["order_no"], str(v["operation_no"]))
        for v in ts_map.values()
        if v.get("operation_no") is not None
    })

    if not pairs:
        return {}

    values_clause = ", ".join(
        f"({pg_cursor.mogrify('%s', (o,)).decode()}, {pg_cursor.mogrify('%s', (op,)).decode()})"
        for o, op in pairs
    )

    sql = f"""
        SELECT order_no, operation_no, confirmation_number
        FROM ph3_order
        WHERE (LTRIM(order_no, '0'), LTRIM(operation_no, '0')) IN ({values_clause})
    """
    pg_cursor.execute(sql)
    pg_rows = pg_cursor.fetchall()

    confirmation_by_key: dict[tuple, str] = {}
    for r in pg_rows:
        key = (
            _strip_zero(r[0]) if r[0] is not None else "",
            _strip_zero(r[1]) if r[1] is not None else "",
        )
        val = r[2]
        if val:
            confirmation_by_key[key] = str(val)

    result: dict[int, str] = {}
    for pid, ts in ts_map.items():
        key = (
            _strip_zero(ts["order_no"]),
            _strip_zero(ts["operation_no"]) if ts["operation_no"] is not None else "",
        )
        conf = confirmation_by_key.get(key)
        if conf:
            result[pid] = conf

    return result


def update_jobid(cursor: pyodbc.Cursor, prod_data_id: int, new_jobid: str) -> None:
    cursor.execute(
        "UPDATE ProductionData SET JobID = ? WHERE ProdDataID = ?",
        (new_jobid, prod_data_id),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="ETL: Update ProductionData.JobID from PostgreSQL lookup"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview mode, no actual updates"
    )
    args = parser.parse_args()

    dry_run: bool = args.dry_run

    log.info(
        "Starting ETL machine confirmation%s (BATCH_SIZE=%d)",
        " (DRY RUN)" if dry_run else "",
        BATCH_SIZE,
    )
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

            ts_lookup_start = datetime.now()
            ts_map = bulk_lookup_timesheet(pg_cursor, rows)
            ts_elapsed = (datetime.now() - ts_lookup_start).total_seconds()
            log.debug("  timesheet bulk lookup: %.1fs (%d matches)", ts_elapsed, len(ts_map))

            conf_start = datetime.now()
            conf_map = bulk_lookup_confirmation(pg_cursor, ts_map)
            conf_elapsed = (datetime.now() - conf_start).total_seconds()
            log.debug("  confirmation bulk lookup: %.1fs (%d matches)", conf_elapsed, len(conf_map))

            for row in rows:
                total_rows += 1
                prod_id = row["ProdDataID"]
                job_id = row["JobID"]

                ts = ts_map.get(prod_id)
                if not ts:
                    skipped_no_timesheet += 1
                    continue

                confirmation = conf_map.get(prod_id)
                if not confirmation:
                    skipped_no_confirmation += 1
                    continue

                if dry_run:
                    updated += 1
                    log.info(
                        "DRY-RUN ProdDataID=%d JobID %r -> %s  (order_no=%s op=%s)",
                        prod_id, job_id, confirmation, ts["order_no"], ts["operation_no"],
                    )
                else:
                    try:
                        update_jobid(mssql_cursor, prod_id, confirmation)
                        updated += 1
                        log.info(
                            "UPDATED ProdDataID=%d JobID %r -> %s",
                            prod_id, job_id, confirmation,
                        )
                    except Exception as exc:
                        failed += 1
                        log.error("FAILED ProdDataID=%d JobID=%r: %s", prod_id, job_id, exc)

            if not dry_run:
                mssql_conn.commit()
                log.info(
                    "Committed batch offset=%d (updated=%d, skipped_ts=%d, skipped_conf=%d, failed=%d)",
                    offset, updated, skipped_no_timesheet, skipped_no_confirmation, failed,
                )

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
