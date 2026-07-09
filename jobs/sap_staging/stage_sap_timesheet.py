from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    connect_source,
    connect_staging,
    ensure_staging_schema,
    insert_staging_rows,
    parse_csv_ints,
    ph3_order_table,
    plant_code,
    quote_table_name,
    setup_logging,
)

log = setup_logging("stage_sap_timesheet")


def previous_completed_hour() -> tuple[datetime, datetime]:
    end = datetime.now().replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=1)
    return start, end


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def fetch_timesheet_rows(tsnumbers: list[int], from_date: str | None, to_date: str | None) -> list[dict]:
    if not tsnumbers and not (from_date and to_date):
        raise ValueError("timesheet staging needs --tsnumbers or both --from-date and --to-date")

    params: list = [app_timezone()]
    filters = [
        "t.longdate_checkin IS NOT NULL",
        "t.longdate_checkout IS NOT NULL",
        "t.longdate_checkout > t.longdate_checkin",
        "COALESCE(t.state_flag, 0) <> 5",
    ]

    if tsnumbers:
        params.append(tsnumbers)
        filters.append(f"t.tsnumber = ANY(%s::int[])")
    else:
        params.extend([from_date, to_date])
        filters.append("t.longdate_checkin >= %s::date")
        filters.append("t.longdate_checkin < (%s::date + interval '1 day')")

    ph3_table = quote_table_name(ph3_order_table())
    where_sql = " AND ".join(filters)

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
      LPAD(COALESCE(t.serialnumber, ''), 8, '0') AS pernr_origin,
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
      ON LTRIM(po.order_no, '0') = t.order_no
     AND LTRIM(po.operation_no, '0') = t.operation_no::text
    LEFT JOIN LATERAL (
      SELECT employee_category
      FROM usernfc u
      WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
          = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
      LIMIT 1
    ) un ON TRUE
    WHERE {where_sql}
    ORDER BY t.tsnumber
    """

    tz = params[0]
    query_params = [tz, tz, tz, tz, tz, tz, *params[1:]]
    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, query_params)
            return [dict(row) for row in cur.fetchall()]


def fetch_machine_hour_rows(from_ts: datetime, to_ts: datetime) -> list[dict]:
    werks = plant_code()
    if not werks:
        raise ValueError("PLANT_SSB is required for machine-hour staging")

    sql = """
    WITH source_rows AS (
      SELECT
        proddataid,
        startdatetime,
        enddatetime,
        sn_employee,
        un.employee_category,
        confirmation_number,
        order_no,
        operation_no,
        sequence_category,
        sequence_number,
        branch_operation_no,
        return_operation_no,
        status_activitytype,
        machineid,
        status_description
      FROM mch_transaction
      LEFT JOIN LATERAL (
        SELECT employee_category
        FROM usernfc u
        WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
            = upper(regexp_replace(COALESCE(mch_transaction.sn_employee, ''), '\\s+', '', 'g'))
        LIMIT 1
      ) un ON TRUE
      WHERE startdatetime IS NOT NULL
        AND enddatetime IS NOT NULL
        AND enddatetime > startdatetime
        AND confirmation_number IS NOT NULL
        AND confirmation_number <> ''
        AND order_no IS NOT NULL
        AND order_no <> ''
        AND operation_no IS NOT NULL
        AND operation_no <> ''
        AND startdatetime < %s
        AND enddatetime > %s
    ),
    split_rows AS (
      SELECT
        s.*,
        h.hour_bucket,
        GREATEST(s.startdatetime, h.hour_bucket, %s::timestamp) AS segment_start,
        LEAST(s.enddatetime, h.hour_bucket + interval '1 hour', %s::timestamp) AS segment_end
      FROM source_rows s
      CROSS JOIN LATERAL generate_series(
        date_trunc('hour', GREATEST(s.startdatetime, %s::timestamp)),
        date_trunc('hour', LEAST(s.enddatetime, %s::timestamp) - interval '1 microsecond'),
        interval '1 hour'
      ) AS h(hour_bucket)
    ),
    segments AS (
      SELECT
        *,
        EXTRACT(EPOCH FROM (segment_end - segment_start))::bigint AS segment_seconds
      FROM split_rows
      WHERE segment_end > segment_start
    ),
    bundled AS (
      SELECT
        hour_bucket AS bucket_start,
        COALESCE(sn_employee, '') AS employee_key,
        CASE
          WHEN COALESCE(employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
          ELSE COALESCE(sn_employee, '')
        END AS pernr,
        COALESCE(confirmation_number, '') AS rueck_raw,
        COALESCE(order_no, '') AS aufnr_raw,
        COALESCE(operation_no, '') AS vornr_raw,
        COALESCE(sequence_category, '') AS flgat,
        COALESCE(sequence_number, '') AS plnfl,
        COALESCE(branch_operation_no, '') AS vornr_b,
        COALESCE(return_operation_no, '') AS vornr_r,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN status_activitytype
          ELSE ''
        END AS zconf_type,
        COALESCE(machineid, '') AS arbpl,
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN ''
          ELSE COALESCE(status_activitytype, '')
        END AS lstar,
        CASE
          WHEN status_activitytype = 'M2' THEN COALESCE(status_description, '')
          ELSE ''
        END AS zbarcodeid,
        COUNT(*)::integer AS source_row_count,
        MIN(segment_start) AS source_min_start,
        MAX(segment_end) AS source_max_end,
        SUM(segment_seconds)::bigint AS total_seconds
      FROM segments
      GROUP BY
        hour_bucket,
        COALESCE(sn_employee, ''),
        CASE
          WHEN COALESCE(employee_category, '') ILIKE '%%Outsource%%' THEN '11009413'
          ELSE COALESCE(sn_employee, '')
        END,
        COALESCE(confirmation_number, ''),
        COALESCE(order_no, ''),
        COALESCE(operation_no, ''),
        COALESCE(sequence_category, ''),
        COALESCE(sequence_number, ''),
        COALESCE(branch_operation_no, ''),
        COALESCE(return_operation_no, ''),
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN status_activitytype
          ELSE ''
        END,
        COALESCE(machineid, ''),
        CASE
          WHEN status_activitytype IN ('M1', 'M2') THEN ''
          ELSE COALESCE(status_activitytype, '')
        END,
        CASE
          WHEN status_activitytype = 'M2' THEN COALESCE(status_description, '')
          ELSE ''
        END
    )
    SELECT
      'MCH_HOURS' AS source_system,
      md5(concat_ws('|',
        %s,
        bucket_start::text,
        employee_key,
        rueck_raw,
        aufnr_raw,
        vornr_raw,
        flgat,
        plnfl,
        vornr_b,
        vornr_r,
        zconf_type,
        arbpl,
        lstar,
        zbarcodeid
      )) AS source_key,
      NULL::text AS source_ref_id,
      %s AS werks,
      pernr,
      employee_key AS pernr_origin,
      CASE WHEN zconf_type IN ('M1', 'M2') THEN LPAD(rueck_raw, 10, '0') ELSE '' END AS rueck,
      LPAD(aufnr_raw, 12, '0') AS aufnr,
      LPAD(vornr_raw, 4, '0') AS vornr,
      flgat,
      plnfl,
      vornr_b,
      vornr_r,
      zconf_type,
      arbpl,
      lstar,
      TO_CHAR(bucket_start, 'YYYYMMDD') AS isdd,
      TO_CHAR(bucket_start, 'HH24MISS') AS isdz,
      TO_CHAR(bucket_start + (total_seconds || ' seconds')::interval, 'YYYYMMDD') AS iedd,
      TO_CHAR(bucket_start + (total_seconds || ' seconds')::interval, 'HH24MISS') AS iedz,
      '' AS aueru,
      zbarcodeid,
      bucket_start,
      bucket_start AS synthetic_start,
      bucket_start + (total_seconds || ' seconds')::interval AS synthetic_end,
      total_seconds,
      source_row_count,
      source_min_start,
      source_max_end
    FROM bundled
    WHERE total_seconds > 0
    ORDER BY bucket_start, arbpl, aufnr, vornr, zconf_type, lstar, zbarcodeid
    """

    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (to_ts, from_ts, from_ts, to_ts, from_ts, to_ts, werks, werks))
            return [dict(row) for row in cur.fetchall()]


def stage_rows(rows: list[dict], dry_run: bool) -> int:
    if dry_run:
        log.info("Dry run: %s rows prepared, nothing inserted", len(rows))
        return 0
    with connect_staging() as conn:
        ensure_staging_schema(conn)
        return insert_staging_rows(conn, rows)


def cmd_init_db(_: argparse.Namespace) -> None:
    with connect_staging() as conn:
        ensure_staging_schema(conn)
    log.info("SAP staging schema is ready")


def cmd_timesheet(args: argparse.Namespace) -> None:
    rows = fetch_timesheet_rows(parse_csv_ints(args.tsnumbers), args.from_date, args.to_date)
    inserted = stage_rows(rows, args.dry_run)
    log.info("Timesheet staging prepared=%s inserted=%s", len(rows), inserted)


def cmd_mchours(args: argparse.Namespace) -> None:
    if args.from_ts and args.to_ts:
        from_ts = parse_dt(args.from_ts)
        to_ts = parse_dt(args.to_ts)
    elif args.from_ts or args.to_ts:
        raise ValueError("--from-ts and --to-ts must be used together")
    else:
        from_ts, to_ts = previous_completed_hour()

    rows = fetch_machine_hour_rows(from_ts, to_ts)
    inserted = stage_rows(rows, args.dry_run)
    log.info("Machine-hour staging window=%s..%s prepared=%s inserted=%s", from_ts, to_ts, len(rows), inserted)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage local timesheet data to AWS SAP staging table",
        epilog=(
            "Examples:\n"
            "  python stage_sap_timesheet.py init-db\n"
            "  python stage_sap_timesheet.py timesheet --tsnumbers 97179,97180\n"
            "  python stage_sap_timesheet.py timesheet --from-date 2026-06-14 --to-date 2026-06-14\n"
            "  python stage_sap_timesheet.py mchours\n"
            "  python stage_sap_timesheet.py mchours --from-ts 2026-06-12T14:00:00 --to-ts 2026-06-12T15:00:00"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    init_db = sub.add_parser("init-db", help="Create/upgrade SAP staging table")
    init_db.set_defaults(func=cmd_init_db)

    timesheet = sub.add_parser("timesheet", help="Stage timesheet_transaction rows")
    timesheet.add_argument("--tsnumbers", help="Comma-separated tsnumber list, e.g. 97179,97180")
    timesheet.add_argument("--from-date", help="Check-in start date YYYY-MM-DD")
    timesheet.add_argument("--to-date", help="Check-in end date YYYY-MM-DD")
    timesheet.add_argument("--dry-run", action="store_true")
    timesheet.set_defaults(func=cmd_timesheet)

    mchours = sub.add_parser("mchours", help="Stage bundled mch_transaction rows")
    mchours.add_argument("--from-ts", help="Start timestamp, e.g. 2026-06-14T14:00:00")
    mchours.add_argument("--to-ts", help="End timestamp, e.g. 2026-06-14T15:00:00")
    mchours.add_argument("--dry-run", action="store_true")
    mchours.set_defaults(func=cmd_mchours)

    return parser


def main() -> None:
    parser = build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        return
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
