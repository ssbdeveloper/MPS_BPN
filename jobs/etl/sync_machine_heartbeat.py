"""
sync_machine_heartbeat.py

Copy [SSB_OEE].[dbo].[MachineHeartbeat] rows from SQL Server to PostgreSQL,
mirroring the columns, every 10 seconds. Runs forever (meant for Docker).

Strategy:
  - Columns copied: CreatedDate, MachineNo, Heartbeat, ID  (same as source)
  - Target table public.machine_heartbeat is auto-created; its column TYPES are
    introspected from the source so they stay "samain" with SQL Server.
  - Incremental by ID (identity ascending) -> only new rows are copied each cycle,
    so it is cheap to run every 10s even when the source table is huge.
  - Idempotent upsert (ON CONFLICT (id) DO UPDATE) so re-runs never duplicate.

Credentials are hardcoded per request.
"""
import logging
import time

import psycopg2
import psycopg2.extras
import pymssql

# ---------------------------------------------------------------------------
# Hardcoded credentials
# ---------------------------------------------------------------------------
# NOTE: driver via pymssql (bundled FreeTDS) — no system ODBC driver needed.
# "server" keeps the SQL Server "host,port" form; it is split for pymssql below.
SQLSERVER_CONFIG = {
    "server":   "10.169.2.76,61878",
    "database": "SSB_OEE",
    "username": "tag",
    "password": "@dminta9",
}

POSTGRES_CONFIG = {
    "host":     "10.169.1.12",
    "port":     5433,
    "dbname":   "ptssb",
    "user":     "tag",
    "password": "@dminta9",
}

SOURCE_TABLE = "dbo.MachineHeartbeat"
SOURCE_SCHEMA = "dbo"
SOURCE_NAME = "MachineHeartbeat"
TARGET_TABLE = "public.machine_heartbeat"
BATCH_SIZE = 1000
INTERVAL_SECONDS = 10

# SQL Server -> PostgreSQL type map (whitelist; unknown types fall back to text).
SQLSERVER_TO_PG = {
    "bigint": "bigint",
    "int": "integer",
    "smallint": "smallint",
    "tinyint": "smallint",
    "bit": "boolean",
    "decimal": "numeric",
    "numeric": "numeric",
    "money": "numeric",
    "smallmoney": "numeric",
    "float": "double precision",
    "real": "real",
    "datetime": "timestamp",
    "datetime2": "timestamp",
    "smalldatetime": "timestamp",
    "datetimeoffset": "timestamptz",
    "date": "date",
    "time": "time",
    "char": "text",
    "nchar": "text",
    "varchar": "text",
    "nvarchar": "text",
    "text": "text",
    "ntext": "text",
    "uniqueidentifier": "uuid",
    "binary": "bytea",
    "varbinary": "bytea",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_machine_heartbeat")


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------
def connect_sqlserver():
    host, _, port = SQLSERVER_CONFIG["server"].partition(",")
    return pymssql.connect(
        server=host.strip(),
        port=int(port.strip()) if port.strip() else 1433,
        user=SQLSERVER_CONFIG["username"],
        password=SQLSERVER_CONFIG["password"],
        database=SQLSERVER_CONFIG["database"],
        timeout=30,
        login_timeout=30,
        autocommit=True,
    )


def connect_postgres():
    conn = psycopg2.connect(**POSTGRES_CONFIG)
    conn.autocommit = False
    return conn


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
def fetch_source_column_types(mssql_cursor) -> dict:
    """Return {lower_column_name: sqlserver_data_type} for the source table."""
    mssql_cursor.execute(
        """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
        """,
        (SOURCE_SCHEMA, SOURCE_NAME),
    )
    return {row[0].lower(): str(row[1]).lower() for row in mssql_cursor.fetchall()}


def pg_type_for(col_types: dict, column: str, fallback_sql_type: str) -> str:
    sql_type = col_types.get(column, fallback_sql_type)
    return SQLSERVER_TO_PG.get(sql_type, "text")


def ensure_target_table(pg_conn, col_types: dict) -> None:
    id_type = pg_type_for(col_types, "id", "bigint")
    created_type = pg_type_for(col_types, "createddate", "datetime")
    machineno_type = pg_type_for(col_types, "machineno", "int")
    heartbeat_type = pg_type_for(col_types, "heartbeat", "int")

    ddl = f"""
    CREATE TABLE IF NOT EXISTS {TARGET_TABLE} (
        id          {id_type} PRIMARY KEY,
        createddate {created_type},
        machineno   {machineno_type},
        heartbeat   {heartbeat_type}
    );
    CREATE INDEX IF NOT EXISTS idx_machine_heartbeat_createddate
        ON {TARGET_TABLE} (createddate);
    CREATE INDEX IF NOT EXISTS idx_machine_heartbeat_machineno
        ON {TARGET_TABLE} (machineno);
    """
    with pg_conn.cursor() as cur:
        cur.execute(ddl)
    pg_conn.commit()
    log.info(
        "Target table ready: id=%s createddate=%s machineno=%s heartbeat=%s",
        id_type, created_type, machineno_type, heartbeat_type,
    )


# ---------------------------------------------------------------------------
# Copy
# ---------------------------------------------------------------------------
UPSERT_SQL = f"""
INSERT INTO {TARGET_TABLE} (id, createddate, machineno, heartbeat)
VALUES %s
ON CONFLICT (id) DO UPDATE SET
    createddate = EXCLUDED.createddate,
    machineno   = EXCLUDED.machineno,
    heartbeat   = EXCLUDED.heartbeat
"""


def get_last_id(pg_conn) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(f"SELECT COALESCE(MAX(id), 0) FROM {TARGET_TABLE}")
        return cur.fetchone()[0] or 0


def fetch_new_rows(mssql_cursor, last_id: int) -> list:
    mssql_cursor.execute(
        f"""
        SELECT TOP ({BATCH_SIZE}) [CreatedDate], [MachineNo], [Heartbeat], [ID]
        FROM {SOURCE_TABLE}
        WHERE [ID] > %s
        ORDER BY [ID]
        """,
        (last_id,),
    )
    return mssql_cursor.fetchall()


def upsert_rows(pg_conn, rows: list) -> None:
    # SELECT order is CreatedDate(0), MachineNo(1), Heartbeat(2), ID(3);
    # target column order is (id, createddate, machineno, heartbeat).
    values = [(r[3], r[0], r[1], r[2]) for r in rows]
    with pg_conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, UPSERT_SQL, values, page_size=BATCH_SIZE)
    pg_conn.commit()


