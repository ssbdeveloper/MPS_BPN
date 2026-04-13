import os
import select
import threading
import time
import logging
import psycopg2
from concurrent.futures import ThreadPoolExecutor
from psycopg2 import pool, extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SRC_DSN = {
    "host":     os.environ["SRC_HOST"],
    "port":     int(os.environ.get("SRC_PORT", 5432)),
    "dbname":   os.environ["SRC_DATABASE"],
    "user":     os.environ["SRC_USER"],
    "password": os.environ["SRC_PASSWORD"],
}
SRC_TABLE       = os.environ["SRC_TABLE"]
POLL_INTERVAL   = int(os.environ.get("POLL_INTERVAL_SECONDS", 5))
RECONNECT_DELAY = int(os.environ.get("RECONNECT_DELAY_SECONDS", 5))
BATCH_LIMIT     = int(os.environ.get("BATCH_LIMIT", 1000))

# ---------------------------------------------------------------------------
# Target databases — one entry per site
# ---------------------------------------------------------------------------
_TARGET_DEFS = [
    ("BALIKPAPAN",    "_BALIKPAPAN"),
    ("SEBAMBAN",      "_SEBAMBAN"),
    ("KUALA_KENCANA", "_KUALA_KENCANA"),
    ("CIKUPA",        "_CIKUPA"),
]


def _build_target(name: str, suffix: str) -> dict:
    dsn = {
        "host":     os.environ[f"TGT_HOST{suffix}"],
        "port":     int(os.environ.get(f"TGT_PORT{suffix}", 5432)),
        "dbname":   os.environ[f"TGT_DATABASE{suffix}"],
        "user":     os.environ[f"TGT_USER{suffix}"],
        "password": os.environ[f"TGT_PASSWORD{suffix}"],
    }
    return {
        "name":       name,
        "dsn":        dsn,
        "table":      os.environ[f"TGT_TABLE{suffix}"],
        "plant":      os.environ[f"TGT_PLANT{suffix}"],
        "pool":       None,
        "upsert_sql": None,
        "lock":       threading.Lock(),
    }


TARGETS = [_build_target(n, s) for n, s in _TARGET_DEFS]

# ---------------------------------------------------------------------------
# Source connection pool (threaded — shared across worker threads)
# ---------------------------------------------------------------------------
src_pool = pool.ThreadedConnectionPool(1, len(TARGETS) * 2, **SRC_DSN)

_pool_lock = threading.Lock()

UPSERT_COLS = [
    "confirmation_number",
    "indicator_code",
    "operation_short_text",
    "order_no",
    "operation_no",
    "sequence_category",
    "sequence_number",
    "branch_operation_no",
    "return_operation_no",
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
    "status_etl",
]
UPDATE_COLS = [c for c in UPSERT_COLS if c != "confirmation_number"]

STRIP_ZERO_COLS = {"confirmation_number", "order_no", "operation_no"}


def strip_zeros(row: dict) -> dict:
    result = dict(row)
    for col in STRIP_ZERO_COLS:
        val = result.get(col)
        if isinstance(val, str):
            result[col] = val.lstrip("0")
    return result


def build_upsert_query(table: str) -> str:
    col_list    = ", ".join(UPSERT_COLS)
    placeholder = ", ".join(["%s"] * len(UPSERT_COLS))
    updates     = ", ".join(f"{c} = EXCLUDED.{c}" for c in UPDATE_COLS)
    return (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholder}) "
        f"ON CONFLICT (confirmation_number) DO UPDATE SET {updates}"
    )


def sync_sow(tgt_cur, rows: list) -> None:
    order_material: dict = {}
    for row in rows:
        order = row["order_no"]
        if order not in order_material:
            order_material[order] = (row.get("material_no"), row.get("material_description"))
        else:
            existing_mat, existing_desc = order_material[order]
            mat  = existing_mat  or row.get("material_no")
            desc = existing_desc or row.get("material_description")
            order_material[order] = (mat, desc)

    sow_tuples = []
    for row in rows:
        order_no       = row["order_no"]
        operation_no   = row["operation_no"]
        work_center    = row.get("work_center")
        confirmation   = row.get("confirmation_number")
        standard_val   = row.get("standard_value")
        operation_text = row.get("operation_short_text")
        part_number, part_name = order_material[order_no]

        try:
            planhours = float(standard_val) if standard_val else None
        except (ValueError, TypeError):
            planhours = None

        sow_tuples.append((
            order_no, operation_no, work_center, confirmation,
            planhours, part_number, part_name, operation_text,
        ))

    extras.execute_values(
        tgt_cur,
        """
        INSERT INTO sow (order_no, operation_no, workcenter, confirmation,
                         planhours, part_number, part_name, operation_text)
        VALUES %s
        ON CONFLICT (order_no, operation_no) DO UPDATE SET
            workcenter     = EXCLUDED.workcenter,
            confirmation   = EXCLUDED.confirmation,
            planhours      = EXCLUDED.planhours,
            part_number    = EXCLUDED.part_number,
            part_name      = EXCLUDED.part_name,
            operation_text = EXCLUDED.operation_text
        """,
        sow_tuples,
    )


def _get_tgt_pool(target: dict):
    if target["pool"] is None:
        with _pool_lock:
            if target["pool"] is None:
                target["pool"] = pool.ThreadedConnectionPool(1, 4, **target["dsn"])
    return target["pool"]


