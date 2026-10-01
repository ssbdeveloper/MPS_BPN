#!/usr/bin/env python3
"""Unit tests for --stage mode, auto-window resolution, and duplicate quarantine."""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, time, timezone
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_timesheet_etl as etl


class StageModeAndAutoWindowTest(unittest.TestCase):
    def test_parser_accepts_stage_auto_window_and_quarantine(self):
        parser = etl.build_parser()
        args = parser.parse_args([
            "--plant", "5100",
            "--stage",
            "--auto-window",
            "--quarantine-duplicates",
            "--env", "prod",
        ])
        self.assertTrue(args.stage)
        self.assertTrue(args.auto_window)
        self.assertTrue(args.quarantine_duplicates)
        self.assertEqual(args.plant, "5100")
        self.assertEqual(args.env, "prod")

    def test_quarantine_duplicates_invalidates_rows(self):
        t1 = datetime(2026, 9, 10, 8, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)
        t4 = datetime(2026, 9, 10, 11, 0, tzinfo=timezone.utc)

        rows = [
            {
                "tsnumber": 101,
                "plant": "5100",
                "serialnumber": "OP-01",
                "order_no": "10001",
                "operation_no": 10,
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 102,
                "plant": "5100",
                "serialnumber": "OP-01",
                "order_no": "10001",
                "operation_no": 10,
                "activitytype": "",
                "longdate_checkin": t3,
                "longdate_checkout": t4,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 103,
                "plant": "5100",
                "serialnumber": "OP-02",
                "order_no": "10002",
                "operation_no": 20,
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
        ]

        # Quarantine mode: no exception raised, duplicate rows marked INVALIDATED
        etl.validate_no_duplicate_activity_overlap(rows, plant="5100", quarantine=True)

        self.assertEqual(rows[0].get("status"), "INVALIDATED")
        self.assertEqual(rows[0].get("invalidated_reason"), "DUPLICATE_ACTIVITY_OVERLAP")
        self.assertEqual(rows[1].get("status"), "INVALIDATED")
        self.assertEqual(rows[1].get("invalidated_reason"), "DUPLICATE_ACTIVITY_OVERLAP")
        self.assertIsNone(rows[2].get("status"))

    def test_validate_no_duplicate_activity_overlap_different_workcenter_allowed(self):
        t1 = datetime(2026, 9, 10, 8, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)
        t4 = datetime(2026, 9, 10, 11, 0, tzinfo=timezone.utc)

        rows = [
            {
                "tsnumber": 201,
                "plant": "5100",
                "serialnumber": "OP-WC-DIFF",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": "MILL-01",
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 202,
                "plant": "5100",
                "serialnumber": "OP-WC-DIFF",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": "LATHE-02",  # Different workcenter
                "activitytype": "",
                "longdate_checkin": t3,
                "longdate_checkout": t4,
                "raw_seconds": 7200,
            },
        ]

        # In strict mode: no exception should be raised because workcenters are different
        etl.validate_no_duplicate_activity_overlap(rows, plant="5100", quarantine=False)
        self.assertIsNone(rows[0].get("status"))
        self.assertIsNone(rows[1].get("status"))

    def test_validate_no_duplicate_activity_overlap_same_workcenter_rejected(self):
        t1 = datetime(2026, 9, 10, 8, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)
        t4 = datetime(2026, 9, 10, 11, 0, tzinfo=timezone.utc)

        rows = [
            {
                "tsnumber": 301,
                "plant": "5100",
                "serialnumber": "OP-WC-SAME",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": "MILL-01",
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 302,
                "plant": "5100",
                "serialnumber": "OP-WC-SAME",
                "order_no": "00010001",
                "operation_no": 10,
                "workcentercode": " \t\r\n MILL-01 \t ",  # Whitespace variation of MILL-01
                "activitytype": "",
                "longdate_checkin": t3,
                "longdate_checkout": t4,
                "raw_seconds": 7200,
            },
        ]

        with self.assertRaisesRegex(etl.EtlError, "DUPLICATE_ACTIVITY_OVERLAP"):
            etl.validate_no_duplicate_activity_overlap(rows, plant="5100", quarantine=False)

    def test_validate_no_duplicate_activity_overlap_legacy_null_empty_rejected(self):
        t1 = datetime(2026, 9, 10, 8, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)
        t4 = datetime(2026, 9, 10, 11, 0, tzinfo=timezone.utc)

        rows = [
            {
                "tsnumber": 401,
                "plant": "5100",
                "serialnumber": "OP-WC-LEGACY",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": None,
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 402,
                "plant": "5100",
                "serialnumber": "OP-WC-LEGACY",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": "   ",
                "activitytype": "",
                "longdate_checkin": t3,
                "longdate_checkout": t4,
                "raw_seconds": 7200,
            },
        ]

        with self.assertRaisesRegex(etl.EtlError, "DUPLICATE_ACTIVITY_OVERLAP"):
            etl.validate_no_duplicate_activity_overlap(rows, plant="5100", quarantine=False)

    def test_validate_no_duplicate_activity_overlap_unicode_whitespace_rejected(self):
        """Pastikan variasi whitespace ekstrem termasuk tab, newline, VT, FF, NBSP, dan BOM terdeteksi sama."""
        t1 = datetime(2026, 9, 10, 8, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 9, 10, 10, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 9, 10, 9, 0, tzinfo=timezone.utc)
        t4 = datetime(2026, 9, 10, 11, 0, tzinfo=timezone.utc)

        rows = [
            {
                "tsnumber": 501,
                "plant": "5100",
                "serialnumber": "OP-WC-UNICODE",
                "order_no": "000010001",
                "operation_no": "0010",
                "workcentercode": " \t\r\n\v\f WC-MAIN \u00a0\ufeff ",
                "activitytype": "",
                "longdate_checkin": t1,
                "longdate_checkout": t2,
                "raw_seconds": 7200,
            },
            {
                "tsnumber": 502,
                "plant": "5100",
                "serialnumber": "OP-WC-UNICODE",
                "order_no": "10001",
                "operation_no": 10,
                "workcentercode": "\ufeff\u00a0WC-MAIN\t\n",
                "activitytype": "",
                "longdate_checkin": t3,
                "longdate_checkout": t4,
                "raw_seconds": 7200,
            },
        ]

        with self.assertRaisesRegex(etl.EtlError, "DUPLICATE_ACTIVITY_OVERLAP"):
            etl.validate_no_duplicate_activity_overlap(rows, plant="5100", quarantine=False)

    def test_resolve_auto_window_up_to_date(self):
        cur = MagicMock()
        tz = ZoneInfo("Asia/Jakarta")
        now = datetime.now(tz)
        today_midnight = datetime.combine(now.date(), time.min, tzinfo=tz)

        # DB returns last_to = today_midnight
        cur.fetchone.return_value = {"last_to": today_midnight}
        result = etl.resolve_auto_window(
            cur,
            plant="5100",
            tz_name="Asia/Jakarta",
            cutoff_date=date(2026, 9, 30),
        )
        self.assertIsNone(result)

    def test_resolve_auto_window_with_earlier_run(self):
        cur = MagicMock()
        tz = ZoneInfo("Asia/Jakarta")
        now = datetime.now(tz)
        today_midnight = datetime.combine(now.date(), time.min, tzinfo=tz)
        past_ts = datetime(2026, 9, 30, 0, 0, tzinfo=tz)

        cur.fetchone.return_value = {"last_to": past_ts}
        result = etl.resolve_auto_window(
            cur,
            plant="5100",
            tz_name="Asia/Jakarta",
            cutoff_date=date(2026, 9, 30),
        )
        # Jika past_ts == today_midnight (hari ini tgl 30 Sep), return None
        if past_ts >= today_midnight:
            self.assertIsNone(result)
        else:
            self.assertIsNotNone(result)
            from_ts, to_ts = result
            self.assertEqual(from_ts, past_ts)
            self.assertEqual(to_ts, today_midnight)

    def test_resolve_auto_window_clamps_to_cutoff(self):
        """Pastikan run lama yang berakhir sebelum cutoff TIDAK menarik window mundur sebelum cutoff."""
        cur = MagicMock()
        tz = ZoneInfo("Asia/Jakarta")
        today_midnight = datetime(2026, 10, 5, 0, 0, tzinfo=tz)
        cutoff = date(2026, 9, 30)
        cutoff_dt = datetime(2026, 9, 30, 0, 0, tzinfo=tz)
        old_run_to = datetime(2026, 9, 25, 0, 0, tzinfo=tz)

        cur.fetchone.return_value = {"last_to": old_run_to}
        with patch("run_timesheet_etl.datetime") as mock_dt:
            mock_dt.combine = datetime.combine
            mock_dt.now.return_value = datetime(2026, 10, 5, 12, 0, tzinfo=tz)
            result = etl.resolve_auto_window(
                cur,
                plant="5100",
                tz_name="Asia/Jakarta",
                cutoff_date=cutoff,
            )
            self.assertIsNotNone(result)
            from_ts, to_ts = result
            self.assertEqual(from_ts, cutoff_dt)
            self.assertEqual(to_ts, today_midnight)

    def test_resolve_auto_window_fails_closed_without_cutoff(self):
        """Fail-closed bila plant_config belum memiliki cutoff."""
        cur = MagicMock()
        cur.fetchone.return_value = {"timesheet_allocation_cutoff_date": None}
        with self.assertRaises(etl.EtlError):
            etl.resolve_auto_window(cur, plant="5100", tz_name="Asia/Jakarta")


if __name__ == "__main__":
    unittest.main()
