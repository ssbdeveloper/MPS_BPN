"""Repair corrupted historical timesheet clocks and remove local timeline overlaps.

Dry-run is the default. Apply is fail-closed and creates a database backup table in
the same transaction as the updates.

Examples:
    python repair_timesheet_timeline.py
    python repair_timesheet_timeline.py --from 2026-08-31 --through 2026-09-17
    python repair_timesheet_timeline.py --apply --yes
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

import psycopg2.extras
from psycopg2 import sql

from backfill_timesheet_confirmation import assert_runtime_context
from sap_staging_common import app_timezone, connect_source, plant_code, setup_logging


log = setup_logging("repair_timesheet_timeline")

DEFAULT_FROM = date(2026, 8, 31)
DEFAULT_THROUGH = date(2026, 9, 17)
FROZEN_STATUSES = {"POSTING", "POSTED", "FAILED", "SKIPPED"}
BUSINESS_DAY_CUTOFF_HOURS = 7


@dataclass(frozen=True)
class TimelineRow:
    tsnumber: int
    serialnumber: str | None
    full_name: str | None
    old_start: datetime
    old_end: datetime
    date_checkin: str
    hour_checkin: str
    date_checkout: str
    hour_checkout: str
    duration: Decimal | None
    state_flag: int | None
    modified_at: datetime | None
    base_start: datetime
    base_end: datetime
    business_date: date

    @property
    def operator_key(self) -> str:
        serial = (self.serialnumber or "").strip()
        if serial:
            return f"SERIAL:{serial}"
        return f"NAME:{(self.full_name or '').strip().upper()}"


@dataclass
class PlannedRow:
    source: TimelineRow
    new_start: datetime
    new_end: datetime
    mode: str

    @property
    def changed(self) -> bool:
        return self.new_start != self.source.old_start or self.new_end != self.source.old_end


@dataclass
class ComponentPlan:
    key: str
    operator_key: str
    business_date: date
    members: list[TimelineRow]
    rows: list[PlannedRow] = field(default_factory=list)
    blocked_reason: str | None = None
    blocked_detail: str | None = None

    @property
    def changed_rows(self) -> list[PlannedRow]:
        return [row for row in self.rows if row.changed]


def parse_local_minute(date_text: str, hour_text: str, tz: ZoneInfo) -> datetime:
    parsed = datetime.strptime(f"{date_text} {hour_text}", "%d/%m/%Y %H:%M")
    if parsed.strftime("%d/%m/%Y %H:%M") != f"{date_text} {hour_text}":
        raise ValueError("format jam tidak canonical")
    return parsed.replace(tzinfo=tz)


def reconstruct_endpoint(
    canonical: datetime,
    date_text: str,
    hour_text: str,
    tz: ZoneInfo,
) -> datetime:
    """Use the text local minute when it disagrees, preserving sub-minute precision."""

    intended = parse_local_minute(date_text, hour_text, tz)
    local = canonical.astimezone(tz)
    canonical_minute = local.replace(second=0, microsecond=0)
    if canonical_minute == intended:
        return canonical
    repaired_local = intended.replace(second=local.second, microsecond=local.microsecond)
    return repaired_local.astimezone(canonical.tzinfo or timezone.utc)


def business_date_for(value: datetime, tz: ZoneInfo) -> date:
    return (value.astimezone(tz) - timedelta(hours=BUSINESS_DAY_CUTOFF_HOURS)).date()


def _overlaps(rows: Iterable[PlannedRow]) -> bool:
    ordered = sorted(rows, key=lambda row: (row.new_start, row.new_end, row.source.tsnumber))
    return any(current.new_start < previous.new_end for previous, current in zip(ordered, ordered[1:]))


def _component_key(operator_key: str, business_date: date, sequence: int) -> str:
    return f"{operator_key}|{business_date.isoformat()}|{sequence:04d}"


def build_component_plans(rows: list[TimelineRow]) -> list[ComponentPlan]:
    grouped: dict[tuple[str, date], list[TimelineRow]] = {}
    for row in rows:
        grouped.setdefault((row.operator_key, row.business_date), []).append(row)

    plans: list[ComponentPlan] = []
    for (operator_key, business_day), group in sorted(grouped.items()):
        ordered = sorted(group, key=lambda row: (row.base_start, row.base_end, row.tsnumber))
        components: list[list[TimelineRow]] = []
        current: list[TimelineRow] = []
        current_max_end: datetime | None = None
        for row in ordered:
            if current and current_max_end is not None and row.base_start >= current_max_end:
                components.append(current)
                current = []
                current_max_end = None
            current.append(row)
            current_max_end = row.base_end if current_max_end is None else max(current_max_end, row.base_end)
        if current:
            components.append(current)

        for sequence, members in enumerate(components, start=1):
            has_clock_change = any(
                row.old_start != row.base_start or row.old_end != row.base_end for row in members
            )
            # Existing overlaps unrelated to the timezone contamination are out of
            # scope. A component is eligible only when at least one endpoint needs
            # clock reconstruction; its neighbors are then packed with it.
            if not has_clock_change:
                continue

            plan = ComponentPlan(
                key=_component_key(operator_key, business_day, sequence),
                operator_key=operator_key,
                business_date=business_day,
                members=members,
            )
            component_end = max(row.base_end for row in members)
            cursor: datetime | None = None
            packing_order = sorted(
                members,
                key=lambda row: (row.base_start, -row.base_end.timestamp(), row.tsnumber),
            )
            for row in packing_order:
                new_start = row.base_start
                new_end = row.base_end
                mode = "CLOCK" if (new_start, new_end) != (row.old_start, row.old_end) else "UNCHANGED"
                if new_end <= new_start:
                    plan.blocked_reason = "NO_SPACE"
                    plan.blocked_detail = f"interval nonpositif tsnumber={row.tsnumber}"
                    break
                if cursor is not None and new_start < cursor:
                    if new_end > cursor:
                        new_start = cursor
                        mode = "TRIM"
                    else:
                        interval = new_end - new_start
                        new_start = cursor
                        new_end = cursor + interval
                        mode = "PUSH"
                        if new_end > component_end:
                            plan.blocked_reason = "NO_SPACE"
                            plan.blocked_detail = f"tidak muat tsnumber={row.tsnumber}"
                            break
                if new_end <= new_start:
                    plan.blocked_reason = "NO_SPACE"
                    plan.blocked_detail = f"hasil nonpositif tsnumber={row.tsnumber}"
                    break
                plan.rows.append(PlannedRow(row, new_start, new_end, mode))
                cursor = new_end

            if plan.blocked_reason:
                plan.rows = [
                    PlannedRow(
                        row,
                        row.base_start,
                        row.base_end,
                        "CLOCK" if (row.base_start, row.base_end) != (row.old_start, row.old_end) else "UNCHANGED",
                    )
                    for row in members
                ]
            elif _overlaps(plan.rows):
                plan.blocked_reason = "NO_SPACE"
                plan.blocked_detail = "packing masih menghasilkan overlap"
            plans.append(plan)
    return plans


def load_rows(cur, start: date, through: date, tz: ZoneInfo) -> tuple[list[TimelineRow], list[dict]]:
    # CLI dates scope the canonical local check-in date. This is deliberate: it
    # matches the audited 18,730-row population and never pulls Sep-18 rows into
    # a Sep-17 repair merely because the business-day cutoff is 07:00.
    local_start = datetime.combine(start, time.min, tzinfo=tz)
    local_end = datetime.combine(through + timedelta(days=1), time.min, tzinfo=tz)
    cur.execute(
        """
        SELECT tsnumber, serialnumber, full_name,
               longdate_checkin, longdate_checkout,
               date_checkin, hour_checkin, date_checkout, hour_checkout,
               duration, state_flag, modified_at
        FROM public.timesheet_transaction
        WHERE COALESCE(state_flag, 0) <> 5
          AND longdate_checkin IS NOT NULL
          AND longdate_checkout IS NOT NULL
          AND longdate_checkin >= %s
          AND longdate_checkin < %s
        ORDER BY tsnumber
        """,
        (local_start, local_end),
    )
    result: list[TimelineRow] = []
    invalid: list[dict] = []
    for raw in cur.fetchall():
        item = dict(raw)
        try:
            base_start = reconstruct_endpoint(
                item["longdate_checkin"], item["date_checkin"], item["hour_checkin"], tz
            )
            base_end = reconstruct_endpoint(
                item["longdate_checkout"], item["date_checkout"], item["hour_checkout"], tz
            )
        except (TypeError, ValueError) as exc:
            invalid.append({"tsnumber": item["tsnumber"], "reason": str(exc)})
            continue
        business_day = business_date_for(base_start, tz)
        result.append(
            TimelineRow(
                tsnumber=int(item["tsnumber"]),
                serialnumber=item["serialnumber"],
                full_name=item["full_name"],
                old_start=item["longdate_checkin"],
                old_end=item["longdate_checkout"],
                date_checkin=item["date_checkin"],
                hour_checkin=item["hour_checkin"],
                date_checkout=item["date_checkout"],
                hour_checkout=item["hour_checkout"],
                duration=item["duration"],
                state_flag=item["state_flag"],
                modified_at=item["modified_at"],
                base_start=base_start,
                base_end=base_end,
                business_date=business_day,
            )
        )
    return result, invalid


def load_exposures(cur, target_ids: list[int], plant: str) -> dict[int, dict]:
    result = {row_id: {"excluded": False, "statuses": []} for row_id in target_ids}
    if not target_ids:
        return result
    source_ids = [str(row_id) for row_id in target_ids]
    cur.execute(
        """
        SELECT source_row_id
        FROM public.sap_staging_exclusion
        WHERE source_system = 'TIMESHEET' AND plant = %s
          AND source_row_id = ANY(%s::text[])
        """,
        (plant, source_ids),
    )
    for row in cur.fetchall():
        result[int(row["source_row_id"])]["excluded"] = True
    cur.execute(
        """
        SELECT ss.source_row_id, st.status
        FROM public.sap_staging_source ss
        JOIN public.sap_timesheet_staging st ON st.id = ss.staging_id
        WHERE ss.source_system = 'TIMESHEET' AND ss.plant = %s
          AND ss.source_row_id = ANY(%s::text[])
          AND st.werks = %s
        """,
        (plant, source_ids, plant),
    )
    statuses: dict[int, set[str]] = {}
    for row in cur.fetchall():
        statuses.setdefault(int(row["source_row_id"]), set()).add(row["status"])
    for row_id, values in result.items():
        values["statuses"] = sorted(statuses.get(row_id, set()))
    return result


def apply_exposure_guards(
    plans: list[ComponentPlan], exposures: dict[int, dict]
) -> None:
    for plan in plans:
        if plan.blocked_reason:
            continue
        for row in plan.changed_rows:
            exposure = exposures[row.source.tsnumber]
            frozen = sorted(FROZEN_STATUSES.intersection(exposure["statuses"]))
            if frozen:
                plan.blocked_reason = "FROZEN"
                plan.blocked_detail = f"tsnumber={row.source.tsnumber}, status={','.join(frozen)}"
                break
            if "PENDING" in exposure["statuses"] and not exposure["excluded"]:
                plan.blocked_reason = "PENDING_EXPOSED"
                plan.blocked_detail = f"tsnumber={row.source.tsnumber} PENDING tanpa exclusion"
                break


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def report_payload(
    plans: list[ComponentPlan], invalid: list[dict], exposures: dict[int, dict], metadata: dict
) -> dict:
    components = []
    for plan in plans:
        components.append(
            {
                "component": plan.key,
                "operator": plan.operator_key,
                "business_date": plan.business_date.isoformat(),
                "blocked_reason": plan.blocked_reason,
                "blocked_detail": plan.blocked_detail,
                "rows": [
                    {
                        "tsnumber": row.source.tsnumber,
                        "full_name": row.source.full_name,
                        "old_start": _iso(row.source.old_start),
                        "old_end": _iso(row.source.old_end),
                        "base_start": _iso(row.source.base_start),
                        "base_end": _iso(row.source.base_end),
                        "new_start": _iso(row.new_start),
                        "new_end": _iso(row.new_end),
                        "mode": row.mode,
                        "changed": row.changed,
                        "exposure": exposures.get(row.source.tsnumber, {}),
                    }
                    for row in plan.rows
                ],
            }
        )
    allowed = [plan for plan in plans if not plan.blocked_reason]
    blocked = [plan for plan in plans if plan.blocked_reason]
    return {
        "metadata": metadata,
        "summary": {
            "affected_components": len(plans),
            "allowed_components": len(allowed),
            "blocked_components": len(blocked),
            "allowed_changed_rows": sum(len(plan.changed_rows) for plan in allowed),
            "blocked_changed_rows": sum(len(plan.changed_rows) for plan in blocked),
            "allowed_component_rows": sum(len(plan.members) for plan in allowed),
            "blocked_component_rows": sum(len(plan.members) for plan in blocked),
            "blocked_by_reason": {
                reason: sum(plan.blocked_reason == reason for plan in blocked)
                for reason in sorted({plan.blocked_reason for plan in blocked})
            },
            "invalid_clock_rows": len(invalid),
        },
        "invalid_clock_rows": invalid,
        "components": components,
    }


def write_report(payload: dict, report_dir: Path) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    json_path = report_dir / "timeline_repair.json"
    csv_path = report_dir / "timeline_repair_rows.csv"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "component", "blocked_reason", "tsnumber", "full_name", "mode", "changed",
            "old_start", "old_end", "base_start", "base_end", "new_start", "new_end",
            "excluded", "staging_statuses",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for component in payload["components"]:
            for row in component["rows"]:
                writer.writerow(
                    {
                        "component": component["component"],
                        "blocked_reason": component["blocked_reason"] or "",
                        "tsnumber": row["tsnumber"],
                        "full_name": row["full_name"],
                        "mode": row["mode"],
                        "changed": row["changed"],
                        "old_start": row["old_start"],
                        "old_end": row["old_end"],
                        "base_start": row["base_start"],
                        "base_end": row["base_end"],
                        "new_start": row["new_start"],
                        "new_end": row["new_end"],
                        "excluded": row["exposure"].get("excluded"),
                        "staging_statuses": ",".join(row["exposure"].get("statuses", [])),
                    }
                )
    return json_path, csv_path


def _assert_locked_snapshot(cur, member_rows: list[TimelineRow]) -> None:
    ids = sorted({row.tsnumber for row in member_rows})
    cur.execute(
        """
        SELECT tsnumber, longdate_checkin, longdate_checkout,
               date_checkin, hour_checkin, date_checkout, hour_checkout,
               state_flag, modified_at
        FROM public.timesheet_transaction
        WHERE tsnumber = ANY(%s::int[])
        ORDER BY tsnumber
        FOR UPDATE
        """,
        (ids,),
    )
    locked = {int(row["tsnumber"]): dict(row) for row in cur.fetchall()}
    if set(locked) != set(ids):
        raise RuntimeError("precondition gagal: anggota component berubah/hilang")
    for source in member_rows:
        current = locked[source.tsnumber]
        expected = (
            source.old_start, source.old_end, source.date_checkin, source.hour_checkin,
            source.date_checkout, source.hour_checkout, source.state_flag, source.modified_at,
        )
        actual = (
            current["longdate_checkin"], current["longdate_checkout"],
            current["date_checkin"], current["hour_checkin"], current["date_checkout"],
            current["hour_checkout"], current["state_flag"], current["modified_at"],
        )
        if actual != expected:
            raise RuntimeError(f"precondition gagal: tsnumber={source.tsnumber} berubah sejak plan")


def _verify_exposures(plans: list[ComponentPlan], exposures: dict[int, dict]) -> None:
    for plan in plans:
        for row in plan.changed_rows:
            exposure = exposures[row.source.tsnumber]
            if FROZEN_STATUSES.intersection(exposure["statuses"]):
                raise RuntimeError(f"exposure berubah menjadi frozen: {row.source.tsnumber}")
            if "PENDING" in exposure["statuses"] and not exposure["excluded"]:
                raise RuntimeError(f"exposure berubah menjadi PENDING aktif: {row.source.tsnumber}")


def _rounded_hours(start: datetime, end: datetime) -> Decimal:
    seconds = Decimal(str((end - start).total_seconds()))
    return (seconds / Decimal("3600")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def apply_repairs(
    cur,
    allowed: list[ComponentPlan],
    blocked: list[ComponentPlan],
    plant: str,
    tz_name: str,
    run_id: str,
) -> tuple[str, int]:
    members = {row.tsnumber: row for plan in allowed for row in plan.members}
    changes = {row.source.tsnumber: row for plan in allowed for row in plan.changed_rows}
    if not changes:
        raise RuntimeError("tidak ada row aman yang perlu diperbarui")
    _assert_locked_snapshot(cur, list(members.values()))
    fresh_exposures = load_exposures(cur, sorted(changes), plant)
    _verify_exposures(allowed, fresh_exposures)

    backup_table = f"timesheet_timeline_repair_backup_{run_id}"
    cur.execute(
        sql.SQL(
            """CREATE TABLE public.{} AS
               SELECT t.*, now() AS repair_backed_up_at, %s::text AS repair_run_id
               FROM public.timesheet_transaction t
               WHERE t.tsnumber = ANY(%s::int[])"""
        ).format(sql.Identifier(backup_table)),
        (run_id, sorted(changes)),
    )
    cur.execute(sql.SQL("SELECT count(*) AS n FROM public.{}").format(sql.Identifier(backup_table)))
    if int(cur.fetchone()["n"]) != len(changes):
        raise RuntimeError("backup database tidak lengkap")

    cur.execute(
        """CREATE TEMP TABLE timeline_repair_plan (
               tsnumber integer PRIMARY KEY,
               new_start timestamptz NOT NULL,
               new_end timestamptz NOT NULL
             ) ON COMMIT DROP"""
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO timeline_repair_plan (tsnumber, new_start, new_end) VALUES %s",
        [(row_id, row.new_start, row.new_end) for row_id, row in sorted(changes.items())],
        page_size=1000,
    )
    cur.execute(
        """
        UPDATE public.timesheet_transaction t
        SET longdate_checkin = p.new_start,
            longdate_checkout = p.new_end,
            date_checkin = to_char(p.new_start AT TIME ZONE %s, 'DD/MM/YYYY'),
            hour_checkin = to_char(p.new_start AT TIME ZONE %s, 'HH24:MI'),
            date_checkout = to_char(p.new_end AT TIME ZONE %s, 'DD/MM/YYYY'),
            hour_checkout = to_char(p.new_end AT TIME ZONE %s, 'HH24:MI'),
            duration = round((extract(epoch FROM (p.new_end - p.new_start)) / 3600)::numeric, 2),
            modified_at = now()
        FROM timeline_repair_plan p
        WHERE t.tsnumber = p.tsnumber
        RETURNING t.tsnumber
        """,
        (tz_name, tz_name, tz_name, tz_name),
    )
    updated_ids = {int(row["tsnumber"]) for row in cur.fetchall()}
    if updated_ids != set(changes):
        raise RuntimeError(f"jumlah/identitas update tidak tepat: {len(updated_ids)} != {len(changes)}")

    cur.execute(
        """
        SELECT tsnumber, longdate_checkin, longdate_checkout,
               date_checkin, hour_checkin, date_checkout, hour_checkout, duration
        FROM public.timesheet_transaction
        WHERE tsnumber = ANY(%s::int[])
        """,
        (sorted(changes),),
    )
    verified = {int(row["tsnumber"]): dict(row) for row in cur.fetchall()}
    tz = ZoneInfo(tz_name)
    for row_id, planned in changes.items():
        actual = verified[row_id]
        local_start = planned.new_start.astimezone(tz)
        local_end = planned.new_end.astimezone(tz)
        expected_clock = (
            local_start.strftime("%d/%m/%Y"), local_start.strftime("%H:%M"),
            local_end.strftime("%d/%m/%Y"), local_end.strftime("%H:%M"),
        )
        actual_clock = (
            actual["date_checkin"], actual["hour_checkin"],
            actual["date_checkout"], actual["hour_checkout"],
        )
        if actual["longdate_checkin"] != planned.new_start or actual["longdate_checkout"] != planned.new_end:
            raise RuntimeError(f"verifikasi timestamp gagal: {row_id}")
        if actual_clock != expected_clock:
            raise RuntimeError(f"verifikasi clock text gagal: {row_id}")
        if actual["longdate_checkout"] <= actual["longdate_checkin"]:
            raise RuntimeError(f"interval nonpositif setelah update: {row_id}")
        if Decimal(actual["duration"]) != _rounded_hours(planned.new_start, planned.new_end):
            raise RuntimeError(f"verifikasi duration gagal: {row_id}")

    for plan in allowed:
        if _overlaps(plan.rows):
            raise RuntimeError(f"overlap tersisa pada component allowed: {plan.key}")

    blocked_sources = {
        row.source.tsnumber: row.source
        for plan in blocked
        for row in plan.changed_rows
    }
    if blocked_sources:
        cur.execute(
            """SELECT tsnumber, longdate_checkin, longdate_checkout
               FROM public.timesheet_transaction
               WHERE tsnumber = ANY(%s::int[])""",
            (sorted(blocked_sources),),
        )
        for current in cur.fetchall():
            source = blocked_sources[int(current["tsnumber"])]
            if (current["longdate_checkin"], current["longdate_checkout"]) != (source.old_start, source.old_end):
                raise RuntimeError(f"blocked row berubah: {source.tsnumber}")

    _verify_exposures(allowed, load_exposures(cur, sorted(changes), plant))
    return f"public.{backup_table}", len(updated_ids)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair timeline timesheet historis tanpa overlap")
    parser.add_argument("--from", dest="from_date", default=DEFAULT_FROM.isoformat())
    parser.add_argument("--through", default=DEFAULT_THROUGH.isoformat(), help="tanggal akhir inklusif")
    parser.add_argument("--apply", action="store_true", help="terapkan perubahan dalam satu transaksi")
    parser.add_argument("--yes", action="store_true", help="konfirmasi non-interaktif untuk --apply")
    parser.add_argument("--report-dir", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        start = date.fromisoformat(args.from_date)
        through = date.fromisoformat(args.through)
    except ValueError as exc:
        raise SystemExit(f"Tanggal harus YYYY-MM-DD: {exc}") from exc
    if start > through:
        raise SystemExit("--from tidak boleh setelah --through")
    if args.apply and not args.yes:
        raise SystemExit("Apply membutuhkan --yes setelah laporan dry-run ditinjau")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_dir = args.report_dir or (Path(__file__).resolve().parent / "reports" / f"timeline-repair-{run_id}")
    metadata = {
        "run_id": run_id,
        "mode": "apply" if args.apply else "dry-run",
        "from": start.isoformat(),
        "through": through.isoformat(),
        "status": "PLANNED",
        "backup_table": None,
    }
    conn = connect_source()
    conn.set_session(isolation_level="REPEATABLE READ", autocommit=False)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            tz_name = assert_runtime_context(cur, app_timezone(), plant_code())
            tz = ZoneInfo(tz_name)
            rows, invalid = load_rows(cur, start, through, tz)
            metadata["source_rows_examined"] = len(rows)
            plans = build_component_plans(rows)
            changed_ids = sorted({row.source.tsnumber for plan in plans for row in plan.changed_rows})
            exposures = load_exposures(cur, changed_ids, plant_code())
            apply_exposure_guards(plans, exposures)
            payload = report_payload(plans, invalid, exposures, metadata)
            json_path, csv_path = write_report(payload, report_dir)
            summary = payload["summary"]
            log.info("Report: %s", json_path)
            log.info("Rows CSV: %s", csv_path)
            log.info("Summary: %s", json.dumps(summary, ensure_ascii=False))
            if not args.apply:
                conn.rollback()
                print(json.dumps({"report": str(json_path), **summary}, indent=2))
                return 0

            allowed = [plan for plan in plans if not plan.blocked_reason]
            blocked = [plan for plan in plans if plan.blocked_reason]
            backup_table, updated = apply_repairs(
                cur, allowed, blocked, plant_code(), tz_name, run_id
            )
            metadata["status"] = "COMMITTED"
            metadata["backup_table"] = backup_table
            metadata["updated_rows"] = updated
            conn.commit()
            payload = report_payload(plans, invalid, exposures, metadata)
            write_report(payload, report_dir)
            print(json.dumps({"report": str(json_path), "backup_table": backup_table, "updated_rows": updated, **summary}, indent=2))
            return 0
    except Exception as exc:
        conn.rollback()
        metadata["status"] = "ROLLED_BACK"
        metadata["error"] = str(exc)
        try:
            report_dir.mkdir(parents=True, exist_ok=True)
            (report_dir / "failure.json").write_text(
                json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            pass
        log.exception("Repair dibatalkan dan di-rollback")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
