from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
ENV_PATH = PROJECT_ROOT / ".env"

load_dotenv(ENV_PATH)

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def setup_logging(name: str) -> logging.Logger:
    logging.basicConfig(level=os.getenv("SAP_STAGING_LOG_LEVEL", "INFO"), format=LOG_FORMAT)
    return logging.getLogger(name)


def env_value(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value in (None, "") else value.strip().strip("'").strip('"')


def env_int(name: str, default: int) -> int:
    value = env_value(name)
    if not value:
        return default
    return int(value)


def source_db_config() -> dict:
    return {
        "host": env_value("DB_HOST"),
        "port": env_int("DB_PORT", 5432),
        "dbname": env_value("DB_NAME"),
        "user": env_value("DB_USER"),
        "password": env_value("DB_PASSWORD"),
    }


def staging_db_config() -> dict:
    return {
        "host": env_value("SAP_STAGING_DB_HOST", env_value("DB_HOST")),
        "port": env_int("SAP_STAGING_DB_PORT", env_int("DB_PORT", 5432)),
        "dbname": env_value("SAP_STAGING_DB_NAME", env_value("DB_NAME")),
        "user": env_value("SAP_STAGING_DB_USER", env_value("DB_USER")),
        "password": env_value("SAP_STAGING_DB_PASSWORD", env_value("DB_PASSWORD")),
    }


def connect_source():
    return psycopg2.connect(**source_db_config())


def connect_staging():
    return psycopg2.connect(**staging_db_config())


def plant_code() -> str:
    return env_value("PLANT_SSB")


def app_timezone() -> str:
    return env_value("TIMEZONE", "Asia/Jakarta")


def ph3_order_table() -> str:
    return env_value("TGT_TABLE", "ph3_order")


def quote_identifier(identifier: str) -> str:
    if not identifier:
        raise ValueError("SQL identifier cannot be empty")
    return '"' + identifier.replace('"', '""') + '"'


def quote_table_name(table_name: str) -> str:
    return ".".join(quote_identifier(part.strip()) for part in table_name.split(".") if part.strip())


DDL = """
CREATE TABLE IF NOT EXISTS sap_timesheet_staging (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ztimesheetid text GENERATED ALWAYS AS (id::text) STORED,

  source_system text NOT NULL,
  source_key text NOT NULL,
  source_ref_id text,

  werks text NOT NULL DEFAULT '',
  pernr text NOT NULL DEFAULT '',
  pernr_origin text NOT NULL DEFAULT '',
  rueck text NOT NULL DEFAULT '',
  aufnr text NOT NULL DEFAULT '',
  vornr text NOT NULL DEFAULT '',
  flgat text NOT NULL DEFAULT '',
  plnfl text NOT NULL DEFAULT '',
  vornr_b text NOT NULL DEFAULT '',
  vornr_r text NOT NULL DEFAULT '',
  zconf_type text NOT NULL DEFAULT '',
  arbpl text NOT NULL DEFAULT '',
  lstar text NOT NULL DEFAULT '',
  isdd text NOT NULL DEFAULT '',
  isdz text NOT NULL DEFAULT '',
  iedd text NOT NULL DEFAULT '',
  iedz text NOT NULL DEFAULT '',
  aueru text NOT NULL DEFAULT '',
  zbarcodeid text NOT NULL DEFAULT '',

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  bucket_start timestamp without time zone,
  synthetic_start timestamp without time zone,
  synthetic_end timestamp without time zone,
  total_seconds bigint,

  source_row_count integer NOT NULL DEFAULT 1,
  source_min_start timestamp without time zone,
  source_max_end timestamp without time zone,

  status text NOT NULL DEFAULT 'PENDING',
  sap_response jsonb,
  sap_response_text text,
  sap_error text,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sap_timesheet_staging_source_uk UNIQUE (source_system, source_key),
  CONSTRAINT sap_timesheet_staging_status_ck CHECK (
    status IN ('PENDING', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT sap_timesheet_staging_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

-- Idempotent upgrade for pre-existing tables (CREATE TABLE IF NOT EXISTS above
-- won't add new columns to a table that already exists).
ALTER TABLE sap_timesheet_staging
  ADD COLUMN IF NOT EXISTS pernr_origin text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_status_idx
  ON sap_timesheet_staging (status, created_at);

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_source_idx
  ON sap_timesheet_staging (source_system, source_ref_id);

CREATE INDEX IF NOT EXISTS sap_timesheet_staging_bucket_idx
  ON sap_timesheet_staging (source_system, bucket_start);

CREATE TABLE IF NOT EXISTS sap_stage_cursor (
  source_system text NOT NULL,
  plant text NOT NULL,
  last_processed_at timestamp without time zone NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, plant),
  CONSTRAINT sap_stage_cursor_source_system_ck CHECK (
    source_system IN ('TIMESHEET', 'MCH_HOURS')
  )
);

CREATE TABLE IF NOT EXISTS sap_staging_eligibility_audit (
  source_system text NOT NULL,
  source_key text NOT NULL,
  source_ref_id text,
  source_date date,
  plant text NOT NULL DEFAULT '',
  eligibility_status text NOT NULL,
  block_reason text,
  block_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_key)
);

CREATE INDEX IF NOT EXISTS sap_staging_eligibility_audit_date_idx
  ON sap_staging_eligibility_audit (source_system, source_date, eligibility_status);
"""


STAGING_COLUMNS = [
    "source_system",
    "source_key",
    "source_ref_id",
    "werks",
    "pernr",
    "pernr_origin",
    "rueck",
    "aufnr",
    "vornr",
    "flgat",
    "plnfl",
    "vornr_b",
    "vornr_r",
    "zconf_type",
    "arbpl",
    "lstar",
    "isdd",
    "isdz",
    "iedd",
    "iedz",
    "aueru",
    "zbarcodeid",
    "bucket_start",
    "synthetic_start",
    "synthetic_end",
    "total_seconds",
    "source_row_count",
    "source_min_start",
    "source_max_end",
]


PAYLOAD_UPDATE_SQL = """
UPDATE sap_timesheet_staging
SET payload = jsonb_build_object(
  'ZTIMESHEETID', ztimesheetid,
  'PERNR', pernr,
  'RUECK', rueck,
  'AUFNR', aufnr,
  'VORNR', vornr,
  'FLGAT', flgat,
  'PLNFL', plnfl,
  'VORNR_B', vornr_b,
  'VORNR_R', vornr_r,
  'ZCONF_TYPE', zconf_type,
  'ARBPL', arbpl,
  'LSTAR', lstar,
  'ISDD', isdd,
  'ISDZ', isdz,
  'IEDD', iedd,
  'IEDZ', iedz,
  'WERKS', werks,
  'AUERU', aueru,
  'ZBARCODEID', zbarcodeid
),
updated_at = now()
WHERE payload = '{}'::jsonb
  AND source_system = ANY(%s)
  AND source_key = ANY(%s)
"""


def ensure_staging_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def get_stage_cursor(conn, source_system: str, plant: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT last_processed_at
            FROM sap_stage_cursor
            WHERE source_system = %s
              AND plant = %s
            """,
            (source_system, plant),
        )
        row = cur.fetchone()
    return row[0] if row else None


def update_stage_cursor(conn, source_system: str, plant: str, last_processed_at) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sap_stage_cursor (source_system, plant, last_processed_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (source_system, plant)
            DO UPDATE SET
              last_processed_at = GREATEST(
                sap_stage_cursor.last_processed_at,
                EXCLUDED.last_processed_at
              ),
              updated_at = now()
            """,
            (source_system, plant, last_processed_at),
        )


def cursor_initial_from():
    from datetime import datetime

    raw = env_value("SAP_STAGE_INITIAL_FROM_TS", "2026-01-01T00:00:00")
    return datetime.fromisoformat(raw)


def cursor_overlap_minutes(default: int = 30) -> int:
    return env_int("SAP_STAGE_CURSOR_OVERLAP_MINUTES", default)


def cursor_safety_delay_minutes(default: int = 1) -> int:
    return env_int("SAP_STAGE_SAFETY_DELAY_MINUTES", default)


def insert_staging_rows(conn, rows: list[dict]) -> int:
    if not rows:
        return 0

    values = [[row.get(column) for column in STAGING_COLUMNS] for row in rows]
    columns_sql = ", ".join(STAGING_COLUMNS)
    # Refresh rows that are still PENDING so corrected source data (e.g. fixed machine-hour
    # durations) flows through on a re-stage. Rows already handed to SAP
    # (POSTING/POSTED/FAILED/SKIPPED) are left frozen. payload is reset to '{}' so the
    # PAYLOAD_UPDATE_SQL pass below rebuilds it from the refreshed columns.
    data_columns = [c for c in STAGING_COLUMNS if c not in ("source_system", "source_key")]
    set_sql = ", ".join(f"{c} = EXCLUDED.{c}" for c in data_columns)
    conflict_sql = (
        "ON CONFLICT (source_system, source_key) DO UPDATE SET "
        f"{set_sql}, payload = '{{}}'::jsonb, updated_at = now() "
        "WHERE sap_timesheet_staging.status = 'PENDING'"
    )

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"""
            INSERT INTO sap_timesheet_staging ({columns_sql})
            VALUES %s
            {conflict_sql}
            """,
            values,
            page_size=1000,
        )
        inserted = cur.rowcount

        source_systems = sorted({row["source_system"] for row in rows})
        source_keys = [row["source_key"] for row in rows]
        cur.execute(PAYLOAD_UPDATE_SQL, (source_systems, source_keys))

    conn.commit()
    return max(inserted, 0)


