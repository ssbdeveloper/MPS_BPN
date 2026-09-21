"""Conserve two-decimal duration across exact timesheet split families.

Dry-run is the default. Apply creates a database backup and updates only `duration`
plus `modified_at`; timestamps and confirmation numbers are immutable inputs.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
from pathlib import Path

import psycopg2.extras
from psycopg2 import sql

from backfill_timesheet_confirmation import assert_runtime_context
from sap_staging_common import app_timezone, connect_source, plant_code, setup_logging


log = setup_logging("repair_split_duration_rounding")


@dataclass(frozen=True)
class Segment:
    tsnumber: int
    serialnumber: str
    order_no: str | None
    operation_no: int | None
    confirmationnumber: str
    confirmation_base: str
    suffix: str
    start: datetime
    end: datetime
    duration: Decimal
    modified_at: datetime | None


@dataclass
class FamilyPlan:
    key: str
    members: list[Segment]
    allocated: dict[int, Decimal]
    blocked_reason: str | None = None
    blocked_detail: str | None = None

    @property
    def changes(self) -> dict[int, Decimal]:
        return {
            row.tsnumber: self.allocated[row.tsnumber]
            for row in self.members
            if row.duration != self.allocated[row.tsnumber]
        }


def allocate_hundredths(members: list[Segment]) -> dict[int, Decimal]:
    exact = []
    for row in members:
        seconds = Decimal(str((row.end - row.start).total_seconds()))
        units = seconds / Decimal("36")
        floor_units = int(units.to_integral_value(rounding=ROUND_FLOOR))
        exact.append((row, units, floor_units, units - floor_units))
    target_units = int(
        sum((item[1] for item in exact), Decimal("0")).to_integral_value(
            rounding=ROUND_HALF_UP
        )
    )
    allocated_units = {item[0].tsnumber: item[2] for item in exact}
    units_to_add = target_units - sum(allocated_units.values())
    ranked = sorted(
        exact,
        key=lambda item: (-item[3], item[0].start, item[0].tsnumber),
    )
    for row, _, _, _ in ranked[:units_to_add]:
        allocated_units[row.tsnumber] += 1
    result = {
        tsnumber: Decimal(units) / Decimal("100")
        for tsnumber, units in allocated_units.items()
    }
    if sum(result.values(), Decimal("0")) != Decimal(target_units) / Decimal("100"):
        raise RuntimeError("allocator duration tidak konservatif")
    if any(value < 0 for value in result.values()):
        raise RuntimeError("allocator menghasilkan duration negatif")
    return result


def discover_families(rows: list[Segment]) -> tuple[list[FamilyPlan], list[dict]]:
    grouped: dict[tuple, list[Segment]] = defaultdict(list)
    for row in rows:
        grouped[
            (row.serialnumber, row.order_no, row.operation_no, row.confirmation_base)
        ].append(row)

    families: list[FamilyPlan] = []
    ambiguous: list[dict] = []
    for group_key, group in grouped.items():
        by_start: dict[datetime, list[Segment]] = defaultdict(list)
        for row in group:
            by_start[row.start].append(row)
        edges: dict[int, set[int]] = defaultdict(set)
        lookup = {row.tsnumber: row for row in group}
        for left in group:
            for right in by_start.get(left.end, []):
                if left.tsnumber != right.tsnumber and left.suffix != right.suffix:
                    edges[left.tsnumber].add(right.tsnumber)
                    edges[right.tsnumber].add(left.tsnumber)

        seen: set[int] = set()
        sequence = 0
        for row_id in sorted(edges):
            if row_id in seen:
                continue
            sequence += 1
            stack = [row_id]
            component: list[Segment] = []
            while stack:
                current = stack.pop()
                if current in seen:
                    continue
                seen.add(current)
                component.append(lookup[current])
                stack.extend(edges[current] - seen)
            component.sort(key=lambda row: (row.start, row.end, row.tsnumber))
            valid = (
                len(component) >= 2
                and all(len(edges[row.tsnumber]) <= 2 for row in component)
                and all(
                    left.end == right.start and left.suffix != right.suffix
                    for left, right in zip(component, component[1:])
                )
            )
            key = "|".join(str(value) for value in (*group_key, sequence))
            if not valid:
                ambiguous.append(
                    {"component": key, "tsnumbers": [row.tsnumber for row in component]}
                )
                continue
            allocated = allocate_hundredths(component)
            plan = FamilyPlan(key, component, allocated)
            if plan.changes:
                families.append(plan)
    return families, ambiguous


def load_segments(cur, start: date | None, through: date | None, timezone: str) -> list[Segment]:
    filters = [
        "confirmationnumber ~ '^[0-9]+(RG|OV|RW)$'",
        "longdate_checkin IS NOT NULL",
        "longdate_checkout IS NOT NULL",
        "duration IS NOT NULL",
        "COALESCE(state_flag, 0) <> 5",
    ]
    params: list = []
    if start:
        params.extend([timezone, start])
        filters.append(f"(longdate_checkin AT TIME ZONE ${len(params) - 1})::date >= ${len(params)}")
    if through:
        params.extend([timezone, through])
        filters.append(f"(longdate_checkin AT TIME ZONE ${len(params) - 1})::date <= ${len(params)}")
    # psycopg2 uses %s rather than node-postgres placeholders.
    query = f"""
        SELECT tsnumber, serialnumber, order_no, operation_no, confirmationnumber,
               regexp_replace(confirmationnumber, '(RG|OV|RW)$', '') AS confirmation_base,
               right(confirmationnumber, 2) AS suffix,
               longdate_checkin, longdate_checkout, duration, modified_at
        FROM public.timesheet_transaction
        WHERE {' AND '.join(filters)}
        ORDER BY serialnumber, order_no, operation_no, confirmation_base,
                 longdate_checkin, longdate_checkout, tsnumber
    """
    for index in range(len(params), 0, -1):
        query = query.replace(f"${index}", "%s")
    cur.execute(query, params)
    return [
        Segment(
            tsnumber=int(row["tsnumber"]),
            serialnumber=str(row["serialnumber"] or ""),
            order_no=row["order_no"],
            operation_no=row["operation_no"],
            confirmationnumber=row["confirmationnumber"],
            confirmation_base=row["confirmation_base"],
            suffix=row["suffix"],
            start=row["longdate_checkin"],
            end=row["longdate_checkout"],
            duration=Decimal(row["duration"]),
            modified_at=row["modified_at"],
        )
        for row in cur.fetchall()
    ]


def apply_exposure_guards(cur, plans: list[FamilyPlan], plant: str) -> dict[int, list[str]]:
    member_ids = sorted({row.tsnumber for plan in plans for row in plan.members})
    statuses: dict[int, set[str]] = defaultdict(set)
    if member_ids:
        cur.execute(
            """
            SELECT ss.source_row_id, st.status
            FROM public.sap_staging_source ss
            JOIN public.sap_timesheet_staging st ON st.id = ss.staging_id
            WHERE ss.source_system = 'TIMESHEET'
              AND ss.plant = %s
              AND ss.source_row_id = ANY(%s::text[])
            """,
            (plant, [str(row_id) for row_id in member_ids]),
        )
        for row in cur.fetchall():
            statuses[int(row["source_row_id"])].add(row["status"])
    for plan in plans:
        exposed = [
            (row.tsnumber, sorted(statuses[row.tsnumber]))
            for row in plan.members
            if statuses[row.tsnumber]
        ]
        if exposed:
            plan.blocked_reason = "STAGED"
            plan.blocked_detail = ", ".join(
                f"{row_id}:{'/'.join(values)}" for row_id, values in exposed
            )
    return {row_id: sorted(values) for row_id, values in statuses.items()}


def build_report(plans: list[FamilyPlan], ambiguous: list[dict], metadata: dict) -> dict:
    allowed = [plan for plan in plans if not plan.blocked_reason]
    blocked = [plan for plan in plans if plan.blocked_reason]
    return {
        "metadata": metadata,
        "summary": {
            "families_needing_change": len(plans),
            "allowed_families": len(allowed),
            "allowed_rows": sum(len(plan.changes) for plan in allowed),
            "blocked_families": len(blocked),
            "blocked_rows": sum(len(plan.changes) for plan in blocked),
            "ambiguous_components": len(ambiguous),
        },
        "ambiguous": ambiguous,
        "families": [
            {
                "family": plan.key,
                "blocked_reason": plan.blocked_reason,
                "blocked_detail": plan.blocked_detail,
                "members": [
                    {
                        "tsnumber": row.tsnumber,
                        "confirmationnumber": row.confirmationnumber,
                        "start": row.start.isoformat(),
                        "end": row.end.isoformat(),
                        "old_duration": str(row.duration),
                        "new_duration": str(plan.allocated[row.tsnumber]),
                        "changed": row.tsnumber in plan.changes,
                    }
                    for row in plan.members
                ],
            }
            for plan in plans
        ],
    }


def write_report(payload: dict, report_dir: Path) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    json_path = report_dir / "split_duration_repair.json"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    csv_path = report_dir / "split_duration_repair.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "family", "blocked_reason", "tsnumber", "confirmationnumber",
                "start", "end", "old_duration", "new_duration", "changed",
            ],
        )
        writer.writeheader()
        for family in payload["families"]:
            for member in family["members"]:
                writer.writerow(
                    {
                        "family": family["family"],
                        "blocked_reason": family["blocked_reason"] or "",
                        **member,
                    }
                )
    return json_path


def apply_changes(cur, plans: list[FamilyPlan], plant: str, run_id: str) -> tuple[str, int]:
    allowed = [plan for plan in plans if not plan.blocked_reason]
    members = {row.tsnumber: row for plan in allowed for row in plan.members}
    changes = {row_id: value for plan in allowed for row_id, value in plan.changes.items()}
    if not changes:
        raise RuntimeError("tidak ada duration aman yang perlu diperbarui")

    cur.execute(
        """
        SELECT tsnumber, confirmationnumber, longdate_checkin, longdate_checkout,
               duration, modified_at
        FROM public.timesheet_transaction
        WHERE tsnumber = ANY(%s::int[])
        ORDER BY tsnumber
        FOR UPDATE
        """,
        (sorted(members),),
    )
    locked = {int(row["tsnumber"]): dict(row) for row in cur.fetchall()}
    if set(locked) != set(members):
        raise RuntimeError("anggota family berubah atau hilang sebelum apply")
    for row_id, source in members.items():
        current = locked[row_id]
        if (
            current["confirmationnumber"], current["longdate_checkin"],
            current["longdate_checkout"], Decimal(current["duration"]), current["modified_at"],
        ) != (
            source.confirmationnumber, source.start, source.end,
            source.duration, source.modified_at,
        ):
            raise RuntimeError(f"precondition berubah untuk tsnumber={row_id}")

    fresh_plans = [FamilyPlan(plan.key, plan.members, plan.allocated) for plan in allowed]
    apply_exposure_guards(cur, fresh_plans, plant)
    if any(plan.blocked_reason for plan in fresh_plans):
        raise RuntimeError("exposure SAP berubah setelah row lock")

    backup_table = f"timesheet_split_duration_backup_{run_id}"
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
        raise RuntimeError("backup duration tidak lengkap")

    cur.execute(
        "CREATE TEMP TABLE split_duration_plan (tsnumber int PRIMARY KEY, duration numeric NOT NULL) ON COMMIT DROP"
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO split_duration_plan (tsnumber, duration) VALUES %s",
        sorted(changes.items()),
    )
    cur.execute(
        """
        UPDATE public.timesheet_transaction t
        SET duration = p.duration, modified_at = now()
        FROM split_duration_plan p
        WHERE t.tsnumber = p.tsnumber
        RETURNING t.tsnumber
        """
    )
    updated = {int(row["tsnumber"]) for row in cur.fetchall()}
    if updated != set(changes):
        raise RuntimeError("jumlah row duration yang diperbarui tidak tepat")

    cur.execute(
        "SELECT tsnumber, duration, longdate_checkin, longdate_checkout, confirmationnumber FROM public.timesheet_transaction WHERE tsnumber = ANY(%s::int[])",
        (sorted(members),),
    )
    actual = {int(row["tsnumber"]): dict(row) for row in cur.fetchall()}
    for plan in allowed:
        if sum((Decimal(actual[row.tsnumber]["duration"]) for row in plan.members), Decimal("0")) != sum(plan.allocated.values(), Decimal("0")):
            raise RuntimeError(f"total duration family gagal: {plan.key}")
        for row in plan.members:
            current = actual[row.tsnumber]
            if (
                current["longdate_checkin"], current["longdate_checkout"],
                current["confirmationnumber"],
            ) != (row.start, row.end, row.confirmationnumber):
                raise RuntimeError(f"timestamp/confirmation berubah: {row.tsnumber}")
    return f"public.{backup_table}", len(updated)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Repair pembulatan duration family split")
    parser.add_argument("--from", dest="from_date")
    parser.add_argument("--through")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--report-dir", type=Path)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    start = date.fromisoformat(args.from_date) if args.from_date else None
    through = date.fromisoformat(args.through) if args.through else None
    if start and through and start > through:
        raise SystemExit("--from tidak boleh setelah --through")
    if args.apply and not args.yes:
        raise SystemExit("Apply membutuhkan --yes")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_dir = args.report_dir or (
        Path(__file__).resolve().parent / "reports" / f"split-duration-repair-{run_id}"
    )
    metadata = {
        "run_id": run_id,
        "mode": "apply" if args.apply else "dry-run",
        "from": start.isoformat() if start else None,
        "through": through.isoformat() if through else None,
        "status": "PLANNED",
        "backup_table": None,
    }
    conn = connect_source()
    conn.set_session(isolation_level="REPEATABLE READ", autocommit=False)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            timezone = assert_runtime_context(cur, app_timezone(), plant_code())
            rows = load_segments(cur, start, through, timezone)
            plans, ambiguous = discover_families(rows)
            apply_exposure_guards(cur, plans, plant_code())
            payload = build_report(plans, ambiguous, metadata)
            report_path = write_report(payload, report_dir)
            if not args.apply:
                conn.rollback()
                print(json.dumps({"report": str(report_path), **payload["summary"]}, indent=2))
                return 0
            backup_table, updated = apply_changes(cur, plans, plant_code(), run_id)
            conn.commit()
            metadata.update(
                status="COMMITTED", backup_table=backup_table, updated_rows=updated
            )
            payload = build_report(plans, ambiguous, metadata)
            write_report(payload, report_dir)
            print(json.dumps({"report": str(report_path), "backup_table": backup_table, "updated_rows": updated, **payload["summary"]}, indent=2))
            return 0
    except Exception as exc:
        conn.rollback()
        metadata.update(status="ROLLED_BACK", error=str(exc))
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / "failure.json").write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        log.exception("Repair duration di-rollback")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
