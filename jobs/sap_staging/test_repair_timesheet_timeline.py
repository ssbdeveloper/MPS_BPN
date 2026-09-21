from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from repair_timesheet_timeline import (
    ComponentPlan,
    PlannedRow,
    TimelineRow,
    apply_exposure_guards,
    build_component_plans,
    business_date_for,
    reconstruct_endpoint,
)


TZ = ZoneInfo("Asia/Jakarta")


def local(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=TZ)


def row(row_id: int, start: str, end: str, old_start: str | None = None, old_end: str | None = None):
    base_start = local(start)
    base_end = local(end)
    source_start = local(old_start or start)
    source_end = local(old_end or end)
    return TimelineRow(
        tsnumber=row_id,
        serialnumber="OP-1",
        full_name="TEST",
        old_start=source_start,
        old_end=source_end,
        date_checkin=base_start.strftime("%d/%m/%Y"),
        hour_checkin=base_start.strftime("%H:%M"),
        date_checkout=base_end.strftime("%d/%m/%Y"),
        hour_checkout=base_end.strftime("%H:%M"),
        duration=Decimal("1"),
        state_flag=1,
        modified_at=None,
        base_start=base_start,
        base_end=base_end,
        business_date=business_date_for(base_start, TZ),
    )


def test_reconstruct_preserves_seconds():
    canonical = datetime(2026, 9, 17, 0, 25, 50, 123456, tzinfo=timezone.utc)
    result = reconstruct_endpoint(canonical, "17/09/2026", "08:25", TZ)
    assert result.astimezone(TZ) == local("2026-09-17T08:25:50.123456")


def test_business_date_uses_seven_am_cutoff():
    assert business_date_for(local("2026-09-18T06:59:00"), TZ).isoformat() == "2026-09-17"
    assert business_date_for(local("2026-09-18T07:00:00"), TZ).isoformat() == "2026-09-18"


def test_kabul_component_matches_expected_single_timeline():
    rows = [
        row(104493, "2026-09-17T06:01:00", "2026-09-17T06:12:00"),
        row(104542, "2026-09-17T06:12:00", "2026-09-17T07:25:00", old_end="2026-09-17T06:25:00"),
        row(108436, "2026-09-17T07:25:00", "2026-09-17T08:25:00", old_start="2026-09-17T06:25:00", old_end="2026-09-17T07:25:00"),
        row(104605, "2026-09-17T07:25:00", "2026-09-17T07:38:00"),
        row(104683, "2026-09-17T07:38:00", "2026-09-17T09:19:00"),
    ]
    plans = build_component_plans(rows)
    assert len(plans) == 2
    assert all(plan.blocked_reason is None for plan in plans)
    actual = {
        item.source.tsnumber: (
            item.new_start.astimezone(TZ).strftime("%H:%M"),
            item.new_end.astimezone(TZ).strftime("%H:%M"),
        )
        for plan in plans
        for item in plan.rows
    }
    assert actual == {
        104542: ("06:12", "07:25"),
        108436: ("07:25", "08:25"),
        104605: ("08:25", "08:38"),
        104683: ("08:38", "09:19"),
    }


def test_contained_interval_without_room_blocks_whole_component():
    rows = [
        row(1, "2026-09-17T08:00:00", "2026-09-17T10:00:00", old_start="2026-09-17T07:00:00"),
        row(2, "2026-09-17T08:30:00", "2026-09-17T09:30:00"),
    ]
    plan = build_component_plans(rows)[0]
    assert plan.blocked_reason == "NO_SPACE"


def test_frozen_and_pending_guards_fail_closed():
    source = row(1, "2026-09-17T08:00:00", "2026-09-17T09:00:00", old_start="2026-09-17T07:00:00")
    frozen = ComponentPlan("x", source.operator_key, source.business_date, [source], [PlannedRow(source, source.base_start, source.base_end, "CLOCK")])
    apply_exposure_guards([frozen], {1: {"excluded": True, "statuses": ["POSTED"]}})
    assert frozen.blocked_reason == "FROZEN"

    pending = ComponentPlan("y", source.operator_key, source.business_date, [source], [PlannedRow(source, source.base_start, source.base_end, "CLOCK")])
    apply_exposure_guards([pending], {1: {"excluded": False, "statuses": ["PENDING"]}})
    assert pending.blocked_reason == "PENDING_EXPOSED"

    excluded_pending = ComponentPlan("z", source.operator_key, source.business_date, [source], [PlannedRow(source, source.base_start, source.base_end, "CLOCK")])
    apply_exposure_guards([excluded_pending], {1: {"excluded": True, "statuses": ["PENDING"]}})
    assert excluded_pending.blocked_reason is None


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"ok - {len(tests)} tests")
