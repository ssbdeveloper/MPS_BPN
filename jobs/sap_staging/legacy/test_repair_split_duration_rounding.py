from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from repair_split_duration_rounding import Segment, allocate_hundredths, discover_families


TZ = ZoneInfo("Asia/Jakarta")


def segment(row_id, start, end, duration, suffix="RG"):
    return Segment(
        tsnumber=row_id,
        serialnumber="OP-1",
        order_no="100",
        operation_no=10,
        confirmationnumber=f"700001{suffix}",
        confirmation_base="700001",
        suffix=suffix,
        start=datetime.fromisoformat(start).replace(tzinfo=TZ),
        end=datetime.fromisoformat(end).replace(tzinfo=TZ),
        duration=Decimal(duration),
        modified_at=None,
    )


def test_allocator_conserves_family_when_independent_rounding_is_high():
    rows = [
        segment(1, "2026-09-17T15:28:06", "2026-09-17T16:30:00", "1.03"),
        segment(2, "2026-09-17T16:30:00", "2026-09-17T18:51:17", "2.35", "OV"),
    ]
    allocated = allocate_hundredths(rows)
    assert sum(allocated.values()) == Decimal("3.39")
    assert allocated == {1: Decimal("1.03"), 2: Decimal("2.36")}


def test_allocator_handles_three_short_segments_without_negative_duration():
    rows = [
        segment(1, "2026-09-17T08:00:00", "2026-09-17T08:00:22", "0.01", "OV"),
        segment(2, "2026-09-17T08:00:22", "2026-09-17T08:00:44", "0.01", "RG"),
        segment(3, "2026-09-17T08:00:44", "2026-09-17T08:00:48", "0.00", "OV"),
    ]
    allocated = allocate_hundredths(rows)
    assert sum(allocated.values()) == Decimal("0.01")
    assert all(value >= 0 for value in allocated.values())


def test_discovery_requires_exact_continuity_and_different_suffix():
    valid = [
        segment(1, "2026-09-17T15:00:00", "2026-09-17T16:30:00", "1.49"),
        segment(2, "2026-09-17T16:30:00", "2026-09-17T17:00:00", "0.51", "OV"),
    ]
    families, ambiguous = discover_families(valid)
    assert len(families) == 1
    assert ambiguous == []

    gap = [
        valid[0],
        segment(3, "2026-09-17T16:30:01", "2026-09-17T17:00:00", "0.50", "OV"),
    ]
    families, ambiguous = discover_families(gap)
    assert families == []
    assert ambiguous == []


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"ok - {len(tests)} tests")
