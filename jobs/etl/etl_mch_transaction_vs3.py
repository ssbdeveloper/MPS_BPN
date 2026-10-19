"""
etl_mch_transaction_v3.py
Incremental PostgreSQL ETL that fills public.mch_transaction from public.mch_productiondata.

V2 avoids nearest-time lookup to public.timesheet_transaction.

Operator fields (full_name, sn_employee) are resolved from public.usernfc via the NFC card:
public.mch_productiondata.operatorid -> public.usernfc.nfcid. operatorid holds the raw NFC
UID hex (e.g. C27FC969) while usernfc.nfcid stores it as the byte-reversed decimal
(e.g. 1774125506). The lookup matches nfcid = operatorid exactly OR, for 8-hex operatorids,
nfcid = decimal(byte_reverse(operatorid)). sn_employee <- usernfc.snssb, full_name <- usernfc.full_name.

V3 resolves job data by splitting public.mch_productiondata.jobid in the format
order_no-operation_no, for example 100001235-10. PH3 and SOW fields are resolved
from public.ph3_order/public.sow using that order_no + operation_no pair.

Usage:
    python etl_mch_transaction_v3.py
    python etl_mch_transaction_v3.py --from 2026-05-01
    python etl_mch_transaction_v3.py --from 2026-06-30 --to 2026-06-30
    python etl_mch_transaction_v3.py --full-rebuild
    python etl_mch_transaction_v3.py --dry-run
"""

import argparse
import logging
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras

try:
    import fcntl  # POSIX only (server prod = Linux)
except ImportError:  # Windows (dev) — locking di-skip dengan aman
    fcntl = None

# Lock antar-proses: cegah dua run ETL berjalan bersamaan (mis. cron */5 yang
# menembak run baru sebelum run sebelumnya selesai).
LOCK_PATH = os.path.join(tempfile.gettempdir(), "etl_mch_transaction_v3.lock")

BATCH_SIZE = 5000
DEFAULT_FROM_DATE = "2026-01-01"
TARGET_TABLE = "public.mch_transaction"
SOURCE_TABLE = "public.mch_productiondata"
NFC_TABLE = "public.usernfc"
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
        # Traceability: label sesi ini di pg_stat_activity.application_name
        "application_name": "mps2-etl-mch-transaction",
        # Batasi waktu tunggu koneksi awal
        "connect_timeout": 10,
        # TCP keepalives: kalau proses ini mati tidak bersih (crash/OOM/kill),
        # Postgres mendeteksi TCP mati dalam ~60 detik dan menutup backend-nya
        # sendiri — mencegah koneksi yatim "idle selamanya".
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
        # Server-side guard: bunuh statement yang menggantung > 10 menit dan
        # sesi yang idle-in-transaction > 1 menit.
        "options": "-c statement_timeout=600000 -c idle_in_transaction_session_timeout=60000",
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


