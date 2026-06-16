from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.request
from typing import Any

import psycopg2.extras

from sap_staging_common import (
    as_json,
    connect_source,
    connect_staging,
    ensure_staging_schema,
    mark_local_timesheet_rejected,
    plant_code,
    sap_credentials,
    setup_logging,
)

log = setup_logging("post_sap_staging")


def parse_sap_status(response_text: str) -> tuple[str, str]:
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return "", response_text

    body = parsed.get("n0:ABM_CPP_223_MT_Timesheet_Res") or {}
    return str(body.get("STATUS") or ""), str(body.get("MESSAGE") or response_text)


def post_payload(payload: dict[str, Any], timeout: int) -> tuple[int, str]:
    url, username, password = sap_credentials()
    if not url or not username or not password:
        raise RuntimeError("SAP_INBOUND_URL, SAP_INBOUND_USERNAME, and SAP_INBOUND_PASSWORD are required")

    basic_auth = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {basic_auth}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def claim_rows(limit: int, include_failed: bool, source_system: str | None, plant: str | None) -> list[dict]:
    statuses = ["PENDING", "FAILED"] if include_failed else ["PENDING"]
    filters = ["status = ANY(%s)"]
    params: list[Any] = [statuses]

    if source_system:
        filters.append("source_system = %s")
        params.append(source_system)
    if plant:
        filters.append("werks = %s")
        params.append(plant)

    where_sql = " AND ".join(filters)
    sql = f"""
    SELECT id, source_system, source_ref_id, werks, payload
    FROM sap_timesheet_staging
    WHERE {where_sql}
    ORDER BY id
    LIMIT %s
    FOR UPDATE SKIP LOCKED
    """
    params.append(limit)

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def claim_selected_rows(ids: list[str], ztimesheetids: list[str], allow_posted: bool) -> list[dict]:
    filters = []
    params: list[Any] = []

    if ids:
        filters.append("id = ANY(%s::bigint[])")
        params.append([int(value) for value in ids])
    if ztimesheetids:
        filters.append("ztimesheetid = ANY(%s::text[])")
        params.append(ztimesheetids)
    if not filters:
        return []

    status_filter = "" if allow_posted else "AND status <> 'POSTED'"
    where_sql = " OR ".join(f"({item})" for item in filters)
    sql = f"""
    SELECT id, source_system, source_ref_id, werks, payload
    FROM sap_timesheet_staging
    WHERE ({where_sql})
      {status_filter}
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    """

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def update_result(row_id: int, ok: bool, status_code: int, response_text: str, message: str) -> None:
    try:
        parsed_response = json.loads(response_text)
    except json.JSONDecodeError:
        parsed_response = None

    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = %s,
                    sap_response = %s,
                    sap_response_text = %s,
                    sap_error = %s,
                    posted_at = CASE WHEN %s THEN now() ELSE posted_at END,
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    "POSTED" if ok else "FAILED",
                    psycopg2.extras.Json(as_json(parsed_response)),
                    response_text,
                    None if ok else f"HTTP {status_code}: {message}",
                    ok,
                    row_id,
                ),
            )
        conn.commit()


