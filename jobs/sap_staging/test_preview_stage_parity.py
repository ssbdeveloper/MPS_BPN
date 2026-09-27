"""Preview harus memakai pipeline hitung yang sama persis dengan stager (#21-#23)."""
from __future__ import annotations

import unittest
from datetime import datetime

from preview_allocation_invariant import calculate_preview
from stage_timesheet_transaction import allocate_staging_rows
from timesheet_normalization import normalize_timesheet_rows


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


RULES = {
    "break_windows": [{"start": "12:00", "end": "13:00", "days": [1]}],
    "max_record_minutes": {"timesheet": {"": 150, "1590": 60}},
    "max_record_fallback": {"va": 300, "nva": 90},
}

ROWS = [
    {"tsnumber": 1, "serialnumber": "OP", "activitytype": "", "order_no": "A",
     "start": dt("2026-09-21T08:00:00.900"), "end": dt("2026-09-21T14:00:00.900")},
    {"tsnumber": 2, "serialnumber": "OP", "activitytype": "", "order_no": "B",
     "start": dt("2026-09-21T08:00:00.100"), "end": dt("2026-09-21T14:00:00.100")},
    {"tsnumber": 3, "serialnumber": "OP", "activitytype": "1590", "order_no": "",
     "start": dt("2026-09-21T11:30:00.999"), "end": dt("2026-09-21T13:30:00.999")},
    # overlap window hanya satu jam; harus di-clip, bukan dipilih utuh berdasarkan check-in.
    {"tsnumber": 4, "serialnumber": "OP2", "activitytype": "1590", "order_no": "",
     "start": dt("2026-09-20T23:00:00"), "end": dt("2026-09-21T01:00:00")},
]


class TestPreviewStageParity(unittest.TestCase):
    def test_preview_identik_dengan_stager(self):
        lo, hi = dt("2026-09-21T00:00:00"), dt("2026-09-22T00:00:00")
        normalized = normalize_timesheet_rows(ROWS, RULES, clip_start=lo, clip_end=hi)
        staged = allocate_staging_rows(normalized)
        expected = {
            r["tsnumber"]: (
                r["raw_seconds"], r["allocated_seconds"],
                r["cap_minutes"], r["sap_effective_seconds"],
            )
            for r in staged
        }

        report = calculate_preview(ROWS, RULES, clip_start=lo, clip_end=hi)
        actual = {
            int(k): (v["raw_seconds"], v["allocated_seconds"],
                     v["cap_minutes"], v["sap_effective_seconds"])
            for k, v in report["records"].items()
        }
        self.assertEqual(actual, expected)

    def test_break_hanya_memotong_nonproduktif(self):
        report = calculate_preview(
            ROWS, RULES,
            clip_start=dt("2026-09-21T00:00:00"),
            clip_end=dt("2026-09-22T00:00:00"),
        )
        self.assertEqual(report["records"][1]["raw_seconds"], 6 * 3600)
        self.assertEqual(report["records"][3]["raw_seconds"], 3600)

    def test_window_overlap_mengikutkan_dan_clip_record_lintas_batas(self):
        report = calculate_preview(
            ROWS, RULES,
            clip_start=dt("2026-09-21T00:00:00"),
            clip_end=dt("2026-09-22T00:00:00"),
        )
        self.assertEqual(report["records"][4]["raw_seconds"], 3600)


if __name__ == "__main__":
    unittest.main(verbosity=2)
