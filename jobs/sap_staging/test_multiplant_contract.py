"""Runnable regression checks for shared-AWS multi-plant staging."""
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def text(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def test_provenance_identity_includes_plant():
    common = text("sap_staging_common.py")
    migration = (ROOT / "../../database/migrations/aws/20260911_sap_staging_multiplant_identity.sql").read_text(encoding="utf-8")
    assert "source_system, plant, source_row_id, bucket_start, seconds" in common
    assert "staging_id, source_system, plant, source_row_id, bucket_start" in common
    assert "uq_sap_staging_source_segment_per_bundle_multiplant" in migration
    assert "DROP INDEX IF EXISTS public.uq_sap_staging_source_segment_per_bundle" not in migration
    assert "DROP INDEX IF EXISTS public.uq_sap_staging_source_posted_once" in migration
    assert "s.plant IS DISTINCT FROM t.werks" in migration
    assert "ALTER COLUMN plant SET NOT NULL" in migration


def test_timesheet_has_plant_filter_and_provenance():
    timesheet = text("stage_timesheet_transaction.py")
    assert "COALESCE(t.plant::text, '') = %s" in timesheet
    assert "jsonb_build_array(jsonb_build_object(" in timesheet
    assert "'id', tsnumber::text" in timesheet

    from datetime import datetime
    import sap_staging_common as common

    class Cursor:
        def execute(self, *_):
            pass
        def fetchall(self):
            return [(99, "TIMESHEET", "5051:123", None)]

    captured = []
    original = common.psycopg2.extras.execute_values
    common.psycopg2.extras.execute_values = lambda _, __, values, **___: captured.extend(values)
    try:
        common.insert_provenance(Cursor(), [{
            "source_system": "TIMESHEET", "source_key": "5051:123", "werks": "5051",
            "segments": [{"id": "123", "bucket": datetime(2026, 9, 1, 8), "sec": 3600}],
        }])
    finally:
        common.psycopg2.extras.execute_values = original
    assert captured[0][4] == datetime(2026, 9, 1, 8)


def test_fresh_plant_migration_creates_both_mch_triggers():
    migration = (ROOT / "../../database/migrations/api/20260911_sap_staging_multiplant_triggers.sql").read_text(encoding="utf-8")
    assert "CREATE TRIGGER trg_mch_transaction_freeze_posted" in migration
    assert "CREATE TRIGGER trg_mch_transaction_invalidate_pending" in migration


def test_all_source_guards_include_plant():
    common = text("sap_staging_common.py")
    machine = text("stage_machinehours.py")
    bundler = text("stage_sap_timesheet.py")
    poster = text("post_sap_staging.py")
    assert "values.append((staging_id, source_system, row[\"werks\"]" in common
    assert "s.plant = %s" in machine
    assert bundler.count("ss.plant = %s") >= 2
    assert "ex.plant = %s" in bundler
    assert "ex.plant         = ss.plant" in poster
    assert "prev.plant         = s.plant" in poster


def test_manual_poster_supports_inclusive_date_range():
    poster = text("post_sap_staging.py")
    assert '--date-from' in poster
    assert '--date-to' in poster
    assert "payload->>'ISDD' BETWEEN %s AND %s" in poster


def test_manual_date_range_validation():
    from post_sap_staging import validate_date_range
    validate_date_range(None, None)
    validate_date_range("2026-09-01", "2026-09-07")
    for start, end in [("2026-09-01", None), (None, "2026-09-07"),
                       ("2026-09-08", "2026-09-07"), ("bad", "2026-09-07")]:
        try:
            validate_date_range(start, end)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid range accepted: {start}..{end}")


def test_only_known_plants_are_accepted():
    from post_sap_staging import build_parser
    assert build_parser().parse_args(["--plant", "5153"]).plant == "5153"
    try:
        with redirect_stderr(StringIO()):
            build_parser().parse_args(["--plant", "5173"])
    except SystemExit:
        pass
    else:
        raise AssertionError("unknown plant 5173 was accepted")


def test_machine_source_key_keeps_stable_plant_aware_hash():
    bundler = text("stage_sap_timesheet.py")
    assert "md5(concat_ws('|',\n          %s, bucket_start::text" in bundler
    assert "%s || ':' || md5" not in bundler


def test_machine_hours_are_disabled_for_manufacturing():
    machine = text("stage_machinehours.py")
    assert 'plant not in {"5051", "5071", "5153"}' in machine


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"OK: {len(tests)} multi-plant contract checks")
