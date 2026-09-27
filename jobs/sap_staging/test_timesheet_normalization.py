"""Kontrak normalizer bersama stager + preview (review #21-#23).

RED lebih dulu: timesheet_normalization belum ada saat test pertama dijalankan.
"""
from __future__ import annotations

import unittest
from datetime import datetime

from timesheet_normalization import normalize_timesheet_rows


def dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


RULES = {
    "break_windows": [
        {"start": "12:00", "end": "13:00", "days": [1, 2, 3, 4, 5]},
        {"start": "00:00", "end": "01:00", "days": [1, 2, 3, 4, 5]},
    ],
    "max_record_minutes": {
        "timesheet": {"": 180, "1590": 120, "1670": None},
    },
    "max_record_fallback": {"va": 300, "nva": 90},
}


class TestTimesheetNormalization(unittest.TestCase):
    def test_trunc_detik_dan_clip_window_setengah_terbuka(self):
        rows = [{
            "tsnumber": 1,
            "serialnumber": "OP1",
            "activitytype": "",
            "order_no": "4001",
            "start": dt("2026-09-20T23:59:59.900000"),
            "end": dt("2026-09-22T00:00:00.900000"),
        }]
        out = normalize_timesheet_rows(
            rows, RULES,
            clip_start=dt("2026-09-21T00:00:00"),
            clip_end=dt("2026-09-22T00:00:00"),
        )[0]
        self.assertEqual(out["alloc_start"], dt("2026-09-21T00:00:00"))
        self.assertEqual(out["alloc_end"], dt("2026-09-22T00:00:00"))
        self.assertEqual(out["raw_seconds"], 24 * 3600)

    def test_record_di_luar_window_dibuang(self):
        rows = [{
            "tsnumber": 1, "serialnumber": "OP1", "activitytype": "",
            "order_no": "4001", "start": dt("2026-09-19T08:00:00"),
            "end": dt("2026-09-19T09:00:00"),
        }]
        self.assertEqual(normalize_timesheet_rows(
            rows, RULES,
            clip_start=dt("2026-09-20T00:00:00"),
            clip_end=dt("2026-09-21T00:00:00"),
        ), [])

    def test_produktif_tidak_dipotong_break(self):
        rows = [{
            "tsnumber": 1, "serialnumber": "OP1", "activitytype": "",
            "order_no": "4001", "start": dt("2026-09-21T11:30:00"),
            "end": dt("2026-09-21T13:30:00"),
        }]
        out = normalize_timesheet_rows(rows, RULES)[0]
        self.assertEqual(out["raw_seconds"], 7200)
        self.assertEqual(out["break_seconds"], 0)
        self.assertEqual(out["cap_minutes"], 180)

    def test_nonproduktif_memotong_break_yang_sama_dengan_stager(self):
        rows = [{
            "tsnumber": 2, "serialnumber": "OP1", "activitytype": "1590",
            "order_no": "", "start": dt("2026-09-21T11:30:00"),
            "end": dt("2026-09-21T13:30:00"),
        }]
        out = normalize_timesheet_rows(rows, RULES)[0]
        self.assertEqual(out["raw_seconds"], 7200)
        self.assertEqual(out["break_seconds"], 3600)
        self.assertEqual(out["cap_minutes"], 120)

    def test_break_lintas_tengah_malam_memakai_dow_hari_break(self):
        # Senin 23:30 -> Selasa 01:30; break Selasa 00:00-01:00 = 3600 detik.
        rows = [{
            "tsnumber": 3, "serialnumber": "OP1", "activitytype": "1590",
            "order_no": "", "start": dt("2026-09-21T23:30:00"),
            "end": dt("2026-09-22T01:30:00"),
        }]
        out = normalize_timesheet_rows(rows, RULES)[0]
        self.assertEqual(out["break_seconds"], 3600)

    def test_cap_map_null_dan_fallback_sama_dengan_stager(self):
        rows = [
            {"tsnumber": 1, "serialnumber": "O", "activitytype": "1670", "order_no": "",
             "start": dt("2026-09-21T08:00:00"), "end": dt("2026-09-21T09:00:00")},
            {"tsnumber": 2, "serialnumber": "O", "activitytype": "9999", "order_no": "",
             "start": dt("2026-09-21T09:00:00"), "end": dt("2026-09-21T10:00:00")},
        ]
        out = normalize_timesheet_rows(rows, RULES)
        self.assertIsNone(out[0]["cap_minutes"])
        self.assertEqual(out[1]["cap_minutes"], 90)


if __name__ == "__main__":
    unittest.main(verbosity=2)