def upsert_eligibility_audit(conn, rows: list[dict]) -> int:
    if not rows:
        return 0

    columns = [
        "source_system",
        "source_key",
        "source_ref_id",
        "source_date",
        "plant",
        "eligibility_status",
        "block_reason",
        "block_detail",
    ]
    values = [[row.get(column) for column in columns] for row in rows]
    columns_sql = ", ".join(columns)

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"""
            INSERT INTO sap_staging_eligibility_audit ({columns_sql})
            VALUES %s
            ON CONFLICT (source_system, source_key)
            DO UPDATE SET
              source_ref_id = EXCLUDED.source_ref_id,
              source_date = EXCLUDED.source_date,
              plant = EXCLUDED.plant,
              eligibility_status = EXCLUDED.eligibility_status,
              block_reason = EXCLUDED.block_reason,
              block_detail = EXCLUDED.block_detail,
              observed_at = now(),
              updated_at = now()
            """,
            values,
            template="(%s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
            page_size=1000,
        )
        count = cur.rowcount

    conn.commit()
    return max(count, 0)


def parse_csv_ints(value: str | None) -> list[int]:
    if not value:
        return []
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def sap_credentials() -> tuple[str, str, str]:
    return (
        env_value("SAP_INBOUND_URL"),
        env_value("SAP_INBOUND_USERNAME"),
        env_value("SAP_INBOUND_PASSWORD"),
    )


def as_json(value) -> dict | list | str | int | float | bool | None:
    if value is None:
        return None
    if isinstance(value, (dict, list, str, int, float, bool)):
        return value
    return json.loads(json.dumps(value, default=str))


def mark_local_timesheet_rejected(tsnumbers: Iterable[str | int], sap_message: str) -> None:
    ids = [int(value) for value in tsnumbers if str(value).strip().isdigit()]
    if not ids:
        return
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE timesheet_transaction
                SET state_flag = 3,
                    validation_date = NULL
                WHERE tsnumber = ANY(%s::int[])
                """,
                (ids,),
            )
        conn.commit()
