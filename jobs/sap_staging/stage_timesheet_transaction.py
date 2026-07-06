from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    connect_source,
    connect_staging,
    cursor_initial_from,
    cursor_overlap_minutes,
    cursor_safety_delay_minutes,
    ensure_staging_schema,
    get_stage_cursor,
    insert_staging_rows,
    ph3_order_table,
    plant_code,
    quote_table_name,
    setup_logging,
    update_stage_cursor,
    upsert_eligibility_audit,
)

log = setup_logging("stage_timesheet_transaction")


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def cursor_window(conn, overlap_minutes: int, safety_delay_minutes: int) -> tuple[datetime, datetime]:
    plant = plant_code()
    cursor_value = get_stage_cursor(conn, "TIMESHEET", plant)
    start = cursor_value or cursor_initial_from()
    if overlap_minutes > 0:
        start = start - timedelta(minutes=overlap_minutes)
    end = datetime.now().replace(microsecond=0) - timedelta(minutes=safety_delay_minutes)
    return start, end


def fetch_rows(from_ts: datetime, to_ts: datetime, limit: int) -> list[dict]:
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    sql = f"""
    SELECT
      'TIMESHEET' AS source_system,
      t.tsnumber::text AS source_key,
      t.tsnumber::text AS source_ref_id,
      COALESCE(t.plant, '') AS werks,
      CASE
        WHEN COALESCE(un.employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
        ELSE LPAD(COALESCE(t.serialnumber, ''), 8, '0')
      END AS pernr,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.confirmation_number, '') END AS rueck,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(t.order_no, ''), 12, '0') END AS aufnr,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(t.operation_no::text, ''), 4, '0') END AS vornr,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.sequence_category, '') END AS flgat,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.sequence_number, '') END AS plnfl,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.branch_operation_no, '') END AS vornr_b,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN '' ELSE COALESCE(po.return_operation_no, '') END AS vornr_r,
      CASE
        WHEN COALESCE(t.activitytype, '') <> '' THEN ''
        WHEN COALESCE(t.workcentercode, '') LIKE '%%OT' THEN 'OV'
        WHEN COALESCE(t.order_no, '') LIKE '32%%' THEN 'RW'
        ELSE 'RG'
      END AS zconf_type,
      COALESCE(t.workcentercode, '') AS arbpl,
      CASE WHEN COALESCE(t.activitytype, '') <> '' THEN t.activitytype ELSE '' END AS lstar,
      TO_CHAR(t.longdate_checkin AT TIME ZONE %s, 'YYYYMMDD') AS isdd,
      TO_CHAR(t.longdate_checkin AT TIME ZONE %s, 'HH24MISS') AS isdz,
      TO_CHAR(t.longdate_checkout AT TIME ZONE %s, 'YYYYMMDD') AS iedd,
      TO_CHAR(t.longdate_checkout AT TIME ZONE %s, 'HH24MISS') AS iedz,
      '' AS aueru,
      '' AS zbarcodeid,
      NULL::timestamp AS bucket_start,
      NULL::timestamp AS synthetic_start,
      NULL::timestamp AS synthetic_end,
      NULL::bigint AS total_seconds,
      1::integer AS source_row_count,
      t.longdate_checkin AT TIME ZONE %s AS source_min_start,
      t.longdate_checkout AT TIME ZONE %s AS source_max_end
    FROM timesheet_transaction t
    LEFT JOIN {ph3_table} po
      ON LTRIM(COALESCE(po.order_no, ''), '0') = t.order_no
     AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
    LEFT JOIN LATERAL (
      SELECT employee_category
      FROM usernfc u
      WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
          = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
      LIMIT 1
    ) un ON TRUE
    WHERE t.longdate_checkin IS NOT NULL
      AND t.longdate_checkout IS NOT NULL
      AND t.longdate_checkout > t.longdate_checkin
      AND t.longdate_checkout >= (%s::timestamp AT TIME ZONE %s)
      AND t.longdate_checkout <  (%s::timestamp AT TIME ZONE %s)
      AND COALESCE(t.state_flag, 0) <> 5
    ORDER BY t.longdate_checkout, t.tsnumber
    LIMIT %s
    """

    params = [timezone, timezone, timezone, timezone, timezone, timezone, from_ts, timezone, to_ts, timezone, limit]
    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]


def dedupe_audit_rows(rows: list[dict]) -> list[dict]:
    """Drop duplicate (source_system, source_key) pairs, keeping the first.

    execute_values runs a single INSERT ... ON CONFLICT DO UPDATE; two rows with
    the same conflict key in one batch raise CardinalityViolation. Callers pass
    STAGED rows before BLOCKED rows so STAGED wins on overlap.
    """
    seen: set[tuple] = set()
    result = []
    for row in rows:
        key = (row.get("source_system"), row.get("source_key"))
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def audit_rows_for_staged(rows: list[dict]) -> list[dict]:
    return [
        {
            "source_system": row["source_system"],
            "source_key": row["source_key"],
            "source_ref_id": row.get("source_ref_id"),
            "source_date": row.get("source_min_start").date() if row.get("source_min_start") else None,
            "plant": row.get("werks") or plant_code(),
            "eligibility_status": "STAGED",
            "block_reason": None,
            "block_detail": json.dumps({"staged_to": "sap_timesheet_staging"}),
        }
        for row in rows
    ]