def sync_cycle(mssql_conn, pg_conn) -> int:
    mssql_cursor = mssql_conn.cursor()
    total = 0
    try:
        last_id = get_last_id(pg_conn)
        while True:
            rows = fetch_new_rows(mssql_cursor, last_id)
            if not rows:
                break
            upsert_rows(pg_conn, rows)
            last_id = rows[-1][3]
            total += len(rows)
            if len(rows) < BATCH_SIZE:
                break
    finally:
        mssql_cursor.close()
    return total


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main() -> None:
    log.info(
        "MachineHeartbeat sync: %s/%s -> %s:%s/%s every %ds",
        SQLSERVER_CONFIG["server"], SQLSERVER_CONFIG["database"],
        POSTGRES_CONFIG["host"], POSTGRES_CONFIG["port"], POSTGRES_CONFIG["dbname"],
        INTERVAL_SECONDS,
    )

    mssql_conn = None
    pg_conn = None
    table_ready = False

    while True:
        try:
            if mssql_conn is None:
                mssql_conn = connect_sqlserver()
            if pg_conn is None or pg_conn.closed:
                pg_conn = connect_postgres()
            if not table_ready:
                probe = mssql_conn.cursor()
                try:
                    col_types = fetch_source_column_types(probe)
                finally:
                    probe.close()
                ensure_target_table(pg_conn, col_types)
                table_ready = True

            copied = sync_cycle(mssql_conn, pg_conn)
            if copied:
                log.info("Copied %d new row(s)", copied)
        except KeyboardInterrupt:
            log.info("Stopped by user.")
            break
        except (pymssql.Error, psycopg2.Error) as exc:
            log.error("Sync error, will reconnect next cycle: %s", exc)
            for conn in (mssql_conn, pg_conn):
                try:
                    if conn:
                        conn.close()
                except Exception:
                    pass
            mssql_conn = None
            pg_conn = None
            table_ready = False
        except Exception as exc:  # noqa: BLE001 - keep the daemon alive
            log.exception("Unexpected error: %s", exc)

        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