def fetch_nfc_user_maps(cursor, operator_ids: list[str]) -> dict[str, dict]:
    """Resolve operatorid -> usernfc (full_name, snssb) via the NFC card id.

    operatorid is the raw NFC UID hex; usernfc.nfcid stores the byte-reversed decimal.
    Match nfcid = operatorid exactly OR, for 8-hex operatorids, nfcid = decimal of the
    byte-reversed UID. Exact matches win over the transformed one.
    """
    if not operator_ids:
        return {}
    # Konversi hex->desimal DIPISAH ke CTE MATERIALIZED yang sudah tersaring, BUKAN
    # digabung sebagai `guard AND cast` di dalam JOIN.
    #
    # Sebabnya: Postgres TIDAK menjamin urutan evaluasi di dalam JOIN/WHERE — planner boleh
    # menjalankan cast ::bit(32) sebelum guard regexnya. Begitu ada satu operatorid sampah
    # (pembacaan kartu NFC korup), seluruh ETL mati dengan
    # `"..." is not a valid hexadecimal digit`. Persis itu yang terjadi 22-Jul-2026: tiga
    # baris korup jam 09:47 ('3sÄCÍÌÄCf&', dua string 2 karakter) menghentikan pipeline
    # machine-hours selama ~7 jam — jam mesin berhenti masuk mch_transaction, staging SAP
    # dan OEE ikut basi. MATERIALIZED memaksa filter dieksekusi lebih dulu, jadi cast hanya
    # pernah melihat 8 digit hex yang valid.
    cursor.execute(
        rf"""
        WITH ops(operatorid) AS (
            SELECT DISTINCT unnest(%s::text[])
        ),
        ops_dec AS MATERIALIZED (
            SELECT
                operatorid,
                (
                  ('x' || regexp_replace(operatorid, '(..)(..)(..)(..)', '\4\3\2\1'))::bit(32)::bigint
                )::text AS nfc_decimal
            FROM ops
            WHERE operatorid ~ '^[0-9A-Fa-f]{{8}}$'
        )
        SELECT DISTINCT ON (o.operatorid)
            o.operatorid, u.full_name, u.snssb
        FROM ops o
        LEFT JOIN ops_dec d ON d.operatorid = o.operatorid
        JOIN {NFC_TABLE} u
          ON u.nfcid = o.operatorid
          OR u.nfcid = d.nfc_decimal
        ORDER BY o.operatorid, (u.nfcid = o.operatorid) DESC, u.idrow
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


def has_v3_job_match(row: dict, ph3_map: dict, sow_map: dict) -> bool:
    job_id = normalize_jobid(row.get("jobid"))
    job_key = parse_job_lookup_key(job_id)
    if not job_id or not job_key:
        return False

    ph3 = ph3_map.get(job_id, {})
    return ph3.get("confirmation_number") is not None or job_key in sow_map


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

    # Duration is ALWAYS derived from enddatetime - startdatetime. The source
    # mch_productiondata.duration column is unreliable (~95% of rows disagree with the
    # real span, some off by days) so it is never read; source_duration mirrors the
    # computed seconds to keep the column consistent.
    duration_seconds = compute_duration_seconds(row["startdatetime"], row["enddatetime"])
    duration_hours = round(duration_seconds / 3600.0, 4)

    return (
        row["proddataid"],
        row["startdatetime"],
        row["enddatetime"],
        row["startdatetime"].date() if row["startdatetime"] else None,
        row["startdatetime"].strftime("%H:%M:%S") if row["startdatetime"] else None,
        row["enddatetime"].strftime("%H:%M:%S") if row["enddatetime"] else None,
        duration_seconds,
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


def delete_target_range(cursor, from_dt: datetime, to_dt: datetime | None) -> int:
    """Delete target rows in the rebuild window so --full-rebuild truly RECREATES it.

    Aligns with the source filter (startdatetime >= from [AND < to]). Any target row
    that would no longer be produced (e.g. a jobid that no longer matches a V3 job, or
    stale operator names) is removed instead of being left behind.
    """
    params: list = [from_dt]
    where = "startdatetime >= %s"
    if to_dt:
        where += " AND startdatetime < %s"
        params.append(to_dt)
    cursor.execute(f"DELETE FROM {TARGET_TABLE} WHERE {where}", params)
    return cursor.rowcount


def count_target_range(cursor, from_dt: datetime, to_dt: datetime | None) -> int:
    params: list = [from_dt]
    where = "startdatetime >= %s"
    if to_dt:
        where += " AND startdatetime < %s"
        params.append(to_dt)
    cursor.execute(f"SELECT COUNT(*) FROM {TARGET_TABLE} WHERE {where}", params)
    return cursor.fetchone()[0]


def upsert_batch(cursor, values: list[tuple]) -> None:
    psycopg2.extras.execute_values(
        cursor,
        UPSERT_SQL,
        values,
        page_size=min(BATCH_SIZE, 1000),
    )


def apply_overrides(pg_conn, dry_run: bool) -> int:
    """Terapkan koreksi manual (public.mch_transaction_override) DI ATAS hasil derivasi.

    Inilah yang membuat koreksi user (assign job dari ph3, assign operator) bertahan
    terhadap re-derivasi — baik incremental maupun --full-rebuild. Tanpa langkah ini,
    edit apa pun ke mch_transaction akan tersapu saat baris-nya diturunkan ulang.

    Baris yang sudah ter-POST ke SAP tidak akan berubah: trigger pembekuan
    (mch_transaction_freeze_posted) me-revert field identitas-nya.
    """
    with pg_conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.mch_transaction_override')")
        if cur.fetchone()[0] is None:
            return 0  # migration belum diterapkan — lewati dengan aman
        cur.execute("SELECT count(*) FROM public.mch_transaction_override")
        n = cur.fetchone()[0]
    if n == 0:
        return 0
    if dry_run:
        log.info("apply_overrides (DRY RUN): %d koreksi manual akan diterapkan ulang", n)
        return n

    with pg_conn.cursor() as cur:
        # JOB: ambil field ph3 terbaru per (order_no, operation_no) + SOW untuk workcenter/ssbr.
        cur.execute(
            """
            WITH ph AS (
                SELECT DISTINCT ON (order_no, operation_no)
                    order_no, operation_no, confirmation_number, operation_short_text,
                    operation_description, sequence_category, sequence_number,
                    branch_operation_no, return_operation_no, cost_center,
                    material_no, material_description
                FROM public.ph3_order
                ORDER BY order_no, operation_no, id DESC
            )
            UPDATE public.mch_transaction m SET
                order_no = ph.order_no,
                operation_no = ph.operation_no,
                confirmation_number = ph.confirmation_number,
                operation_short_text = ph.operation_short_text,
                operation_description = ph.operation_description,
                sequence_category = ph.sequence_category,
                sequence_number = ph.sequence_number,
                branch_operation_no = ph.branch_operation_no,
                return_operation_no = ph.return_operation_no,
                cost_center = ph.cost_center,
                material_no = ph.material_no,
                material_description = ph.material_description,
                ssbr_id = COALESCE((
                    SELECT s.ssbr_id FROM public.sow s
                    WHERE COALESCE(NULLIF(ltrim(trim(coalesce(s.order_no,'')),'0'),''),'0')
                        = COALESCE(NULLIF(ltrim(trim(o.order_no),'0'),''),'0')
                      AND COALESCE(NULLIF(ltrim(trim(s.operation_no::text),'0'),''),'0')
                        = COALESCE(NULLIF(ltrim(trim(o.operation_no),'0'),''),'0')
                    LIMIT 1), m.ssbr_id),
                workcentercode = COALESCE((
                    SELECT s.workcenter FROM public.sow s
                    WHERE COALESCE(NULLIF(ltrim(trim(coalesce(s.order_no,'')),'0'),''),'0')
                        = COALESCE(NULLIF(ltrim(trim(o.order_no),'0'),''),'0')
                      AND COALESCE(NULLIF(ltrim(trim(s.operation_no::text),'0'),''),'0')
                        = COALESCE(NULLIF(ltrim(trim(o.operation_no),'0'),''),'0')
                    LIMIT 1), m.workcentercode),
                refreshed_at = now()
            FROM public.mch_transaction_override o
            JOIN ph ON ph.order_no = o.order_no AND ph.operation_no = o.operation_no
            WHERE m.proddataid = o.proddataid AND o.order_no IS NOT NULL
            """
        )
        job_applied = cur.rowcount

        # OPERATOR: set snssb + nama dari usernfc.
        cur.execute(
            """
            UPDATE public.mch_transaction m SET
                sn_employee = o.sn_employee,
                full_name = COALESCE(
                    (SELECT u.full_name FROM public.usernfc u WHERE u.snssb = o.sn_employee LIMIT 1),
                    m.full_name),
                refreshed_at = now()
            FROM public.mch_transaction_override o
            WHERE m.proddataid = o.proddataid AND o.sn_employee IS NOT NULL
            """
        )
        op_applied = cur.rowcount
    pg_conn.commit()
    log.info("apply_overrides: %d koreksi job + %d koreksi operator diterapkan ulang", job_applied, op_applied)
    return n


def run_etl(pg_conn, from_dt: datetime, to_dt: datetime | None, full_rebuild: bool, dry_run: bool) -> int:
    total_upserted = 0
    offset = 0

    if not full_rebuild:
        with pg_conn.cursor() as cursor:
            candidate_count = prepare_incremental_candidates(cursor, from_dt, to_dt)
        pg_conn.commit()
        log.info("Prepared incremental candidate rows: %d", candidate_count)
    else:
        # RECREATE: wipe the target window first so rows that no longer match a V3 job
        # (or carry stale operator names) are removed, not just skipped.
        with pg_conn.cursor() as cursor:
            if dry_run:
                would_delete = count_target_range(cursor, from_dt, to_dt)
                log.info("Full rebuild (DRY RUN): would delete %d existing target rows in range before recreate", would_delete)
            else:
                deleted = delete_target_range(cursor, from_dt, to_dt)
                pg_conn.commit()
                log.info("Full rebuild: deleted %d existing target rows in range (recreate)", deleted)

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
            user_map = fetch_nfc_user_maps(cursor, operator_ids)
            sow_map = fetch_sow_maps(cursor, job_keys)

        # Insert ALL rows (no V3-match filter). Completeness is flagged per row by the
        # generated column mch_transaction.status_record, not by dropping rows — so the
        # accuracy_machine metric can show which records are incomplete instead of missing.
        no_v3_match = len(source_rows) - sum(
            1 for row in source_rows if has_v3_job_match(row, ph3_map, sow_map)
        )

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
                "sow_rows_matched=%d sow_keys_matched=%d upsert_candidates=%d "
                "no_v3_match_flagged=%d"
            ),
            offset,
            len(source_rows),
            operator_lookup_count,
            operator_rows_matched,
            len(user_map),
            job_key_rows,
            len(job_keys),
            ph3_rows_matched,
            ph3_keys_matched,
            sow_rows_matched,
            len(sow_map),
            len(values),
            no_v3_match,
        )

        if dry_run:
            total_upserted += len(values)
        elif values:
            with pg_conn.cursor() as cursor:
                upsert_batch(cursor, values)
            pg_conn.commit()
            total_upserted += len(values)
            log.info("Committed batch offset=%d count=%d", offset, len(values))
        else:
            log.info("Skipped commit for batch offset=%d because it produced no rows.", offset)

        offset += BATCH_SIZE

    # Terapkan koreksi manual DI ATAS hasil derivasi — supaya edit user (job/operator)
    # bertahan terhadap re-derivasi ini.
    apply_overrides(pg_conn, dry_run)

    return total_upserted


def acquire_single_instance_lock():
    """Ambil lock eksklusif non-blocking. Kembalikan handle file lock kalau
    berhasil (harus tetap terbuka selama proses hidup), atau None kalau run lain
    sedang berjalan. Pada platform tanpa fcntl (Windows dev), locking di-skip."""
    if fcntl is None:
        return "no-lock"

    lock_file = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock_file.close()
        return None

    lock_file.write(f"{os.getpid()}\n")
    lock_file.flush()
    return lock_file


def main() -> None:
    lock = acquire_single_instance_lock()
    if lock is None:
        log.warning(
            "Run lain masih berjalan (lock %s). Lewati run ini.", LOCK_PATH
        )
        return

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
        help="RECREATE rentang tanggal: hapus dulu baris mch_transaction pada rentang (startdatetime), lalu bangun ulang dari source. Baris yang tak lagi match job V3 ikut terhapus (bukan disisakan basi).",
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
            "full rebuild (recreate: delete range then rebuild)"
            if args.full_rebuild
            else "incremental by proddataid + reprocess target rows with enddatetime IS NULL",
        )
        log.info("Source status filter: all statusid values")
        log.info("Operator lookup: mch_productiondata.operatorid -> usernfc.nfcid (exact or byte-reversed hex->decimal)")
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