def fetch_blocked_today_rows() -> list[dict]:
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    sql = f"""
    WITH base AS (
      SELECT
        t.tsnumber,
        t.plant,
        (t.longdate_checkin AT TIME ZONE %s)::date AS source_date,
        t.activitytype,
        t.order_no,
        t.operation_no,
        EXISTS (
          SELECT 1
          FROM {ph3_table} po
          WHERE LTRIM(COALESCE(po.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
        ) AS has_sow_match
      FROM timesheet_transaction t
      WHERE t.longdate_checkin IS NOT NULL
        AND t.longdate_checkin >= (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s)
        AND t.longdate_checkin <  (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s) + interval '1 day'
        AND COALESCE(t.state_flag, 0) <> 5
    ),
    flags AS (
      SELECT
        *,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND operation_no IS NULL) AS missing_operation,
        (
          NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL
          AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          AND operation_no IS NOT NULL
          AND NOT has_sow_match
        ) AS sow_no_match
      FROM base
    )
    SELECT *
    FROM flags
    WHERE missing_order OR missing_operation OR sow_no_match
    ORDER BY tsnumber
    """

    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (timezone, timezone, timezone, timezone, timezone))
            rows = [dict(row) for row in cur.fetchall()]

    audit_rows = []
    for row in rows:
        reasons = []
        if row.get("missing_order"):
            reasons.append("missing_order")
        if row.get("missing_operation"):
            reasons.append("missing_operation")
        if row.get("sow_no_match"):
            reasons.append("sow_no_match")

        audit_rows.append({
            "source_system": "TIMESHEET",
            "source_key": str(row["tsnumber"]),
            "source_ref_id": str(row["tsnumber"]),
            "source_date": row.get("source_date"),
            "plant": row.get("plant") or plant_code(),
            "eligibility_status": "BLOCKED",
            "block_reason": ",".join(reasons),
            "block_detail": json.dumps({
                "missing_order": bool(row.get("missing_order")),
                "missing_operation": bool(row.get("missing_operation")),
                "sow_no_match": bool(row.get("sow_no_match")),
                "order_no": row.get("order_no"),
                "operation_no": row.get("operation_no"),
            }),
        })
    return audit_rows


def run_once(args: argparse.Namespace) -> bool:
    cursor_mode = not (args.from_ts or args.to_ts)

    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            from_ts, to_ts = cursor_window(staging_conn, args.overlap_minutes, args.safety_delay_minutes)

    if from_ts >= to_ts:
        log.info("Timesheet staging skipped: empty window %s..%s", from_ts, to_ts)
        return False

    rows = fetch_rows(from_ts, to_ts, args.limit)
    if args.dry_run:
        log.info("Dry run: window=%s..%s prepared=%s inserted=0", from_ts, to_ts, len(rows))
        return bool(rows)

    cursor_to = to_ts
    with connect_staging() as conn:
        ensure_staging_schema(conn)
        inserted = insert_staging_rows(conn, rows)
        audited = upsert_eligibility_audit(conn, dedupe_audit_rows([
            *audit_rows_for_staged(rows),
            *fetch_blocked_today_rows(),
        ]))
        if cursor_mode:
            cursor_to = max((row["source_max_end"] for row in rows), default=to_ts)
            update_stage_cursor(conn, "TIMESHEET", plant_code(), cursor_to)
            conn.commit()

    log.info(
        "Timesheet staging window=%s..%s prepared=%s inserted=%s audited=%s cursor_mode=%s",
        from_ts,
        to_ts,
        len(rows),
        inserted,
        audited,
        cursor_mode,
    )
    return cursor_to > from_ts


def run(args: argparse.Namespace) -> None:
    if not args.loop:
        run_once(args)
        return

    if args.from_ts or args.to_ts:
        raise ValueError("--loop is only for cursor mode; do not use --from-ts/--to-ts")

    for iteration in range(1, args.loop + 1):
        log.info("Loop iteration %s/%s", iteration, args.loop)
        progressed = run_once(args)
        if not progressed:
            log.info("Loop stopped: no more cursor progress")
            break
        if args.loop_sleep_seconds > 0 and iteration < args.loop:
            time.sleep(args.loop_sleep_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage completed timesheet_transaction rows to SAP staging. Default: cursor catch-up by checkout time.",
    )
    parser.add_argument("--from-ts", help="Start checkout timestamp, e.g. 2026-06-14T21:00:00")
    parser.add_argument("--to-ts", help="End checkout timestamp, e.g. 2026-06-14T21:10:00")
    parser.add_argument("--overlap-minutes", type=int, default=cursor_overlap_minutes(30), help="Cursor overlap to catch late updates")
    parser.add_argument("--safety-delay-minutes", type=int, default=cursor_safety_delay_minutes(1), help="Do not process the most recent N minutes")
    parser.add_argument("--limit", type=int, default=5000, help="Maximum source rows to stage per run")
    parser.add_argument("--loop", type=int, default=0, help="Test/catch-up mode: run cursor batches repeatedly N times")
    parser.add_argument("--loop-sleep-seconds", type=float, default=0.0, help="Sleep between loop iterations")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(args)


if __name__ == "__main__":
    main()