def log_timesheet_sap(payload: dict[str, Any], response_text: str) -> None:
    try:
        status, message = parse_sap_status(response_text)
        sap_response = f"{'SUCCESS' if status == 'S' else 'ERROR'} : {message}" if status else response_text
        with connect_source() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO log_timesheet_sap (
                      ztimesheetid, pernr, confirmation_number, order_no, operation_no,
                      sequence_category, sequence_number, branch_operation_no, return_operation_no,
                      zconf_type, work_center, activity_type,
                      start_date, start_time, end_date, end_time, plant_code, final_completed_indicator,
                      zbarcodeid, sap_response
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      %s,%s,%s,%s,%s,%s,%s,%s
                    )
                    """,
                    (
                        payload.get("ZTIMESHEETID", ""),
                        payload.get("PERNR", ""),
                        payload.get("RUECK", ""),
                        payload.get("AUFNR", ""),
                        payload.get("VORNR", ""),
                        payload.get("FLGAT", ""),
                        payload.get("PLNFL", ""),
                        payload.get("VORNR_B", ""),
                        payload.get("VORNR_R", ""),
                        payload.get("ZCONF_TYPE", ""),
                        payload.get("ARBPL", ""),
                        payload.get("LSTAR", ""),
                        payload.get("ISDD", ""),
                        payload.get("ISDZ", ""),
                        payload.get("IEDD", ""),
                        payload.get("IEDZ", ""),
                        payload.get("WERKS", ""),
                        payload.get("AUERU", ""),
                        payload.get("ZBARCODEID", ""),
                        sap_response,
                    ),
                )
            conn.commit()
    except Exception as exc:
        log.warning("Could not write local log_timesheet_sap: %s", exc)


def process_rows(args: argparse.Namespace) -> None:
    selected_ids = parse_csv_values(args.ids)
    selected_ztimesheetids = parse_csv_values(args.ztimesheetids)
    if selected_ids or selected_ztimesheetids:
        rows = claim_selected_rows(selected_ids, selected_ztimesheetids, args.allow_posted)
    else:
        plant = None if args.all_plants else (args.plant or plant_code())
        rows = claim_rows(args.limit, args.retry_failed, args.source_system, plant)
    if not rows:
        log.info("No staging rows to post")
        return

    success_count = 0
    fail_count = 0

    for row in rows:
        payload = row["payload"] or {}
        if not payload:
            message = "empty payload"
            update_result(row["id"], False, 0, message, message)
            fail_count += 1
            continue

        try:
            status_code, response_text = post_payload(payload, args.timeout)
            sap_status, sap_message = parse_sap_status(response_text)
            ok = sap_status == "S"
            update_result(row["id"], ok, status_code, response_text, sap_message)
            log_timesheet_sap(payload, response_text)

            if ok:
                success_count += 1
                log.info("SAP OK id=%s ztimesheetid=%s", row["id"], payload.get("ZTIMESHEETID"))
            else:
                fail_count += 1
                log.warning("SAP FAILED id=%s ztimesheetid=%s message=%s", row["id"], payload.get("ZTIMESHEETID"), sap_message)
                if row["source_system"] == "TIMESHEET" and row.get("source_ref_id"):
                    mark_local_timesheet_rejected([row["source_ref_id"]], sap_message)
        except Exception as exc:
            fail_count += 1
            response_text = str(exc)
            update_result(row["id"], False, 0, response_text, response_text)
            log.warning("SAP ERROR id=%s ztimesheetid=%s error=%s", row["id"], payload.get("ZTIMESHEETID"), exc)
            if row["source_system"] == "TIMESHEET" and row.get("source_ref_id"):
                mark_local_timesheet_rejected([row["source_ref_id"]], str(exc))

        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000)

    log.info("SAP posting done success=%s failed=%s", success_count, fail_count)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Post SAP payloads from sap_timesheet_staging")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--delay-ms", type=int, default=100)
    parser.add_argument("--retry-failed", action="store_true", help="Also retry rows with status FAILED")
    parser.add_argument("--source-system", choices=["TIMESHEET", "MCH_HOURS"], help="Only post one source system")
    parser.add_argument("--plant", help="Only post one plant. Defaults to PLANT_SSB")
    parser.add_argument("--all-plants", action="store_true", help="Ignore plant filter")
    parser.add_argument("--ids", help="Comma-separated staging id list to post for manual testing")
    parser.add_argument("--ztimesheetids", help="Comma-separated ZTIMESHEETID list to post for manual testing")
    parser.add_argument("--allow-posted", action="store_true", help="Allow selected --ids/--ztimesheetids even if already POSTED")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    process_rows(args)


if __name__ == "__main__":
    main()
