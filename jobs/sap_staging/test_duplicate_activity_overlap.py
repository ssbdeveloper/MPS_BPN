#!/usr/bin/env python3
"""Test F2 duplicate productive activity overlap guard in run_timesheet_etl.py."""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timezone

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_timesheet_etl as etl  # noqa: E402
from run_timesheet_etl import EtlError, build_cleaned_plan, validate_no_duplicate_activity_overlap  # noqa: E402


class DuplicateActivityOverlapTest(unittest.TestCase):
    def setUp(self):
        self.plant = "5100"
        self.tz = "Asia/Jakarta"

    def test_overlap_same_order_and_op_rejected(self):
        """Dua timesheet produktif untuk operator dan order/op yang sama saling overlap -> ditolak DUPLICATE_ACTIVITY_OVERLAP."""
        rows = [
            {
                "tsnumber": 1001,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 1002,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "00010001234",  # leading zeroes
                "operation_no": "0040",      # string numeric
                "activitytype": None,
                "longdate_checkin": datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 11, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
        ]
        with self.assertRaises(EtlError) as ctx:
            build_cleaned_plan(rows, plant=self.plant, plant_timezone=self.tz)
        
        err_msg = str(ctx.exception)
        self.assertIn("DUPLICATE_ACTIVITY_OVERLAP", err_msg)
        self.assertIn("1001", err_msg)
        self.assertIn("1002", err_msg)

    def test_touching_adjacent_intervals_accepted(self):
        """Interval bersentuhan [08:00, 10:00) dan [10:00, 12:00) untuk order/op sama -> lolos (half-open)."""
        rows = [
            {
                "tsnumber": 1001,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 1002,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
        ]
        plan = build_cleaned_plan(rows, plant=self.plant, plant_timezone=self.tz)
        self.assertEqual(len(plan), 2)
        self.assertEqual(plan[0]["source_tsnumber"], 1001)
        self.assertEqual(plan[1]["source_tsnumber"], 1002)

    def test_different_orders_overlapping_accepted(self):
        """Order berbeda saling overlap untuk operator yang sama -> lolos (multitasking valid)."""
        rows = [
            {
                "tsnumber": 1001,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 1002,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10005678",  # Different order
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 30, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 30, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
        ]
        plan = build_cleaned_plan(rows, plant=self.plant, plant_timezone=self.tz)
        self.assertEqual(len(plan), 2)

    def test_different_operations_on_same_order_overlapping_accepted(self):
        """Operasi berbeda pada order yang sama saling overlap -> lolos."""
        rows = [
            {
                "tsnumber": 1001,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 40,
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 1002,
                "plant": self.plant,
                "serialnumber": "OP-01",
                "order_no": "10001234",
                "operation_no": 50,      # Different operation
                "activitytype": "",
                "longdate_checkin": datetime(2026, 9, 15, 8, 30, tzinfo=timezone.utc),
                "longdate_checkout": datetime(2026, 9, 15, 10, 30, tzinfo=timezone.utc),
                "raw_seconds": 7200,
            },
        ]
        plan = build_cleaned_plan(rows, plant=self.plant, plant_timezone=self.tz)
        self.assertEqual(len(plan), 2)

    def test_cross_boundary_window_vs_companion_conflict_rejected(self):
        """Satu record di dalam capture window dan pasangannya di luar window (companion) saling overlap
        pada operator-day yang sama -> harus tetap terdeteksi DUPLICATE_ACTIVITY_OVERLAP sebelum F3."""
        # 1. Direct fetch_companion_work_segments verification
        target_row = {
            "tsnumber": 2001,
            "source_tsnumber": 2001,
            "plant": self.plant,
            "serialnumber": "OP-COMPANION-01",
            "order_no": "10008888",
            "operation_no": 20,
            "activitytype": "",
            "longdate_checkin": datetime(2026, 9, 19, 1, 0, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 19, 3, 0, tzinfo=timezone.utc),
            "raw_seconds": 7200,
        }
        target_cleaned = build_cleaned_plan([target_row], plant=self.plant, plant_timezone=self.tz)
        target_work = [s for s in target_cleaned if s.get("segment_kind") == "WORK" and s.get("is_productive")]

        # Companion row (checkout outside window [00:00, 04:00) UTC)
        companion_row = {
            "tsnumber": 2002,
            "plant": self.plant,
            "serialnumber": "OP-COMPANION-01",
            "order_no": "00010008888",  # same order
            "operation_no": "0020",      # same op
            "activitytype": None,
            "longdate_checkin": datetime(2026, 9, 19, 2, 0, tzinfo=timezone.utc),  # Overlaps [01:00, 03:00)
            "longdate_checkout": datetime(2026, 9, 19, 5, 0, tzinfo=timezone.utc),  # outside window
            "modified_at": datetime(2026, 9, 19, 5, 0, tzinfo=timezone.utc),
            "raw_seconds": 10800,
            "local_date_checkin": datetime(2026, 9, 19, 9, 0).date(),
            "raw_snapshot": {},
        }

        class MockCursor:
            def execute(self, sql, params):
                pass
            def fetchall(self):
                return [companion_row]

        with self.assertRaises(EtlError) as ctx:
            etl.fetch_companion_work_segments(
                MockCursor(),
                plant=self.plant,
                tz_name=self.tz,
                target_work_segments=target_work,
                from_ts=datetime(2026, 9, 19, 0, 0, tzinfo=timezone.utc),
                to_ts=datetime(2026, 9, 19, 4, 0, tzinfo=timezone.utc),
                target_inputs=[target_row],
            )

        err_msg = str(ctx.exception)
        self.assertIn("DUPLICATE_ACTIVITY_OVERLAP", err_msg)
        self.assertIn("2001", err_msg)
        self.assertIn("2002", err_msg)

    def test_companion_vs_companion_historical_overlap_outside_window_not_rejected(self):
        """Dua record companion di luar window yang saling overlap (data historis sebelum cutoff)
        tidak boleh menggagalkan run jika tidak saling overlap dengan record target di dalam window."""
        target_row = {
            "tsnumber": 3001,
            "serialnumber": "OP-HIST",
            "plant": self.plant,
            "order_no": "10009999",
            "operation_no": "0010",
            "activitytype": None,
            "longdate_checkin": datetime(2026, 9, 23, 1, 0, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc),
            "workcentercode": "WC-01",
            "confirmationnumber": "CONF-3001",
            "state_flag": 1,
            "raw_seconds": 7200,
            "local_date_checkin": date(2026, 9, 23),
            "raw_snapshot": {},
            "status": "VALID",
        }
        # Dua companion di tanggal 2026-09-22 yang saling overlap satu sama lain
        comp_row_1 = {
            "tsnumber": 3002,
            "serialnumber": "OP-HIST",
            "plant": self.plant,
            "order_no": "10009999",
            "operation_no": "0010",
            "activitytype": None,
            "longdate_checkin": datetime(2026, 9, 22, 1, 0, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 22, 3, 0, tzinfo=timezone.utc),
            "workcentercode": "WC-01",
            "confirmationnumber": "CONF-3002",
            "state_flag": 1,
            "raw_seconds": 7200,
            "local_date_checkin": date(2026, 9, 22),
            "raw_snapshot": {},
            "status": "VALID",
            "source_tsnumber": 3002,
            "modified_at": datetime(2026, 9, 22, 3, 0, tzinfo=timezone.utc),
        }
        comp_row_2 = {
            "tsnumber": 3003,
            "serialnumber": "OP-HIST",
            "plant": self.plant,
            "order_no": "10009999",
            "operation_no": "0010",
            "activitytype": None,
            "longdate_checkin": datetime(2026, 9, 22, 1, 5, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 22, 3, 0, tzinfo=timezone.utc),
            "workcentercode": "WC-01",
            "confirmationnumber": "CONF-3003",
            "state_flag": 1,
            "raw_seconds": 6900,
            "local_date_checkin": date(2026, 9, 22),
            "raw_snapshot": {},
            "status": "VALID",
            "source_tsnumber": 3003,
            "modified_at": datetime(2026, 9, 22, 3, 0, tzinfo=timezone.utc),
        }

        class MockCursorHistorical:
            def execute(self, sql, params):
                pass

            def fetchall(self):
                return [comp_row_1, comp_row_2]

        target_work = [{
            "source_tsnumber": 3001,
            "serialnumber": "OP-HIST",
            "segment_kind": "WORK",
            "is_productive": True,
            "remaining_seconds": 7200,
            "local_date": date(2026, 9, 23),
        }]

        # Harus lolos tanpa DUPLICATE_ACTIVITY_OVERLAP
        comp_result = etl.fetch_companion_work_segments(
            MockCursorHistorical(),
            plant=self.plant,
            tz_name=self.tz,
            target_work_segments=target_work,
            from_ts=datetime(2026, 9, 23, 0, 0, tzinfo=timezone.utc),
            to_ts=datetime(2026, 9, 23, 4, 0, tzinfo=timezone.utc),
            target_inputs=[target_row],
        )
        self.assertIsInstance(comp_result, list)


if __name__ == "__main__":
    unittest.main()
