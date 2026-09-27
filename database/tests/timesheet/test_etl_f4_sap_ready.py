#!/usr/bin/env python3
"""Test suite komprehensif untuk ETL timesheet F4 SAP-Ready.

Memverifikasi invariant dan kontrak F4:
1. Productive single slice: 1 WORK segment -> 1 SAP-ready payload.
2. Productive multi-slice merge: irisan alokasi digabungkan kembali per cleaned segment/source record.
3. Non-productive WORK: langsung dari cleaned segment tanpa sweep-line, remaining_seconds -> pre_cap_seconds.
4. BREAK segment exclusion: segmen BREAK tidak pernah masuk ke SAP-ready.
5. UNKNOWN confirmation blocking: produktif UNKNOWN diblokir (UNKNOWN_CONFIRMATION).
6. Missing Order / Operation blocking: produktif tanpa order_no / operation_no diblokir.
7. Missing serialnumber blocking: record tanpa serialnumber diblokir (MISSING_REQUIRED_SAP_FIELD).
8. Cap per source record: cap berlaku satu kali per source input record, bukan per irisan.
9. Midnight split single cap: input lintas tengah malam membagi cap secara kronologis.
10. Break split single cap: input yang terpotong break membagi cap secara kronologis.
11. Cap exhaustion drops 0s fragment: fragmen dengan sap_effective_seconds == 0 didrop (ZERO_EFFECTIVE_SECONDS).
12. NULL cap: cap_seconds is None -> tanpa batasan (pre_cap_seconds penuh).
13. Deterministik source_key: f"{plant}:{source_tsnumber}:{source_version}:{allocation_version}:{ready_rule_version}:{local_date}:{segment_sequence}".
14. READY-V1 dan READY-V2 coexistence: versi berbeda hidup berdampingan di timesheet_sap_ready tanpa tabrakan.
15. Source key berbeda antar ready version.
16. Final SAP payload contract untuk productive RG/OV/RW (WERKS, PERNR, AUFNR, VORNR, ISDD, ISDZ, IEDD, IEDZ, etc.).
17. Final SAP payload contract untuk non-productive (LSTAR, AUFNR="", VORNR="").
18. Timestamp/durasi konsisten setelah allocation (effective_end - effective_start == alloc).
19. Timestamp/durasi konsisten setelah cap (effective_end - effective_start == alloc <= cap).
20. Timezone Cikupa (Asia/Jakarta) dan Balikpapan (Asia/Makassar).
21. Mixed/invalid cap metadata ditolak (INVALID_CAP_METADATA).
22. Idempotent rerun reuse: rerun memakai ulang row timesheet_sap_ready (inserted=0, reused=N).
23. Drift detection fail-closed: sabotase payload/seconds/ready_version di DB memicu EtlError dan rollback.
24. DB CHECK constraints: penolakan seconds invalid, effective > allocated, status invalid.
25. Dry-run read-only parity: dry-run menghitung payload dan metric identik tanpa menulis ke DB.
26. Execute lalu preview persisted identik: preview read-only dari timesheet_sap_ready menghasilkan checksum dan data yang sama persis.
27. Invariant conservation: total_pre_cap_seconds == total_sap_effective_seconds + total_cap_deducted_seconds.
28. RUECK dan sequence category/number/branch/return dari master order.
29. Master order tidak ditemukan / confirmation number kosong diblokir.
30. Role OUTSOURCE/ADMINISTRATOR -> PERNR=11009413, SUBCONT diblokir, normal -> operator asli.
31. activitytype 0000 diblokir.
32. Operator-day open diblokir / ditahan.
33. Explicit staging exclusion diblokir.
34. Enrichment snapshot drift detection & coexistence.
35. Cap configured vs applied metric separation.
36. Payload parity dengan stage_timesheet_transaction.
"""
from __future__ import annotations

import json
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


def mock_enrichment(
    master_orders: dict | None = None,
    user_roles: dict | None = None,
    open_operator_days: set | None = None,
    explicit_exclusions: set | None = None,
) -> dict:
    return {
        "master_orders": master_orders or {},
        "user_roles": user_roles or {},
        "open_operator_days": open_operator_days or set(),
        "explicit_exclusions": explicit_exclusions or set(),
    }


