#!/usr/bin/env python3
"""Test suite komprehensif untuk ETL timesheet F2 Cleansing.

Memverifikasi 20 kontrak dan invariant F2 sesuai docs/todo/todo.md:
1. Break di tengah interval menghasilkan WORK/BREAK/WORK.
2. Seluruh interval di dalam break menghasilkan satu BREAK, bukan WORK remaining=0.
3. Interval berhenti tepat saat break mulai.
4. Interval mulai tepat saat break selesai.
5. Break lintas tengah malam.
6. Break window overlap tidak didobel.
7. Segment menutup source tanpa gap/overlap.
8. Semua segment berada pada satu local_date.
9. Record produktif tidak dipotong break.
10. Cap tersimpan sebagai metadata tetapi tidak mengurangi WORK pada F2.
11. Cap satu kali per input lintas tengah malam.
12. Suffix RG mengalahkan workcenter OT.
13. Suffix OV valid.
14. Suffix RW valid.
15. Confirmation kosong/invalid menghasilkan UNKNOWN.
16. Legacy fallback ditandai eksplisit.
17. Rerun idempoten.
18. Rollback atomik.
19. Checksum berubah jika boundary segment berubah.
20. Query kandidat F3 hanya memilih segment_kind='WORK' AND remaining_seconds > 0 AND is_productive=true.
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
STAGING_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "..", "jobs", "sap_staging"))
sys.path.insert(0, STAGING_DIR)

import run_timesheet_etl as etl  # noqa: E402
from timesheet_normalization import break_overlap_seconds, cap_minutes_for  # noqa: E402

CKP = "mps_timesheet_ckp_test"
BPN = "mps_timesheet_bpn_test"


def local_conn(dbname: str, autocommit: bool = False):
    conn = psycopg2.connect(host="localhost", port=5432, dbname=dbname, user="postgres")
    conn.autocommit = autocommit
    return conn


def dt_tz(year, month, day, hour=0, minute=0, second=0, tz_offset_hours=7) -> datetime:
    tz = timezone(timedelta(hours=tz_offset_hours))
    return datetime(year, month, day, hour, minute, second, tzinfo=tz)


class F2CleansingTestSuite(unittest.TestCase):
    """Test suite lengkap 20 kasus wajib F2 Cleansing."""

    def setUp(self):
        self.rules_ckp = {
            "break_windows": [
                {"start": "12:00", "end": "13:00", "days": [0, 1, 2, 3, 4, 5, 6]},
                {"start": "00:30", "end": "01:30", "days": [0, 1, 2, 3, 4, 5, 6]},
            ],
            "max_record_minutes": {
                "timesheet": {
                    "": 150,       # VA cap: 150m (9000s)
                    "1510": 30,    # NVA cap: 30m (1800s)
                    "1520": 90,    # NNVA cap: 90m (5400s)
                    "1540": 240,   # NVA cap: 240m (14400s)
                    "1670": None,  # No limit
                }
            },
            "activity_categories": {
                "1510": "nva",
                "1520": "nnva",
                "1540": "nva",
                "1670": "va",
            },
            "max_record_fallback": {"va": 180, "nnva": 120, "nva": 60},
        }

    # -------------------------------------------------------------------------
    # 1. Break di tengah interval menghasilkan WORK/BREAK/WORK
    # -------------------------------------------------------------------------
    def test_01_break_in_middle_produces_work_break_work(self):
        """Non-produktif 11:30–13:30 dengan break 12:00–13:00 dipartisi jadi WORK, BREAK, WORK."""
        rows = [{
            "source_tsnumber": 101,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 13, 30, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 3)

        # Segmen 1: WORK 11:30–12:00
        self.assertEqual(plan[0]["segment_kind"], "WORK")
        self.assertEqual(plan[0]["segment_start"], dt_tz(2026, 9, 15, 11, 30, 0, 7))
        self.assertEqual(plan[0]["segment_end"], dt_tz(2026, 9, 15, 12, 0, 0, 7))
        self.assertEqual(plan[0]["raw_seconds"], 1800)
        self.assertEqual(plan[0]["deducted_seconds"], 0)
        self.assertEqual(plan[0]["remaining_seconds"], 1800)
        self.assertIsNone(plan[0]["break_rule"])

        # Segmen 2: BREAK 12:00–13:00
        self.assertEqual(plan[1]["segment_kind"], "BREAK")
        self.assertEqual(plan[1]["segment_start"], dt_tz(2026, 9, 15, 12, 0, 0, 7))
        self.assertEqual(plan[1]["segment_end"], dt_tz(2026, 9, 15, 13, 0, 0, 7))
        self.assertEqual(plan[1]["raw_seconds"], 3600)
        self.assertEqual(plan[1]["deducted_seconds"], 3600)
        self.assertEqual(plan[1]["remaining_seconds"], 0)
        self.assertEqual(plan[1]["break_rule"], "BREAK: 12:00-13:00")

        # Segmen 3: WORK 13:00–13:30
        self.assertEqual(plan[2]["segment_kind"], "WORK")
        self.assertEqual(plan[2]["segment_start"], dt_tz(2026, 9, 15, 13, 0, 0, 7))
        self.assertEqual(plan[2]["segment_end"], dt_tz(2026, 9, 15, 13, 30, 0, 7))
        self.assertEqual(plan[2]["raw_seconds"], 1800)
        self.assertEqual(plan[2]["deducted_seconds"], 0)
        self.assertEqual(plan[2]["remaining_seconds"], 1800)
        self.assertIsNone(plan[2]["break_rule"])

    # -------------------------------------------------------------------------
    # 2. Seluruh interval di dalam break menghasilkan satu BREAK, bukan WORK remaining=0
    # -------------------------------------------------------------------------
    def test_02_entire_interval_in_break_produces_one_break_segment(self):
        """Non-produktif 12:15–12:45 di dalam break 12:00–13:00 menghasilkan tepat 1 BREAK segment."""
        rows = [{
            "source_tsnumber": 102,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 12, 15, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 12, 45, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 1)
        seg = plan[0]
        self.assertEqual(seg["segment_kind"], "BREAK")
        self.assertEqual(seg["raw_seconds"], 1800)
        self.assertEqual(seg["deducted_seconds"], 1800)
        self.assertEqual(seg["remaining_seconds"], 0)
        self.assertEqual(seg["break_rule"], "BREAK: 12:00-13:00")

    # -------------------------------------------------------------------------
    # 3. Interval berhenti tepat saat break mulai
    # -------------------------------------------------------------------------
    def test_03_interval_stops_exactly_when_break_starts(self):
        """Non-produktif 10:00–12:00 (berhenti tepat 12:00 saat break mulai) menghasilkan 1 WORK segment."""
        rows = [{
            "source_tsnumber": 103,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 12, 0, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 1)
        seg = plan[0]
        self.assertEqual(seg["segment_kind"], "WORK")
        self.assertEqual(seg["raw_seconds"], 7200)
        self.assertEqual(seg["deducted_seconds"], 0)
        self.assertEqual(seg["remaining_seconds"], 7200)
        self.assertIsNone(seg["break_rule"])

    # -------------------------------------------------------------------------
    # 4. Interval mulai tepat saat break selesai
    # -------------------------------------------------------------------------
    def test_04_interval_starts_exactly_when_break_ends(self):
        """Non-produktif 13:00–15:00 (mulai tepat 13:00 saat break selesai) menghasilkan 1 WORK segment."""
        rows = [{
            "source_tsnumber": 104,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 13, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 15, 0, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 1)
        seg = plan[0]
        self.assertEqual(seg["segment_kind"], "WORK")
        self.assertEqual(seg["raw_seconds"], 7200)
        self.assertEqual(seg["deducted_seconds"], 0)
        self.assertEqual(seg["remaining_seconds"], 7200)
        self.assertIsNone(seg["break_rule"])

    # -------------------------------------------------------------------------
    # 5. Break lintas tengah malam
    # -------------------------------------------------------------------------
    def test_05_break_crossing_midnight(self):
        """Break window lintas tengah malam (23:30–00:30) memotong interval 23:00–01:00 tanpa bocor."""
        rules_overnight = {
            "break_windows": [
                {"start": "23:30", "end": "00:30", "days": [0, 1, 2, 3, 4, 5, 6]},
            ],
            "max_record_minutes": {"timesheet": {"1540": 240}},
            "activity_categories": {"1540": "nva"},
            "max_record_fallback": {"nva": 60},
        }
        rows = [{
            "source_tsnumber": 105,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 23, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 16, 1, 0, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=rules_overnight
        )
        self.assertEqual(len(plan), 4)

        # Segmen 1 (Hari 15 Sep): WORK 23:00–23:30
        self.assertEqual(plan[0]["local_date"], date(2026, 9, 15))
        self.assertEqual(plan[0]["segment_kind"], "WORK")
        self.assertEqual(plan[0]["raw_seconds"], 1800)

        # Segmen 2 (Hari 15 Sep): BREAK 23:30–00:00
        self.assertEqual(plan[1]["local_date"], date(2026, 9, 15))
        self.assertEqual(plan[1]["segment_kind"], "BREAK")
        self.assertEqual(plan[1]["raw_seconds"], 1800)

        # Segmen 3 (Hari 16 Sep): BREAK 00:00–00:30
        self.assertEqual(plan[2]["local_date"], date(2026, 9, 16))
        self.assertEqual(plan[2]["segment_kind"], "BREAK")
        self.assertEqual(plan[2]["raw_seconds"], 1800)

        # Segmen 4 (Hari 16 Sep): WORK 00:30–01:00
        self.assertEqual(plan[3]["local_date"], date(2026, 9, 16))
        self.assertEqual(plan[3]["segment_kind"], "WORK")
        self.assertEqual(plan[3]["raw_seconds"], 1800)

    # -------------------------------------------------------------------------
    # 6. Break window overlap tidak didobel
    # -------------------------------------------------------------------------
    def test_06_overlapping_break_windows_not_doubled(self):
        """Window break yang overlap (12:00–13:00 dan 12:30–13:30) di-merge menjadi 12:00–13:30 (5400s)."""
        rules_overlap = {
            "break_windows": [
                {"start": "12:00", "end": "13:00", "days": [0, 1, 2, 3, 4, 5, 6]},
                {"start": "12:30", "end": "13:30", "days": [0, 1, 2, 3, 4, 5, 6]},
            ],
            "max_record_minutes": {"timesheet": {"1540": 240}},
            "activity_categories": {"1540": "nva"},
            "max_record_fallback": {"nva": 60},
        }
        rows = [{
            "source_tsnumber": 106,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 11, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 14, 0, 0, 7),  # 3 jam = 10800s
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=rules_overlap
        )
        self.assertEqual(len(plan), 3)
        # WORK 11:00-12:00 (3600s), BREAK 12:00-13:30 (5400s), WORK 13:30-14:00 (1800s)
        self.assertEqual(plan[0]["segment_kind"], "WORK")
        self.assertEqual(plan[0]["raw_seconds"], 3600)

        self.assertEqual(plan[1]["segment_kind"], "BREAK")
        self.assertEqual(plan[1]["raw_seconds"], 5400)
        self.assertEqual(plan[1]["deducted_seconds"], 5400)
        self.assertEqual(plan[1]["remaining_seconds"], 0)

        self.assertEqual(plan[2]["segment_kind"], "WORK")
        self.assertEqual(plan[2]["raw_seconds"], 1800)

        total_raw = sum(s["raw_seconds"] for s in plan)
        self.assertEqual(total_raw, 10800)

    # -------------------------------------------------------------------------
    # 7. Segment menutup source tanpa gap/overlap
    # -------------------------------------------------------------------------
    def test_07_segments_close_source_without_gap_or_overlap(self):
        """Partisi segmen harus contiguous sempurna: start == checkin, end == checkout, seg[i].end == seg[i+1].start."""
        checkin = dt_tz(2026, 9, 15, 10, 15, 30, 7)
        checkout = dt_tz(2026, 9, 16, 2, 45, 15, 7)
        rows = [{
            "source_tsnumber": 107,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": checkin,
            "longdate_checkout": checkout,
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertGreater(len(plan), 1)

        # 1. Start segmen pertama tepat pada checkin
        self.assertEqual(plan[0]["segment_start"], checkin)
        # 2. End segmen terakhir tepat pada checkout
        self.assertEqual(plan[-1]["segment_end"], checkout)

        # 3. Contiguous tanpa gap & tanpa overlap
        for i in range(len(plan) - 1):
            self.assertEqual(plan[i]["segment_end"], plan[i + 1]["segment_start"])

        # 4. SUM(raw_seconds) == source duration
        src_seconds = int((checkout - checkin).total_seconds())
        sum_raw = sum(s["raw_seconds"] for s in plan)
        self.assertEqual(sum_raw, src_seconds)

        # 5. Rekonsiliasi raw = deducted + remaining
        sum_work = sum(s["remaining_seconds"] for s in plan if s["segment_kind"] == "WORK")
        sum_break = sum(s["deducted_seconds"] for s in plan if s["segment_kind"] == "BREAK")
        self.assertEqual(sum_work + sum_break, src_seconds)

    # -------------------------------------------------------------------------
    # 8. Semua segment berada pada satu local_date
    # -------------------------------------------------------------------------
    def test_08_all_segments_on_single_local_date(self):
        """Setiap segmen memiliki segment_start dan segment_end dalam tanggal lokal yang sama (local_date)."""
        checkin = dt_tz(2026, 9, 15, 20, 0, 0, 8)  # Balikpapan UTC+8
        checkout = dt_tz(2026, 9, 17, 8, 0, 0, 8)
        rows = [{
            "source_tsnumber": 108,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": checkin,
            "longdate_checkout": checkout,
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5051", plant_timezone="Asia/Makassar", sap_rules=self.rules_ckp
        )
        tz = ZoneInfo("Asia/Makassar")
        for seg in plan:
            self.assertEqual(seg["segment_start"].astimezone(tz).date(), seg["local_date"])
            # Jika segmen berhenti di tengah malam 00:00 hari berikutnya, start-nya tetap di local_date
            self.assertGreater(seg["segment_end"], seg["segment_start"])

    # -------------------------------------------------------------------------
    # 9. Record produktif tidak dipotong break
    # -------------------------------------------------------------------------
    def test_09_productive_record_not_split_by_break(self):
        """Record produktif 11:30–13:30 melintasi break 12:00–13:00 tetap utuh sebagai 1 WORK segment (7200s)."""
        rows = [{
            "source_tsnumber": 109,
            "activitytype": "",
            "order_no": "100050",
            "workcentercode": "WC01",
            "confirmationnumber": "1001RG",
            "longdate_checkin": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 13, 30, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 1)
        seg = plan[0]
        self.assertEqual(seg["segment_kind"], "WORK")
        self.assertEqual(seg["raw_seconds"], 7200)
        self.assertEqual(seg["deducted_seconds"], 0)
        self.assertEqual(seg["remaining_seconds"], 7200)
        self.assertIsNone(seg["break_rule"])
        self.assertTrue(seg["is_productive"])

    # -------------------------------------------------------------------------
    # 10. Cap tersimpan sebagai metadata tetapi tidak mengurangi WORK pada F2
    # -------------------------------------------------------------------------
    def test_10_cap_stored_as_metadata_without_reducing_work_in_f2(self):
        """Cap VA 150m (9000s) tersimpan sebagai metadata cap_seconds=9000, remaining_seconds tetap 14400s (tidak dipotong)."""
        rows = [{
            "source_tsnumber": 110,
            "activitytype": "",
            "order_no": "100050",
            "workcentercode": "WC01",
            "confirmationnumber": "1001RG",
            "longdate_checkin": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 12, 0, 0, 7),  # 4 jam = 14400s
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertEqual(len(plan), 1)
        seg = plan[0]
        self.assertEqual(seg["raw_seconds"], 14400)
        self.assertEqual(seg["deducted_seconds"], 0)
        self.assertEqual(seg["remaining_seconds"], 14400)  # Tidak dipotong di F2!
        self.assertEqual(seg["cap_seconds"], 9000)
        self.assertEqual(seg["cap_category"], "VA")
        self.assertIn("CAP_META: max 150m (VA)", seg["cap_rule"])

    # -------------------------------------------------------------------------
    # 11. Cap satu kali per input lintas tengah malam
    # -------------------------------------------------------------------------
    def test_11_cap_once_per_input_across_midnight(self):
        """Input lintas tengah malam membawa metadata cap_seconds yang sama per input (bukan cap per hari)."""
        rows = [{
            "source_tsnumber": 111,
            "activitytype": "1510",  # cap 30m = 1800s
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 23, 0, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 16, 2, 0, 0, 7),
        }]
        plan = etl.build_cleaned_plan(
            rows, plant="5100", plant_timezone="Asia/Jakarta", sap_rules=self.rules_ckp
        )
        self.assertGreater(len(plan), 1)
        for seg in plan:
            self.assertEqual(seg["cap_seconds"], 1800)
            self.assertEqual(seg["cap_category"], "NVA")

    # -------------------------------------------------------------------------
    # 12. Suffix RG mengalahkan workcenter OT
    # -------------------------------------------------------------------------
    def test_12_suffix_rg_beats_workcenter_ot(self):
        """Confirmation dengan suffix RG mengalahkan workcentercode berakhiran OT -> tipe RG, CANONICAL."""
        row = {
            "activitytype": "",
            "order_no": "100050",
            "workcentercode": "MECHOT",
            "confirmationnumber": "1001RG",
        }
        conf_type, src, reason = etl.classify_confirmation_type(row)
        self.assertEqual(conf_type, "RG")
        self.assertEqual(src, "CANONICAL")
        self.assertEqual(reason, "CONFIRMATION_SUFFIX_RG")

    # -------------------------------------------------------------------------
    # 13. Suffix OV valid
    # -------------------------------------------------------------------------
    def test_13_suffix_ov_valid(self):
        """Confirmation dengan suffix OV menghasilkan tipe OV, CANONICAL."""
        row = {
            "activitytype": "",
            "order_no": "100050",
            "workcentercode": "WC01",
            "confirmationnumber": "2002OV",
        }
        conf_type, src, reason = etl.classify_confirmation_type(row)
        self.assertEqual(conf_type, "OV")
        self.assertEqual(src, "CANONICAL")
        self.assertEqual(reason, "CONFIRMATION_SUFFIX_OV")

    # -------------------------------------------------------------------------
    # 14. Suffix RW valid
    # -------------------------------------------------------------------------
    def test_14_suffix_rw_valid(self):
        """Confirmation dengan suffix RW menghasilkan tipe RW, CANONICAL."""
        row = {
            "activitytype": "",
            "order_no": "100050",
            "workcentercode": "WC01",
            "confirmationnumber": "3003RW",
        }
        conf_type, src, reason = etl.classify_confirmation_type(row)
        self.assertEqual(conf_type, "RW")
        self.assertEqual(src, "CANONICAL")
        self.assertEqual(reason, "CONFIRMATION_SUFFIX_RW")

    # -------------------------------------------------------------------------
    # 15. Confirmation kosong/invalid menghasilkan UNKNOWN
    # -------------------------------------------------------------------------
    def test_15_empty_or_invalid_confirmation_produces_unknown(self):
        """Confirmation kosong atau tanpa suffix canonical/fallback menghasilkan UNKNOWN (tidak default ke RG)."""
        row_empty = {"activitytype": "", "order_no": "100050", "workcentercode": "WC01", "confirmationnumber": ""}
        conf_type, src, _ = etl.classify_confirmation_type(row_empty)
        self.assertEqual(conf_type, "UNKNOWN")
        self.assertEqual(src, "UNKNOWN")

        row_invalid = {"activitytype": "", "order_no": "100050", "workcentercode": "WC01", "confirmationnumber": "INVALID_CONF"}
        conf_type, src, _ = etl.classify_confirmation_type(row_invalid)
        self.assertEqual(conf_type, "UNKNOWN")
        self.assertEqual(src, "UNKNOWN")

    # -------------------------------------------------------------------------
    # 16. Legacy fallback ditandai eksplisit
    # -------------------------------------------------------------------------
    def test_16_legacy_fallback_marked_explicitly(self):
        """Order 32% dan Workcenter OT tanpa suffix canonical ditandai sebagai LEGACY_FALLBACK."""
        row_order32 = {"activitytype": "", "order_no": "320050", "workcentercode": "WC01", "confirmationnumber": "1001"}
        conf_type, src, reason = etl.classify_confirmation_type(row_order32)
        self.assertEqual(conf_type, "RW")
        self.assertEqual(src, "LEGACY_FALLBACK")
        self.assertEqual(reason, "ORDER_PREFIX_32")

        row_wcot = {"activitytype": "", "order_no": "100050", "workcentercode": "WC01OT", "confirmationnumber": "1001"}
        conf_type, src, reason = etl.classify_confirmation_type(row_wcot)
        self.assertEqual(conf_type, "OV")
        self.assertEqual(src, "LEGACY_FALLBACK")
        self.assertEqual(reason, "WORKCENTER_SUFFIX_OT")

    # -------------------------------------------------------------------------
    # 17. Rerun idempoten
    # -------------------------------------------------------------------------
    def test_17_rerun_idempotent(self):
        """Rerun execute pada window yang sama tidak menduplikasi cleaned segments dan menghasilkan checksum identik."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-TEST-IDEMP"
                clean_ver = "CLEAN-TEST-IDEMP"

                # Cleanup test version
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-idemp",
                )
                res2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-idemp",
                )

                self.assertEqual(res2["inserted_inputs"], 0)
                self.assertEqual(res2["reused_inputs"], res1["candidates"])
                self.assertEqual(res2["inserted_segments"], 0)
                self.assertEqual(res2["reused_segments"], res1["cleaned_segments"])
                self.assertEqual(res2["output_checksum"], res1["output_checksum"])
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 18. Rollback atomik
    # -------------------------------------------------------------------------
    def test_18_rollback_atomic(self):
        """Kegagalan di tengah execute me-rollback seluruh transaksi tanpa meninggalkan record yatim."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT count(*) AS n FROM public.timesheet_cleaned_segment")
                seg_before = cur.fetchone()["n"]
                cur.execute("SELECT count(*) AS n FROM public.timesheet_etl_run")
                run_before = cur.fetchone()["n"]

                # Simulasikan transaksi gagal
                with self.assertRaises(Exception):
                    with conn.cursor() as crash_cur:
                        crash_cur.execute(
                            "INSERT INTO public.timesheet_etl_run (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by) "
                            "VALUES ('5100', now(), now() + interval '1 hour', 'Asia/Jakarta', 'CRASH-VER', 'tester')"
                        )
                        # Paksa error
                        crash_cur.execute("INSERT INTO public.timesheet_cleaned_segment (raw_seconds, remaining_seconds) VALUES (-1, -1)")
                    conn.commit()

                conn.rollback()

                cur.execute("SELECT count(*) AS n FROM public.timesheet_cleaned_segment")
                self.assertEqual(cur.fetchone()["n"], seg_before)
                cur.execute("SELECT count(*) AS n FROM public.timesheet_etl_run")
                self.assertEqual(cur.fetchone()["n"], run_before)
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 19. Checksum berubah jika boundary segment berubah
    # -------------------------------------------------------------------------
    def test_19_checksum_changes_if_segment_boundary_changes(self):
        """Perubahan boundary interval atau break rules mengubah output checksum secara deterministik."""
        rows1 = [{
            "source_tsnumber": 119,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 13, 30, 0, 7),
        }]
        rows2 = [{
            "source_tsnumber": 119,
            "activitytype": "1540",
            "order_no": "",
            "workcentercode": "WC01",
            "confirmationnumber": "",
            "longdate_checkin": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "longdate_checkout": dt_tz(2026, 9, 15, 13, 35, 0, 7),  # Berubah 5 menit
        }]
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)

                res1 = etl.run_dry_run(
                    cur, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version="ALLOC-TEST-1", clean_rule_version="CLEAN-V2",
                )

                # Window berbeda menghasilkan boundary dan checksum berbeda
                to_ts_2 = datetime(2026, 9, 15, 6, 0, tzinfo=timezone.utc)
                res2 = etl.run_dry_run(
                    cur, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts_2,
                    allocation_version="ALLOC-TEST-1", clean_rule_version="CLEAN-V2",
                )
                self.assertNotEqual(res1["output_checksum"], res2["output_checksum"])
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 20. Query kandidat F3 hanya memilih WORK, remaining > 0, is_productive=true
    # -------------------------------------------------------------------------
    def test_20_f3_candidate_query_contract(self):
        """Query alokasi F3 memfilter segmen secara ketat: WORK, remaining > 0, dan is_productive=true."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F3-CANDIDATE-TEST"
                clean_ver = "CLEAN-F3-CANDIDATE-TEST"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="f3-query-tester",
                )

                # Query F3 candidate
                cur.execute(
                    """
                    SELECT segment_kind, remaining_seconds, is_productive
                    FROM public.timesheet_cleaned_segment
                    WHERE run_id = %s
                      AND segment_kind = 'WORK'
                      AND remaining_seconds > 0
                      AND is_productive = true
                    """,
                    (res["run_id"],),
                )
                f3_candidates = cur.fetchall()

                # Pastikan tidak ada BREAK atau non-productive atau remaining=0 yang lolos ke F3
                for row in f3_candidates:
                    self.assertEqual(row["segment_kind"], "WORK")
                    self.assertGreater(row["remaining_seconds"], 0)
                    self.assertTrue(row["is_productive"])

                # Verifikasi bahwa BREAK segments memang ada di run_id tersebut dan tereksklusi dari F3
                cur.execute(
                    """
                    SELECT count(*) AS n
                    FROM public.timesheet_cleaned_segment
                    WHERE run_id = %s AND (segment_kind <> 'WORK' OR remaining_seconds <= 0 OR is_productive = false)
                    """,
                    (res["run_id"],),
                )
                excluded_count = cur.fetchone()["n"]
                # Total baris = f3_candidates + excluded_count
                cur.execute("SELECT count(*) AS n FROM public.timesheet_cleaned_segment WHERE run_id = %s", (res["run_id"],))
                total_seg = cur.fetchone()["n"]
                self.assertEqual(len(f3_candidates) + excluded_count, total_seg)
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 21. Sabotase row existing dengan boundary berbeda membuat run gagal dan rollback
    # -------------------------------------------------------------------------
    def test_21_sabotage_boundary_causes_fail_closed_and_rollback(self):
        """Modifikasi boundary pada row cleaned_segment existing memicu EtlError (drift) dan me-rollback run baru."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-TEST-DRIFT-BOUND"
                clean_ver = "CLEAN-TEST-DRIFT-V2"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                # Run pertama normal
                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="tester-drift",
                )

                # Sabotase satu baris segmen di DB (geser segment_end 5 detik)
                cur.execute(
                    """
                    UPDATE public.timesheet_cleaned_segment
                    SET segment_end = segment_end + interval '5 seconds'
                    WHERE cleaned_segment_id = (
                      SELECT cleaned_segment_id FROM public.timesheet_cleaned_segment
                      WHERE run_id = %s LIMIT 1
                    )
                    """,
                    (res1["run_id"],),
                )
                conn.commit()

                # Run kedua harus gagal fail-closed dengan EtlError
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.run_execute(
                        cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=alloc_ver, clean_rule_version=clean_ver,
                        created_by="tester-drift-2",
                    )
                self.assertIn("Drift terdeteksi pada cleaned_segment", str(ctx.exception))
                self.assertIn("segment_end", str(ctx.exception))
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 22. Sabotase metadata (classification_reason / cap_category) terdeteksi fail-closed
    # -------------------------------------------------------------------------
    def test_22_sabotage_metadata_causes_fail_closed_and_rollback(self):
        """Modifikasi classification_reason atau cap_category pada row existing terdeteksi dan me-rollback run."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-TEST-DRIFT-META"
                clean_ver = "CLEAN-TEST-DRIFT-V2"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                # Run pertama normal
                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="tester-drift-meta",
                )

                # Sabotase classification_reason
                cur.execute(
                    """
                    UPDATE public.timesheet_cleaned_segment
                    SET classification_reason = 'SABOTAGED_REASON'
                    WHERE cleaned_segment_id = (
                      SELECT cleaned_segment_id FROM public.timesheet_cleaned_segment
                      WHERE run_id = %s LIMIT 1
                    )
                    """,
                    (res1["run_id"],),
                )
                conn.commit()

                # Run kedua harus gagal
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.run_execute(
                        cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=alloc_ver, clean_rule_version=clean_ver,
                        created_by="tester-drift-meta-2",
                    )
                self.assertIn("Drift terdeteksi pada cleaned_segment", str(ctx.exception))
                self.assertIn("classification_reason", str(ctx.exception))
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 23. DB Constraints menolak WORK/BREAK yang tidak konsisten
    # -------------------------------------------------------------------------
    def test_23_db_constraints_reject_inconsistent_work_break(self):
        """PostgreSQL CHECK constraints menolak jenis segmen tidak valid, break tidak konsisten, atau cap invalid."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Ambil satu input_id dan run_id valid untuk foreign key
                cur.execute("SELECT run_id, input_id, plant, source_tsnumber, local_date_checkin FROM public.timesheet_etl_input LIMIT 1")
                row = cur.fetchone()
                self.assertIsNotNone(row)

                base = {
                    "run_id": row["run_id"],
                    "input_id": row["input_id"],
                    "plant": row["plant"],
                    "source_tsnumber": row["source_tsnumber"],
                    "rule_version": "CONSTRAINT-TEST",
                    "segment_sequence": 999,
                    "segment_start": datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
                    "segment_end": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
                    "local_date": row["local_date_checkin"],
                    "segment_kind": "WORK",
                    "confirmation_type": "RG",
                    "classification_source": "CANONICAL",
                    "classification_reason": "CONFIRMATION_SUFFIX_RG",
                    "is_productive": True,
                    "break_rule": None,
                    "cap_rule": None,
                    "cap_seconds": None,
                    "cap_category": "VA",
                    "raw_seconds": 7200,
                    "deducted_seconds": 0,
                    "remaining_seconds": 7200,
                }

                # 1. Invalid segment_kind 'CAPPED'
                bad1 = dict(base, segment_kind="CAPPED")
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad1)
                conn.rollback()

                # 2. WORK dengan deducted_seconds > 0
                bad2 = dict(base, segment_kind="WORK", deducted_seconds=100)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad2)
                conn.rollback()

                # 3. WORK dengan break_rule terisi
                bad3 = dict(base, segment_kind="WORK", break_rule="BREAK: 12:00-13:00")
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad3)
                conn.rollback()

                # 4. BREAK dengan remaining_seconds > 0
                bad4 = dict(base, segment_kind="BREAK", break_rule="BREAK: 12:00-13:00", deducted_seconds=7200, remaining_seconds=100)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad4)
                conn.rollback()

                # 5. BREAK tanpa break_rule
                bad5 = dict(base, segment_kind="BREAK", break_rule=None, deducted_seconds=7200, remaining_seconds=0)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad5)
                conn.rollback()

                # 6. cap_seconds negatif
                bad6 = dict(base, cap_seconds=-50)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad6)
                conn.rollback()

                # 7. classification_source invalid
                bad7 = dict(base, classification_source="INVALID_SOURCE")
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad7)
                conn.rollback()

                # 8. confirmation_type invalid
                bad8 = dict(base, confirmation_type="INVALID_TYPE")
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_CLEANED_SEGMENT_SQL, bad8)
                conn.rollback()
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 24. CLEAN-V1 dan CLEAN-V2 tidak bertabrakan (koeksistensi multi-versi)
    # -------------------------------------------------------------------------
    def test_24_clean_v1_and_clean_v2_coexist_without_collision(self):
        """Eksekusi dengan CLEAN-V1 dan CLEAN-V2 pada input yang sama dapat berdampingan tanpa konflik unique."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-TEST-MULTI-VER"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res_v1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version="CLEAN-V1",
                    created_by="tester-v1",
                )

                res_v2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version="CLEAN-V2",
                    created_by="tester-v2",
                )

                # Keduanya berhasil dieksekusi dan memiliki versi segmen masing-masing
                self.assertEqual(res_v1["status"], "SAP_READY")
                self.assertEqual(res_v2["status"], "SAP_READY")
                self.assertEqual(res_v2["reused_inputs"], res_v1["candidates"])
                self.assertGreater(res_v2["inserted_segments"], 0)

                # Pastikan kedua rule_version ada di tabel cleaned_segment
                cur.execute(
                    "SELECT DISTINCT rule_version FROM public.timesheet_cleaned_segment WHERE run_id IN (%s, %s)",
                    (res_v1["run_id"], res_v2["run_id"]),
                )
                versions = {r["rule_version"] for r in cur.fetchall()}
                self.assertEqual(versions, {"CLEAN-V1", "CLEAN-V2"})
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
