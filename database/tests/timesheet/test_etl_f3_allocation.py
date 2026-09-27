#!/usr/bin/env python3
"""Test suite komprehensif untuk ETL timesheet F3 Allocation (Sweep-line).

Memverifikasi invariant dan kontrak F3:
1. Mandatory staggered test case (O1=3h, O2=1.5h, O3=1.5h, union=6h).
2. Non-overlapping intervals (allocated_seconds == raw_seconds == union).
3. Full overlap identical intervals (3 orders -> 1h each, sum = union).
4. Partial overlap (2 orders -> 3h each, sum = union).
5. Cross-midnight segregation (alokasi строго per operator dan local_date).
6. Remainder tie-breaking deterministik (largest remainder per slice).
7. UNKNOWN confirmation ikut serta dalam sweep-line sebagai divisor.
8. Non-productive dan BREAK tidak ikut serta dan tidak membagi waktu.
9. Companion record integration (record di luar window membagi waktu tanpa ditulis ke output).
10. Operator independen (tidak saling membagi waktu operator lain).
11. Idempotent rerun reuse (inserted_allocated=0, reused_allocated=N).
12. Drift detection fail-closed (sabotase slice DB memicu EtlError dan rollback).
13. DB constraint integrity (active_count >= 1, slice_end > slice_start, dll).
14. Mathematical invariant: SUM(allocated_seconds) == union_seconds.
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

CKP = "mps_timesheet_ckp_test"
BPN = "mps_timesheet_bpn_test"


def local_conn(dbname: str, autocommit: bool = False):
    conn = psycopg2.connect(host="localhost", port=5432, dbname=dbname, user="postgres")
    conn.autocommit = autocommit
    return conn


def dt_tz(year, month, day, hour=0, minute=0, second=0, tz_offset_hours=7) -> datetime:
    tz = timezone(timedelta(hours=tz_offset_hours))
    return datetime(year, month, day, hour, minute, second, tzinfo=tz)


class F3AllocationTestSuite(unittest.TestCase):
    """Test suite lengkap 14 kasus uji alokasi sweep-line F3."""

    # -------------------------------------------------------------------------
    # 1. Mandatory staggered test case
    # -------------------------------------------------------------------------
    def test_01_mandatory_staggered_orders(self):
        """Contoh wajib: O1 (08:00-12:00, 4h), O2 (10:00-13:00, 3h), O3 (12:00-14:00, 2h).

        Hasil eksak:
        - O1: 3.0h (10,800s)
        - O2: 1.5h (5,400s)
        - O3: 1.5h (5,400s)
        - Union = 6.0h (21,600s), SUM(allocated) = 21,600s.
        """
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": "seg-1",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
            {
                "cleaned_segment_id": "seg-2",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 13, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 10800,
            },
            {
                "cleaned_segment_id": "seg-3",
                "input_id": "inp-3",
                "source_tsnumber": 3,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 14, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
        ]

        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )

        o1_sec = sum(s["allocated_seconds"] for s in allocated if s["source_tsnumber"] == 1)
        o2_sec = sum(s["allocated_seconds"] for s in allocated if s["source_tsnumber"] == 2)
        o3_sec = sum(s["allocated_seconds"] for s in allocated if s["source_tsnumber"] == 3)

        self.assertEqual(o1_sec, 10800)  # 3.0 jam
        self.assertEqual(o2_sec, 5400)   # 1.5 jam
        self.assertEqual(o3_sec, 5400)   # 1.5 jam
        self.assertEqual(metrics["target_allocated_seconds"], 21600)  # 6.0 jam
        self.assertEqual(metrics["companion_allocated_seconds"], 0)
        self.assertEqual(metrics["all_allocated_seconds"], 21600)
        self.assertEqual(metrics["total_union_seconds"], 21600)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 2. Non-overlapping intervals
    # -------------------------------------------------------------------------
    def test_02_non_overlapping_intervals(self):
        """Interval berurutan tanpa overlap menerima 100% alokasi (active_count=1)."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": "seg-1",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
            {
                "cleaned_segment_id": "seg-2",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        self.assertEqual(len(allocated), 2)
        for s in allocated:
            self.assertEqual(s["active_count"], 1)
            self.assertEqual(s["allocated_seconds"], 7200)
        self.assertEqual(metrics["target_allocated_seconds"], 14400)
        self.assertEqual(metrics["companion_allocated_seconds"], 0)
        self.assertEqual(metrics["all_allocated_seconds"], 14400)
        self.assertEqual(metrics["total_union_seconds"], 14400)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 3. Full overlap identical intervals
    # -------------------------------------------------------------------------
    def test_03_full_overlap_identical_intervals(self):
        """Tiga order pada rentang waktu yang sama persis dibagi rata (1/3 masing-masing)."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": f"seg-{i}",
                "input_id": f"inp-{i}",
                "source_tsnumber": i,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 11, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 10800,
            }
            for i in [1, 2, 3]
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        self.assertEqual(len(allocated), 3)
        for s in allocated:
            self.assertEqual(s["active_count"], 3)
            self.assertEqual(s["allocated_seconds"], 3600)  # 1 jam
        self.assertEqual(metrics["target_allocated_seconds"], 10800)
        self.assertEqual(metrics["companion_allocated_seconds"], 0)
        self.assertEqual(metrics["all_allocated_seconds"], 10800)
        self.assertEqual(metrics["total_union_seconds"], 10800)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 4. Partial overlap (2 orders)
    # -------------------------------------------------------------------------
    def test_04_partial_overlap_two_orders(self):
        """O1 (08:00-12:00, 4h) dan O2 (10:00-14:00, 4h) -> O1=3h, O2=3h, union=6h."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": "seg-1",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
            {
                "cleaned_segment_id": "seg-2",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 14, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        o1_sec = sum(s["allocated_seconds"] for s in allocated if s["source_tsnumber"] == 1)
        o2_sec = sum(s["allocated_seconds"] for s in allocated if s["source_tsnumber"] == 2)
        self.assertEqual(o1_sec, 10800)  # 3 jam
        self.assertEqual(o2_sec, 10800)  # 3 jam
        self.assertEqual(metrics["target_allocated_seconds"], 21600)  # 6 jam
        self.assertEqual(metrics["companion_allocated_seconds"], 0)
        self.assertEqual(metrics["all_allocated_seconds"], 21600)
        self.assertEqual(metrics["total_union_seconds"], 21600)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 5. Cross-midnight segregation
    # -------------------------------------------------------------------------
    def test_05_cross_midnight_segregation(self):
        """Alokasi sweep-line berjalan independen per (serialnumber, local_date)."""
        d1 = date(2026, 9, 15)
        d2 = date(2026, 9, 16)
        cleaned = [
            # Hari 1: 22:00 - 24:00 (2 jam)
            {
                "cleaned_segment_id": "seg-1-d1",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 22, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 16, 0, 0, 0, 7),
                "local_date": d1,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
            # Hari 2: 00:00 - 04:00 (4 jam)
            {
                "cleaned_segment_id": "seg-1-d2",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 2,
                "segment_start": dt_tz(2026, 9, 16, 0, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 16, 4, 0, 0, 7),
                "local_date": d2,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
            # Hari 2 overlap: 02:00 - 06:00 (4 jam)
            {
                "cleaned_segment_id": "seg-2-d2",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 16, 2, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 16, 6, 0, 0, 7),
                "local_date": d2,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        d1_slices = [s for s in allocated if s["local_date"] == d1]
        d2_slices = [s for s in allocated if s["local_date"] == d2]

        self.assertEqual(len(d1_slices), 1)
        self.assertEqual(d1_slices[0]["allocated_seconds"], 7200)

        # Hari 2: total union = 00:00 - 06:00 = 6h (21,600s)
        self.assertEqual(sum(s["allocated_seconds"] for s in d2_slices), 21600)
        self.assertEqual(metrics["operator_days_count"], 2)

    # -------------------------------------------------------------------------
    # 6. Remainder tie-breaking deterministik
    # -------------------------------------------------------------------------
    def test_06_remainder_tie_breaking_deterministic(self):
        """Irisan 7 detik dengan 3 order menghasilkan [3s, 2s, 2s] secara deterministik."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": f"seg-{ts}",
                "input_id": f"inp-{ts}",
                "source_tsnumber": ts,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 8, 0, 7, 7),  # 7 detik
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7,
            }
            for ts in [10, 20, 30]
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        self.assertEqual(len(allocated), 3)
        # Urutan deterministik berdasarkan source_tsnumber ASC
        s10 = next(s for s in allocated if s["source_tsnumber"] == 10)
        s20 = next(s for s in allocated if s["source_tsnumber"] == 20)
        s30 = next(s for s in allocated if s["source_tsnumber"] == 30)

        self.assertEqual(s10["allocated_seconds"], 3)  # Mendapat sisa +1
        self.assertEqual(s20["allocated_seconds"], 2)
        self.assertEqual(s30["allocated_seconds"], 2)
        self.assertEqual(metrics["target_allocated_seconds"], 7)
        self.assertEqual(metrics["companion_allocated_seconds"], 0)
        self.assertEqual(metrics["all_allocated_seconds"], 7)
        self.assertEqual(metrics["total_union_seconds"], 7)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 7. UNKNOWN confirmation ikut serta dalam sweep-line
    # -------------------------------------------------------------------------
    def test_07_unknown_confirmation_included_in_sweepline(self):
        """Record produktif WORK dengan confirmation UNKNOWN tetap menjadi divisor di F3."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": "seg-1",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "confirmation_type": "RG",
                "classification_source": "CANONICAL",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
            {
                "cleaned_segment_id": "seg-2",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "confirmation_type": "UNKNOWN",
                "classification_source": "UNKNOWN",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        self.assertEqual(len(allocated), 2)
        for s in allocated:
            self.assertEqual(s["active_count"], 2)
            self.assertEqual(s["allocated_seconds"], 3600)

    # -------------------------------------------------------------------------
    # 8. Non-productive dan BREAK tidak ikut serta dan tidak membagi waktu
    # -------------------------------------------------------------------------
    def test_08_non_productive_and_breaks_excluded_from_sweepline(self):
        """Segmen BREAK atau non-productive (remaining=0 atau is_productive=False) diabaikan."""
        l_date = date(2026, 9, 15)
        cleaned = [
            # Segmen WORK produktif 08:00 - 10:00 (2h)
            {
                "cleaned_segment_id": "seg-work",
                "input_id": "inp-1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            },
            # Segmen BREAK 08:30 - 09:30 (1h)
            {
                "cleaned_segment_id": "seg-break",
                "input_id": "inp-2",
                "source_tsnumber": 2,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 30, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 9, 30, 0, 7),
                "local_date": l_date,
                "segment_kind": "BREAK",
                "is_productive": False,
                "remaining_seconds": 0,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        # Hanya segmen WORK yang dialokasikan, dan tidak terbagi oleh BREAK
        self.assertEqual(len(allocated), 1)
        self.assertEqual(allocated[0]["source_tsnumber"], 1)
        self.assertEqual(allocated[0]["active_count"], 1)
        self.assertEqual(allocated[0]["allocated_seconds"], 7200)

    # -------------------------------------------------------------------------
    # 9. Companion record integration
    # -------------------------------------------------------------------------
    def test_09_companion_record_integration(self):
        """Record companion di luar window membagi irisan waktu target tanpa masuk ke output."""
        l_date = date(2026, 9, 15)
        # Target segment dalam window: 10:00 - 12:00 (2h)
        target_cleaned = [
            {
                "cleaned_segment_id": "seg-target",
                "input_id": "inp-target",
                "source_tsnumber": 100,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            }
        ]
        # Companion segment di luar window: 11:00 - 13:00 (2h)
        companion_cleaned = [
            {
                "cleaned_segment_id": "seg-comp",
                "input_id": "inp-comp",
                "source_tsnumber": 200,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 11, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 13, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 7200,
            }
        ]
        allocated, metrics = etl.build_allocated_plan(
            target_cleaned,
            plant="5100",
            allocation_version="ALLOC-V1",
            companion_segments=companion_cleaned,
        )

        # Output hanya memuat irisan milik target (tsnumber 100)
        self.assertTrue(all(s["source_tsnumber"] == 100 for s in allocated))
        # Slices: 10:00-11:00 (active=1 -> 3600s), 11:00-12:00 (active=2 -> 1800s)
        self.assertEqual(len(allocated), 2)
        s1 = next(s for s in allocated if s["slice_start"] == dt_tz(2026, 9, 15, 10, 0, 0, 7))
        s2 = next(s for s in allocated if s["slice_start"] == dt_tz(2026, 9, 15, 11, 0, 0, 7))

        self.assertEqual(s1["active_count"], 1)
        self.assertEqual(s1["allocated_seconds"], 3600)
        self.assertEqual(s2["active_count"], 2)
        self.assertEqual(s2["allocated_seconds"], 1800)

        self.assertEqual(metrics["target_allocated_seconds"], 5400)
        self.assertEqual(metrics["companion_allocated_seconds"], 5400)
        self.assertEqual(metrics["all_allocated_seconds"], 10800)
        self.assertEqual(metrics["total_union_seconds"], 10800)
        self.assertEqual(metrics["allocation_delta_seconds"], 0)
        self.assertEqual(metrics["operator_day_violation_count"], 0)

    # -------------------------------------------------------------------------
    # 10. Operator independen
    # -------------------------------------------------------------------------
    def test_10_multiple_operators_are_isolated(self):
        """Dua operator yang bekerja pada jam yang sama tidak saling membagi waktu."""
        l_date = date(2026, 9, 15)
        cleaned = [
            {
                "cleaned_segment_id": "seg-op1",
                "input_id": "inp-op1",
                "source_tsnumber": 1,
                "serialnumber": "OP1",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
            {
                "cleaned_segment_id": "seg-op2",
                "input_id": "inp-op2",
                "source_tsnumber": 2,
                "serialnumber": "OP2",
                "segment_sequence": 1,
                "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": l_date,
                "segment_kind": "WORK",
                "is_productive": True,
                "remaining_seconds": 14400,
            },
        ]
        allocated, metrics = etl.build_allocated_plan(
            cleaned, plant="5100", allocation_version="ALLOC-V1"
        )
        self.assertEqual(len(allocated), 2)
        for s in allocated:
            self.assertEqual(s["active_count"], 1)
            self.assertEqual(s["allocated_seconds"], 14400)
        self.assertEqual(metrics["operator_days_count"], 2)

    # -------------------------------------------------------------------------
    # 11. Idempotent rerun reuse
    # -------------------------------------------------------------------------
    def test_11_rerun_idempotent_reuse(self):
        """Rerun execute pada window yang sama memakai ulang row allocated_segment (inserted=0, reused=N)."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F3-TEST-IDEMP"
                clean_ver = "CLEAN-F3-TEST-IDEMP"

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
                    created_by="test-f3-idemp",
                )
                res2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-f3-idemp",
                )

                self.assertEqual(res2["inserted_allocated"], 0)
                self.assertEqual(res2["reused_allocated"], res1["allocated_segments"])
                self.assertEqual(res2["output_checksum"], res1["output_checksum"])
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 12. Drift detection fail-closed
    # -------------------------------------------------------------------------
    def test_12_drift_detection_fail_closed_and_rollback(self):
        """Sabotase field allocated_segment di DB memicu EtlError dan rollback atomik."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F3-TEST-SABOTAGE"
                clean_ver = "CLEAN-F3-TEST-SABOTAGE"

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

                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-f3-sabotage",
                )

                # Sabotase satu row allocated_seconds
                cur.execute(
                    """
                    UPDATE public.timesheet_allocated_segment
                    SET allocated_seconds = allocated_seconds + 999
                    WHERE allocation_version = %s
                      AND allocated_segment_id = (
                          SELECT allocated_segment_id FROM public.timesheet_allocated_segment
                          WHERE allocation_version = %s LIMIT 1
                      )
                    """,
                    (alloc_ver, alloc_ver),
                )
                conn.commit()

                # Rerun kedua harus gagal dengan EtlError (drift terdeteksi)
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.run_execute(
                        cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=alloc_ver, clean_rule_version=clean_ver,
                        created_by="test-f3-sabotage-rerun",
                    )
                self.assertIn("Drift terdeteksi pada allocated_segment", str(ctx.exception))
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 13. DB constraint integrity
    # -------------------------------------------------------------------------
    def test_13_db_constraints_prevent_invalid_allocated_segment(self):
        """DB CHECK constraint menolak active_count <= 0, span invalid, atau negative seconds."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Ambil satu cleaned_segment_id yang valid
                cur.execute("SELECT cleaned_segment_id, input_id, plant, source_tsnumber FROM public.timesheet_cleaned_segment LIMIT 1")
                row = cur.fetchone()
                if not row:
                    self.skipTest("Tidak ada cleaned_segment di DB untuk pengujian constraint")

                base = {
                    "run_id": "00000000-0000-0000-0000-000000000000",
                    "cleaned_segment_id": row["cleaned_segment_id"],
                    "input_id": row["input_id"],
                    "plant": row["plant"],
                    "source_tsnumber": row["source_tsnumber"],
                    "allocation_version": "ALLOC-TEST-CONSTRAINT",
                    "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                    "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                    "local_date": date(2026, 9, 15),
                    "active_count": 1,
                    "numerator": 7200,
                    "denominator": 1,
                    "allocated_seconds": 7200,
                }

                # 1. active_count <= 0
                bad1 = dict(base, active_count=0)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL, bad1)
                conn.rollback()

                # 2. denominator <= 0
                bad2 = dict(base, denominator=0)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL, bad2)
                conn.rollback()

                # 3. allocated_seconds < 0
                bad3 = dict(base, allocated_seconds=-10)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL, bad3)
                conn.rollback()

                # 4. slice_end <= slice_start
                bad4 = dict(base, slice_end=dt_tz(2026, 9, 15, 8, 0, 0, 7))
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL, bad4)
                conn.rollback()
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 14. Rekonsiliasi Lintas Window & Invariansi Sisa Detik
    # -------------------------------------------------------------------------
    def test_14_two_windows_cross_reconciliation_and_remainder_invariance(self):
        """Dua run/window terpisah pada operator-day yang sama saling merekonsiliasi ke union eksak.

        - Window 1: Record A adalah target, Record B adalah companion.
        - Window 2: Record B adalah target, Record A adalah companion.
        - Overlap memiliki span ganjil (7 detik) dengan 3 order untuk menguji remainder tie-breaker.
        - SUM(target Run 1 + target Run 2 + target Run 3) == union seluruh operator-day.
        - Hasil target deterministik dan tidak tergantung urutan eksekusi run.
        """
        l_date = date(2026, 9, 15)
        # Order A: 08:00 - 11:00 (10800s)
        seg_a = {
            "cleaned_segment_id": "seg-a",
            "input_id": "inp-a",
            "source_tsnumber": 10,
            "serialnumber": "OP1",
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 11, 0, 0, 7),
            "local_date": l_date,
            "segment_kind": "WORK",
            "is_productive": True,
            "remaining_seconds": 10800,
        }
        # Order B: 10:00 - 13:00:07 (10807s)
        seg_b = {
            "cleaned_segment_id": "seg-b",
            "input_id": "inp-b",
            "source_tsnumber": 20,
            "serialnumber": "OP1",
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 13, 0, 7, 7),
            "local_date": l_date,
            "segment_kind": "WORK",
            "is_productive": True,
            "remaining_seconds": 10807,
        }
        # Order C (overlap 7s pada 10:00:00 - 10:00:07):
        seg_c = {
            "cleaned_segment_id": "seg-c",
            "input_id": "inp-c",
            "source_tsnumber": 30,
            "serialnumber": "OP1",
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 10, 0, 7, 7),
            "local_date": l_date,
            "segment_kind": "WORK",
            "is_productive": True,
            "remaining_seconds": 7,
        }

        # Run 1: Target = [A], Companion = [B, C]
        alloc_r1, met_r1 = etl.build_allocated_plan(
            [seg_a], plant="5100", allocation_version="ALLOC-V1", companion_segments=[seg_b, seg_c]
        )
        self.assertEqual(met_r1["allocation_delta_seconds"], 0)
        self.assertEqual(met_r1["operator_day_violation_count"], 0)
        self.assertEqual(
            met_r1["target_allocated_seconds"] + met_r1["companion_allocated_seconds"],
            met_r1["all_allocated_seconds"],
        )
        self.assertEqual(met_r1["all_allocated_seconds"], met_r1["total_union_seconds"])

        # Run 2: Target = [B], Companion = [A, C]
        alloc_r2, met_r2 = etl.build_allocated_plan(
            [seg_b], plant="5100", allocation_version="ALLOC-V1", companion_segments=[seg_a, seg_c]
        )
        self.assertEqual(met_r2["allocation_delta_seconds"], 0)
        self.assertEqual(met_r2["operator_day_violation_count"], 0)

        # Run 3: Target = [C], Companion = [A, B]
        alloc_r3, met_r3 = etl.build_allocated_plan(
            [seg_c], plant="5100", allocation_version="ALLOC-V1", companion_segments=[seg_a, seg_b]
        )
        self.assertEqual(met_r3["allocation_delta_seconds"], 0)
        self.assertEqual(met_r3["operator_day_violation_count"], 0)

        # Verifikasi irisan sisa 7 detik antara A (ts=10), B (ts=20), C (ts=30):
        # 7 // 3 = 2s, sisa 1s jatuh ke A (ts=10 terkecil) -> A dapat 3s, B dapat 2s, C dapat 2s
        slice_c = next(s for s in alloc_r3 if s["slice_start"] == dt_tz(2026, 9, 15, 10, 0, 0, 7))
        self.assertEqual(slice_c["allocated_seconds"], 2)

        # Total union seluruh operator-day (08:00:00 - 13:00:07) = 5h 7s = 18,007 detik
        total_union_operator_day = 18007
        combined_target_seconds = (
            met_r1["target_allocated_seconds"]
            + met_r2["target_allocated_seconds"]
            + met_r3["target_allocated_seconds"]
        )
        self.assertEqual(combined_target_seconds, total_union_operator_day)

    # -------------------------------------------------------------------------
    # 15. Companion Multi-Hari Melintasi Hari Tengah
    # -------------------------------------------------------------------------
    def test_15_three_day_spanning_companion_captured_on_middle_day(self):
        """Companion yang check-in pada H-1 dan check-out pada H+1 berhasil tertangkap pada target hari H."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Setup context audit agar aman menanam record sintetis
                cur.execute("SELECT set_config('mps.correction_actor', %s, true)", ("f3-test-3d",))
                cur.execute("SELECT set_config('mps.correction_reason', %s, true)", ("test companion 3-day overlap",))

                ts_target = 999981
                ts_comp = 999982
                serial = "TEST-OP-3DAY"

                # Bersihkan jika ada
                cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber IN (%s, %s)", (ts_target, ts_comp))
                conn.commit()

                # 1. Target T: 2026-09-15 10:00 - 14:00 (4 jam)
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, activitytype, order_no, operation_no,
                       workcentercode, confirmationnumber, state_flag, longdate_checkin,
                       longdate_checkout, planhours, std_foreman_hours)
                    VALUES
                      (%s, '5100', %s, '', '000100', 10, 'WC01', '100RG', 2,
                       %s, %s, 4.0, 4.0)
                    """,
                    (
                        ts_target, serial,
                        dt_tz(2026, 9, 15, 10, 0, 0, 7),
                        dt_tz(2026, 9, 15, 14, 0, 0, 7),
                    ),
                )
                # 2. Companion C melintasi 3 hari: 2026-09-14 12:00 -> 2026-09-16 12:00
                # Check-in dan check-out bukan di 2026-09-15! 2026-09-15 berada di tengah.
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, activitytype, order_no, operation_no,
                       workcentercode, confirmationnumber, state_flag, longdate_checkin,
                       longdate_checkout, planhours, std_foreman_hours)
                    VALUES
                      (%s, '5100', %s, '', '000200', 10, 'WC01', '200RG', 2,
                       %s, %s, 48.0, 48.0)
                    """,
                    (
                        ts_comp, serial,
                        dt_tz(2026, 9, 14, 12, 0, 0, 7),
                        dt_tz(2026, 9, 16, 12, 0, 0, 7),
                    ),
                )
                conn.commit()

                # Window hanya tanggal 2026-09-15
                from_ts = dt_tz(2026, 9, 15, 0, 0, 0, 7)
                to_ts = dt_tz(2026, 9, 16, 0, 0, 0, 7)

                try:
                    # Capture target
                    target_captured = etl.capture_candidates(cur, plant="5100", tz="Asia/Jakarta", from_ts=from_ts, to_ts=to_ts)
                    target_rows = [r for r in target_captured["rows"] if r["serialnumber"] == serial]
                    self.assertEqual(len(target_rows), 1)
                    self.assertEqual(target_rows[0]["tsnumber"], ts_target)

                    target_plan = etl.build_input_plan(target_rows, plant="5100", allocation_version="ALLOC-V1")
                    target_plan[0]["serialnumber"] = serial
                    target_cleaned = etl.build_cleaned_plan(target_plan, plant="5100", plant_timezone="Asia/Jakarta")

                    # Tarik companion
                    comp_work = etl.fetch_companion_work_segments(
                        cur,
                        plant="5100",
                        tz_name="Asia/Jakarta",
                        target_work_segments=target_cleaned,
                        from_ts=from_ts,
                        to_ts=to_ts,
                    )

                    # Companion C harus tertangkap dan memiliki segmen pada 2026-09-15 (00:00 - 24:00)
                    comp_on_15 = [s for s in comp_work if s["local_date"] == date(2026, 9, 15) and s["source_tsnumber"] == ts_comp]
                    self.assertEqual(len(comp_on_15), 1)
                    self.assertEqual(comp_on_15[0]["segment_start"], dt_tz(2026, 9, 15, 0, 0, 0, 7))
                    self.assertEqual(comp_on_15[0]["segment_end"], dt_tz(2026, 9, 16, 0, 0, 0, 7))

                    # Lakukan alokasi F3
                    alloc_plan, metrics = etl.build_allocated_plan(
                        target_cleaned,
                        plant="5100",
                        allocation_version="ALLOC-V1",
                        companion_segments=comp_work,
                    )

                    # Target T (10:00 - 14:00) terbagi dengan companion C (active_count = 2)
                    self.assertEqual(len(alloc_plan), 1)
                    self.assertEqual(alloc_plan[0]["active_count"], 2)
                    self.assertEqual(alloc_plan[0]["allocated_seconds"], 7200)  # 4 jam / 2 = 2 jam

                    self.assertEqual(metrics["target_allocated_seconds"], 7200)
                    # Companion C mendapat 00:00-10:00 (10h solo = 36000s) + 10:00-14:00 (4h/2 = 7200s) + 14:00-24:00 (10h solo = 36000s) = 79200s
                    self.assertEqual(metrics["companion_allocated_seconds"], 79200)
                    self.assertEqual(metrics["all_allocated_seconds"], 86400)
                    self.assertEqual(metrics["total_union_seconds"], 86400)
                    self.assertEqual(metrics["allocation_delta_seconds"], 0)
                    self.assertEqual(metrics["operator_day_violation_count"], 0)
                finally:
                    # Cleanup
                    cur.execute("SELECT set_config('mps.correction_actor', %s, true)", ("f3-test-3d",))
                    cur.execute("SELECT set_config('mps.correction_reason', %s, true)", ("test companion cleanup",))
                    cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber IN (%s, %s)", (ts_target, ts_comp))
                    conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
