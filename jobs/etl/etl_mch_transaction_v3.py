"""
etl_mch_transaction_v3.py
Incremental PostgreSQL ETL that fills public.mch_transaction from public.mch_productiondata.

V2 avoids nearest-time lookup to public.timesheet_transaction. Operator fields are resolved
from public.mch_user using public.mch_productiondata.operatorid.

V3 resolves job data by splitting public.mch_productiondata.jobid in the format
order_no-operation_no, for example 100001235-10. PH3 and SOW fields are resolved
from public.ph3_order/public.sow using that order_no + operation_no pair.

Usage:
    python etl_mch_transaction_v3.py
    python etl_mch_transaction_v3.py --from 2026-05-01
    python etl_mch_transaction_v3.py --from 2026-05-01 --to 2026-05-11
    python etl_mch_transaction_v3.py --full-rebuild
    python etl_mch_transaction_v3.py --dry-run
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras

BATCH_SIZE = 5000
DEFAULT_FROM_DATE = "2026-01-01"
TARGET_TABLE = "public.mch_transaction"
SOURCE_TABLE = "public.mch_productiondata"
USER_TABLE = "public.mch_user"
SOW_TABLE = "public.sow"
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parent.parent,
)
ENV_PATH = PROJECT_ROOT / ".env"
CANDIDATE_TABLE = "pg_temp.mch_transaction_etl_candidates"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl_mch_transaction_v3")


UPSERT_SQL = """
INSERT INTO public.mch_transaction (
    proddataid,
    startdatetime,
    enddatetime,
    work_date,
    start_time,
    end_time,
    source_duration,
    duration_seconds,
    duration_hours,
    machineno,
    sitemachineno,
    machinegroupid,
    machine_plantid,
    machinetypeid,
    machineid,
    machinename,
    statusid,
    previoustatusid,
    status_description,
    status_activitytype,
    previous_status_description,
    confirmation_number,
    order_no,
    operation_no,
    operation_short_text,
    operation_description,
    sequence_category,
    sequence_number,
    branch_operation_no,
    return_operation_no,
    cost_center,
    material_no,
    material_description,
    ssbr_id,
    full_name,
    sn_employee,
    workcentercode,
    tsnumber,
    checkin,
    refreshed_at
)
VALUES %s
ON CONFLICT (proddataid) DO UPDATE SET
    startdatetime = EXCLUDED.startdatetime,
    enddatetime = EXCLUDED.enddatetime,
    work_date = EXCLUDED.work_date,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    source_duration = EXCLUDED.source_duration,
    duration_seconds = EXCLUDED.duration_seconds,
    duration_hours = EXCLUDED.duration_hours,
    machineno = EXCLUDED.machineno,
    sitemachineno = EXCLUDED.sitemachineno,
    machinegroupid = EXCLUDED.machinegroupid,
    machine_plantid = EXCLUDED.machine_plantid,
    machinetypeid = EXCLUDED.machinetypeid,
    machineid = EXCLUDED.machineid,
    machinename = EXCLUDED.machinename,
    statusid = EXCLUDED.statusid,
    previoustatusid = EXCLUDED.previoustatusid,
    status_description = EXCLUDED.status_description,
    status_activitytype = EXCLUDED.status_activitytype,
    previous_status_description = EXCLUDED.previous_status_description,
    confirmation_number = EXCLUDED.confirmation_number,
    order_no = EXCLUDED.order_no,
    operation_no = EXCLUDED.operation_no,
    operation_short_text = EXCLUDED.operation_short_text,
    operation_description = EXCLUDED.operation_description,
    sequence_category = EXCLUDED.sequence_category,
    sequence_number = EXCLUDED.sequence_number,
    branch_operation_no = EXCLUDED.branch_operation_no,
    return_operation_no = EXCLUDED.return_operation_no,
    cost_center = EXCLUDED.cost_center,
    material_no = EXCLUDED.material_no,
    material_description = EXCLUDED.material_description,
    ssbr_id = EXCLUDED.ssbr_id,
    full_name = EXCLUDED.full_name,
    sn_employee = EXCLUDED.sn_employee,
    workcentercode = EXCLUDED.workcentercode,
    tsnumber = EXCLUDED.tsnumber,
    checkin = EXCLUDED.checkin,
    refreshed_at = EXCLUDED.refreshed_at
