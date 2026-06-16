from __future__ import annotations

import argparse
import time
from datetime import timedelta

from stage_sap_timesheet import fetch_machine_hour_rows, parse_dt, previous_completed_hour, stage_rows
from sap_staging_common import (
    connect_staging,
    connect_source,
    cursor_initial_from,
    cursor_overlap_minutes,
    ensure_staging_schema,
    get_stage_cursor,
    plant_code,
    setup_logging,
    update_stage_cursor,
)

log = setup_logging("stage_machinehours")


def find_next_sap_ready_start(after_ts):
    sql = """
    SELECT min(startdatetime)
    FROM mch_transaction
    WHERE startdatetime > %s
      AND enddatetime IS NOT NULL
      AND enddatetime > startdatetime
      AND confirmation_number IS NOT NULL
      AND confirmation_number <> ''
      AND order_no IS NOT NULL
      AND order_no <> ''
      AND operation_no IS NOT NULL
      AND operation_no <> ''
    """
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (after_ts,))
            row = cur.fetchone()
    return row[0] if row else None


def floor_hour(value):
    return value.replace(minute=0, second=0, microsecond=0)


def run_once(args: argparse.Namespace) -> bool:
    cursor_mode = not (args.from_ts or args.to_ts)

    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        _, to_ts = previous_completed_hour()
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            cursor_value = get_stage_cursor(staging_conn, "MCH_HOURS", plant_code())
        from_ts = cursor_value or cursor_initial_from()
        if args.overlap_minutes > 0:
            from_ts = from_ts - timedelta(minutes=args.overlap_minutes)
        max_to_ts = from_ts + timedelta(hours=args.max_hours)
        if max_to_ts < to_ts:
            to_ts = max_to_ts

    if from_ts >= to_ts:
        log.info("Machine-hour staging skipped: empty window %s..%s", from_ts, to_ts)
        return False

    rows = fetch_machine_hour_rows(from_ts, to_ts)
    inserted = stage_rows(rows, args.dry_run)
    cursor_to = to_ts
    if cursor_mode and not args.dry_run:
        if not rows and args.fast_forward_empty:
            next_ready = find_next_sap_ready_start(to_ts)
            if next_ready and next_ready > to_ts:
                cursor_to = floor_hour(next_ready)
                log.info("No SAP-ready rows in window; fast-forward cursor to next ready hour %s", cursor_to)
        with connect_staging() as staging_conn:
            ensure_staging_schema(staging_conn)
            update_stage_cursor(staging_conn, "MCH_HOURS", plant_code(), cursor_to)
            staging_conn.commit()
    log.info(
        "Machine-hour staging window=%s..%s prepared=%s inserted=%s cursor_mode=%s",
        from_ts,
        to_ts,
        len(rows),
        inserted,
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
        description="Stage bundled mch_transaction rows to SAP staging. Default: previous completed hour.",
    )
    parser.add_argument("--from-ts", help="Start timestamp, e.g. 2026-06-12T14:00:00")
    parser.add_argument("--to-ts", help="End timestamp, e.g. 2026-06-12T15:00:00")
    parser.add_argument("--overlap-minutes", type=int, default=cursor_overlap_minutes(30), help="Cursor overlap to catch cross-hour updates")
    parser.add_argument("--max-hours", type=int, default=6, help="Maximum catch-up window per run in cursor mode")
    parser.add_argument("--loop", type=int, default=0, help="Test/catch-up mode: run cursor batches repeatedly N times")
    parser.add_argument("--loop-sleep-seconds", type=float, default=0.0, help="Sleep between loop iterations")
    parser.add_argument("--no-fast-forward-empty", dest="fast_forward_empty", action="store_false", help="Do not jump over empty cursor windows")
    parser.add_argument("--dry-run", action="store_true")
    parser.set_defaults(fast_forward_empty=True)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(args)


if __name__ == "__main__":
    main()