def run_cycle(target: dict) -> bool:
    try:
        tgt_pool_ = _get_tgt_pool(target)
    except Exception as exc:
        log.error("[%s] Cannot connect to target DB: %s", target["name"], exc)
        return False

    tgt_table    = target["table"]
    plant_filter = target["plant"]
    upsert_sql   = target["upsert_sql"]

    src_conn = src_pool.getconn()
    tgt_conn = tgt_pool_.getconn()
    try:
        src_conn.autocommit = False
        tgt_conn.autocommit = False

        with src_conn.cursor(cursor_factory=extras.RealDictCursor) as src_cur:
            src_cur.execute(
                f"SELECT {', '.join(UPSERT_COLS)} FROM {SRC_TABLE} "
                f"WHERE plant_code = %s AND status_etl = 'NEW' "
                f"ORDER BY created_at ASC LIMIT {BATCH_LIMIT}",
                (plant_filter,),
            )
            raw_rows = src_cur.fetchall()

        if not raw_rows:
            src_conn.rollback()
            tgt_conn.rollback()
            return False

        batch_full = len(raw_rows) == BATCH_LIMIT
        if batch_full:
            log.warning("[%s] Batch full (%d rows); another cycle may be needed.", target["name"], BATCH_LIMIT)

        rows = [strip_zeros(r) for r in raw_rows]

        src_confirmation_numbers = [r["confirmation_number"] for r in raw_rows]
        tgt_confirmation_numbers = [r["confirmation_number"] for r in rows]

        row_tuples = [tuple(r[c] for c in UPSERT_COLS) for r in rows]

        with tgt_conn.cursor() as tgt_cur:
            extras.execute_batch(tgt_cur, upsert_sql, row_tuples)
            sync_sow(tgt_cur, rows)
            tgt_cur.execute(
                f"UPDATE {tgt_table} SET status_etl = 'UPDATED' "
                f"WHERE confirmation_number = ANY(%s)",
                (tgt_confirmation_numbers,),
            )

        with src_conn.cursor() as src_cur:
            src_cur.execute(
                f"UPDATE {SRC_TABLE} SET status_etl = 'UPDATED' "
                f"WHERE confirmation_number = ANY(%s)",
                (src_confirmation_numbers,),
            )

        tgt_conn.commit()
        src_conn.commit()
        log.info("[%s] Processed %d row(s).", target["name"], len(rows))
        return batch_full

    except Exception as exc:
        src_conn.rollback()
        tgt_conn.rollback()
        log.error("[%s] Cycle failed, rolled back: %s", target["name"], exc)
        return False
    finally:
        src_pool.putconn(src_conn)
        tgt_pool_.putconn(tgt_conn)


def _drain_target(target: dict) -> None:
    try:
        while run_cycle(target):
            pass
    except Exception as exc:
        log.error("[%s] Unexpected error in drain: %s", target["name"], exc)


def _drain_target_safe(target: dict) -> None:
    if not target["lock"].acquire(blocking=False):
        log.debug("[%s] Drain already running, skipped.", target["name"])
        return
    try:
        _drain_target(target)
    finally:
        target["lock"].release()


def _listen_loop(targets: list, listen_conn, executor: ThreadPoolExecutor) -> None:
    plant_map = {}
    for t in targets:
        plant_map.setdefault(t["plant"], []).append(t)

    while True:
        ready = select.select([listen_conn], [], [], POLL_INTERVAL)
        if ready[0]:
            listen_conn.poll()
            triggered_plants = set()
            while listen_conn.notifies:
                notify = listen_conn.notifies.pop(0)
                if notify.payload in plant_map:
                    triggered_plants.add(notify.payload)
            for plant in triggered_plants:
                for target in plant_map[plant]:
                    executor.submit(_drain_target_safe, target)
        else:
            for t in targets:
                executor.submit(_drain_target_safe, t)


def listen_and_process(targets: list) -> None:
    with ThreadPoolExecutor(max_workers=len(TARGETS)) as executor:
        while True:
            listen_conn = None
            try:
                listen_conn = psycopg2.connect(**SRC_DSN)
                listen_conn.autocommit = True
                with listen_conn.cursor() as cur:
                    cur.execute("LISTEN etl_new_row")
                log.info("LISTEN/NOTIFY active on channel 'etl_new_row'.")
                _listen_loop(targets, listen_conn, executor)
            except Exception as exc:
                log.error("Listen connection error: %s", exc)
                time.sleep(RECONNECT_DELAY)
            finally:
                if listen_conn is not None:
                    try:
                        listen_conn.close()
                    except Exception:
                        pass


def main() -> None:
    for t in TARGETS:
        t["upsert_sql"] = build_upsert_query(t["table"])
        log.info(
            "ETL target registered: [%s] %s:%s/%s plant=%s table=%s",
            t["name"], t["dsn"]["host"], t["dsn"]["port"],
            t["dsn"]["dbname"], t["plant"], t["table"],
        )
    log.info(
        "ETL started (LISTEN/NOTIFY) — source=%s.%s, fallback_timeout=%ds, targets=%d",
        SRC_DSN["dbname"], SRC_TABLE, POLL_INTERVAL, len(TARGETS),
    )
    listen_and_process(TARGETS)


if __name__ == "__main__":
    main()