"""


def connect_postgres():
    return psycopg2.connect(**load_postgres_config())


def parse_env_file(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(path):
        return values

    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def load_postgres_config() -> dict:
    env_values = parse_env_file(ENV_PATH)
    return {
        "host": env_values.get("DB_HOST", "localhost"),
        "port": int(env_values.get("DB_PORT", "5432")),
        "dbname": env_values.get("DB_NAME", "ptssb"),
        "user": env_values.get("DB_USER", "postgres"),
        "password": env_values.get("DB_PASSWORD", ""),
    }


def parse_date_arg(value: str, label: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{label} harus format YYYY-MM-DD") from exc


def make_date_range(args: argparse.Namespace) -> tuple[datetime, datetime | None]:
    from_dt = parse_date_arg(args.from_date, "--from")
    to_dt = None
    if args.to_date:
        to_dt = parse_date_arg(args.to_date, "--to") + timedelta(days=1)
    if to_dt and from_dt >= to_dt:
        raise ValueError("--from tidak boleh lebih besar dari --to")
    return from_dt, to_dt


def build_source_query(full_rebuild: bool, from_dt: datetime, to_dt: datetime | None) -> tuple[str, list]:
    base_filters = ["p.startdatetime >= %s"]
    params: list = [from_dt]

    if to_dt:
        base_filters.append("p.startdatetime < %s")
        params.append(to_dt)

    base_filter_sql = " AND ".join(base_filters)

    if full_rebuild:
        query = f"""
            SELECT
                p.proddataid,
                p.startdatetime,
                p.enddatetime,
                p.duration,
                p.machineno,
                p.statusid,
                p.previoustatusid,
                p.operatorid,
                p.jobid
            FROM {SOURCE_TABLE} p
            WHERE {base_filter_sql}
            ORDER BY p.proddataid
            LIMIT %s OFFSET %s
        """
        return query, params

    query = f"""
        SELECT
            p.proddataid,
            p.startdatetime,
            p.enddatetime,
            p.duration,
            p.machineno,
            p.statusid,
            p.previoustatusid,
            p.operatorid,
            p.jobid
        FROM {SOURCE_TABLE} p
        JOIN {CANDIDATE_TABLE} c
          ON c.proddataid = p.proddataid
        ORDER BY p.proddataid
        LIMIT %s OFFSET %s
    """
    return query, []


def prepare_incremental_candidates(cursor, from_dt: datetime, to_dt: datetime | None) -> int:
    base_filters = ["p.startdatetime >= %s"]
    params: list = [from_dt]

    if to_dt:
        base_filters.append("p.startdatetime < %s")
        params.append(to_dt)

    base_filter_sql = " AND ".join(base_filters)

    cursor.execute("DROP TABLE IF EXISTS mch_transaction_etl_candidates")
    cursor.execute(
        """
        CREATE TEMP TABLE mch_transaction_etl_candidates (
            proddataid integer PRIMARY KEY
        ) ON COMMIT PRESERVE ROWS
        """
    )
    cursor.execute(
        f"""
        INSERT INTO {CANDIDATE_TABLE} (proddataid)
        SELECT p.proddataid
        FROM {SOURCE_TABLE} p
        LEFT JOIN {TARGET_TABLE} t
          ON t.proddataid = p.proddataid
        WHERE {base_filter_sql}
          AND t.proddataid IS NULL
        UNION
        SELECT p.proddataid
        FROM {SOURCE_TABLE} p
        JOIN {TARGET_TABLE} t
          ON t.proddataid = p.proddataid
        WHERE {base_filter_sql}
          AND t.enddatetime IS NULL
        """,
        params + params,
    )
    cursor.execute(f"SELECT COUNT(*) FROM {CANDIDATE_TABLE}")
    return cursor.fetchone()[0]


def fetch_source_rows(cursor, full_rebuild: bool, from_dt: datetime, to_dt: datetime | None, offset: int) -> list[dict]:
    query, params = build_source_query(full_rebuild, from_dt, to_dt)
    cursor.execute(query, (*params, BATCH_SIZE, offset))
    columns = [col.name for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_machine_maps(cursor, machine_nos: list[int]) -> dict[int, dict]:
    if not machine_nos:
        return {}
    cursor.execute(
        """
        SELECT machineno, sitemachineno, machinegroupid, plantid, machinetypeid, machineid, machinename
        FROM public.mch_machines
        WHERE machineno = ANY(%s)
        """,
        (machine_nos,),
    )
    return {
        row[0]: {
            "sitemachineno": row[1],
            "machinegroupid": row[2],
            "machine_plantid": row[3],
            "machinetypeid": row[4],
            "machineid": row[5],
            "machinename": row[6],
        }
        for row in cursor.fetchall()
    }


def fetch_status_maps(cursor, status_ids: list[int]) -> dict[int, dict]:
    if not status_ids:
        return {}
    cursor.execute(
        """
        SELECT statusid, description, activitytype
        FROM public.mch_statustypes
        WHERE statusid = ANY(%s)
        """,
        (status_ids,),
    )
    return {
        row[0]: {
            "description": row[1],
            "activitytype": row[2],
        }
        for row in cursor.fetchall()
    }


def normalize_operatorid(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def fetch_mch_user_maps(cursor, operator_ids: list[str]) -> dict[str, dict]:
    if not operator_ids:
        return {}
    cursor.execute(
        f"""
        SELECT operatorid, full_name, sn_employee
        FROM {USER_TABLE}
        WHERE operatorid = ANY(%s)
        """,
        (operator_ids,),
    )
    return {
        row[0]: {
            "full_name": row[1],
            "sn_employee": row[2],
        }
        for row in cursor.fetchall()
    }


def normalize_order_key(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    normalized = text.lstrip("0")
    return normalized or "0"


def normalize_jobid(value) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def parse_job_lookup_key(value) -> tuple[str, int] | None:
    text = normalize_jobid(value)
    if not text:
        return None

    if "-" not in text:
        return None

    order_part, operation_part = text.split("-", 1)
    order_key = normalize_order_key(order_part)
    operation_text = operation_part.strip()

    if not order_key or not operation_text.isdigit():
        return None

    return order_key, int(operation_text)


def make_job_ph3_fallback(job_key: tuple[str, int]) -> dict:
    return {
        "confirmation_number": None,
        "order_no": job_key[0],
        "operation_no": job_key[1],
        "operation_short_text": None,
        "operation_description": None,
        "sequence_category": None,
        "sequence_number": None,
        "branch_operation_no": None,
        "return_operation_no": None,
        "cost_center": None,
        "material_no": None,
        "material_description": None,
    }


def fetch_latest_ph3_by_job_key(cursor, job_ids: list[str]) -> dict[str, dict]:
    job_keys_by_id = {
        job_id: job_key
        for job_id in job_ids
        for job_key in (parse_job_lookup_key(job_id),)
        if job_key
    }
    lookup_keys = sorted(set(job_keys_by_id.values()))
    if not lookup_keys:
        return {}

    values_sql = ",".join(["(%s, %s)"] * len(lookup_keys))
    query = f"""
        WITH src(order_key, operation_no) AS (
            VALUES {values_sql}
        )
        SELECT DISTINCT ON (src.order_key, src.operation_no)
            src.order_key,
            src.operation_no,
            p.confirmation_number,
            p.order_no,
            p.operation_no,
            p.operation_short_text,
            p.operation_description,
            p.sequence_category,
            p.sequence_number,
            p.branch_operation_no,
            p.return_operation_no,
            p.cost_center,
            p.material_no,
            p.material_description
        FROM src
        JOIN public.ph3_order p
          ON coalesce(nullif(ltrim(trim(coalesce(p.order_no, '')), '0'), ''), '0') = src.order_key
         AND coalesce(nullif(ltrim(trim(p.operation_no::text), '0'), ''), '0') = src.operation_no::text
        ORDER BY src.order_key, src.operation_no, p.id DESC
    """
    cursor.execute(query, [item for lookup_key in lookup_keys for item in lookup_key])

    rows_by_job_key = {
        (row[0], row[1]): {
            "confirmation_number": row[2],
            "order_no": row[3],
            "operation_no": row[4],
            "operation_short_text": row[5],
            "operation_description": row[6],
            "sequence_category": row[7],
            "sequence_number": row[8],
            "branch_operation_no": row[9],
            "return_operation_no": row[10],
            "cost_center": row[11],
            "material_no": row[12],
            "material_description": row[13],
        }
        for row in cursor.fetchall()
    }

    return {
        job_id: rows_by_job_key.get(job_key) or make_job_ph3_fallback(job_key)
        for job_id, job_key in job_keys_by_id.items()
    }


def fetch_sow_maps(cursor, job_keys: list[tuple[str, int]]) -> dict[tuple[str, int], dict]:
    sow_keys = sorted(set(job_keys))
    if not sow_keys:
        return {}

    values_sql = ",".join(["(%s, %s)"] * len(sow_keys))
    query = f"""
        WITH src(order_key, operation_no) AS (
            VALUES {values_sql}
        )
        SELECT
            src.order_key,
            src.operation_no,
            s.ssbr_id,
            s.workcenter
        FROM src
        JOIN {SOW_TABLE} s
          ON coalesce(nullif(ltrim(trim(coalesce(s.order_no, '')), '0'), ''), '0') = src.order_key
         AND coalesce(nullif(ltrim(trim(s.operation_no::text), '0'), ''), '0') = src.operation_no::text
    """
    cursor.execute(query, [item for sow_key in sow_keys for item in sow_key])
    return {
        (row[0], row[1]): {
            "ssbr_id": row[2],
            "workcenter": row[3],
        }
        for row in cursor.fetchall()
    }


def compute_duration_seconds(startdatetime, enddatetime) -> int:
    if startdatetime is None or enddatetime is None:
        return 0
    return max(int((enddatetime - startdatetime).total_seconds()), 0)


def build_target_tuple(
    row: dict,
    machine_map: dict,
    status_map: dict,
    ph3_map: dict,
    user_map: dict,
    sow_map: dict,
) -> tuple:
    machine = machine_map.get(row["machineno"], {})
    status = status_map.get(row["statusid"], {})
    prev_status = status_map.get(row["previoustatusid"], {})
    job_id = normalize_jobid(row.get("jobid"))
    job_key = parse_job_lookup_key(job_id)
    ph3 = ph3_map.get(job_id, make_job_ph3_fallback(job_key) if job_key else {})
    user = user_map.get(normalize_operatorid(row.get("operatorid")), {})
    sow = sow_map.get(job_key, {})

    duration_seconds = compute_duration_seconds(row["startdatetime"], row["enddatetime"])
    duration_hours = round(duration_seconds / 3600.0, 4)

    return (
        row["proddataid"],
        row["startdatetime"],
        row["enddatetime"],
        row["startdatetime"].date() if row["startdatetime"] else None,
        row["startdatetime"].strftime("%H:%M:%S") if row["startdatetime"] else None,
        row["enddatetime"].strftime("%H:%M:%S") if row["enddatetime"] else None,
        row["duration"],
        duration_seconds,
        duration_hours,
        row["machineno"],
        machine.get("sitemachineno"),
        machine.get("machinegroupid"),
        machine.get("machine_plantid"),
        machine.get("machinetypeid"),
        machine.get("machineid") or "",
        machine.get("machinename") or "",
        row["statusid"],
        row["previoustatusid"],
        status.get("description") or "Unknown",
        status.get("activitytype") or "",
        prev_status.get("description"),
        ph3.get("confirmation_number"),
        ph3.get("order_no"),
        ph3.get("operation_no"),
        ph3.get("operation_short_text"),
        ph3.get("operation_description"),
        ph3.get("sequence_category"),
        ph3.get("sequence_number"),
        ph3.get("branch_operation_no"),
        ph3.get("return_operation_no"),
        ph3.get("cost_center"),
        ph3.get("material_no"),
        ph3.get("material_description"),
        sow.get("ssbr_id"),
        user.get("full_name"),
        user.get("sn_employee"),
        sow.get("workcenter"),
        None,
        None,
        datetime.now(),
    )


def upsert_batch(cursor, values: list[tuple]) -> None:
    psycopg2.extras.execute_values(
        cursor,
        UPSERT_SQL,
        values,
        page_size=min(BATCH_SIZE, 1000),
    )


def run_etl(pg_conn, from_dt: datetime, to_dt: datetime | None, full_rebuild: bool, dry_run: bool) -> int:
    total_upserted = 0
    offset = 0

    if not full_rebuild:
        with pg_conn.cursor() as cursor:
            candidate_count = prepare_incremental_candidates(cursor, from_dt, to_dt)
        pg_conn.commit()
        log.info("Prepared incremental candidate rows: %d", candidate_count)

    while True:
        with pg_conn.cursor() as cursor:
            source_rows = fetch_source_rows(cursor, full_rebuild, from_dt, to_dt, offset)

        if not source_rows:
            log.info("No more source rows at offset %d.", offset)
            break

        machine_nos = sorted({row["machineno"] for row in source_rows if row["machineno"] is not None})
        status_ids = sorted({
            status_id
            for row in source_rows
            for status_id in (row["statusid"], row["previoustatusid"])
            if status_id is not None
        })
        job_ids = sorted(
            {
                job_id
                for row in source_rows
                for job_id in (normalize_jobid(row.get("jobid")),)
                if job_id
            }
        )
        job_keys = sorted(
            {
                job_key
                for row in source_rows
                for job_key in (parse_job_lookup_key(row.get("jobid")),)
                if job_key
            }
        )
        operator_ids = sorted(
            {
                operator_id
                for row in source_rows
                for operator_id in (normalize_operatorid(row.get("operatorid")),)
                if operator_id
            }
        )

        with pg_conn.cursor() as cursor:
            machine_map = fetch_machine_maps(cursor, machine_nos)
            status_map = fetch_status_maps(cursor, status_ids)
            ph3_map = fetch_latest_ph3_by_job_key(cursor, job_ids)
            user_map = fetch_mch_user_maps(cursor, operator_ids)
            sow_map = fetch_sow_maps(cursor, job_keys)

        values = [
            build_target_tuple(row, machine_map, status_map, ph3_map, user_map, sow_map)
            for row in source_rows
        ]

        operator_lookup_count = sum(1 for row in source_rows if normalize_operatorid(row.get("operatorid")))
        operator_rows_matched = sum(
            1
            for row in source_rows
            if normalize_operatorid(row.get("operatorid")) in user_map
        )
        job_key_rows = sum(1 for row in source_rows if parse_job_lookup_key(row.get("jobid")))
        ph3_rows_matched = sum(
            1
            for row in source_rows
            if ph3_map.get(normalize_jobid(row.get("jobid")), {}).get("confirmation_number") is not None
        )
        ph3_keys_matched = sum(
            1
            for ph3 in ph3_map.values()
            if ph3.get("confirmation_number") is not None
        )
        sow_rows_matched = sum(
            1
            for row in source_rows
            if parse_job_lookup_key(row.get("jobid")) in sow_map
        )
        log.info(
            (
                "Prepared batch offset=%d count=%d operator_lookup_candidates=%d "
                "operator_rows_matched=%d operator_ids_matched=%d job_rows_parsed=%d "
                "job_keys_parsed=%d ph3_rows_matched=%d ph3_keys_matched=%d "
                "sow_rows_matched=%d sow_keys_matched=%d"
            ),
            offset,
            len(values),
            operator_lookup_count,
            operator_rows_matched,
            len(user_map),
            job_key_rows,
            len(job_keys),
            ph3_rows_matched,
            ph3_keys_matched,
            sow_rows_matched,
            len(sow_map),
        )

        if dry_run:
            total_upserted += len(values)
        else:
            with pg_conn.cursor() as cursor:
                upsert_batch(cursor, values)
            pg_conn.commit()
            total_upserted += len(values)
            log.info("Committed batch offset=%d count=%d", offset, len(values))

        offset += BATCH_SIZE

    return total_upserted


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Incremental ETL from public.mch_productiondata into public.mch_transaction using mch_user operator lookup"
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        default=DEFAULT_FROM_DATE,
        help=f"StartDateTime mulai tanggal YYYY-MM-DD, default {DEFAULT_FROM_DATE}",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        help="StartDateTime sampai tanggal YYYY-MM-DD, inclusive. Jika kosong, sync sampai data terbaru.",
    )
    parser.add_argument(
        "--full-rebuild",
        action="store_true",
        help="Ignore watermark mch_transaction dan proses ulang semua source row pada rentang tanggal.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview mode, no INSERT/UPDATE to mch_transaction",
    )
    args = parser.parse_args()

    from_dt, to_dt = make_date_range(args)
    pg_conn = None

    try:
        pg_config = load_postgres_config()
        log.info(
            "Starting mch_transaction ETL%s (BATCH_SIZE=%d)",
            " (DRY RUN)" if args.dry_run else "",
            BATCH_SIZE,
        )
        log.info(
            "Date filter: StartDateTime >= %s%s",
            from_dt.strftime("%Y-%m-%d"),
            f" and <= {args.to_date}" if args.to_date else "",
        )
        log.info("PostgreSQL: %s:%s/%s", pg_config["host"], pg_config["port"], pg_config["dbname"])
        log.info(
            "Mode: %s",
            "full rebuild"
            if args.full_rebuild
            else "incremental by proddataid + reprocess target rows with enddatetime IS NULL",
        )
        log.info("Source status filter: all statusid values")
        log.info("Operator lookup: mch_productiondata.operatorid -> mch_user.operatorid")
        log.info("Job lookup: split mch_productiondata.jobid order_no-operation_no -> ph3_order")
        log.info("SOW lookup: split mch_productiondata.jobid order_no-operation_no -> sow")

        pg_conn = psycopg2.connect(**pg_config)
        processed = run_etl(pg_conn, from_dt, to_dt, args.full_rebuild, args.dry_run)

        log.info("=" * 60)
        log.info("ETL Complete%s", " (DRY RUN)" if args.dry_run else "")
        log.info("  Upserted rows: %d", processed)
        log.info("=" * 60)
    except KeyboardInterrupt:
        log.warning("Interrupted by user.")
    except Exception as exc:
        if pg_conn:
            pg_conn.rollback()
        log.exception("Fatal error: %s", exc)
        sys.exit(1)
    finally:
        if pg_conn:
            try:
                pg_conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