class F4SapReadyTestSuite(unittest.TestCase):
    """Test suite lengkap untuk SAP-Ready F4."""

    # -------------------------------------------------------------------------
    # 1. Productive single slice -> 1 SAP-ready payload
    # -------------------------------------------------------------------------
    def test_01_productive_single_slice(self):
        """Cleaned WORK produktif tunggal menghasilkan 1 payload SAP-ready dengan durasi dan jam yang benar."""
        inp = {
            "input_id": "inp-01",
            "source_tsnumber": 1001,
            "source_hash": "hash01",
            "serialnumber": "EMP01",
            "activitytype": "ACT1",
            "order_no": "0001001",
            "operation_no": 10,
            "workcentercode": "WC01",
            "confirmationnumber": "1001RG",
        }
        c_seg = {
            "cleaned_segment_id": "seg-01",
            "input_id": "inp-01",
            "plant": "5100",
            "source_tsnumber": 1001,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "classification_reason": "SUFFIX_RG",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        alloc_slice = {
            "cleaned_segment_id": "seg-01",
            "input_id": "inp-01",
            "source_tsnumber": 1001,
            "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "allocated_seconds": 14400,
        }
        enrich = mock_enrichment(
            master_orders={
                ("1001", "10"): {
                    "order_no": "1001",
                    "operation_no": "10",
                    "confirmation_number": "CONF1001",
                    "sequence_category": "0",
                    "sequence_number": "0",
                    "branch_operation_no": "",
                    "return_operation_no": "",
                }
            }
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp], [c_seg], [alloc_slice], plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 1)
        self.assertEqual(metrics["sap_ready_count"], 1)
        self.assertEqual(metrics["productive_sap_ready_count"], 1)
        self.assertEqual(metrics["total_sap_effective_seconds"], 14400)
        self.assertEqual(metrics["total_sap_hours"], 4.0)

        row = ready_plan[0]
        self.assertEqual(row["source_tsnumber"], 1001)
        self.assertEqual(row["raw_seconds"], 14400)
        self.assertEqual(row["cleaned_seconds"], 14400)
        self.assertEqual(row["allocated_seconds"], 14400)
        self.assertEqual(row["sap_effective_seconds"], 14400)
        self.assertEqual(row["payload"]["WERKS"], "5100")
        self.assertEqual(row["payload"]["PERNR"], "000EMP01")
        self.assertEqual(row["payload"]["PERNR_ORIGIN"], "000EMP01")
        self.assertEqual(row["payload"]["AUFNR"], "000000001001")
        self.assertEqual(row["payload"]["VORNR"], "0010")
        self.assertEqual(row["payload"]["RUECK"], "CONF1001")
        self.assertEqual(row["payload"]["ZCONF_TYPE"], "RG")
        self.assertEqual(row["payload"]["ISDD"], "20260915")
        self.assertEqual(row["payload"]["ISDZ"], "080000")
        self.assertEqual(row["payload"]["IEDD"], "20260915")
        self.assertEqual(row["payload"]["IEDZ"], "120000")
        self.assertEqual(row["payload"]["date_checkin"], "2026-09-15")
        self.assertEqual(row["payload"]["hour_checkin"], "08:00:00")
        self.assertEqual(row["payload"]["date_checkout"], "2026-09-15")
        self.assertEqual(row["payload"]["hour_checkout"], "12:00:00")
        self.assertEqual(row["payload"]["hours"], 4.0)

    # -------------------------------------------------------------------------
    # 2. Productive multi-slice merge
    # -------------------------------------------------------------------------
    def test_02_productive_multi_slice_merge(self):
        """Cleaned WORK yang terbagi menjadi beberapa slice alokasi di F3 digabung kembali menjadi 1 payload SAP-ready."""
        inp = {
            "input_id": "inp-02",
            "source_tsnumber": 1002,
            "source_hash": "hash02",
            "serialnumber": "EMP01",
            "order_no": "0001002",
            "operation_no": 20,
            "workcentercode": "WC01",
            "confirmationnumber": "1002RG",
        }
        c_seg = {
            "cleaned_segment_id": "seg-02",
            "input_id": "inp-02",
            "plant": "5100",
            "source_tsnumber": 1002,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        slices = [
            {
                "cleaned_segment_id": "seg-02",
                "input_id": "inp-02",
                "source_tsnumber": 1002,
                "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "local_date": date(2026, 9, 15),
                "allocated_seconds": 7200,
            },
            {
                "cleaned_segment_id": "seg-02",
                "input_id": "inp-02",
                "source_tsnumber": 1002,
                "slice_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
                "local_date": date(2026, 9, 15),
                "allocated_seconds": 3600,
            },
        ]
        enrich = mock_enrichment(
            master_orders={
                ("1002", "20"): {"order_no": "1002", "operation_no": "20", "confirmation_number": "CONF1002"}
            }
        )

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 1)
        row = ready_plan[0]
        self.assertEqual(row["allocated_seconds"], 10800)  # 7200 + 3600
        self.assertEqual(row["sap_effective_seconds"], 10800)  # 3 jam
        self.assertEqual(row["payload"]["hours"], 3.0)

    # -------------------------------------------------------------------------
    # 3. Non-productive WORK record
    # -------------------------------------------------------------------------
    def test_03_non_productive_work_record(self):
        """Record non-produktif WORK langsung dari cleaned segment tanpa melewati alokasi sweep-line."""
        inp = {
            "input_id": "inp-03",
            "source_tsnumber": 1003,
            "source_hash": "hash03",
            "serialnumber": "12345",
            "activitytype": "MEETING",
            "order_no": None,
            "operation_no": None,
            "workcentercode": None,
            "confirmationnumber": None,
        }
        c_seg = {
            "cleaned_segment_id": "seg-03",
            "input_id": "inp-03",
            "plant": "5100",
            "source_tsnumber": 1003,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": None,
            "classification_source": "NON_PRODUCTIVE",
            "is_productive": False,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": None,
        }

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [c_seg], [], plant="5100", plant_timezone="Asia/Jakarta"
        )
        self.assertEqual(len(ready_plan), 1)
        self.assertEqual(metrics["non_productive_sap_ready_count"], 1)
        row = ready_plan[0]
        self.assertEqual(row["allocated_seconds"], 7200)
        self.assertEqual(row["sap_effective_seconds"], 7200)
        self.assertEqual(row["payload"]["LSTAR"], "MEETING")
        self.assertEqual(row["payload"]["AUFNR"], "")
        self.assertEqual(row["payload"]["VORNR"], "")
        self.assertEqual(row["payload"]["RUECK"], "")
        self.assertEqual(row["payload"]["ZCONF_TYPE"], "")

    # -------------------------------------------------------------------------
    # 4. BREAK segment exclusion
    # -------------------------------------------------------------------------
    def test_04_break_segment_excluded(self):
        """Segmen BREAK tidak pernah masuk ke SAP-ready."""
        inp = {
            "input_id": "inp-04",
            "source_tsnumber": 1004,
            "source_hash": "hash04",
            "serialnumber": "EMP01",
        }
        c_seg = {
            "cleaned_segment_id": "seg-04",
            "input_id": "inp-04",
            "plant": "5100",
            "source_tsnumber": 1004,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 13, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "BREAK",
            "confirmation_type": None,
            "is_productive": False,
            "raw_seconds": 3600,
            "remaining_seconds": 0,
            "cap_seconds": None,
        }

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [c_seg], [], plant="5100", plant_timezone="Asia/Jakarta"
        )
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(metrics["sap_ready_count"], 0)

    # -------------------------------------------------------------------------
    # 5. UNKNOWN confirmation blocking
    # -------------------------------------------------------------------------
    def test_05_unknown_confirmation_blocked(self):
        """Record produktif dengan confirmation UNKNOWN diblokir dari SAP-ready."""
        inp = {
            "input_id": "inp-05",
            "source_tsnumber": 1005,
            "source_hash": "hash05",
            "serialnumber": "EMP01",
            "order_no": "0001005",
            "operation_no": 10,
            "confirmationnumber": "UNKNOWN_VAL",
        }
        c_seg = {
            "cleaned_segment_id": "seg-05",
            "input_id": "inp-05",
            "plant": "5100",
            "source_tsnumber": 1005,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "UNKNOWN",
            "classification_source": "UNKNOWN",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        alloc_slice = {
            "cleaned_segment_id": "seg-05",
            "input_id": "inp-05",
            "source_tsnumber": 1005,
            "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "allocated_seconds": 14400,
        }
        enrich = mock_enrichment(
            master_orders={("1005", "10"): {"order_no": "1005", "operation_no": "10", "confirmation_number": "CONF1005"}}
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp], [c_seg], [alloc_slice], plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["UNKNOWN_CONFIRMATION"], 1)

    # -------------------------------------------------------------------------
    # 6. Missing Order / Operation blocking
    # -------------------------------------------------------------------------
    def test_06_missing_order_or_operation_blocked(self):
        """Record produktif tanpa order_no atau operation_no <= 0 diblokir."""
        inp_no_order = {
            "input_id": "inp-06a",
            "source_tsnumber": 10061,
            "source_hash": "hash06a",
            "serialnumber": "EMP01",
            "order_no": "",
            "operation_no": 10,
        }
        c_seg_a = {
            "cleaned_segment_id": "seg-06a",
            "input_id": "inp-06a",
            "plant": "5100",
            "source_tsnumber": 10061,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": None,
        }
        inp_no_op = {
            "input_id": "inp-06b",
            "source_tsnumber": 10062,
            "source_hash": "hash06b",
            "serialnumber": "EMP01",
            "order_no": "0001006",
            "operation_no": 0,
        }
        c_seg_b = {
            "cleaned_segment_id": "seg-06b",
            "input_id": "inp-06b",
            "plant": "5100",
            "source_tsnumber": 10062,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-06a", "input_id": "inp-06a", "source_tsnumber": 10061, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
            {"cleaned_segment_id": "seg-06b", "input_id": "inp-06b", "source_tsnumber": 10062, "slice_start": dt_tz(2026, 9, 15, 10, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
        ]
        enrich = mock_enrichment(
            master_orders={("1006", "0"): {"order_no": "1006", "operation_no": "0", "confirmation_number": "CONF1006"}}
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp_no_order, inp_no_op], [c_seg_a, c_seg_b], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["MISSING_ORDER"], 1)
        self.assertEqual(exclusions["MISSING_OPERATION"], 1)

    # -------------------------------------------------------------------------
    # 7. Missing serialnumber blocking
    # -------------------------------------------------------------------------
    def test_07_missing_serialnumber_blocked(self):
        """Record tanpa serialnumber diblokir dengan MISSING_REQUIRED_SAP_FIELD."""
        inp = {
            "input_id": "inp-07",
            "source_tsnumber": 1007,
            "source_hash": "hash07",
            "serialnumber": "",
            "order_no": "0001007",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-07",
            "input_id": "inp-07",
            "plant": "5100",
            "source_tsnumber": 1007,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp], [c_seg], [], plant="5100", plant_timezone="Asia/Jakarta"
        )
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["MISSING_REQUIRED_SAP_FIELD"], 1)

    # -------------------------------------------------------------------------
    # 8. Cap per source record across fragments
    # -------------------------------------------------------------------------
    def test_08_cap_per_source_record(self):
        """Cap berlaku per source record (total_effective <= cap_seconds)."""
        inp = {
            "input_id": "inp-08",
            "source_tsnumber": 1008,
            "source_hash": "hash08",
            "serialnumber": "EMP01",
            "order_no": "0001008",
            "operation_no": 10,
        }
        seg1 = {
            "cleaned_segment_id": "seg-08a",
            "input_id": "inp-08",
            "plant": "5100",
            "source_tsnumber": 1008,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 11, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 10800,
            "remaining_seconds": 10800,
            "cap_seconds": 14400,
        }
        seg2 = {
            "cleaned_segment_id": "seg-08b",
            "input_id": "inp-08",
            "plant": "5100",
            "source_tsnumber": 1008,
            "segment_sequence": 2,
            "segment_start": dt_tz(2026, 9, 15, 11, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 14, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 10800,
            "remaining_seconds": 10800,
            "cap_seconds": 14400,
        }
        slices = [
            {"cleaned_segment_id": "seg-08a", "input_id": "inp-08", "source_tsnumber": 1008, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 11, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 10800},
            {"cleaned_segment_id": "seg-08b", "input_id": "inp-08", "source_tsnumber": 1008, "slice_start": dt_tz(2026, 9, 15, 11, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 14, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 10800},
        ]
        enrich = mock_enrichment(
            master_orders={("1008", "10"): {"order_no": "1008", "operation_no": "10", "confirmation_number": "CONF1008"}}
        )

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [seg1, seg2], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 2)
        self.assertEqual(ready_plan[0]["sap_effective_seconds"], 10800)
        self.assertEqual(ready_plan[1]["sap_effective_seconds"], 3600)
        self.assertEqual(metrics["total_sap_effective_seconds"], 14400)
        self.assertEqual(metrics["total_sap_hours"], 4.0)

    # -------------------------------------------------------------------------
    # 9. Midnight split single cap
    # -------------------------------------------------------------------------
    def test_09_midnight_split_single_cap(self):
        """Input lintas tengah malam membawa 1 cap tunggal yang terdistribusi kronologis."""
        inp = {
            "input_id": "inp-09",
            "source_tsnumber": 1009,
            "source_hash": "hash09",
            "serialnumber": "EMP01",
            "order_no": "0001009",
            "operation_no": 10,
        }
        seg1 = {
            "cleaned_segment_id": "seg-09a",
            "input_id": "inp-09",
            "plant": "5100",
            "source_tsnumber": 1009,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 22, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 16, 0, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": 14400,
        }
        seg2 = {
            "cleaned_segment_id": "seg-09b",
            "input_id": "inp-09",
            "plant": "5100",
            "source_tsnumber": 1009,
            "segment_sequence": 2,
            "segment_start": dt_tz(2026, 9, 16, 0, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 16, 4, 0, 0, 7),
            "local_date": date(2026, 9, 16),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": 14400,
        }
        slices = [
            {"cleaned_segment_id": "seg-09a", "input_id": "inp-09", "source_tsnumber": 1009, "slice_start": dt_tz(2026, 9, 15, 22, 0, 0, 7), "slice_end": dt_tz(2026, 9, 16, 0, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
            {"cleaned_segment_id": "seg-09b", "input_id": "inp-09", "source_tsnumber": 1009, "slice_start": dt_tz(2026, 9, 16, 0, 0, 0, 7), "slice_end": dt_tz(2026, 9, 16, 4, 0, 0, 7), "local_date": date(2026, 9, 16), "allocated_seconds": 14400},
        ]
        enrich = mock_enrichment(
            master_orders={("1009", "10"): {"order_no": "1009", "operation_no": "10", "confirmation_number": "CONF1009"}}
        )

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [seg1, seg2], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 2)
        self.assertEqual(ready_plan[0]["sap_effective_seconds"], 7200)
        self.assertEqual(ready_plan[0]["local_date"], date(2026, 9, 15))
        self.assertEqual(ready_plan[1]["sap_effective_seconds"], 7200)
        self.assertEqual(ready_plan[1]["local_date"], date(2026, 9, 16))
        self.assertEqual(metrics["total_sap_effective_seconds"], 14400)

    # -------------------------------------------------------------------------
    # 10. Break split single cap
    # -------------------------------------------------------------------------
    def test_10_break_split_single_cap(self):
        """Input yang terpotong break (WORK, BREAK, WORK) membagi cap secara benar."""
        inp = {
            "input_id": "inp-10",
            "source_tsnumber": 1010,
            "source_hash": "hash10",
            "serialnumber": "EMP01",
            "order_no": "0001010",
            "operation_no": 10,
        }
        seg1 = {
            "cleaned_segment_id": "seg-10a",
            "input_id": "inp-10",
            "plant": "5100",
            "source_tsnumber": 1010,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 12600,
            "remaining_seconds": 12600,
            "cap_seconds": 14400,
        }
        seg_brk = {
            "cleaned_segment_id": "seg-10b",
            "input_id": "inp-10",
            "plant": "5100",
            "source_tsnumber": 1010,
            "segment_sequence": 2,
            "segment_start": dt_tz(2026, 9, 15, 11, 30, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 30, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "BREAK",
            "confirmation_type": None,
            "is_productive": False,
            "raw_seconds": 3600,
            "remaining_seconds": 0,
            "cap_seconds": 14400,
        }
        seg2 = {
            "cleaned_segment_id": "seg-10c",
            "input_id": "inp-10",
            "plant": "5100",
            "source_tsnumber": 1010,
            "segment_sequence": 3,
            "segment_start": dt_tz(2026, 9, 15, 12, 30, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 16, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 12600,
            "remaining_seconds": 12600,
            "cap_seconds": 14400,
        }
        slices = [
            {"cleaned_segment_id": "seg-10a", "input_id": "inp-10", "source_tsnumber": 1010, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 11, 30, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 12600},
            {"cleaned_segment_id": "seg-10c", "input_id": "inp-10", "source_tsnumber": 1010, "slice_start": dt_tz(2026, 9, 15, 12, 30, 0, 7), "slice_end": dt_tz(2026, 9, 15, 16, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 12600},
        ]
        enrich = mock_enrichment(
            master_orders={("1010", "10"): {"order_no": "1010", "operation_no": "10", "confirmation_number": "CONF1010"}}
        )

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [seg1, seg_brk, seg2], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 2)
        self.assertEqual(ready_plan[0]["sap_effective_seconds"], 12600)
        self.assertEqual(ready_plan[1]["sap_effective_seconds"], 1800)
        self.assertEqual(metrics["total_sap_effective_seconds"], 14400)

    # -------------------------------------------------------------------------
    # 11. Cap exhaustion drops 0s fragments
    # -------------------------------------------------------------------------
    def test_11_cap_exhaustion_drops_zeros(self):
        """Fragmen yang kehabisan jatah cap (sap_effective_seconds == 0) didrop dari payload dan dilaporkan di ZERO_EFFECTIVE_SECONDS."""
        inp = {
            "input_id": "inp-11",
            "source_tsnumber": 1011,
            "source_hash": "hash11",
            "serialnumber": "EMP01",
            "order_no": "0001011",
            "operation_no": 10,
        }
        seg1 = {
            "cleaned_segment_id": "seg-11a",
            "input_id": "inp-11",
            "plant": "5100",
            "source_tsnumber": 1011,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": 14400,
        }
        seg2 = {
            "cleaned_segment_id": "seg-11b",
            "input_id": "inp-11",
            "plant": "5100",
            "source_tsnumber": 1011,
            "segment_sequence": 2,
            "segment_start": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 14, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": 14400,
        }
        slices = [
            {"cleaned_segment_id": "seg-11a", "input_id": "inp-11", "source_tsnumber": 1011, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 14400},
            {"cleaned_segment_id": "seg-11b", "input_id": "inp-11", "source_tsnumber": 1011, "slice_start": dt_tz(2026, 9, 15, 12, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 14, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
        ]
        enrich = mock_enrichment(
            master_orders={("1011", "10"): {"order_no": "1011", "operation_no": "10", "confirmation_number": "CONF1011"}}
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp], [seg1, seg2], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 1)
        self.assertEqual(ready_plan[0]["segment_sequence"], 1)
        self.assertEqual(exclusions["ZERO_EFFECTIVE_SECONDS"], 1)

    # -------------------------------------------------------------------------
    # 12. NULL cap
    # -------------------------------------------------------------------------
    def test_12_null_cap_unlimited(self):
        """Record dengan cap_seconds = None menerima alokasi penuh tanpa batas."""
        inp = {
            "input_id": "inp-12",
            "source_tsnumber": 1012,
            "source_hash": "hash12",
            "serialnumber": "EMP01",
            "order_no": "0001012",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-12",
            "input_id": "inp-12",
            "plant": "5100",
            "source_tsnumber": 1012,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 20, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 43200,
            "remaining_seconds": 43200,
            "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-12", "input_id": "inp-12", "source_tsnumber": 1012, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 20, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 43200},
        ]
        enrich = mock_enrichment(
            master_orders={("1012", "10"): {"order_no": "1012", "operation_no": "10", "confirmation_number": "CONF1012"}}
        )

        ready_plan, metrics, _ = etl.build_sap_ready_plan(
            [inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 1)
        self.assertEqual(ready_plan[0]["sap_effective_seconds"], 43200)
        self.assertEqual(ready_plan[0]["payload"]["hours"], 12.0)

    # -------------------------------------------------------------------------
    # 13. Deterministik source_key dengan ready_rule_version
    # -------------------------------------------------------------------------
    def test_13_deterministic_source_key_with_ready_version(self):
        """source_key memuat plant, tsnumber, source_version, allocation_version, ready_rule_version, local_date, segment_sequence."""
        inp = {
            "input_id": "inp-13",
            "source_tsnumber": 555,
            "source_hash": "sha13",
            "serialnumber": "EMP01",
            "order_no": "0001013",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-13",
            "input_id": "inp-13",
            "plant": "5100",
            "source_tsnumber": 555,
            "segment_sequence": 2,
            "segment_start": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 14, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 7200,
            "remaining_seconds": 7200,
            "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-13", "input_id": "inp-13", "source_tsnumber": 555, "slice_start": dt_tz(2026, 9, 15, 12, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 14, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
        ]
        enrich = mock_enrichment(
            master_orders={("1013", "10"): {"order_no": "1013", "operation_no": "10", "confirmation_number": "CONF1013"}}
        )

        ready_plan, _, _ = etl.build_sap_ready_plan(
            [inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta",
            allocation_version="ALLOC-V1", ready_version="READY-V1", enrichment_data=enrich
        )
        expected_key = "5100:555:sha13:ALLOC-V1:READY-V1:2026-09-15:2"
        self.assertEqual(ready_plan[0]["source_key"], expected_key)
        self.assertEqual(ready_plan[0]["payload"]["source_key"], expected_key)
        self.assertEqual(ready_plan[0]["ready_rule_version"], "READY-V1")
        self.assertEqual(ready_plan[0]["payload"]["ready_rule_version"], "READY-V1")

    # -------------------------------------------------------------------------
    # 14. READY-V1 dan READY-V2 coexistence
    # -------------------------------------------------------------------------
    def test_14_ready_versions_coexistence(self):
        """READY-V1 dan READY-V2 dapat dipersist pada record yang sama tanpa konflik/menimpa."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-COEXIST"
                clean_ver = "CLEAN-F4-COEXIST"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                # Run READY-V1
                res_v1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version="READY-V1", created_by="test-coexist-v1",
                )
                self.assertGreater(res_v1["inserted_sap_ready"], 0)

                # Run READY-V2 pada input yang sama
                res_v2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version="READY-V2", created_by="test-coexist-v2",
                )
                self.assertGreater(res_v2["inserted_sap_ready"], 0)

                # Periksa bahwa kedua versi ada di timesheet_sap_ready
                cur.execute(
                    """
                    SELECT ready_rule_version, count(*) FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s GROUP BY ready_rule_version ORDER BY ready_rule_version
                    """,
                    (alloc_ver,),
                )
                counts = {r["ready_rule_version"]: r["count"] for r in cur.fetchall()}
                self.assertEqual(counts["READY-V1"], res_v1["sap_ready_count"])
                self.assertEqual(counts["READY-V2"], res_v2["sap_ready_count"])
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 15. Source key berbeda antar ready version
    # -------------------------------------------------------------------------
    def test_15_source_key_differs_by_ready_version(self):
        """source_key untuk READY-V1 dan READY-V2 berbeda pada source input yang sama."""
        inp = {
            "input_id": "inp-15",
            "source_tsnumber": 777,
            "source_hash": "hash15",
            "serialnumber": "EMP01",
            "order_no": "0001015",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-15",
            "input_id": "inp-15",
            "plant": "5100",
            "source_tsnumber": 777,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-15", "input_id": "inp-15", "source_tsnumber": 777, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 14400},
        ]
        enrich = mock_enrichment(
            master_orders={("1015", "10"): {"order_no": "1015", "operation_no": "10", "confirmation_number": "CONF1015"}}
        )

        plan_v1, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", ready_version="READY-V1", enrichment_data=enrich)
        plan_v2, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", ready_version="READY-V2", enrichment_data=enrich)

        self.assertIn(":READY-V1:", plan_v1[0]["source_key"])
        self.assertIn(":READY-V2:", plan_v2[0]["source_key"])
        self.assertNotEqual(plan_v1[0]["source_key"], plan_v2[0]["source_key"])

    # -------------------------------------------------------------------------
    # 16. Final SAP payload contract untuk productive RG/OV/RW
    # -------------------------------------------------------------------------
    def test_16_final_sap_payload_productive(self):
        """Payload produktif memiliki seluruh kolom SAP (WERKS, PERNR, AUFNR, VORNR, ZCONF_TYPE, etc.) terformat benar."""
        types_and_expected = [
            ("RG", "RG"),
            ("OV", "OV"),
            ("RW", "RW"),
        ]
        for c_type, expected_zconf in types_and_expected:
            with self.subTest(conf_type=c_type):
                inp = {
                    "input_id": f"inp-16-{c_type}",
                    "source_tsnumber": 1600,
                    "source_hash": f"hash16{c_type}",
                    "serialnumber": "12345",
                    "order_no": "100500",
                    "operation_no": 20,
                    "workcentercode": "WCTR01",
                    "confirmationnumber": f"1600{c_type}",
                }
                c_seg = {
                    "cleaned_segment_id": f"seg-16-{c_type}",
                    "input_id": f"inp-16-{c_type}",
                    "plant": "5100",
                    "source_tsnumber": 1600,
                    "segment_sequence": 1,
                    "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
                    "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
                    "local_date": date(2026, 9, 15),
                    "segment_kind": "WORK",
                    "confirmation_type": c_type,
                    "classification_source": "CANONICAL",
                    "is_productive": True,
                    "raw_seconds": 7200,
                    "remaining_seconds": 7200,
                    "cap_seconds": None,
                }
                slices = [
                    {"cleaned_segment_id": f"seg-16-{c_type}", "input_id": f"inp-16-{c_type}", "source_tsnumber": 1600, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
                ]
                enrich = mock_enrichment(
                    master_orders={
                        ("100500", "20"): {
                            "order_no": "100500",
                            "operation_no": "20",
                            "confirmation_number": f"MASTERCONF{c_type}",
                            "sequence_category": "0",
                            "sequence_number": "0",
                            "branch_operation_no": "",
                            "return_operation_no": "",
                        }
                    }
                )
                ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
                p = ready_plan[0]["payload"]
                self.assertEqual(p["WERKS"], "5100")
                self.assertEqual(p["PERNR"], "00012345")
                self.assertEqual(p["PERNR_ORIGIN"], "00012345")
                self.assertEqual(p["AUFNR"], "000000100500")
                self.assertEqual(p["VORNR"], "0020")
                self.assertEqual(p["ZCONF_TYPE"], expected_zconf)
                self.assertEqual(p["ARBPL"], "WCTR01")
                self.assertEqual(p["LSTAR"], "")
                self.assertEqual(p["ISDD"], "20260915")
                self.assertEqual(p["ISDZ"], "080000")
                self.assertEqual(p["IEDD"], "20260915")
                self.assertEqual(p["IEDZ"], "100000")
                self.assertEqual(p["RUECK"], f"MASTERCONF{c_type}")

    # -------------------------------------------------------------------------
    # 17. Final SAP payload contract untuk non-productive
    # -------------------------------------------------------------------------
    def test_17_final_sap_payload_non_productive(self):
        """Payload nonproduktif memiliki LSTAR terisi, sedangkan AUFNR, VORNR, RUECK, ZCONF_TYPE kosong."""
        inp = {
            "input_id": "inp-17",
            "source_tsnumber": 1700,
            "source_hash": "hash17",
            "serialnumber": "999",
            "activitytype": "ABS_SICK",
        }
        c_seg = {
            "cleaned_segment_id": "seg-17",
            "input_id": "inp-17",
            "plant": "5100",
            "source_tsnumber": 1700,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": None,
            "classification_source": "NON_PRODUCTIVE",
            "is_productive": False,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], [], plant="5100", plant_timezone="Asia/Jakarta")
        p = ready_plan[0]["payload"]
        self.assertEqual(p["WERKS"], "5100")
        self.assertEqual(p["PERNR"], "00000999")
        self.assertEqual(p["LSTAR"], "ABS_SICK")
        self.assertEqual(p["AUFNR"], "")
        self.assertEqual(p["VORNR"], "")
        self.assertEqual(p["RUECK"], "")
        self.assertEqual(p["ZCONF_TYPE"], "")

    # -------------------------------------------------------------------------
    # 18. Timestamp/durasi konsisten setelah alokasi
    # -------------------------------------------------------------------------
    def test_18_timestamp_duration_consistency_after_allocation(self):
        """IEDD/IEDZ dan longdate_checkout tepat mencerminkan effective_start + alloc."""
        inp = {
            "input_id": "inp-18",
            "source_tsnumber": 1800,
            "source_hash": "hash18",
            "serialnumber": "EMP01",
            "order_no": "0001018",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-18",
            "input_id": "inp-18",
            "plant": "5100",
            "source_tsnumber": 1800,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 14400,
            "remaining_seconds": 14400,
            "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-18", "input_id": "inp-18", "source_tsnumber": 1800, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 5400},
        ]
        enrich = mock_enrichment(
            master_orders={("1018", "10"): {"order_no": "1018", "operation_no": "10", "confirmation_number": "CONF1018"}}
        )

        ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        p = ready_plan[0]["payload"]
        self.assertEqual(p["ISDD"], "20260915")
        self.assertEqual(p["ISDZ"], "080000")
        self.assertEqual(p["IEDD"], "20260915")
        self.assertEqual(p["IEDZ"], "093000")  # 08:00 + 1.5h = 09:30
        self.assertEqual(p["sap_effective_seconds"], 5400)
        self.assertEqual(p["hour_checkout"], "09:30:00")

    # -------------------------------------------------------------------------
    # 19. Timestamp/durasi konsisten setelah cap
    # -------------------------------------------------------------------------
    def test_19_timestamp_duration_consistency_after_cap(self):
        """Setelah terkena cap, effective_end - effective_start == sap_effective_seconds <= cap_seconds."""
        inp = {
            "input_id": "inp-19",
            "source_tsnumber": 1900,
            "source_hash": "hash19",
            "serialnumber": "EMP01",
            "order_no": "0001019",
            "operation_no": 10,
        }
        c_seg = {
            "cleaned_segment_id": "seg-19",
            "input_id": "inp-19",
            "plant": "5100",
            "source_tsnumber": 1900,
            "segment_sequence": 1,
            "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7),
            "segment_end": dt_tz(2026, 9, 15, 16, 0, 0, 7),
            "local_date": date(2026, 9, 15),
            "segment_kind": "WORK",
            "confirmation_type": "RG",
            "classification_source": "CANONICAL",
            "is_productive": True,
            "raw_seconds": 28800,
            "remaining_seconds": 28800,
            "cap_seconds": 7200,  # Cap 2 jam = 7200s
        }
        slices = [
            {"cleaned_segment_id": "seg-19", "input_id": "inp-19", "source_tsnumber": 1900, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 16, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 28800},
        ]
        enrich = mock_enrichment(
            master_orders={("1019", "10"): {"order_no": "1019", "operation_no": "10", "confirmation_number": "CONF1019"}}
        )

        ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        p = ready_plan[0]["payload"]
        self.assertEqual(p["ISDZ"], "080000")
        self.assertEqual(p["IEDZ"], "100000")  # 08:00 + 2h = 10:00
        self.assertEqual(p["sap_effective_seconds"], 7200)

    # -------------------------------------------------------------------------
    # 20. Timezone handling Cikupa dan Balikpapan
    # -------------------------------------------------------------------------
    def test_20_timezone_handling_ckp_bpn(self):
        """Timezone Cikupa (Asia/Jakarta, UTC+7) dan Balikpapan (Asia/Makassar, UTC+8) menghasilkan ISDD/ISDZ/IEDD/IEDZ yang akurat."""
        enrich_ckp = mock_enrichment(
            master_orders={("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"}}
        )
        inp_ckp = {"input_id": "inp-ckp", "source_tsnumber": 2001, "source_hash": "hckp", "serialnumber": "1", "order_no": "1", "operation_no": 1}
        seg_ckp = {
            "cleaned_segment_id": "seg-ckp", "input_id": "inp-ckp", "plant": "5100", "source_tsnumber": 2001,
            "segment_sequence": 1, "segment_start": datetime(2026, 9, 15, 1, 0, 0, tzinfo=timezone.utc), # 08:00 UTC+7
            "segment_end": datetime(2026, 9, 15, 3, 0, 0, tzinfo=timezone.utc), # 10:00 UTC+7
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices_ckp = [{"cleaned_segment_id": "seg-ckp", "input_id": "inp-ckp", "source_tsnumber": 2001, "slice_start": datetime(2026, 9, 15, 1, 0, 0, tzinfo=timezone.utc), "slice_end": datetime(2026, 9, 15, 3, 0, 0, tzinfo=timezone.utc), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]
        plan_ckp, _, _ = etl.build_sap_ready_plan([inp_ckp], [seg_ckp], slices_ckp, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich_ckp)
        self.assertEqual(plan_ckp[0]["payload"]["ISDZ"], "080000")
        self.assertEqual(plan_ckp[0]["payload"]["IEDZ"], "100000")

        # Check Balikpapan (UTC+8)
        enrich_bpn = mock_enrichment(
            master_orders={("2", "1"): {"order_no": "2", "operation_no": "1", "confirmation_number": "CONF2"}}
        )
        inp_bpn = {"input_id": "inp-bpn", "source_tsnumber": 2002, "source_hash": "hbpn", "serialnumber": "2", "order_no": "2", "operation_no": 1}
        seg_bpn = {
            "cleaned_segment_id": "seg-bpn", "input_id": "inp-bpn", "plant": "5051", "source_tsnumber": 2002,
            "segment_sequence": 1, "segment_start": datetime(2026, 9, 15, 1, 0, 0, tzinfo=timezone.utc), # 09:00 UTC+8
            "segment_end": datetime(2026, 9, 15, 3, 0, 0, tzinfo=timezone.utc), # 11:00 UTC+8
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices_bpn = [{"cleaned_segment_id": "seg-bpn", "input_id": "inp-bpn", "source_tsnumber": 2002, "slice_start": datetime(2026, 9, 15, 1, 0, 0, tzinfo=timezone.utc), "slice_end": datetime(2026, 9, 15, 3, 0, 0, tzinfo=timezone.utc), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]
        plan_bpn, _, _ = etl.build_sap_ready_plan([inp_bpn], [seg_bpn], slices_bpn, plant="5051", plant_timezone="Asia/Makassar", enrichment_data=enrich_bpn)
        self.assertEqual(plan_bpn[0]["payload"]["ISDZ"], "090000")
        self.assertEqual(plan_bpn[0]["payload"]["IEDZ"], "110000")

    # -------------------------------------------------------------------------
    # 21. Mixed / invalid cap metadata fail-closed
    # -------------------------------------------------------------------------
    def test_21_mixed_or_invalid_cap_metadata_blocked(self):
        """Fragmen pada source yang sama dengan cap metadata tidak konsisten atau negatif memblokir seluruh source record."""
        inp = {"input_id": "inp-21", "source_tsnumber": 2100, "source_hash": "hash21", "serialnumber": "1", "order_no": "1", "operation_no": 1}
        seg1 = {
            "cleaned_segment_id": "seg-21a", "input_id": "inp-21", "plant": "5100", "source_tsnumber": 2100,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": 7200, "cap_category": "VA",
        }
        seg2 = {
            "cleaned_segment_id": "seg-21b", "input_id": "inp-21", "plant": "5100", "source_tsnumber": 2100,
            "segment_sequence": 2, "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None, "cap_category": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-21a", "input_id": "inp-21", "source_tsnumber": 2100, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
            {"cleaned_segment_id": "seg-21b", "input_id": "inp-21", "source_tsnumber": 2100, "slice_start": dt_tz(2026, 9, 15, 10, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200},
        ]
        enrich = mock_enrichment(
            master_orders={("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"}}
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan([inp], [seg1, seg2], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["INVALID_CAP_METADATA"], 1)
        self.assertEqual(metrics["blocked_source_count"], 1)

    # -------------------------------------------------------------------------
    # 22. Idempotent rerun reuse
    # -------------------------------------------------------------------------
    def test_22_idempotent_rerun_reuse(self):
        """Rerun execute pada window yang sama memakai ulang row timesheet_sap_ready (inserted=0, reused=N)."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-TEST-IDEMP"
                clean_ver = "CLEAN-F4-TEST-IDEMP"

                # Cleanup test version
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-f4-idemp",
                )
                res2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-f4-idemp",
                )

                self.assertEqual(res2["inserted_sap_ready"], 0)
                self.assertEqual(res2["reused_sap_ready"], res1["sap_ready_count"])
                self.assertEqual(res2["output_checksum"], res1["output_checksum"])
                self.assertEqual(res2["status"], "SAP_READY")
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 23. Drift detection fail-closed
    # -------------------------------------------------------------------------
    def test_23_drift_detection_fail_closed(self):
        """Sabotase field timesheet_sap_ready di DB memicu EtlError dan rollback atomik."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-TEST-SABOTAGE"
                clean_ver = "CLEAN-F4-TEST-SABOTAGE"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    created_by="test-f4-sabotage",
                )

                # Sabotase satu row sap_effective_seconds di DB (kurangi 1 detik)
                cur.execute(
                    """
                    UPDATE public.timesheet_sap_ready
                    SET sap_effective_seconds = sap_effective_seconds - 1
                    WHERE sap_ready_id = (
                      SELECT sap_ready_id FROM public.timesheet_sap_ready
                      WHERE run_id = %s LIMIT 1
                    )
                    """,
                    (res1["run_id"],),
                )
                conn.commit()

                # Rerun kedua harus mendeteksi drift dan me-rollback
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.run_execute(
                        cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=alloc_ver, clean_rule_version=clean_ver,
                        created_by="test-f4-sabotage-2",
                    )
                self.assertIn("Drift terdeteksi pada timesheet_sap_ready", str(ctx.exception))
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 24. DB CHECK constraints
    # -------------------------------------------------------------------------
    def test_24_db_constraints(self):
        """DB CHECK constraint menolak effective > allocated, negative seconds, status invalid."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Siapkan parent run & input
                cur.execute(
                    """
                    INSERT INTO public.timesheet_etl_run (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by)
                    VALUES ('5100', '2026-09-15 00:00:00+07', '2026-09-15 04:00:00+07', 'Asia/Jakarta', 'ALLOC-TEST-CK', 'tester')
                    RETURNING run_id
                    """
                )
                run_id = cur.fetchone()["run_id"]
                cur.execute(
                    """
                    INSERT INTO public.timesheet_etl_input
                      (run_id, plant, source_tsnumber, source_hash, allocation_version, serialnumber,
                       longdate_checkin, longdate_checkout, raw_seconds, local_date_checkin, raw_snapshot)
                    VALUES
                    (%s, '5100', 999901, 'hash-ck', 'ALLOC-TEST-CK', 'OP-CK',
                     '2026-09-15 08:00:00+07', '2026-09-15 12:00:00+07', 14400, '2026-09-15', '{}'::jsonb)
                    RETURNING input_id
                    """,
                    (run_id,),
                )
                inp_id = cur.fetchone()["input_id"]

                base = {
                    "run_id": run_id,
                    "input_id": inp_id,
                    "plant": "5100",
                    "source_tsnumber": 999901,
                    "source_version": "hash-ck",
                    "allocation_version": "ALLOC-TEST-CK",
                    "ready_rule_version": "READY-V1",
                    "local_date": date(2026, 9, 15),
                    "segment_sequence": 1,
                    "source_key": "5100:999901:hash-ck:ALLOC-TEST-CK:READY-V1:2026-09-15:1",
                    "payload": json.dumps({"test": 1}),
                    "enrichment_snapshot": json.dumps({}),
                    "raw_seconds": 14400,
                    "cleaned_seconds": 14400,
                    "allocated_seconds": 14400,
                    "cap_seconds": 14400,
                    "sap_effective_seconds": 14400,
                    "status": "SAP_READY",
                }

                # 1. sap_effective_seconds > allocated_seconds
                bad1 = dict(base, sap_effective_seconds=15000)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_SAP_READY_SQL, bad1)
                conn.rollback()

                # 2. negative sap_effective_seconds
                bad2 = dict(base, sap_effective_seconds=-10)
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_SAP_READY_SQL, bad2)
                conn.rollback()

                # 3. status invalid
                bad3 = dict(base, status="INVALID_STATUS")
                with self.assertRaises(psycopg2.IntegrityError):
                    cur.execute(etl.EXECUTE_INSERT_SAP_READY_SQL, bad3)
                conn.rollback()
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 25. Dry-run read-only parity
    # -------------------------------------------------------------------------
    def test_25_dry_run_read_only_parity(self):
        """Dry-run menghitung seluruh payload dan ringkasan SAP-ready tanpa menulis ke database."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                # The clone's 2026-09-01..22 window contains real duplicate-activity
                # overlaps (review case 5100-C028), so F2 must reject it; the success path
                # uses 2026-09-12..14, which a per-day dry-run showed to be conflict-free.
                with self.assertRaisesRegex(etl.EtlError, "DUPLICATE_ACTIVITY_OVERLAP"):
                    etl.run_dry_run(
                        cur, cfg=cfg, dbname=CKP,
                        from_ts=datetime(2026, 9, 1, 0, 0, tzinfo=timezone(timedelta(hours=7))),
                        to_ts=datetime(2026, 9, 22, 0, 0, tzinfo=timezone(timedelta(hours=7))),
                        allocation_version="ALLOC-V1", clean_rule_version="CLEAN-V2",
                        ready_version="READY-V1",
                    )
                conn.rollback()

                from_ts = datetime(2026, 9, 12, 0, 0, tzinfo=timezone(timedelta(hours=7)))
                to_ts = datetime(2026, 9, 14, 0, 0, tzinfo=timezone(timedelta(hours=7)))

                fp_before = etl.database_fingerprint(cur)
                res = etl.run_dry_run(
                    cur, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version="ALLOC-V1", clean_rule_version="CLEAN-V2",
                    ready_version="READY-V1",
                )
                fp_after = etl.database_fingerprint(cur)

                self.assertEqual(fp_before, fp_after)
                self.assertEqual(res["wrote_rows"], 0)
                self.assertGreater(res["sap_ready_count"], 0)
                self.assertGreater(res["total_sap_effective_seconds"], 0)
                self.assertGreater(res["total_sap_hours"], 0)
                self.assertIsNotNone(res["output_checksum"])
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 26. Execute lalu preview persisted identik
    # -------------------------------------------------------------------------
    def test_26_execute_then_preview_persisted_parity(self):
        """Execute menghasilkan data di timesheet_sap_ready, dan preview_persisted_sap_ready membacanya dengan parity 100% tanpa modifikasi DB."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-PREV-TEST"
                clean_ver = "CLEAN-F4-PREV-TEST"
                ready_ver = "READY-F4-PREV-TEST"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res_exec = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version=ready_ver, created_by="test-f4-preview",
                )

                fp_before_preview = etl.database_fingerprint(cur)
                res_prev = etl.preview_persisted_sap_ready(
                    cur, plant="5100", run_id=res_exec["run_id"], ready_rule_version=ready_ver
                )
                fp_after_preview = etl.database_fingerprint(cur)

                self.assertEqual(fp_before_preview, fp_after_preview)
                self.assertEqual(res_prev["sap_ready_count"], res_exec["sap_ready_count"])
                self.assertEqual(res_prev["total_sap_effective_seconds"], res_exec["total_sap_effective_seconds"])
                self.assertEqual(res_prev["total_sap_hours"], res_exec["total_sap_hours"])
                self.assertEqual(res_prev["output_checksum"], res_exec["output_checksum"])

                # Cleanup test version after verification
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 27. Invariant conservation
    # -------------------------------------------------------------------------
    def test_27_invariant_conservation(self):
        """Konservasi durasi pre_cap == effective + deducted terpenuhi."""
        inp = {"input_id": "inp-27", "source_tsnumber": 2700, "source_hash": "h27", "serialnumber": "1", "order_no": "1", "operation_no": 1}
        c_seg = {
            "cleaned_segment_id": "seg-27", "input_id": "inp-27", "plant": "5100", "source_tsnumber": 2700,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 14400,
            "remaining_seconds": 14400, "cap_seconds": 10800,  # Cap 3h
        }
        slices = [
            {"cleaned_segment_id": "seg-27", "input_id": "inp-27", "source_tsnumber": 2700, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 14400},
        ]
        enrich = mock_enrichment(
            master_orders={("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"}}
        )

        _, metrics, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        self.assertEqual(metrics["total_pre_cap_seconds"], 14400)
        self.assertEqual(metrics["total_sap_effective_seconds"], 10800)
        self.assertEqual(metrics["total_cap_deducted_seconds"], 3600)
        self.assertEqual(metrics["total_pre_cap_seconds"], metrics["total_sap_effective_seconds"] + metrics["total_cap_deducted_seconds"])

    # -------------------------------------------------------------------------
    # 28. RUECK and master sequence fields enrichment
    # -------------------------------------------------------------------------
    def test_28_master_order_rueck_and_sequence_fields(self):
        """RUECK diambil dari ph3_order.confirmation_number dan sequence fields terisi dari master."""
        inp = {
            "input_id": "inp-28", "source_tsnumber": 2800, "source_hash": "h28",
            "serialnumber": "EMP28", "order_no": "0009876", "operation_no": 30,
            "workcentercode": "WC28", "confirmationnumber": "TIMESHEET_CONF_IGNORED_RG",
        }
        c_seg = {
            "cleaned_segment_id": "seg-28", "input_id": "inp-28", "plant": "5100", "source_tsnumber": 2800,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices = [
            {"cleaned_segment_id": "seg-28", "input_id": "inp-28", "source_tsnumber": 2800, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}
        ]
        enrich = mock_enrichment(
            master_orders={
                ("9876", "30"): {
                    "order_no": "9876",
                    "operation_no": "30",
                    "confirmation_number": "SAP_MASTER_CONF_9999",
                    "sequence_category": "0",
                    "sequence_number": "000000",
                    "branch_operation_no": "0025",
                    "return_operation_no": "0035",
                }
            }
        )
        ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        self.assertEqual(len(ready_plan), 1)
        p = ready_plan[0]["payload"]
        self.assertEqual(p["RUECK"], "SAP_MASTER_CONF_9999")
        self.assertEqual(p["FLGAT"], "0")
        self.assertEqual(p["PLNFL"], "000000")
        self.assertEqual(p["VORNR_B"], "0025")
        self.assertEqual(p["VORNR_R"], "0035")

        snap = ready_plan[0]["enrichment_snapshot"]
        self.assertEqual(snap["master_confirmation_number"], "SAP_MASTER_CONF_9999")
        self.assertEqual(snap["sequence_category"], "0")
        self.assertEqual(snap["sequence_number"], "000000")
        self.assertEqual(snap["branch_operation_no"], "0025")
        self.assertEqual(snap["return_operation_no"], "0035")

    # -------------------------------------------------------------------------
    # 29. Master order not found & missing confirmation number blocked
    # -------------------------------------------------------------------------
    def test_29_master_order_not_found_and_missing_conf_blocked(self):
        """Master order tidak ditemukan menghasilkan MASTER_OPERATION_NOT_FOUND, dan confirmation_number kosong menghasilkan MISSING_CONFIRMATION_NUMBER."""
        # 1. Not found
        inp1 = {"input_id": "inp-29a", "source_tsnumber": 2901, "source_hash": "h29a", "serialnumber": "1", "order_no": "999999", "operation_no": 10}
        seg1 = {
            "cleaned_segment_id": "seg-29a", "input_id": "inp-29a", "plant": "5100", "source_tsnumber": 2901,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices1 = [{"cleaned_segment_id": "seg-29a", "input_id": "inp-29a", "source_tsnumber": 2901, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 2. Missing confirmation_number
        inp2 = {"input_id": "inp-29b", "source_tsnumber": 2902, "source_hash": "h29b", "serialnumber": "1", "order_no": "888888", "operation_no": 10}
        seg2 = {
            "cleaned_segment_id": "seg-29b", "input_id": "inp-29b", "plant": "5100", "source_tsnumber": 2902,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices2 = [{"cleaned_segment_id": "seg-29b", "input_id": "inp-29b", "source_tsnumber": 2902, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={
                ("888888", "10"): {"order_no": "888888", "operation_no": "10", "confirmation_number": ""}
            }
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp1, inp2], [seg1, seg2], slices1 + slices2, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["MASTER_OPERATION_NOT_FOUND"], 1)
        self.assertEqual(exclusions["MISSING_CONFIRMATION_NUMBER"], 1)
        self.assertEqual(metrics["blocked_source_count"], 2)

    # -------------------------------------------------------------------------
    # 30. Roles OUTSOURCE / ADMINISTRATOR / SUBCONT / normal
    # -------------------------------------------------------------------------
    def test_30_roles_outsource_admin_subcont_normal(self):
        """OUTSOURCE/ADMINISTRATOR menghasilkan PERNR 11009413, SUBCONT diblokir, normal menghasilkan PERNR asli."""
        # 1. OUTSOURCE
        inp_out = {"input_id": "inp-out", "source_tsnumber": 3001, "source_hash": "hout", "serialnumber": "OP_OUT", "order_no": "100", "operation_no": 10}
        seg_out = {"cleaned_segment_id": "s-out", "input_id": "inp-out", "plant": "5100", "source_tsnumber": 3001, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_out = [{"cleaned_segment_id": "s-out", "input_id": "inp-out", "source_tsnumber": 3001, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 2. ADMINISTRATOR
        inp_adm = {"input_id": "inp-adm", "source_tsnumber": 3002, "source_hash": "hadm", "serialnumber": "OP_ADM", "order_no": "100", "operation_no": 10}
        seg_adm = {"cleaned_segment_id": "s-adm", "input_id": "inp-adm", "plant": "5100", "source_tsnumber": 3002, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_adm = [{"cleaned_segment_id": "s-adm", "input_id": "inp-adm", "source_tsnumber": 3002, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 3. SUBCONT
        inp_sub = {"input_id": "inp-sub", "source_tsnumber": 3003, "source_hash": "hsub", "serialnumber": "OP_SUB", "order_no": "100", "operation_no": 10}
        seg_sub = {"cleaned_segment_id": "s-sub", "input_id": "inp-sub", "plant": "5100", "source_tsnumber": 3003, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_sub = [{"cleaned_segment_id": "s-sub", "input_id": "inp-sub", "source_tsnumber": 3003, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 4. NORMAL
        inp_nor = {"input_id": "inp-nor", "source_tsnumber": 3004, "source_hash": "hnor", "serialnumber": "12345", "order_no": "100", "operation_no": 10}
        seg_nor = {"cleaned_segment_id": "s-nor", "input_id": "inp-nor", "plant": "5100", "source_tsnumber": 3004, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_nor = [{"cleaned_segment_id": "s-nor", "input_id": "inp-nor", "source_tsnumber": 3004, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={("100", "10"): {"order_no": "100", "operation_no": "10", "confirmation_number": "CONF100"}},
            user_roles={
                "OP_OUT": "OUTSOURCE",
                "OP_ADM": "ADMINISTRATOR",
                "OP_SUB": "SUBCONT",
                "12345": "OPERATOR",
            }
        )

        ready_plan, metrics, exclusions = etl.build_sap_ready_plan(
            [inp_out, inp_adm, inp_sub, inp_nor],
            [seg_out, seg_adm, seg_sub, seg_nor],
            slices_out + slices_adm + slices_sub + slices_nor,
            plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 3)  # SUBCONT blocked
        self.assertEqual(exclusions["SUBCONT_ROLE"], 1)

        plan_by_ts = {r["source_tsnumber"]: r for r in ready_plan}

        # OUTSOURCE
        self.assertEqual(plan_by_ts[3001]["payload"]["PERNR"], "11009413")
        self.assertEqual(plan_by_ts[3001]["payload"]["PERNR_ORIGIN"], "00OP_OUT")
        self.assertTrue(plan_by_ts[3001]["enrichment_snapshot"]["is_outsource_or_admin"])

        # ADMINISTRATOR
        self.assertEqual(plan_by_ts[3002]["payload"]["PERNR"], "11009413")
        self.assertEqual(plan_by_ts[3002]["payload"]["PERNR_ORIGIN"], "00OP_ADM")
        self.assertTrue(plan_by_ts[3002]["enrichment_snapshot"]["is_outsource_or_admin"])

        # NORMAL
        self.assertEqual(plan_by_ts[3004]["payload"]["PERNR"], "00012345")
        self.assertEqual(plan_by_ts[3004]["payload"]["PERNR_ORIGIN"], "00012345")
        self.assertFalse(plan_by_ts[3004]["enrichment_snapshot"]["is_outsource_or_admin"])

    # -------------------------------------------------------------------------
    # 31. activitytype 0000 blocked
    # -------------------------------------------------------------------------
    def test_31_activitytype_0000_blocked(self):
        """Record dengan activitytype '0000' diblokir dari emisi SAP-ready."""
        inp = {"input_id": "inp-31", "source_tsnumber": 3100, "source_hash": "h31", "serialnumber": "12345", "activitytype": "0000"}
        c_seg = {
            "cleaned_segment_id": "seg-31", "input_id": "inp-31", "plant": "5100", "source_tsnumber": 3100,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": None,
            "classification_source": "NON_PRODUCTIVE", "is_productive": False, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        ready_plan, metrics, exclusions = etl.build_sap_ready_plan([inp], [c_seg], [], plant="5100", plant_timezone="Asia/Jakarta")
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["ACTIVITYTYPE_0000"], 1)

    # -------------------------------------------------------------------------
    # 32. Operator day open blocked / held
    # -------------------------------------------------------------------------
    def test_32_operator_day_open_blocked(self):
        """Operator yang memiliki record terbuka pada tanggal lokal tersebut ditahan emisinya."""
        inp = {"input_id": "inp-32", "source_tsnumber": 3200, "source_hash": "h32", "serialnumber": "OP_OPEN", "order_no": "1", "operation_no": 1}
        c_seg = {
            "cleaned_segment_id": "seg-32", "input_id": "inp-32", "plant": "5100", "source_tsnumber": 3200,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices = [{"cleaned_segment_id": "seg-32", "input_id": "inp-32", "source_tsnumber": 3200, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"}},
            open_operator_days={("OP_OPEN", date(2026, 9, 15))}
        )
        ready_plan, metrics, exclusions = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["OPERATOR_DAY_OPEN"], 1)

    # -------------------------------------------------------------------------
    # 33. Explicit staging exclusion blocked
    # -------------------------------------------------------------------------
    def test_33_explicit_staging_exclusion_blocked(self):
        """Row dengan tsnumber yang terdaftar di sap_staging_exclusion diblokir."""
        inp = {"input_id": "inp-33", "source_tsnumber": 3300, "source_hash": "h33", "serialnumber": "12345", "order_no": "1", "operation_no": 1}
        c_seg = {
            "cleaned_segment_id": "seg-33", "input_id": "inp-33", "plant": "5100", "source_tsnumber": 3300,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices = [{"cleaned_segment_id": "seg-33", "input_id": "inp-33", "source_tsnumber": 3300, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"}},
            explicit_exclusions={"3300"}
        )
        ready_plan, metrics, exclusions = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        self.assertEqual(len(ready_plan), 0)
        self.assertEqual(exclusions["EXPLICIT_STAGING_EXCLUSION"], 1)

    # -------------------------------------------------------------------------
    # 34. Enrichment snapshot drift detection & coexistence
    # -------------------------------------------------------------------------
    def test_34_enrichment_snapshot_drift_detection(self):
        """Perubahan enrichment_snapshot pada versi yang sama memicu drift detection fail-closed, dan versi baru dapat berdampingan."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-DRIFT-ENRICH"
                clean_ver = "CLEAN-F4-DRIFT-ENRICH"
                ready_ver1 = "READY-DRIFT-V1"
                ready_ver2 = "READY-DRIFT-V2"

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version=ready_ver1, created_by="tester-drift-enrich",
                )

                # Sabotase enrichment_snapshot di DB
                cur.execute(
                    """
                    UPDATE public.timesheet_sap_ready
                    SET enrichment_snapshot = '{"role": "SABOTAGED"}'::jsonb
                    WHERE sap_ready_id = (
                        SELECT sap_ready_id FROM public.timesheet_sap_ready
                        WHERE run_id = %s LIMIT 1
                    )
                    """,
                    (res1["run_id"],),
                )
                conn.commit()

                # Rerun ready_ver1 harus mendeteksi drift
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.run_execute(
                        cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=alloc_ver, clean_rule_version=clean_ver,
                        ready_version=ready_ver1, created_by="tester-drift-enrich",
                    )
                self.assertIn("enrichment_snapshot", str(ctx.exception))

                # Rerun versi baru ready_ver2 harus sukses dan berdampingan
                res2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version=ready_ver2, created_by="tester-drift-enrich-v2",
                )
                self.assertGreater(res2["inserted_sap_ready"], 0)
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 35. Cap configured vs applied metric separation
    # -------------------------------------------------------------------------
    def test_35_cap_configured_vs_cap_applied_metrics(self):
        """Memverifikasi pemisahan metric cap_configured_source_count dan cap_applied_source_count."""
        # Source 1: cap configured 10000, pre_cap 5000 -> cap configured=1, cap applied=0
        inp1 = {"input_id": "inp-35a", "source_tsnumber": 3501, "source_hash": "h35a", "serialnumber": "1", "order_no": "1", "operation_no": 1}
        seg1 = {"cleaned_segment_id": "s-35a", "input_id": "inp-35a", "plant": "5100", "source_tsnumber": 3501, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": 10000}
        slices1 = [{"cleaned_segment_id": "s-35a", "input_id": "inp-35a", "source_tsnumber": 3501, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 5000}]

        # Source 2: cap configured 5000, pre_cap 7200 -> cap configured=1, cap applied=1
        inp2 = {"input_id": "inp-35b", "source_tsnumber": 3502, "source_hash": "h35b", "serialnumber": "2", "order_no": "2", "operation_no": 1}
        seg2 = {"cleaned_segment_id": "s-35b", "input_id": "inp-35b", "plant": "5100", "source_tsnumber": 3502, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": 5000}
        slices2 = [{"cleaned_segment_id": "s-35b", "input_id": "inp-35b", "source_tsnumber": 3502, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # Source 3: uncapped
        inp3 = {"input_id": "inp-35c", "source_tsnumber": 3503, "source_hash": "h35c", "serialnumber": "3", "order_no": "3", "operation_no": 1}
        seg3 = {"cleaned_segment_id": "s-35c", "input_id": "inp-35c", "plant": "5100", "source_tsnumber": 3503, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices3 = [{"cleaned_segment_id": "s-35c", "input_id": "inp-35c", "source_tsnumber": 3503, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={
                ("1", "1"): {"order_no": "1", "operation_no": "1", "confirmation_number": "CONF1"},
                ("2", "1"): {"order_no": "2", "operation_no": "1", "confirmation_number": "CONF2"},
                ("3", "1"): {"order_no": "3", "operation_no": "1", "confirmation_number": "CONF3"},
            }
        )

        _, metrics, _ = etl.build_sap_ready_plan(
            [inp1, inp2, inp3],
            [seg1, seg2, seg3],
            slices1 + slices2 + slices3,
            plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )

        self.assertEqual(metrics["cap_configured_source_count"], 2)
        self.assertEqual(metrics["cap_applied_source_count"], 1)
        self.assertEqual(metrics["uncapped_source_count"], 1)
        self.assertEqual(metrics["total_cap_deducted_seconds"], 2200)

    # -------------------------------------------------------------------------
    # 36. Payload parity with stage_timesheet_transaction.py
    # -------------------------------------------------------------------------
    def test_36_payload_parity_with_stage_timesheet_transaction(self):
        """Memverifikasi bahwa payload SAP-ready F4 memiliki parity 100% field set, zero-padding, dan format dengan staging payload."""
        expected_fields = {
            "WERKS", "PERNR", "PERNR_ORIGIN", "RUECK", "AUFNR", "VORNR",
            "FLGAT", "PLNFL", "VORNR_B", "VORNR_R", "ZCONF_TYPE", "ARBPL",
            "LSTAR", "ISDD", "ISDZ", "IEDD", "IEDZ", "AUERU", "ZBARCODEID",
            "date_checkin", "date_checkout", "hour_checkin", "hour_checkout",
            "longdate_checkin", "longdate_checkout", "order_no", "operation_no",
            "workcentercode", "confirmationnumber", "activitytype",
            "confirmation_type", "classification_source", "classification_reason",
            "source_key", "ready_rule_version", "raw_seconds", "cleaned_seconds",
            "allocated_seconds", "cap_seconds", "sap_effective_seconds", "hours",
            "enrichment_snapshot",
        }

        inp = {"input_id": "inp-36", "source_tsnumber": 3600, "source_hash": "h36", "serialnumber": "12345", "order_no": "100", "operation_no": 10, "workcentercode": "WC36"}
        c_seg = {
            "cleaned_segment_id": "seg-36", "input_id": "inp-36", "plant": "5100", "source_tsnumber": 3600,
            "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7),
            "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG",
            "classification_source": "CANONICAL", "classification_reason": "SUFFIX_RG", "is_productive": True, "raw_seconds": 7200,
            "remaining_seconds": 7200, "cap_seconds": None,
        }
        slices = [{"cleaned_segment_id": "seg-36", "input_id": "inp-36", "source_tsnumber": 3600, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]
        enrich = mock_enrichment(
            master_orders={("100", "10"): {"order_no": "100", "operation_no": "10", "confirmation_number": "CONF100"}}
        )

        ready_plan, _, _ = etl.build_sap_ready_plan([inp], [c_seg], slices, plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich)
        p = ready_plan[0]["payload"]

        # Check all required keys exist
        for k in expected_fields:
            self.assertIn(k, p, f"Field {k} missing from payload")

        # Zero-padding checks
        self.assertEqual(len(p["PERNR"]), 8)
        self.assertEqual(len(p["PERNR_ORIGIN"]), 8)
        self.assertEqual(len(p["AUFNR"]), 12)
        self.assertEqual(len(p["VORNR"]), 4)
        self.assertEqual(len(p["ISDD"]), 8)
        self.assertEqual(len(p["ISDZ"]), 6)
        self.assertEqual(len(p["IEDD"]), 8)
        self.assertEqual(len(p["IEDZ"]), 6)

    # -------------------------------------------------------------------------
    # 37. Rerun lineage & preview persisted isolation
    # -------------------------------------------------------------------------
    def test_37_rerun_lineage_and_preview_isolation(self):
        """Execute run 1 lalu run 2 (rerun reuse) mencatat relasi timesheet_etl_run_sap_ready, dan preview masing-masing run_id menghasilkan rows, count, dan checksum identik."""
        conn = local_conn(CKP)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = etl.load_plant_config(cur, "5100")
                from_ts = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
                to_ts = datetime(2026, 9, 15, 4, 0, tzinfo=timezone.utc)
                alloc_ver = "ALLOC-F4-LINEAGE-TEST"
                clean_ver = "CLEAN-F4-LINEAGE-TEST"
                ready_ver = "READY-F4-LINEAGE-TEST"

                # Cleanup awal
                cur.execute(
                    """
                    DELETE FROM public.timesheet_etl_run_sap_ready WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                # Run 1
                res1 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version=ready_ver, created_by="test-lineage-1",
                )
                self.assertGreater(res1["inserted_sap_ready"], 0)
                self.assertEqual(res1["reused_sap_ready"], 0)
                self.assertEqual(res1["linked_sap_ready"], res1["sap_ready_count"])

                # Run 2 (Rerun identik - seluruh rows dipakai ulang)
                res2 = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=from_ts, to_ts=to_ts,
                    allocation_version=alloc_ver, clean_rule_version=clean_ver,
                    ready_version=ready_ver, created_by="test-lineage-2",
                )
                self.assertEqual(res2["inserted_sap_ready"], 0)
                self.assertEqual(res2["reused_sap_ready"], res1["sap_ready_count"])
                self.assertEqual(res2["linked_sap_ready"], res1["sap_ready_count"])
                self.assertNotEqual(res1["run_id"], res2["run_id"])

                # Preview run 1
                prev1 = etl.preview_persisted_sap_ready(
                    cur, plant="5100", run_id=res1["run_id"], ready_rule_version=ready_ver
                )
                self.assertEqual(prev1["sap_ready_count"], res1["sap_ready_count"])
                self.assertEqual(prev1["output_checksum"], res1["output_checksum"])
                self.assertEqual(prev1["total_sap_effective_seconds"], res1["total_sap_effective_seconds"])

                # Preview run 2 (harus persis sama dengan run 1)
                prev2 = etl.preview_persisted_sap_ready(
                    cur, plant="5100", run_id=res2["run_id"], ready_rule_version=ready_ver
                )
                self.assertEqual(prev2["sap_ready_count"], res2["sap_ready_count"])
                self.assertEqual(prev2["output_checksum"], res2["output_checksum"])
                self.assertEqual(prev2["total_sap_effective_seconds"], res2["total_sap_effective_seconds"])
                self.assertEqual(prev1["output_checksum"], prev2["output_checksum"])

                # Verifikasi tabel relasi timesheet_etl_run_sap_ready
                cur.execute(
                    "SELECT COUNT(*) AS c FROM public.timesheet_etl_run_sap_ready WHERE run_id = %s",
                    (res1["run_id"],),
                )
                self.assertEqual(int(cur.fetchone()["c"]), res1["sap_ready_count"])

                cur.execute(
                    "SELECT COUNT(*) AS c FROM public.timesheet_etl_run_sap_ready WHERE run_id = %s",
                    (res2["run_id"],),
                )
                self.assertEqual(int(cur.fetchone()["c"]), res2["sap_ready_count"])

                # Cleanup
                cur.execute(
                    """
                    DELETE FROM public.timesheet_etl_run_sap_ready WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_sap_ready WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 38. Fail-closed enrichment lookup failure simulations
    # -------------------------------------------------------------------------
    def test_38_lookup_fail_closed_simulation(self):
        """Lookup master order, usernfc, sap_staging_exclusion, dan open timesheet wajib fail-closed (EtlError) saat query gagal."""
        class FailingCursor:
            def __init__(self, fail_target: str):
                self.fail_target = fail_target

            def execute(self, sql, params=None):
                sql_upper = sql.upper()
                if self.fail_target == "USERNFC" and "USERNFC" in sql_upper:
                    raise psycopg2.DatabaseError("Simulated usernfc connection timeout")
                if self.fail_target == "PH3_ORDER" and ("PH3_ORDER" in sql_upper or "ORDER" in sql_upper):
                    raise psycopg2.DatabaseError("Simulated ph3_order lock timeout")
                if self.fail_target == "EXCLUSION" and "SAP_STAGING_EXCLUSION" in sql_upper:
                    raise psycopg2.DatabaseError("Simulated sap_staging_exclusion syntax error")
                if self.fail_target == "OPEN" and "TIMESHEET_TRANSACTION" in sql_upper and "LONGDATE_CHECKOUT IS NULL" in sql_upper:
                    raise psycopg2.DatabaseError("Simulated timesheet open check error")

            def fetchall(self):
                return []

        # 1. usernfc failure
        with self.assertRaises(etl.EtlError) as ctx1:
            etl.fetch_f4_enrichment_data(FailingCursor("USERNFC"), plant="5100", plant_timezone="Asia/Jakarta")
        self.assertIn("Gagal memuat usernfc", str(ctx1.exception))

        # 2. ph3_order failure
        with self.assertRaises(etl.EtlError) as ctx2:
            etl.fetch_f4_enrichment_data(FailingCursor("PH3_ORDER"), plant="5100", plant_timezone="Asia/Jakarta")
        self.assertIn("Gagal memuat master order", str(ctx2.exception))

        # 3. sap_staging_exclusion failure
        with self.assertRaises(etl.EtlError) as ctx3:
            etl.fetch_f4_enrichment_data(FailingCursor("EXCLUSION"), plant="5100", plant_timezone="Asia/Jakarta")
        self.assertIn("Gagal memuat sap_staging_exclusion", str(ctx3.exception))

        # 4. open records failure
        with self.assertRaises(etl.EtlError) as ctx4:
            etl.fetch_f4_enrichment_data(FailingCursor("OPEN"), plant="5100", plant_timezone="Asia/Jakarta")
        self.assertIn("Gagal memuat open records", str(ctx4.exception))

    # -------------------------------------------------------------------------
    # 39. Comprehensive strict value parity test
    # -------------------------------------------------------------------------
    def test_39_comprehensive_strict_value_parity(self):
        """Memverifikasi seluruh nilai field SAP hasil F4 untuk produktif RG/OV/RW, nonproduktif, OUTSOURCE, dan ADMINISTRATOR."""
        # 1. Productive RG
        inp_rg = {"input_id": "inp-rg", "source_tsnumber": 3901, "source_hash": "hrg", "serialnumber": "12345", "order_no": "10001", "operation_no": 10, "workcentercode": "WC01", "confirmationnumber": "1001RG"}
        seg_rg = {"cleaned_segment_id": "s-rg", "input_id": "inp-rg", "plant": "5100", "source_tsnumber": 3901, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 11, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "classification_reason": "CONFIRMATION_SUFFIX_RG", "is_productive": True, "raw_seconds": 10800, "remaining_seconds": 10800, "cap_seconds": None}
        slices_rg = [{"cleaned_segment_id": "s-rg", "input_id": "inp-rg", "source_tsnumber": 3901, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 11, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 10800}]

        # 2. Productive OV
        inp_ov = {"input_id": "inp-ov", "source_tsnumber": 3902, "source_hash": "hov", "serialnumber": "12345", "order_no": "10002", "operation_no": 20, "workcentercode": "WC02", "confirmationnumber": "1002OV"}
        seg_ov = {"cleaned_segment_id": "s-ov", "input_id": "inp-ov", "plant": "5100", "source_tsnumber": 3902, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 11, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 13, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "OV", "classification_source": "CANONICAL", "classification_reason": "CONFIRMATION_SUFFIX_OV", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_ov = [{"cleaned_segment_id": "s-ov", "input_id": "inp-ov", "source_tsnumber": 3902, "slice_start": dt_tz(2026, 9, 15, 11, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 13, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 3. Productive RW
        inp_rw = {"input_id": "inp-rw", "source_tsnumber": 3903, "source_hash": "hrw", "serialnumber": "12345", "order_no": "32003", "operation_no": 30, "workcentercode": "WC03", "confirmationnumber": "1003RW"}
        seg_rw = {"cleaned_segment_id": "s-rw", "input_id": "inp-rw", "plant": "5100", "source_tsnumber": 3903, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 13, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 15, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RW", "classification_source": "CANONICAL", "classification_reason": "CONFIRMATION_SUFFIX_RW", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_rw = [{"cleaned_segment_id": "s-rw", "input_id": "inp-rw", "source_tsnumber": 3903, "slice_start": dt_tz(2026, 9, 15, 13, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 15, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 4. Non-productive
        inp_np = {"input_id": "inp-np", "source_tsnumber": 3904, "source_hash": "hnp", "serialnumber": "12345", "activitytype": "CLEANING", "workcentercode": "WC04"}
        seg_np = {"cleaned_segment_id": "s-np", "input_id": "inp-np", "plant": "5100", "source_tsnumber": 3904, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 15, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 17, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": None, "classification_source": "NON_PRODUCTIVE", "classification_reason": "NON_PRODUCTIVE_ACTIVITY", "is_productive": False, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}

        # 5. OUTSOURCE
        inp_out = {"input_id": "inp-out", "source_tsnumber": 3905, "source_hash": "hout", "serialnumber": "OS99", "order_no": "10005", "operation_no": 10, "workcentercode": "WC05", "confirmationnumber": "1005RG"}
        seg_out = {"cleaned_segment_id": "s-out", "input_id": "inp-out", "plant": "5100", "source_tsnumber": 3905, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "classification_reason": "CONFIRMATION_SUFFIX_RG", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_out = [{"cleaned_segment_id": "s-out", "input_id": "inp-out", "source_tsnumber": 3905, "slice_start": dt_tz(2026, 9, 15, 8, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 10, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        # 6. ADMINISTRATOR
        inp_adm = {"input_id": "inp-adm", "source_tsnumber": 3906, "source_hash": "hadm", "serialnumber": "AD88", "order_no": "10006", "operation_no": 20, "workcentercode": "WC06", "confirmationnumber": "1006RG"}
        seg_adm = {"cleaned_segment_id": "s-adm", "input_id": "inp-adm", "plant": "5100", "source_tsnumber": 3906, "segment_sequence": 1, "segment_start": dt_tz(2026, 9, 15, 10, 0, 0, 7), "segment_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "segment_kind": "WORK", "confirmation_type": "RG", "classification_source": "CANONICAL", "classification_reason": "CONFIRMATION_SUFFIX_RG", "is_productive": True, "raw_seconds": 7200, "remaining_seconds": 7200, "cap_seconds": None}
        slices_adm = [{"cleaned_segment_id": "s-adm", "input_id": "inp-adm", "source_tsnumber": 3906, "slice_start": dt_tz(2026, 9, 15, 10, 0, 0, 7), "slice_end": dt_tz(2026, 9, 15, 12, 0, 0, 7), "local_date": date(2026, 9, 15), "allocated_seconds": 7200}]

        enrich = mock_enrichment(
            master_orders={
                ("10001", "10"): {"order_no": "10001", "operation_no": "10", "confirmation_number": "RUECK_RG", "sequence_category": "0", "sequence_number": "000000", "branch_operation_no": "0005", "return_operation_no": "0015"},
                ("10002", "20"): {"order_no": "10002", "operation_no": "20", "confirmation_number": "RUECK_OV", "sequence_category": "0", "sequence_number": "000000", "branch_operation_no": "", "return_operation_no": ""},
                ("32003", "30"): {"order_no": "32003", "operation_no": "30", "confirmation_number": "RUECK_RW", "sequence_category": "1", "sequence_number": "000010", "branch_operation_no": "0020", "return_operation_no": "0040"},
                ("10005", "10"): {"order_no": "10005", "operation_no": "10", "confirmation_number": "RUECK_OS", "sequence_category": "0", "sequence_number": "000000", "branch_operation_no": "", "return_operation_no": ""},
                ("10006", "20"): {"order_no": "10006", "operation_no": "20", "confirmation_number": "RUECK_AD", "sequence_category": "0", "sequence_number": "000000", "branch_operation_no": "", "return_operation_no": ""},
            },
            user_roles={
                "12345": "OPERATOR",
                "OS99": "OUTSOURCE",
                "AD88": "ADMINISTRATOR",
            }
        )

        ready_plan, _, _ = etl.build_sap_ready_plan(
            [inp_rg, inp_ov, inp_rw, inp_np, inp_out, inp_adm],
            [seg_rg, seg_ov, seg_rw, seg_np, seg_out, seg_adm],
            slices_rg + slices_ov + slices_rw + slices_out + slices_adm,
            plant="5100", plant_timezone="Asia/Jakarta", enrichment_data=enrich
        )
        self.assertEqual(len(ready_plan), 6)
        by_ts = {r["source_tsnumber"]: r["payload"] for r in ready_plan}

        # 1. Verifikasi Produktif RG
        p_rg = by_ts[3901]
        self.assertEqual(p_rg["WERKS"], "5100")
        self.assertEqual(p_rg["PERNR"], "00012345")
        self.assertEqual(p_rg["PERNR_ORIGIN"], "00012345")
        self.assertEqual(p_rg["AUFNR"], "000000010001")
        self.assertEqual(p_rg["VORNR"], "0010")
        self.assertEqual(p_rg["RUECK"], "RUECK_RG")
        self.assertEqual(p_rg["FLGAT"], "0")
        self.assertEqual(p_rg["PLNFL"], "000000")
        self.assertEqual(p_rg["VORNR_B"], "0005")
        self.assertEqual(p_rg["VORNR_R"], "0015")
        self.assertEqual(p_rg["ZCONF_TYPE"], "RG")
        self.assertEqual(p_rg["ARBPL"], "WC01")
        self.assertEqual(p_rg["LSTAR"], "")
        self.assertEqual(p_rg["ISDD"], "20260915")
        self.assertEqual(p_rg["ISDZ"], "080000")
        self.assertEqual(p_rg["IEDD"], "20260915")
        self.assertEqual(p_rg["IEDZ"], "110000")
        self.assertEqual(p_rg["hours"], 3.0)

        # 2. Verifikasi Produktif OV
        p_ov = by_ts[3902]
        self.assertEqual(p_ov["WERKS"], "5100")
        self.assertEqual(p_ov["PERNR"], "00012345")
        self.assertEqual(p_ov["AUFNR"], "000000010002")
        self.assertEqual(p_ov["VORNR"], "0020")
        self.assertEqual(p_ov["RUECK"], "RUECK_OV")
        self.assertEqual(p_ov["ZCONF_TYPE"], "OV")
        self.assertEqual(p_ov["ARBPL"], "WC02")
        self.assertEqual(p_ov["LSTAR"], "")
        self.assertEqual(p_ov["hours"], 2.0)

        # 3. Verifikasi Produktif RW
        p_rw = by_ts[3903]
        self.assertEqual(p_rw["WERKS"], "5100")
        self.assertEqual(p_rw["PERNR"], "00012345")
        self.assertEqual(p_rw["AUFNR"], "000000032003")
        self.assertEqual(p_rw["VORNR"], "0030")
        self.assertEqual(p_rw["RUECK"], "RUECK_RW")
        self.assertEqual(p_rw["FLGAT"], "1")
        self.assertEqual(p_rw["PLNFL"], "000010")
        self.assertEqual(p_rw["VORNR_B"], "0020")
        self.assertEqual(p_rw["VORNR_R"], "0040")
        self.assertEqual(p_rw["ZCONF_TYPE"], "RW")
        self.assertEqual(p_rw["ARBPL"], "WC03")
        self.assertEqual(p_rw["LSTAR"], "")
        self.assertEqual(p_rw["hours"], 2.0)

        # 4. Verifikasi Non-produktif
        p_np = by_ts[3904]
        self.assertEqual(p_np["WERKS"], "5100")
        self.assertEqual(p_np["PERNR"], "00012345")
        self.assertEqual(p_np["PERNR_ORIGIN"], "00012345")
        self.assertEqual(p_np["LSTAR"], "CLEANING")
        self.assertEqual(p_np["AUFNR"], "")
        self.assertEqual(p_np["VORNR"], "")
        self.assertEqual(p_np["RUECK"], "")
        self.assertEqual(p_np["FLGAT"], "")
        self.assertEqual(p_np["PLNFL"], "")
        self.assertEqual(p_np["VORNR_B"], "")
        self.assertEqual(p_np["VORNR_R"], "")
        self.assertEqual(p_np["ZCONF_TYPE"], "")
        self.assertEqual(p_np["ARBPL"], "WC04")
        self.assertEqual(p_np["hours"], 2.0)

        # 5. Verifikasi OUTSOURCE
        p_os = by_ts[3905]
        self.assertEqual(p_os["WERKS"], "5100")
        self.assertEqual(p_os["PERNR"], "11009413")
        self.assertEqual(p_os["PERNR_ORIGIN"], "0000OS99")
        self.assertEqual(p_os["AUFNR"], "000000010005")
        self.assertEqual(p_os["VORNR"], "0010")
        self.assertEqual(p_os["RUECK"], "RUECK_OS")
        self.assertEqual(p_os["ZCONF_TYPE"], "RG")

        # 6. Verifikasi ADMINISTRATOR
        p_ad = by_ts[3906]
        self.assertEqual(p_ad["WERKS"], "5100")
        self.assertEqual(p_ad["PERNR"], "11009413")
        self.assertEqual(p_ad["PERNR_ORIGIN"], "0000AD88")
        self.assertEqual(p_ad["AUFNR"], "000000010006")
        self.assertEqual(p_ad["VORNR"], "0020")
        self.assertEqual(p_ad["RUECK"], "RUECK_AD")
        self.assertEqual(p_ad["ZCONF_TYPE"], "RG")


if __name__ == "__main__":
    unittest.main(verbosity=2)

