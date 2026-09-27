#!/usr/bin/env python3
"""run_local_lab_integration.py

Integration test suite untuk laboratorium PostgreSQL lokal terisolasi:
1. Exact migration verification (Balikpapan & Cikupa).
2. Four derived time columns contract.
3. Controller & Service integration (updateTimesheetadmin & timesheetConfirmationService).
4. Freeze enforcement across all statuses & reject DELETE.
5. Break deduction, overnight split, max duration cap.
6. Actual data interval allocation & invariant verification on both plants.
7. Outbox reservation & staging failure retry.
8. Stage --dry-run immutability (fingerprint proof: 0 mutasi, 0 freeze, 0 reconcile).
9. Local staging execution with window [2026-09-08T00:00:00, 2026-09-09T00:00:00).
10. Poster --dry-run immutability & HTTP spy (assert 0 HTTP calls, identical DB fingerprint).

ATURAN KEAMANAN:
- Fail-closed jika target host bukan localhost/loopback.
- Target DB wajib database allowlist lokal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, date, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import psycopg2
import psycopg2.extras

# Resolve repository root secara dinamis dari lokasi file
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "jobs" / "sap_staging"))

from timesheet_allocation import Record, allocate_records
from timesheet_normalization import normalize_timesheet_rows
import stage_timesheet_transaction
from stage_timesheet_transaction import (
    allocate_staging_rows,
    reserve_staging_rows,
    list_pending_reservations,
    retry_staging_reservations,
    validate_manual_window,
    assert_source_runtime_context,
    assert_source_outbox_schema,
)
from sap_staging_common import load_sap_rules, assert_staging_schema
import post_sap_staging

LOCAL_HOST = "localhost"
LOCAL_PORT = 5432
LOCAL_USER = "postgres"

os.environ["DB_HOST"] = LOCAL_HOST
os.environ["DB_PORT"] = str(LOCAL_PORT)
os.environ["DB_NAME"] = "mps_timesheet_ckp_test"
os.environ["DB_USER"] = LOCAL_USER
os.environ["SAP_STAGING_DB_HOST"] = LOCAL_HOST
os.environ["SAP_STAGING_DB_PORT"] = str(LOCAL_PORT)
os.environ["SAP_STAGING_DB_NAME"] = "mps_sap_staging_test"
os.environ["SAP_STAGING_DB_USER"] = LOCAL_USER
os.environ["PLANT_SSB"] = "5100"


def get_conn(dbname: str, autocommit: bool = True):
    assert dbname in ("mps_timesheet_bpn_test", "mps_timesheet_ckp_test", "mps_sap_staging_test", "mps_timesheet_lab")
    conn = psycopg2.connect(host=LOCAL_HOST, port=LOCAL_PORT, dbname=dbname, user=LOCAL_USER)
    with conn.cursor() as cur:
        cur.execute("SELECT inet_server_addr()")
        addr = cur.fetchone()[0]
        if addr is not None and str(addr).strip() not in ("127.0.0.1", "::1"):
            conn.close()
            raise RuntimeError(f"Koneksi {dbname} bukan loopback: inet_server_addr={addr}")
    conn.commit()
    conn.autocommit = autocommit
    return conn


# --------------------------------------------------------------------------
# Clean state terpusat.
#
# Review menemukan reset sebelumnya hanya menyentuh sebagian tabel
# (sap_staging_exclusion dan timesheet_correction_audit terlewat), sehingga
# sisa baris dari test sebelumnya bisa membuat hasil terlihat hijau padahal
# state kotor. Daftar di bawah harus MENCAKUP SELURUH tabel state mutable.
# --------------------------------------------------------------------------
STAGING_STATE_TABLES = [
    "sap_stage_cursor",
    "sap_staging_eligibility_audit",
    "sap_staging_exclusion",
    "sap_staging_source",
    "sap_timesheet_staging",
]
SOURCE_STATE_TABLES = [
    "timesheet_staging_freeze",
    "timesheet_staging_outbox",
]
# timesheet_correction_audit SENGAJA append-only (trigger
# timesheet_correction_audit_append_only menolak DELETE). Audit ledger tidak
# boleh direset; ia hanya dilaporkan sebagai baseline.
APPEND_ONLY_STATE_TABLES = [
    "timesheet_correction_audit",
]


def reset_local_state(source_db: str = "mps_timesheet_ckp_test") -> dict:
    """Kosongkan SELURUH tabel state lab yang boleh direset, lalu BUKTIKAN.

    Fail-closed: bila satu tabel masih berisi baris setelah DELETE, naikkan
    RuntimeError — jangan biarkan test berjalan di atas state kotor.

    Tabel append-only (audit koreksi) tidak dihapus; jumlahnya dikembalikan
    sebagai baseline supaya pemanggil bisa memverifikasi pertumbuhan ledger.
    """
    residue = {}

    stg = get_conn("mps_sap_staging_test", autocommit=False)
    with stg.cursor() as cur:
        for tbl in STAGING_STATE_TABLES:
            cur.execute(f"DELETE FROM public.{tbl};")
    stg.commit()
    with stg.cursor() as cur:
        for tbl in STAGING_STATE_TABLES:
            cur.execute(f"SELECT count(*) FROM public.{tbl}")
            n = cur.fetchone()[0]
            if n:
                residue[f"mps_sap_staging_test.{tbl}"] = n
    stg.close()

    src = get_conn(source_db, autocommit=False)
    with src.cursor() as cur:
        for tbl in SOURCE_STATE_TABLES:
            cur.execute(f"DELETE FROM public.{tbl};")
    src.commit()
    with src.cursor() as cur:
        for tbl in SOURCE_STATE_TABLES:
            cur.execute(f"SELECT count(*) FROM public.{tbl}")
            n = cur.fetchone()[0]
            if n:
                residue[f"{source_db}.{tbl}"] = n

    baseline = {}
    with src.cursor() as cur:
        for tbl in APPEND_ONLY_STATE_TABLES:
            cur.execute(f"SELECT count(*) FROM public.{tbl}")
            baseline[f"{source_db}.{tbl}"] = cur.fetchone()[0]
    src.close()

    if residue:
        detail = ", ".join(f"{k}={v}" for k, v in residue.items())
        raise RuntimeError(
            f"reset_local_state gagal — tabel state masih berisi baris: {detail}"
        )
    return baseline


def run_test_suite():
    print("=" * 75)
    print("RUNNING REVISED LOCAL LAB INTEGRATION TESTS ON LOCALHOST")
    print(f"Repository Root: {REPO_ROOT}")
    print("=" * 75)

    test_results = {}

    # Set local test cutoff dates in plant_config so staging window tests can run
    for db in ["mps_timesheet_bpn_test", "mps_timesheet_ckp_test"]:
        conn = get_conn(db, autocommit=True)
        with conn.cursor() as cur:
            cur.execute("UPDATE public.plant_config SET timesheet_allocation_cutoff_date = '2026-09-01' WHERE id = 1;")
        conn.close()

    # --------------------------------------------------------------------------
    # 1. Exact Migration Verification
    # --------------------------------------------------------------------------

    print("\n[Test 1] Exact Migration Verification:")
    for db in ["mps_timesheet_bpn_test", "mps_timesheet_ckp_test"]:
        conn = get_conn(db)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT filename FROM public.schema_migrations WHERE filename LIKE '20260922%' ORDER BY filename"
            )
            rows = [r[0] for r in cur.fetchall()]
            assert "20260922_timesheet_derived_time_contract.sql" in rows
            assert "20260922b_timesheet_freeze_and_audit.sql" in rows
            print(f"  {db}: applied migrations = {rows}")
        conn.close()
    test_results["test_1_migrations"] = "PASSED"
    print("  => Test 1 PASSED.")

    # --------------------------------------------------------------------------
    # 2. Four Derived Time Columns Contract
    # --------------------------------------------------------------------------
    print("\n[Test 2] Four Derived Time Columns Contract:")
    for db, plant, tz_name in [("mps_timesheet_bpn_test", "5051", "Asia/Makassar"), ("mps_timesheet_ckp_test", "5100", "Asia/Jakarta")]:
        conn = get_conn(db)
        tz = ZoneInfo(tz_name)
        with conn.cursor() as cur:
            cur.execute("SELECT snssb FROM public.usernfc WHERE snssb IS NOT NULL LIMIT 1")
            valid_sn = cur.fetchone()[0]

            test_in = datetime(2026, 9, 10, 8, 30, 0, tzinfo=tz)
            test_out = datetime(2026, 9, 10, 12, 0, 0, tzinfo=tz)
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                    plant, serialnumber, activitytype, order_no, longdate_checkin, longdate_checkout, duration
                ) VALUES (
                    %s, %s, 'M1', '999901', %s, %s, 3.5
                ) RETURNING tsnumber, date_checkin, hour_checkin, date_checkout, hour_checkout
                """,
                (plant, valid_sn, test_in, test_out),
            )
            ts_id, d_in, h_in, d_out, h_out = cur.fetchone()
            assert str(d_in) == "10/09/2026"
            assert str(h_in) == "08:30"
            assert str(d_out) == "10/09/2026"
            assert str(h_out) == "12:00"

            # Update longdate to NULL -> date and hour must become NULL
            cur.execute("SET mps.correction_actor = 'test_actor'")
            cur.execute("SET mps.correction_reason = 'test_nullify'")
            cur.execute(
                """
                UPDATE public.timesheet_transaction
                SET longdate_checkout = NULL
                WHERE tsnumber = %s
                RETURNING date_checkout, hour_checkout
                """,
                (ts_id,),
            )
            d_out, h_out = cur.fetchone()
            assert d_out is None and h_out is None, "Derived checkout must be NULL when longdate_checkout is NULL"

            # Cleanup
            cur.execute("SET mps.correction_actor = 'test_actor'")
            cur.execute("SET mps.correction_reason = 'cleanup'")
            cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (ts_id,))
        conn.close()
    test_results["test_2_derived_columns"] = "PASSED"
    print("  => Test 2 PASSED.")

    # --------------------------------------------------------------------------
    # 3. Controller & Service Integration Tests (Node.js runtime paths)
    # --------------------------------------------------------------------------
    print("\n[Test 3] Controller & Service Integration Tests (Actual Node runtime):")
    script_path = REPO_ROOT / "database" / "tests" / "timesheet" / "test_timesheet_controller_integration.js"
    res = subprocess.run(
        ["node", str(script_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(REPO_ROOT),
    )
    clean_stdout = [line.encode("ascii", "replace").decode("ascii") for line in res.stdout.strip().splitlines()]
    if res.returncode != 0:
        print(f"  STDOUT:\n" + "\n".join("    " + l for l in clean_stdout))
        stderr_clean = res.stderr.encode("ascii", "replace").decode("ascii")
        print(f"  STDERR:\n{stderr_clean}")
        raise AssertionError(
            f"Controller integration tests FAILED (returncode={res.returncode})"
        )
    # Count passing subtests from Node test runner TAP output (lines starting with "ok ")
    passed_subtests = sum(1 for l in clean_stdout if l.strip().startswith("ok "))
    failed_subtests = sum(1 for l in clean_stdout if l.strip().startswith("not ok "))
    assert failed_subtests == 0, (
        f"Node controller integration: {failed_subtests} FAILED subtests:\n"
        + "\n".join("    " + l for l in clean_stdout if "not ok" in l)
    )
    print("  Node controller & service integration tests output:")
    for l in clean_stdout:
        print("    " + l)
    print(f"  Subtests: {passed_subtests} passed, {failed_subtests} failed.")
    test_results["test_3_controller_service_integration"] = "PASSED"
    print("  => Test 3 PASSED.")



    # --------------------------------------------------------------------------
    # 4. Freeze Enforcement & Reject DELETE
    # --------------------------------------------------------------------------
    print("\n[Test 4] Freeze Enforcement across all staging statuses & reject DELETE:")
    freeze_statuses = ["STAGING_RESERVED", "PENDING", "POSTING", "POSTED", "FAILED", "SKIPPED"]
    for db in ["mps_timesheet_bpn_test", "mps_timesheet_ckp_test"]:
        conn = get_conn(db, autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id = 1")
            plant, tz_name = cur.fetchone()
            tz = ZoneInfo(tz_name)
            cur.execute("SELECT snssb FROM public.usernfc LIMIT 1")
            valid_sn = cur.fetchone()[0]

            for st in freeze_statuses:
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction (
                        plant, serialnumber, activitytype, order_no, longdate_checkin, longdate_checkout, duration
                    ) VALUES (
                        %s, %s, 'M1', 'ORD_FRZ', %s, %s, 1.00
                    ) RETURNING tsnumber
                    """,
                    (plant, valid_sn, datetime(2026, 9, 10, 8, 0, 0, tzinfo=tz), datetime(2026, 9, 10, 9, 0, 0, tzinfo=tz)),
                )
                ts_id = cur.fetchone()[0]

                cur.execute(
                    """
                    INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, note)
                    VALUES (%s, %s, %s, 'test freeze')
                    """,
                    (ts_id, plant, st),
                )
                conn.commit()

                # Payroll update must be rejected
                rejected = False
                try:
                    cur.execute("SET mps.correction_actor = 'admin'")
                    cur.execute("SET mps.correction_reason = 'koreksi'")
                    cur.execute("UPDATE public.timesheet_transaction SET order_no = 'ORD_MUTATED' WHERE tsnumber = %s", (ts_id,))
                    conn.commit()
                except Exception:
                    rejected = True
                    conn.rollback()
                assert rejected, f"Status {st} must freeze row against payroll updates"

                # DELETE must be rejected
                del_rejected = False
                try:
                    cur.execute("SET mps.correction_actor = 'admin'")
                    cur.execute("SET mps.correction_reason = 'delete frozen'")
                    cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (ts_id,))
                    conn.commit()
                except Exception:
                    del_rejected = True
                    conn.rollback()
                assert del_rejected, f"Status {st} must reject DELETE"

                # Non-payroll update allowed
                cur.execute("UPDATE public.timesheet_transaction SET note = 'non payroll note' WHERE tsnumber = %s", (ts_id,))
                conn.commit()

                cur.execute("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber = %s", (ts_id,))
                cur.execute("SET mps.correction_actor = 'test_actor'")
                cur.execute("SET mps.correction_reason = 'cleanup'")
                cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (ts_id,))
                conn.commit()
        conn.close()
    test_results["test_4_freeze_and_delete"] = "PASSED"
    print("  => Test 4 PASSED.")

    # --------------------------------------------------------------------------
    # 5. Break deduction, Overtime split, Max duration
    # --------------------------------------------------------------------------
    print("\n[Test 5] Break deduction, Overtime split, Max duration:")
    rules = {
        "break_windows": [{"start": "12:00", "end": "13:00", "days": [0, 1, 2, 3, 4, 5, 6]}],
        "max_record_minutes": {"timesheet": {"M1": 120}},
    }
    test_rows = [{
        "tsnumber": 1001,
        "serialnumber": "OP_BREAK",
        "activitytype": "M1",
        "order_no": "ORD_01",
        "start": datetime(2026, 9, 10, 11, 0, 0),
        "end": datetime(2026, 9, 10, 15, 0, 0),
    }]
    norm = normalize_timesheet_rows(test_rows, rules, clip_start=datetime(2026, 9, 10, 0, 0), clip_end=datetime(2026, 9, 11, 0, 0))
    alloc = allocate_staging_rows(norm)
    assert alloc[0]["raw_seconds"] == 10800  # 4h - 1h break = 3h = 10800s
    assert alloc[0]["sap_effective_seconds"] == 7200  # cap 2h = 7200s

    rec_ot = Record(
        tsnumber=1002, serialnumber="OP_OT", start=datetime(2026, 9, 10, 22, 0, 0),
        end=datetime(2026, 9, 11, 2, 0, 0), order_no="ORD_OT", activitytype=""
    )
    res_ot = allocate_records([rec_ot])
    assert len(res_ot.segments) == 2
    assert abs(sum(s.allocated_seconds for s in res_ot.segments) - 14400) <= 60
    test_results["test_5_break_split"] = "PASSED"
    print("  => Test 5 PASSED.")

    # --------------------------------------------------------------------------
    # 6. Actual Data Invariant & Comparison Tables in mps_timesheet_lab
    # --------------------------------------------------------------------------
    print("\n[Test 6] Actual Data Allocation & Invariant Verification:")
    lab_conn = get_conn("mps_timesheet_lab")
    lab_cur = lab_conn.cursor()

    for db, plant, tz_name, res_schema in [
        ("mps_timesheet_bpn_test", "5051", "Asia/Makassar", "bpn_result"),
        ("mps_timesheet_ckp_test", "5100", "Asia/Jakarta", "ckp_result"),
    ]:
        conn = get_conn(db)
        plant_rules = load_sap_rules(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT t.tsnumber, t.serialnumber, t.activitytype, t.order_no,
                       date_trunc('second', t.longdate_checkin  AT TIME ZONE %s) AS ci,
                       date_trunc('second', t.longdate_checkout AT TIME ZONE %s) AS co
                FROM public.timesheet_transaction t
                WHERE t.plant = %s
                  AND t.longdate_checkin IS NOT NULL
                  AND t.longdate_checkout IS NOT NULL
                  AND t.longdate_checkout > t.longdate_checkin
                  AND (t.longdate_checkin AT TIME ZONE %s)::date = '2026-09-08'
                  AND COALESCE(t.state_flag, 0) <> 5
                  AND COALESCE(t.activitytype, '') <> '0000'
                ORDER BY t.serialnumber, t.longdate_checkin
            """, (tz_name, tz_name, plant, tz_name))
            db_rows = cur.fetchall()

        input_rows = [{
            "tsnumber": r["tsnumber"],
            "serialnumber": r["serialnumber"] or "",
            "activitytype": r["activitytype"] or "",
            "order_no": r["order_no"] or "",
            "start": r["ci"],
            "end": r["co"],
        } for r in db_rows]

        norm = normalize_timesheet_rows(input_rows, plant_rules, clip_start=datetime(2026, 9, 8, 0, 0), clip_end=datetime(2026, 9, 9, 0, 0))
        alloc = allocate_staging_rows(norm)

        records = [Record(
            tsnumber=r["tsnumber"], serialnumber=r["serialnumber"],
            start=r["alloc_start"], end=r["alloc_end"],
            activitytype=r["activitytype"], order_no=r["order_no"]
        ) for r in norm]
        by_ts = {r.tsnumber: r for r in records}
        res = allocate_records(records)

        per_day = {}
        for seg in res.segments:
            if by_ts[seg.tsnumber].is_productive:
                key = (seg.serialnumber, seg.allocation_date)
                per_day[key] = per_day.get(key, 0) + seg.allocated_seconds

        invariant_violations = 0
        for key, union_s in res.union_seconds.items():
            if per_day.get(key, 0) != union_s:
                invariant_violations += 1

        assert invariant_violations == 0, f"{invariant_violations} invariant violations found in {db}"
        print(f"  {db}: 0 violations across {len(res.union_seconds)} operator-days, {len(alloc)} allocated segments.")

        lab_cur.execute(f"DELETE FROM {res_schema}.comparison_summary;")
        for a in alloc:
            raw_sec = int(a.get("raw_seconds") or 0)
            alloc_sec = int(a.get("allocated_seconds") or 0)
            cap_sec = int(a.get("cap_minutes") or 0) * 60 if a.get("cap_minutes") else None
            eff_sec = int(a.get("sap_effective_seconds") or 0)
            reasons = []
            if alloc_sec < raw_sec:
                reasons.append(f"overlap_allocated(-{raw_sec - alloc_sec}s)")
            if cap_sec and alloc_sec > cap_sec:
                reasons.append(f"cap_limit(-{alloc_sec - cap_sec}s)")
            reason_str = ", ".join(reasons) if reasons else "no_reduction"
            lab_cur.execute(f"""
                INSERT INTO {res_schema}.comparison_summary (
                    tsnumber, operator, tanggal, raw_start, raw_end,
                    raw_seconds, allocated_seconds, cap_seconds,
                    sap_effective_seconds, reduction_reason, freeze_status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tsnumber) DO NOTHING
            """, (
                a["tsnumber"], a["serialnumber"], a["start"].date(),
                a["start"], a["end"], raw_sec, alloc_sec, cap_sec,
                eff_sec, reason_str, "READY_STAGING"
            ))
        conn.close()

    lab_conn.close()
    test_results["test_6_actual_allocation"] = "PASSED"
    print("  => Test 6 PASSED.")

    # --------------------------------------------------------------------------
    # 7. Outbox Reservation & Retry Simulation
    # --------------------------------------------------------------------------
    print("\n[Test 7] Outbox Reservation & Retry Simulation:")
    source_conn = get_conn("mps_timesheet_ckp_test", autocommit=False)
    with source_conn.cursor() as cur:
        cur.execute("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber IN (999101, 999102)")
        cur.execute("DELETE FROM public.timesheet_staging_outbox WHERE batch_id LIKE 'test-batch-%'")
    source_conn.commit()

    staging_conn = get_conn("mps_sap_staging_test")
    with staging_conn.cursor() as cur:
        cur.execute("DELETE FROM public.sap_timesheet_staging WHERE source_ref_id IN ('999101', '999102')")
    staging_conn.commit()
    staging_conn.close()

    batch_id = "test-batch-" + datetime.now().strftime("%Y%m%d%H%M%S")
    def make_mock(ref_id):
        return {
            "source_system": "TIMESHEET",
            "source_key": f"5100:{ref_id}",
            "is_correction": False,
            "source_ref_id": str(ref_id),
            "werks": "5100",
            "pernr": "19722",
            "pernr_origin": "19722",
            "rueck": "123",
            "aufnr": "999901",
            "vornr": "0010",
            "flgat": "",
            "plnfl": "00",
            "vornr_b": "",
            "vornr_r": "",
            "zconf_type": "FINAL",
            "arbpl": "WS01",
            "lstar": "M1",
            "isdd": "20260910",
            "isdz": "080000",
            "iedd": "20260910",
            "iedz": "090000",
            "aueru": "X",
            "zbarcodeid": "",
            "bucket_start": datetime(2026, 9, 10, 8, 0, 0),
            "synthetic_start": datetime(2026, 9, 10, 8, 0, 0),
            "synthetic_end": datetime(2026, 9, 10, 9, 0, 0),
            "total_seconds": 3600,
            "source_row_count": 1,
            "source_min_start": datetime(2026, 9, 10, 8, 0, 0),
            "source_max_end": datetime(2026, 9, 10, 9, 0, 0),
            "provenance_snapshot": {"raw": 3600, "alloc": 3600, "sec": 3600},
            "raw_seconds": 3600,
            "allocated_seconds": 3600,
            "sap_effective_seconds": 3600,
        }
    bid, reserved_cnt = reserve_staging_rows(source_conn, [make_mock(999101), make_mock(999102)], batch_id=batch_id)
    assert bid == batch_id and reserved_cnt == 2

    staging_conn = get_conn("mps_sap_staging_test", autocommit=False)
    retried = retry_staging_reservations(source_conn, staging_conn, plant="5100")
    assert retried >= 1

    with source_conn.cursor() as cur:
        cur.execute("SELECT status FROM public.timesheet_staging_outbox WHERE batch_id = %s", (batch_id,))
        assert cur.fetchone()[0] == "STAGED"
        cur.execute("DELETE FROM public.timesheet_staging_outbox WHERE batch_id = %s", (batch_id,))
        cur.execute("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber IN (999101, 999102)")
    source_conn.commit()
    source_conn.close()
    staging_conn.close()
    test_results["test_7_outbox_retry"] = "PASSED"
    print("  => Test 7 PASSED.")

    # --------------------------------------------------------------------------
    # 8. Stage --dry-run Immutability Test (Item 3)
    # --------------------------------------------------------------------------
    print("\n[Test 8] Stage --dry-run Immutability Verification (Checksum Fingerprint):")

    # Tables to fingerprint: PK used for stable ordering.
    SOURCE_FINGERPRINT_TABLES = [
        ("mps_timesheet_ckp_test", "timesheet_transaction", "tsnumber"),
        ("mps_timesheet_ckp_test", "timesheet_staging_freeze", "tsnumber"),
        ("mps_timesheet_ckp_test", "timesheet_staging_outbox", "id"),
    ]
    STAGING_FINGERPRINT_TABLES = [
        ("mps_sap_staging_test", "sap_timesheet_staging", "id"),
        ("mps_sap_staging_test", "sap_staging_source", "id"),
        ("mps_sap_staging_test", "sap_staging_eligibility_audit", "source_key"),
        ("mps_sap_staging_test", "sap_stage_cursor", "source_system"),
    ]

    def get_checksum_fingerprint():
        fp = {}
        for dbname, tbl, pk in SOURCE_FINGERPRINT_TABLES + STAGING_FINGERPRINT_TABLES:
            conn_fp = get_conn(dbname)
            with conn_fp.cursor() as cur:
                cur.execute(f"""
                    SELECT
                        count(*) AS cnt,
                        md5(string_agg(row_to_json(t)::text, '' ORDER BY {pk}::text)) AS chk
                    FROM (SELECT * FROM public.{tbl} ORDER BY {pk}) t
                """)
                cnt, chk = cur.fetchone()
                fp[f"{dbname}.{tbl}"] = (cnt, chk)
            conn_fp.close()
        return fp

    fp_before = get_checksum_fingerprint()
    print("  Fingerprint sebelum dry-run:")
    for k, (cnt, chk) in fp_before.items():
        print(f"    {k}: count={cnt} md5={chk}")

    dry_args = argparse.Namespace(
        from_ts="2026-09-08T00:00:00",
        to_ts="2026-09-09T00:00:00",
        limit=1000,
        dry_run=True,
        retry_reservations=False,
        loop=0,
    )
    dry_result = stage_timesheet_transaction.run_once(dry_args)
    assert dry_result is True, "Dry-run should report candidates prepared"

    fp_after = get_checksum_fingerprint()
    print("  Fingerprint sesudah dry-run:")
    for k, (cnt, chk) in fp_after.items():
        print(f"    {k}: count={cnt} md5={chk}")

    # Assert EVERY table: both count AND checksum must be identical
    mismatches = []
    for k in fp_before:
        if fp_before[k] != fp_after[k]:
            mismatches.append(
                f"    {k}: before={fp_before[k]} after={fp_after[k]}"
            )
    assert not mismatches, "Dry-run violated immutability (count+checksum):\n" + "\n".join(mismatches)
    test_results["test_8_stage_dry_run_immutability"] = "PASSED"
    print("  => Test 8 PASSED (100% identical count + md5 checksum per table).")



    # --------------------------------------------------------------------------
    # 9. Local Staging Execution (Item 8/2)
    # --------------------------------------------------------------------------
    print("\n[Test 9] Local Staging Execution [2026-09-08T00:00:00, 2026-09-09T00:00:00):")

    # --- Clean state terpusat: SELURUH tabel state, diverifikasi kosong ---
    reset_local_state("mps_timesheet_ckp_test")

    # --- Derive expected source_ref_id set dynamically from fetch_rows preview ---
    from datetime import datetime as _dt
    from_ts_val = _dt.fromisoformat("2026-09-08T00:00:00")
    to_ts_val = _dt.fromisoformat("2026-09-09T00:00:00")
    preview_rows, _ = stage_timesheet_transaction.fetch_rows(from_ts_val, to_ts_val, limit=99999)
    expected_source_ref_ids = {str(r["source_ref_id"]) for r in preview_rows}
    expected_total = len(preview_rows)
    print(f"  Preview: {expected_total} candidate rows, {len(expected_source_ref_ids)} distinct source_ref_ids")
    assert expected_total > 0, "fetch_rows preview returned 0 rows — window is empty"

    stage_args = argparse.Namespace(
        from_ts="2026-09-08T00:00:00",
        to_ts="2026-09-09T00:00:00",
        limit=5000,
        dry_run=False,
        retry_reservations=False,
        loop=0,
    )
    staged_ok = stage_timesheet_transaction.run_once(stage_args)
    assert staged_ok is True, "Staging run_once should succeed"

    # --- Assert staged rows match preview ---
    stg_conn = get_conn("mps_sap_staging_test")
    with stg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM public.sap_timesheet_staging")
        staged_rows = cur.fetchall()
        assert len(staged_rows) == expected_total, (
            f"Expected {expected_total} staged rows (from fetch_rows preview), got {len(staged_rows)}"
        )
        staged_source_ref_ids = {str(r["source_ref_id"]) for r in staged_rows}
        missing_in_staging = expected_source_ref_ids - staged_source_ref_ids
        extra_in_staging = staged_source_ref_ids - expected_source_ref_ids
        assert not missing_in_staging, f"source_ref_ids in preview but not in staging: {missing_in_staging}"
        assert not extra_in_staging, f"source_ref_ids in staging but not in preview: {extra_in_staging}"
        for r in staged_rows:
            assert r["source_system"] == "TIMESHEET"
            assert r["werks"] == "5100"
            assert r["source_key"].startswith("5100:")
            assert r["provenance_snapshot"] is not None
            assert "raw" in r["provenance_snapshot"]
        print(f"  Staged {len(staged_rows)} rows, {len(staged_source_ref_ids)} distinct source_ref_ids — all match preview.")
    stg_conn.close()

    # --- Assert freeze & outbox lifecycle (handoff §8.4) ---
    # reserved > 0 wajib dibuktikan: run sebelumnya melaporkan reserved=0 karena
    # provenance lama membekukan kandidat sebelum reservation sempat dibuat.
    src_check = get_conn("mps_timesheet_ckp_test")
    with src_check.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.timesheet_staging_freeze")
        freeze_count = cur.fetchone()[0]
        assert freeze_count == len(expected_source_ref_ids), (
            f"freeze harus sama dengan DISTINCT source_ref_id: "
            f"expected {len(expected_source_ref_ids)}, got {freeze_count}"
        )

        # Tepat satu batch outbox untuk run ini, dan statusnya STAGED.
        cur.execute("SELECT count(DISTINCT batch_id) FROM public.timesheet_staging_outbox")
        batch_count = cur.fetchone()[0]
        assert batch_count == 1, f"Harus tepat satu outbox batch, got {batch_count}"

        cur.execute(
            "SELECT batch_id, status, COALESCE(array_length(source_ref_ids, 1), 0) "
            "FROM public.timesheet_staging_outbox"
        )
        outbox_rows = cur.fetchall()
        assert len(outbox_rows) == 1, f"Harus satu baris outbox, got {len(outbox_rows)}"
        ob_batch, ob_status, ob_reserved = outbox_rows[0]
        assert ob_status == "STAGED", f"Outbox status harus STAGED, got {ob_status}"
        ob_reserved = int(ob_reserved or 0)
        assert ob_reserved > 0, (
            f"reserved harus > 0 (bukti reservation nyata), got {ob_reserved}"
        )
        assert ob_reserved == len(expected_source_ref_ids), (
            f"reserved ({ob_reserved}) harus sama dengan distinct source_ref_id "
            f"({len(expected_source_ref_ids)})"
        )
        print(f"  Outbox batch={ob_batch} status={ob_status} reserved={ob_reserved}")

        # Tidak boleh ada reservation tertinggal. Status di sini HARUS sama persis
        # dengan yang ditulis reserve_staging_rows(); versi lama menulis 'RESERVED'
        # di outbox tetapi mencari 'STAGING_RESERVED' di sini, sehingga assertion
        # ini selalu lolos secara vacuous. Nilai yang dicari diverifikasi dulu
        # terhadap CHECK constraint supaya nama status tidak bisa menyimpang lagi.
        cur.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_timesheet_staging_outbox_status'"
        )
        ck_row = cur.fetchone()
        assert ck_row and "STAGING_RESERVED" in ck_row[0], (
            "CHECK constraint outbox tidak mengenal STAGING_RESERVED — nama status "
            f"menyimpang: {ck_row[0] if ck_row else 'constraint tidak ada'}"
        )

        cur.execute("SELECT count(*) FROM public.timesheet_staging_outbox WHERE status = 'STAGING_RESERVED'")
        stuck_reserved = cur.fetchone()[0]
        assert stuck_reserved == 0, f"No STAGING_RESERVED outbox rows should remain; found {stuck_reserved}"

        # Manual explicit window TIDAK boleh memajukan cursor.
        cur.execute("SELECT count(*) FROM public.timesheet_staging_outbox WHERE status = 'FAILED'")
        failed_outbox = cur.fetchone()[0]
        assert failed_outbox == 0, f"Tidak boleh ada outbox FAILED, got {failed_outbox}"
    src_check.close()

    # Manual window tidak menyentuh sap_stage_cursor sama sekali.
    stg_cursor_check = get_conn("mps_sap_staging_test")
    with stg_cursor_check.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.sap_stage_cursor WHERE source_system = 'TIMESHEET'")
        cursor_rows = cur.fetchone()[0]
    stg_cursor_check.close()
    assert cursor_rows == 0, (
        f"Manual --from-ts/--to-ts TIDAK BOLEH menulis sap_stage_cursor, got {cursor_rows} baris"
    )
    print(f"  Cursor TIMESHEET tidak tersentuh oleh manual window (rows={cursor_rows}).")

    # --- Assert idempotency: second run does NOT duplicate staging/provenance/freeze ---
    stg_before = get_conn("mps_sap_staging_test")
    with stg_before.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.sap_staging_source")
        prov_before = cur.fetchone()[0]
    stg_before.close()

    staged_ok_2 = stage_timesheet_transaction.run_once(stage_args)
    assert staged_ok_2 is not None

    stg_conn2 = get_conn("mps_sap_staging_test")
    with stg_conn2.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.sap_timesheet_staging")
        count_after_retry = cur.fetchone()[0]
        assert count_after_retry == expected_total, (
            f"Second run must NOT add rows: expected {expected_total}, got {count_after_retry}"
        )
        cur.execute("SELECT count(*) FROM public.sap_staging_source")
        prov_after = cur.fetchone()[0]
        assert prov_after == prov_before, (
            f"Provenance tidak boleh digandakan: before={prov_before} after={prov_after}"
        )
    stg_conn2.close()

    src_after = get_conn("mps_timesheet_ckp_test")
    with src_after.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.timesheet_staging_freeze")
        freeze_after = cur.fetchone()[0]
        assert freeze_after == freeze_count, (
            f"Freeze tidak boleh digandakan: before={freeze_count} after={freeze_after}"
        )
    src_after.close()
    print(f"  Idempotency confirmed: staging={count_after_retry}, provenance={prov_after}, freeze={freeze_after} (unchanged).")

    test_results["test_9_staging_execution"] = "PASSED"
    print("  => Test 9 PASSED.")



    # --------------------------------------------------------------------------
    # 10. Poster --dry-run Immutability & HTTP Spy (Item 7)
    # --------------------------------------------------------------------------
    print("\n[Test 10] Poster --dry-run Immutability & HTTP Spy:")
    stg_conn = get_conn("mps_sap_staging_test")
    with stg_conn.cursor() as cur:
        cur.execute("SELECT id, status, updated_at, payload, total_seconds FROM public.sap_timesheet_staging ORDER BY id")
        poster_fp_before = cur.fetchall()
    stg_conn.close()

    poster_parser = post_sap_staging.build_parser()
    poster_args = poster_parser.parse_args([
        "--dry-run",
        "--plant", "5100",
        "--source-system", "TIMESHEET",
        "--limit", "10",
    ])

    with patch("urllib.request.urlopen") as mock_url:
        post_sap_staging.preview_rows(poster_args)
        assert mock_url.call_count == 0, f"HTTP calls made during dry-run: {mock_url.call_count}"

    stg_conn = get_conn("mps_sap_staging_test")
    with stg_conn.cursor() as cur:
        cur.execute("SELECT id, status, updated_at, payload, total_seconds FROM public.sap_timesheet_staging ORDER BY id")
        poster_fp_after = cur.fetchall()
    stg_conn.close()

    assert poster_fp_before == poster_fp_after, "Poster dry-run mutated staging table!"
    test_results["test_10_poster_dry_run"] = "PASSED"
    print(f"  => Test 10 PASSED (0 HTTP calls, identical database fingerprint across {len(poster_fp_before)} rows).")

    print("\n" + "=" * 75)
    print("ALL REVISED INTEGRATION TESTS PASSED 100%!")
    print("=" * 75)
    return test_results


if __name__ == "__main__":
    run_test_suite()
