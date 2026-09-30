"""Regression checks for confirmation backfill safety boundaries."""

from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backfill_timesheet_confirmation import (  # noqa: E402
    actionable,
    build_plan_sql,
    clone_columns,
    load_exposures,
    resolve_date_range,
    validate_runtime_context,
)


def test_through_today_is_inclusive_in_plant_date():
    assert resolve_date_range(
        "2026-09-18", None, None, True, date(2026, 9, 21)
    ) == ("2026-09-18", "2026-09-22")


def test_through_date_becomes_exclusive_next_day():
    assert resolve_date_range(
        "2026-09-01", None, "2026-09-17", False, date(2026, 9, 21)
    ) == ("2026-09-01", "2026-09-18")


def test_date_range_rejects_ambiguous_or_reversed_bounds():
    invalid = [
        ("2026-09-01", "2026-09-20", "2026-09-17", False),
        ("2026-09-18", "2026-09-18", None, False),
        ("not-a-date", None, None, False),
    ]
    for from_value, to_value, through_value, through_today in invalid:
        try:
            resolve_date_range(
                from_value,
                to_value,
                through_value,
                through_today,
                date(2026, 9, 21),
            )
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid range accepted: {invalid}")


def test_runtime_context_requires_same_plant_and_timezone():
    row = {"plant_code": "5100", "timezone": "Asia/Jakarta"}
    assert validate_runtime_context("Asia/Jakarta", "5100", row) == "Asia/Jakarta"

    for timezone, plant in [("Asia/Makassar", "5100"), ("Asia/Jakarta", "5051")]:
        try:
            validate_runtime_context(timezone, plant, row)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"mismatch accepted: timezone={timezone}, plant={plant}")


def test_integrity_exceptions_are_never_actionable():
    for classification in (
        "NULL_CLOCK",
        "NULL_INTERVAL",
        "NULL_OVERLAP",
        "NULL_MULTI_BOUNDARY",
        "NULL_COMPLEX_ROSTER",
    ):
        row = {"class": classification, "exposure": "UNSTAGED"}
        simple, splits, held = actionable([row])
        assert simple == []
        assert splits == []
        assert held == [row]

    pending = {"class": "SPLIT", "exposure": "PENDING"}
    simple, splits, held = actionable([pending])
    assert simple == []
    assert splits == []
    assert held == [pending]


def test_plan_sql_uses_explicit_timezone_and_integrity_guards():
    sql = build_plan_sql('"ph3_order"')
    assert "AT TIME ZONE %(tz)s" in sql
    assert "NULL_CLOCK" in sql
    assert "NULL_OVERLAP" in sql
    assert "NULL_MULTI_BOUNDARY" in sql
    assert "NULL_COMPLEX_ROSTER" in sql
    assert "%(from_ts)s::timestamp AT TIME ZONE %(tz)s" in sql
    assert "WHEN NULLIF(BTRIM(order_no), '') IS NULL THEN NULL" in sql
    assert "ph3 AS MATERIALIZED" in sql


def test_clone_columns_accepts_real_dict_rows():
    class Cursor:
        def execute(self, *_):
            pass

        def fetchall(self):
            return [{"column_name": "order_no"}, {"column_name": "operation_no"}]

    assert clone_columns(Cursor()) == ["order_no", "operation_no"]


def test_exposure_loader_preserves_freeze_priority():
    class Cursor:
        def __init__(self):
            self.batch = -1

        def execute(self, *_):
            self.batch += 1

        def fetchall(self):
            return [
                [{"source_row_id": "10"}],
                [
                    {"source_row_id": "10", "staging_id": 100},
                    {"source_row_id": "11", "staging_id": 101},
                    {"source_row_id": "11", "staging_id": 102},
                ],
                [
                    {"id": 100, "status": "PENDING"},
                    {"id": 101, "status": "PENDING"},
                    {"id": 102, "status": "POSTED"},
                ],
            ][self.batch]

    assert load_exposures(Cursor(), [10, 11, 12], "5100") == {
        10: {"exposure": "EXCLUDED", "staging_statuses": ["PENDING"]},
        11: {"exposure": "FROZEN", "staging_statuses": ["PENDING", "POSTED"]},
        12: {"exposure": "UNSTAGED", "staging_statuses": []},
    }


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"OK: {len(tests)} confirmation backfill checks")
