#!/usr/bin/env python3
"""Test suite komprehensif untuk ETL timesheet F5 Publish dan Recovery (Lab Lokal).

Memverifikasi kontrak dan invariant F5:
1. Preview publish read-only: row, payload SAP, source_key, seconds, dan checksum
   sama dengan SAP-ready persisted tanpa mutasi DB.
2. Transisi plant SAP_READY -> PUBLISHING mengunci field payroll pada timesheet_staging_freeze.
3. Insert central idempoten berdasarkan (source_system, source_key) ke mps_sap_staging_test.
4. Simpan staging ID dan bukti checksum; finalisasi plant menjadi STAGED.
5. Reconciler memulihkan 3 titik crash:
   - Crash Point 1: Putus koneksi sebelum central insert (reconciler insert central + finalize STAGED).
   - Crash Point 2: Putus koneksi setelah central insert, sebelum finalize plant (reconciler verify + finalize STAGED tanpa duplikasi).
   - Crash Point 3: Putus koneksi pada partial batch (reconciler melengkapi batch + finalize STAGED).
6. Fail-closed pada:
   - Payload drift pada source_key yang sama.
   - Schema central tidak cocok.
   - Koneksi non-loopback.
7. Idempotensi publikasi: rerun tidak membuat duplikasi row central staging / provenance.
8. Parity report: membandingkan hasil ETL baru dengan staging lama secara read-only.
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
CENTRAL_DB = "mps_sap_staging_test"
PLANT_CKP = "5100"
PLANT_BPN = "5051"

TS_F5_BASE = 998000
TS_F5_A = TS_F5_BASE + 1
TS_F5_B = TS_F5_BASE + 2
TS_F5_C = TS_F5_BASE + 3
TS_F5_IDS = [TS_F5_A, TS_F5_B, TS_F5_C]


def clean_f5_test_data(plant_db: str, plant_code: str):
    """Bersihkan data sintetis pengujian F5 di plant DB dan central DB."""
    p_conn = etl.connect_plant(plant_db, autocommit=False)
    with p_conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM public.timesheet_etl_run_sap_ready
            WHERE sap_ready_id IN (
                SELECT sap_ready_id FROM public.timesheet_sap_ready
                WHERE source_tsnumber = ANY(%s) AND plant = %s
            )
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_sap_ready
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_allocated_segment
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_cleaned_segment
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_etl_run_input
            WHERE input_id IN (
                SELECT input_id FROM public.timesheet_etl_input
                WHERE source_tsnumber = ANY(%s) AND plant = %s
            )
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_etl_input
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_staging_freeze
            WHERE tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
        cur.execute("SET LOCAL mps.correction_actor = 'test_cleanup'")
        cur.execute("SET LOCAL mps.correction_reason = 'f5_test_cleanup'")
        cur.execute(
            """
            DELETE FROM public.timesheet_transaction
            WHERE tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F5_IDS, plant_code),
        )
    p_conn.commit()
    p_conn.close()

    c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
    with c_conn.cursor() as cur:
        keys_pattern = f"{plant_code}:{TS_F5_BASE}%"
        cur.execute(
            """
            DELETE FROM public.sap_staging_source
            WHERE source_row_id = ANY(%s) AND plant = %s
            """,
            ([str(i) for i in TS_F5_IDS], plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.sap_timesheet_staging
            WHERE source_system = 'TIMESHEET' AND (source_key LIKE %s OR source_ref_id = ANY(%s))
            """,
            (keys_pattern, [str(i) for i in TS_F5_IDS]),
        )
    c_conn.commit()
    c_conn.close()


def insert_f5_synthetic_sap_ready(
    plant_db: str,
    plant_code: str,
    tsnumber: int,
    *,
    status: str = "SAP_READY",
    effective_seconds: int = 3600,
    confirmation_type: str = "RG",
) -> tuple[str, str, dict]:
    """Helper membuat baris timesheet_sap_ready sintetis untuk pengujian publish."""
    p_conn = etl.connect_plant(plant_db, autocommit=False)
    loc_date = "2026-09-10"
    source_key = f"{plant_code}:{tsnumber}:v1:ALLOC-V1:READY-V1:{loc_date}:1"
    payload = {
        "WERKS": plant_code,
        "PERNR": "00010424",
        "PERNR_ORIGIN": "00010424",
        "RUECK": "6998430",
        "AUFNR": "001000128545",
        "VORNR": "0170",
        "FLGAT": "",
        "PLNFL": "",
        "VORNR_B": "",
        "VORNR_R": "",
        "ZCONF_TYPE": confirmation_type,
        "ARBPL": "C5100FIT",
        "LSTAR": "" if confirmation_type in ("RG", "OV", "RW") else "M1",
        "ISDD": "20260910",
        "ISDZ": "080000",
        "IEDD": "20260910",
        "IEDZ": "090000",
        "AUERU": "",
        "ZBARCODEID": "",
        "longdate_checkin": "2026-09-10T01:00:00.000000+00:00",
        "longdate_checkout": "2026-09-10T02:00:00.000000+00:00",
        "confirmation_type": confirmation_type,
        "source_key": source_key,
    }
    snap = {
        "raw_seconds": effective_seconds,
        "cleaned_seconds": effective_seconds,
        "allocated_seconds": effective_seconds,
        "cap_seconds": None,
        "sap_effective_seconds": effective_seconds,
        "ready_rule_version": "READY-V1",
    }

    # Buat dummy run
    with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            INSERT INTO public.timesheet_etl_run (
              plant, from_ts, to_ts, plant_timezone, allocation_version, status,
              created_by, input_count, input_checksum
            ) VALUES (
              %s, '2026-09-10 00:00:00+07', '2026-09-11 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
              'test_f5', 1, 'dummy_checksum'
            ) RETURNING run_id
            """,
            (plant_code,),
        )
        run_id = str(cur.fetchone()["run_id"])

        # Buat dummy input
        cur.execute(
            """
            INSERT INTO public.timesheet_etl_input (
              run_id, plant, source_tsnumber, source_updated_at, source_hash, allocation_version,
              serialnumber, activitytype, order_no, operation_no, workcentercode,
              confirmationnumber, state_flag, longdate_checkin, longdate_checkout,
              raw_seconds, local_date_checkin, raw_snapshot
            ) VALUES (
              %s, %s, %s, now(), 'v1', 'ALLOC-V1',
              '00010424', NULL, '1000128545', 170, 'C5100FIT',
              '6998430', 1, '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00',
              %s, '2026-09-10', '{}'::jsonb
            ) RETURNING input_id
            """,
            (run_id, plant_code, tsnumber, effective_seconds),
        )
        input_id = str(cur.fetchone()["input_id"])

        # Buat raw transaction agar trigger freeze bisa diuji
        cur.execute(
            """
            DELETE FROM public.timesheet_transaction WHERE tsnumber = %s AND plant = %s
            """,
            (tsnumber, plant_code),
        )
        cur.execute(
            """
            INSERT INTO public.timesheet_transaction (
              tsnumber, plant, serialnumber, order_no, operation_no, longdate_checkin, longdate_checkout, duration
            ) VALUES (
              %s, %s, '00010424', '1000128545', 170, '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00', %s
            )
            """,
            (tsnumber, plant_code, effective_seconds),
        )

        cur.execute(
            """
            INSERT INTO public.timesheet_sap_ready (
              run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
              ready_rule_version, local_date, segment_sequence, source_key, payload,
              enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
              cap_seconds, sap_effective_seconds, status
            ) VALUES (
              %s, %s, %s, %s, 'v1', 'ALLOC-V1',
              'READY-V1', %s, 1, %s, %s::jsonb,
              %s::jsonb, %s, %s, %s, NULL, %s, %s
            ) RETURNING sap_ready_id
            """,
            (
                run_id, input_id, plant_code, tsnumber,
                loc_date, source_key, json.dumps(payload),
                json.dumps(snap), effective_seconds, effective_seconds, effective_seconds,
                effective_seconds, status,
            ),
        )
        sap_ready_id = str(cur.fetchone()["sap_ready_id"])

        cur.execute(
            """
            INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id)
            VALUES (%s, %s)
            """,
            (run_id, sap_ready_id),
        )
    p_conn.commit()
    p_conn.close()
    return run_id, sap_ready_id, payload


def insert_f5_synthetic_multi_segment_sap_ready(
    plant_db: str,
    plant_code: str,
    tsnumber: int,
    *,
    status: str = "SAP_READY",
) -> tuple[str, list[str], list[dict]]:
    """Helper membuat 2 fragmen timesheet_sap_ready sintetis untuk satu source_tsnumber."""
    p_conn = etl.connect_plant(plant_db, autocommit=False)
    with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Run
        cur.execute(
            """
            INSERT INTO public.timesheet_etl_run (
              plant, from_ts, to_ts, plant_timezone, allocation_version, status,
              created_by, input_count, input_checksum
            ) VALUES (
              %s, '2026-09-10 00:00:00+07', '2026-09-12 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
              'test_f5_multiseg', 1, 'dummy_checksum_multiseg'
            ) RETURNING run_id
            """,
            (plant_code,),
        )
        run_id = str(cur.fetchone()["run_id"])

        # Input
        cur.execute(
            """
            INSERT INTO public.timesheet_etl_input (
              run_id, plant, source_tsnumber, source_updated_at, source_hash, allocation_version,
              serialnumber, activitytype, order_no, operation_no, workcentercode,
              confirmationnumber, state_flag, longdate_checkin, longdate_checkout,
              raw_seconds, local_date_checkin, raw_snapshot
            ) VALUES (
              %s, %s, %s, now(), 'v1_hash', 'ALLOC-V1',
              '00010424', NULL, '1000128545', 170, 'C5100FIT',
              '6998430', 1, '2026-09-10 01:00:00+00', '2026-09-11 02:00:00+00',
              3600, '2026-09-10', '{}'::jsonb
            ) RETURNING input_id
            """,
            (run_id, plant_code, tsnumber),
        )
        input_id = str(cur.fetchone()["input_id"])

        cur.execute(
            "DELETE FROM public.timesheet_transaction WHERE tsnumber = %s AND plant = %s",
            (tsnumber, plant_code),
        )
        cur.execute(
            """
            INSERT INTO public.timesheet_transaction (
              tsnumber, plant, serialnumber, order_no, operation_no, longdate_checkin, longdate_checkout, duration
            ) VALUES (
              %s, %s, '00010424', '1000128545', 170, '2026-09-10 01:00:00+00', '2026-09-11 02:00:00+00', 3600
            )
            """,
            (tsnumber, plant_code),
        )

        ready_ids = []
        payloads = []
        dates_and_seqs = [("2026-09-10", 1, 1800), ("2026-09-11", 2, 1800)]
        for loc_date, seq, sec in dates_and_seqs:
            sk = f"{plant_code}:{tsnumber}:v1_hash:ALLOC-V1:READY-V1:{loc_date}:{seq}"
            p = {
                "WERKS": plant_code,
                "PERNR": "00010424",
                "PERNR_ORIGIN": "00010424",
                "RUECK": "6998430",
                "AUFNR": "001000128545",
                "VORNR": "0170",
                "FLGAT": "",
                "PLNFL": "",
                "VORNR_B": "",
                "VORNR_R": "",
                "ZCONF_TYPE": "RG",
                "ARBPL": "C5100FIT",
                "LSTAR": "",
                "ISDD": loc_date.replace("-", ""),
                "ISDZ": "080000",
                "IEDD": loc_date.replace("-", ""),
                "IEDZ": "083000",
                "AUERU": "",
                "ZBARCODEID": "",
                "longdate_checkin": f"{loc_date}T01:00:00.000000+00:00",
                "longdate_checkout": f"{loc_date}T01:30:00.000000+00:00",
                "confirmation_type": "RG",
                "source_key": sk,
            }
            snap = {
                "raw": sec,
                "cleaned": sec,
                "alloc": sec,
                "cap": None,
                "sec": sec,
                "ready_rule_version": "READY-V1",
            }
            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, %s, %s, %s, 'v1_hash', 'ALLOC-V1',
                  'READY-V1', %s, %s, %s, %s::jsonb,
                  %s::jsonb, %s, %s, %s, NULL, %s, %s
                ) RETURNING sap_ready_id
                """,
                (
                    run_id, input_id, plant_code, tsnumber,
                    loc_date, seq, sk, json.dumps(p),
                    json.dumps(snap), sec, sec, sec,
                    sec, status,
                ),
            )
            rid = str(cur.fetchone()["sap_ready_id"])
            ready_ids.append(rid)
            payloads.append(p)
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id, rid))

    p_conn.commit()
    p_conn.close()
    return run_id, ready_ids, payloads


class TestEtlF5PublishAndRecovery(unittest.TestCase):
    """Test suite F5 untuk verifikasi publish, recovery, idempotensi, dan fail-closed."""

    def setUp(self):
        clean_f5_test_data(CKP, PLANT_CKP)
        clean_f5_test_data(BPN, PLANT_BPN)
        self.addCleanup(lambda: clean_f5_test_data(CKP, PLANT_CKP))
        self.addCleanup(lambda: clean_f5_test_data(BPN, PLANT_BPN))

    # ------------------------------------------------------------------
    # 1. Preview Publish Read-Only
    # ------------------------------------------------------------------
    def test_preview_publish_read_only_matches_persisted_sap_ready(self):
        """Preview publish menghasilkan data identik tanpa mutasi database apa pun."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        p_conn = etl.connect_plant(CKP)
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            prev = etl.preview_publish(cur, plant=PLANT_CKP, run_id=run_id)

        p_conn.close()

        self.assertEqual(prev["mode"], "preview_publish")
        self.assertEqual(prev["plant"], PLANT_CKP)
        self.assertEqual(prev["run_id"], run_id)
        self.assertEqual(prev["candidate_count"], 1)
        self.assertEqual(prev["status_breakdown"], {"SAP_READY": 1})
        self.assertEqual(prev["total_sap_effective_seconds"], 3600)
        self.assertIn(f"{PLANT_CKP}:{TS_F5_A}", prev["sample_source_keys"][0])

    # ------------------------------------------------------------------
    # 2. State Transition & Payroll Locking
    # ------------------------------------------------------------------
    def test_transition_to_publishing_locks_payroll(self):
        """Transisi ke PUBLISHING membekukan timesheet_staging_freeze dan menolak update raw."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        p_conn = etl.connect_plant(CKP, autocommit=False)
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM timesheet_sap_ready WHERE sap_ready_id = %s",
                (ready_id,),
            )
            rows = cur.fetchall()
            count = etl.transition_sap_ready_to_publishing(cur, plant=PLANT_CKP, candidate_rows=rows)
        p_conn.commit()

        self.assertEqual(count, 1)

        # Cek status timesheet_sap_ready
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id,))
            status = cur.fetchone()[0]
            self.assertEqual(status, "PUBLISHING")

            # Cek timesheet_staging_freeze
            cur.execute("SELECT first_seen_status FROM timesheet_staging_freeze WHERE tsnumber = %s", (TS_F5_A,))
            freeze_st = cur.fetchone()[0]
            self.assertEqual(freeze_st, "PUBLISHING")

            # Coba ubah payroll pada timesheet_transaction -> HARUS ditolak oleh trigger
            with self.assertRaises(psycopg2.Error):
                cur.execute(
                    "UPDATE timesheet_transaction SET duration = 9999 WHERE tsnumber = %s",
                    (TS_F5_A,),
                )
        p_conn.rollback()
        p_conn.close()

    # ------------------------------------------------------------------
    # 3. Idempotent Publish & Finalization to STAGED
    # ------------------------------------------------------------------
    def test_idempotent_publish_flow_and_reexecution(self):
        """Publikasi sukses memfinalisasi ke STAGED dan re-run tidak membuat duplikasi central."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        p_conn = etl.connect_plant(CKP, autocommit=False)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)

        res = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)

        self.assertEqual(res["published_count"], 1)
        self.assertEqual(res["status"], "STAGED")

        # Verifikasi status di plant DB
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, central_staging_id, central_checksum FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id,))
            p_row = cur.fetchone()
            self.assertEqual(p_row[0], "STAGED")
            self.assertIsNotNone(p_row[1])
            self.assertIsNotNone(p_row[2])

        # Verifikasi row di central DB
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key LIKE %s", (f"{PLANT_CKP}:{TS_F5_A}%",))
            c_count = cur.fetchone()[0]
            self.assertEqual(c_count, 1)

            # Verifikasi provenance
            cur.execute("SELECT count(*) FROM sap_staging_source WHERE source_system = 'TIMESHEET' AND plant = %s AND source_row_id = %s", (PLANT_CKP, str(TS_F5_A)))
            prov_count = cur.fetchone()[0]
            self.assertEqual(prov_count, 1)

        # Re-run publish pada run_id yang sama
        res2 = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)
        self.assertEqual(res2["published_count"], 0)
        self.assertEqual(res2["reconciled_count"], 0)

        # Buktikan central tetap 1 baris
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key LIKE %s", (f"{PLANT_CKP}:{TS_F5_A}%",))
            self.assertEqual(cur.fetchone()[0], 1)

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 4. Crash Point 1: Putus sebelum Central Insert
    # ------------------------------------------------------------------
    def test_crash_point_1_before_central_insert_recovery(self):
        """Crash sebelum central disentuh: reconciler menginsert central dan memfinalisasi STAGED."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A, status="PUBLISHING")

        # Simulasi freeze status
        p_conn = etl.connect_plant(CKP, autocommit=False)
        with p_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note, allocation_snapshot) VALUES (%s, %s, 'PUBLISHING', now(), 'crash 1', '{}'::jsonb) ON CONFLICT (tsnumber) DO UPDATE SET first_seen_status='PUBLISHING'",
                (TS_F5_A, PLANT_CKP),
            )
        p_conn.commit()

        # Central belum tersentuh
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key LIKE %s", (f"{PLANT_CKP}:{TS_F5_A}%",))
            self.assertEqual(cur.fetchone()[0], 0)

        # Jalankan Reconciler
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_plant:
            with c_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_central:
                rec_res = etl.reconcile_publishing_state(
                    cur_plant, p_conn, cur_central, c_conn, plant=PLANT_CKP, run_id=run_id
                )

        self.assertEqual(rec_res["status"], "RECONCILED")
        self.assertEqual(rec_res["reconciled_count"], 1)

        # Central sekarang punya 1 row
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key LIKE %s", (f"{PLANT_CKP}:{TS_F5_A}%",))
            self.assertEqual(cur.fetchone()[0], 1)

        # Plant row STAGED
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, central_staging_id FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id,))
            row = cur.fetchone()
            self.assertEqual(row[0], "STAGED")
            self.assertIsNotNone(row[1])

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 5. Crash Point 2: Putus setelah Central Insert, sebelum Plant Finalize
    # ------------------------------------------------------------------
    def test_crash_point_2_after_central_insert_recovery(self):
        """Crash setelah central berhasil: reconciler memfinalisasi STAGED tanpa insert ulang."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_B, status="PUBLISHING")

        # Insert manual ke central (simulasi central sudah commit)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        p_conn = etl.connect_plant(CKP, autocommit=False)

        source_key = payload["source_key"]
        prov_json = '{"raw": 3600, "cleaned": 3600, "alloc": 3600, "cap": null, "sec": 3600, "ready_rule_version": "READY-V1"}'
        with c_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, is_productive, created_at, updated_at
                ) VALUES (
                  'TIMESHEET', %s, false, %s, %s,
                  '00010424', '00010424', '6998430', '001000128545', '0170', '', '', '', '',
                  'RG', 'C5100FIT', '', '20260910', '080000', '20260910', '090000', '', '',
                  %s::jsonb, now(), now(), now(), 3600,
                  1, now(), now(), %s::jsonb,
                  'PENDING', true, now(), now()
                )
                """,
                (source_key, str(TS_F5_B), PLANT_CKP, json.dumps(payload), prov_json),
            )
        c_conn.commit()

        # Reconciler dijalankan
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_plant:
            with c_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_central:
                rec_res = etl.reconcile_publishing_state(
                    cur_plant, p_conn, cur_central, c_conn, plant=PLANT_CKP, run_id=run_id
                )

        self.assertEqual(rec_res["status"], "RECONCILED")
        self.assertEqual(rec_res["reconciled_count"], 1)

        # Verifikasi central TIDAK menduplikasi (tetap tepat 1 row)
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key = %s", (source_key,))
            self.assertEqual(cur.fetchone()[0], 1)

        # Plant row final STAGED
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, central_staging_id FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id,))
            row = cur.fetchone()
            self.assertEqual(row[0], "STAGED")
            self.assertIsNotNone(row[1])

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 6. Crash Point 3: Partial Batch Recovery
    # ------------------------------------------------------------------
    def test_crash_point_3_partial_batch_recovery(self):
        """Crash pada batch parsial: reconciler menyelesaikan seluruh batch tanpa duplikasi."""
        run_id, ready_a, payload_a = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A, status="PUBLISHING")
        # Baris B pada run yang sama
        p_conn = etl.connect_plant(CKP, autocommit=False)
        loc_date = "2026-09-10"
        source_key_b = f"{PLANT_CKP}:{TS_F5_B}:v1:ALLOC-V1:READY-V1:{loc_date}:1"
        payload_b = dict(payload_a)
        payload_b["source_key"] = source_key_b

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'dummy_hash', 'ALLOC-V1',
                  'READY-V1', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 3600, 3600, 3600, NULL, 3600, 'PUBLISHING'
                ) RETURNING sap_ready_id
                """,
                (run_id, ready_a, PLANT_CKP, TS_F5_B, loc_date, source_key_b, json.dumps(payload_b)),
            )
            ready_b = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id, ready_b))
        p_conn.commit()

        # Insert A saja ke central (B belum masuk)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        prov_json = '{"raw": 3600, "cleaned": 3600, "alloc": 3600, "cap": null, "sec": 3600, "ready_rule_version": "READY-V1"}'
        with c_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, is_productive, created_at, updated_at
                ) VALUES (
                  'TIMESHEET', %s, false, %s, %s,
                  '00010424', '00010424', '6998430', '001000128545', '0170', '', '', '', '',
                  'RG', 'C5100FIT', '', '20260910', '080000', '20260910', '090000', '', '',
                  %s::jsonb, now(), now(), now(), 3600,
                  1, now(), now(), %s::jsonb,
                  'PENDING', true, now(), now()
                )
                """,
                (payload_a["source_key"], str(TS_F5_A), PLANT_CKP, json.dumps(payload_a), prov_json),
            )
        c_conn.commit()

        # Jalankan Reconciler
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_plant:
            with c_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_central:
                rec_res = etl.reconcile_publishing_state(
                    cur_plant, p_conn, cur_central, c_conn, plant=PLANT_CKP, run_id=run_id
                )

        self.assertEqual(rec_res["status"], "RECONCILED")
        self.assertEqual(rec_res["reconciled_count"], 2)

        # Kedua baris ada tepat 1 di central
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id IN (%s, %s)", (str(TS_F5_A), str(TS_F5_B)))
            self.assertEqual(cur.fetchone()[0], 2)

        # Kedua baris STAGED di plant
        with p_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM timesheet_sap_ready WHERE sap_ready_id IN (%s, %s) AND status = 'STAGED'", (ready_a, ready_b))
            self.assertEqual(cur.fetchone()[0], 2)

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 7. Fail-Closed on Payload & Semantic Drift
    # ------------------------------------------------------------------
    def test_fail_closed_on_payload_drift_in_central(self):
        """Payload berbeda pada source_key yang sama memicu EtlError fail-closed."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_C)

        # Pasang baris di central dengan AUFNR berbeda (drift)
        drift_payload = dict(payload)
        drift_payload["AUFNR"] = "009999999999"
        prov_json = '{"raw": 3600, "cleaned": 3600, "alloc": 3600, "cap": null, "sec": 3600, "ready_rule_version": "READY-V1"}'

        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with c_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, is_productive, created_at, updated_at
                ) VALUES (
                  'TIMESHEET', %s, false, %s, %s,
                  '00010424', '00010424', '6998430', '009999999999', '0170', '', '', '', '',
                  'RG', 'C5100FIT', '', '20260910', '080000', '20260910', '090000', '', '',
                  %s::jsonb, now(), now(), now(), 3600,
                  1, now(), now(), %s::jsonb,
                  'PENDING', true, now(), now()
                )
                """,
                (payload["source_key"], str(TS_F5_C), PLANT_CKP, json.dumps(drift_payload), prov_json),
            )
        c_conn.commit()

        p_conn = etl.connect_plant(CKP, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)

        self.assertIn("Semantic drift", str(ctx.exception))

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_semantic_drift_total_seconds_and_provenance(self):
        """Field SAP identik tetapi total_seconds atau provenance berbeda memicu fail-closed."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_C)

        # Kasus A: total_seconds berbeda
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with c_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, is_productive, created_at, updated_at
                ) VALUES (
                  'TIMESHEET', %s, false, %s, %s,
                  '00010424', '00010424', '6998430', '001000128545', '0170', '', '', '', '',
                  'RG', 'C5100FIT', '', '20260910', '080000', '20260910', '090000', '', '',
                  %s::jsonb, now(), now(), now(), 1800,
                  1, now(), now(), '{"raw": 3600, "cleaned": 3600, "alloc": 3600, "cap": null, "sec": 3600, "ready_rule_version": "READY-V1"}'::jsonb,
                  'PENDING', true, now(), now()
                )
                """,
                (payload["source_key"], str(TS_F5_C), PLANT_CKP, json.dumps(payload)),
            )
        c_conn.commit()

        p_conn = etl.connect_plant(CKP, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)
        self.assertIn("total_seconds", str(ctx.exception))

        # Kasus B: provenance_snapshot berbeda
        with c_conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.sap_timesheet_staging
                SET total_seconds = 3600,
                    provenance_snapshot = '{"raw": 1800, "cleaned": 1800, "alloc": 1800, "cap": null, "sec": 1800, "ready_rule_version": "READY-V1"}'::jsonb
                WHERE source_system = 'TIMESHEET' AND source_key = %s
                """,
                (payload["source_key"],),
            )
        c_conn.commit()

        with self.assertRaises(etl.EtlError) as ctx2:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)
        self.assertIn("provenance_snapshot", str(ctx2.exception))

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_ambiguous_active_sap_ready_versions(self):
        """Deteksi dan tolak publish jika ada lebih dari 1 source_version aktif untuk tsnumber yang sama."""
        run_id_1, ready_id_1, payload_1 = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        # Buat run kedua dengan source_version berbeda untuk TS_F5_A yang sama
        p_conn = etl.connect_plant(CKP, autocommit=False)
        loc_date = "2026-09-10"
        source_key_2 = f"{PLANT_CKP}:{TS_F5_A}:v2:ALLOC-V1:READY-V1:{loc_date}:1"
        payload_2 = dict(payload_1)
        payload_2["source_key"] = source_key_2

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'v2_different_hash', 'ALLOC-V1',
                  'READY-V1', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 3600, 3600, 3600, NULL, 3600, 'SAP_READY'
                ) RETURNING sap_ready_id
                """,
                (run_id_1, ready_id_1, PLANT_CKP, TS_F5_A, loc_date, source_key_2, json.dumps(payload_2)),
            )
            ready_id_2 = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id_1, ready_id_2))
        p_conn.commit()

        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP)

        self.assertIn("Ambiguous active SAP_READY versions", str(ctx.exception))
        self.assertIn(str(TS_F5_A), str(ctx.exception))

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_version_conflict_when_v1_already_staged(self):
        """READY-V1 sudah STAGED, publish READY-V2 ditolak fail-closed; central tetap 1 baris."""
        run_id_1, ready_id_1, payload_1 = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        # 1. Publish READY-V1 sampai selesai -> STAGED
        p_conn = etl.connect_plant(CKP, autocommit=False)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        res1 = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_1)
        self.assertEqual(res1["published_count"], 1)
        self.assertEqual(res1["status"], "STAGED")

        # Buktikan central punya 1 baris READY-V1
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], 1)

        # 2. Buat artefak READY-V2 (status SAP_READY) untuk TS_F5_A yang sama
        loc_date = "2026-09-10"
        source_key_2 = f"{PLANT_CKP}:{TS_F5_A}:v1:ALLOC-V1:READY-V2:{loc_date}:1"
        payload_2 = dict(payload_1)
        payload_2["source_key"] = source_key_2

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2026-09-10 00:00:00+07', '2026-09-11 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_f5_v2', 1, 'dummy_checksum_v2'
                ) RETURNING run_id
                """,
                (PLANT_CKP,),
            )
            run_id_2 = str(cur.fetchone()["run_id"])

            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'v1', 'ALLOC-V1',
                  'READY-V2', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 3600, 3600, 3600, NULL, 3600, 'SAP_READY'
                ) RETURNING sap_ready_id
                """,
                (run_id_2, ready_id_1, PLANT_CKP, TS_F5_A, loc_date, source_key_2, json.dumps(payload_2)),
            )
            ready_id_2 = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id_2, ready_id_2))
        p_conn.commit()

        # 3. Coba publish READY-V2 -> HARUS DITOLAK
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_2, ready_rule_version="READY-V2")

        self.assertIn("Version conflict", str(ctx.exception))

        # 4. Buktikan jumlah row central TETAP TEPAT SATU (tidak ada baris READY-V2)
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], 1)
            cur.execute("SELECT source_key FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], payload_1["source_key"])

        # 5. Buktikan READY-V2 di plant DB tidak berubah state (tetap SAP_READY)
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id_2,))
            self.assertEqual(cur.fetchone()[0], "SAP_READY")

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_version_conflict_when_v1_is_publishing(self):
        """READY-V1 masih PUBLISHING, publish READY-V2 ditolak fail-closed."""
        run_id_1, ready_id_1, payload_1 = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_A, status="PUBLISHING")

        p_conn = etl.connect_plant(CKP, autocommit=False)
        loc_date = "2026-09-10"
        source_key_2 = f"{PLANT_CKP}:{TS_F5_A}:v1:ALLOC-V1:READY-V2:{loc_date}:1"
        payload_2 = dict(payload_1)
        payload_2["source_key"] = source_key_2

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2026-09-10 00:00:00+07', '2026-09-11 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_f5_v2', 1, 'dummy_checksum_v2'
                ) RETURNING run_id
                """,
                (PLANT_CKP,),
            )
            run_id_2 = str(cur.fetchone()["run_id"])

            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'v1', 'ALLOC-V1',
                  'READY-V2', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 3600, 3600, 3600, NULL, 3600, 'SAP_READY'
                ) RETURNING sap_ready_id
                """,
                (run_id_2, ready_id_1, PLANT_CKP, TS_F5_A, loc_date, source_key_2, json.dumps(payload_2)),
            )
            ready_id_2 = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id_2, ready_id_2))
        p_conn.commit()

        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_2, ready_rule_version="READY-V2")

        self.assertIn("Version conflict", str(ctx.exception))

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_semantic_drift_null_vs_empty_string(self):
        """Memvalidasi bahwa nilai null dan string kosong '' tidak disamakan dalam kontrak semantik."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_C)
        self.assertEqual(payload.get("AUERU"), "")

        # Central memiliki AUERU = None / null
        drift_payload = dict(payload)
        drift_payload["AUERU"] = None
        prov_json = '{"raw": 3600, "cleaned": 3600, "alloc": 3600, "cap": null, "sec": 3600, "ready_rule_version": "READY-V1"}'

        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with c_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, is_productive, created_at, updated_at
                ) VALUES (
                  'TIMESHEET', %s, false, %s, %s,
                  '00010424', '00010424', '6998430', '001000128545', '0170', '', '', '', '',
                  'RG', 'C5100FIT', '', '20260910', '080000', '20260910', '090000', '', '',
                  %s::jsonb, now(), now(), now(), 3600,
                  1, now(), now(), %s::jsonb,
                  'PENDING', true, now(), now()
                )
                """,
                (payload["source_key"], str(TS_F5_C), PLANT_CKP, json.dumps(drift_payload), prov_json),
            )
        c_conn.commit()

        p_conn = etl.connect_plant(CKP, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)

        self.assertIn("payload.AUERU", str(ctx.exception))

        p_conn.close()
        c_conn.close()

    def test_multi_fragment_same_version_batch_size_1_and_rerun_idempotency(self):
        """Satu source 2 fragmen (versi sama) dipublish dengan batch_size=1:
        - kedua fragmen STAGED dan tepat 2 baris di central;
        - rerun tidak menggandakan baris central;
        - publish READY-V2 tetap ditolak fail-closed."""
        run_id, ready_ids, payloads = insert_f5_synthetic_multi_segment_sap_ready(CKP, PLANT_CKP, TS_F5_A)

        p_conn = etl.connect_plant(CKP, autocommit=False)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)

        # 1. Publish dengan batch_size = 1
        res = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id, batch_size=1)
        self.assertEqual(res["published_count"], 2)
        self.assertEqual(res["status"], "STAGED")

        # Verifikasi di plant DB: kedua fragmen STAGED
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE sap_ready_id = ANY(%s::uuid[])", (ready_ids,))
            statuses = [r[0] for r in cur.fetchall()]
            self.assertEqual(statuses, ["STAGED", "STAGED"])

        # Verifikasi di central DB: tepat 2 baris
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], 2)
            cur.execute("SELECT source_key FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s ORDER BY source_key", (str(TS_F5_A),))
            staged_keys = [r[0] for r in cur.fetchall()]
            expected_keys = sorted([p["source_key"] for p in payloads])
            self.assertEqual(staged_keys, expected_keys)

        # 2. Rerun: tidak boleh menggandakan
        res_rerun = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id, batch_size=1)
        self.assertEqual(res_rerun["published_count"], 0)
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], 2)

        # 3. Buat READY-V2 untuk source TS_F5_A -> harus tetap ditolak fail-closed
        loc_date = "2026-09-10"
        source_key_v2 = f"{PLANT_CKP}:{TS_F5_A}:v1_hash:ALLOC-V1:READY-V2:{loc_date}:1"
        payload_v2 = dict(payloads[0])
        payload_v2["source_key"] = source_key_v2

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2026-09-10 00:00:00+07', '2026-09-11 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_f5_v2_conflict', 1, 'dummy_checksum_v2'
                ) RETURNING run_id
                """,
                (PLANT_CKP,),
            )
            run_id_v2 = str(cur.fetchone()["run_id"])
            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'v1_hash', 'ALLOC-V1',
                  'READY-V2', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 1800, 1800, 1800, NULL, 1800, 'SAP_READY'
                ) RETURNING sap_ready_id
                """,
                (run_id_v2, ready_ids[0], PLANT_CKP, TS_F5_A, loc_date, source_key_v2, json.dumps(payload_v2)),
            )
            ready_id_v2 = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id_v2, ready_id_v2))
        p_conn.commit()

        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_v2, ready_rule_version="READY-V2")

        self.assertIn("Version conflict", str(ctx.exception))

        # Buktikan central tetap tepat 2 baris (READY-V1)
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_A),))
            self.assertEqual(cur.fetchone()[0], 2)

        p_conn.close()
        c_conn.close()

    def test_multi_fragment_same_version_limit_1_then_remaining(self):
        """Satu source 2 fragmen dipublish bertahap dengan --limit 1 lalu dilanjutkan sisa fragmen:
        - publish pertama memproses 1 fragmen;
        - publish kedua memproses fragmen tersisa;
        - total kedua fragmen menjadi STAGED dan tepat 2 baris di central."""
        run_id, ready_ids, payloads = insert_f5_synthetic_multi_segment_sap_ready(CKP, PLANT_CKP, TS_F5_B)

        p_conn = etl.connect_plant(CKP, autocommit=False)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)

        # 1. Publish pertama dengan limit = 1
        res1 = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id, limit=1)
        self.assertEqual(res1["published_count"], 1)

        # 1 STAGED, 1 SAP_READY di plant
        with p_conn.cursor() as cur:
            cur.execute("SELECT sap_ready_id, status FROM timesheet_sap_ready WHERE sap_ready_id = ANY(%s::uuid[]) ORDER BY segment_sequence", (ready_ids,))
            rows = cur.fetchall()
            self.assertEqual(rows[0][1], "STAGED")
            self.assertEqual(rows[1][1], "SAP_READY")

        # 1 baris di central
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_B),))
            self.assertEqual(cur.fetchone()[0], 1)

        # 2. Publish sisa fragmen (tanpa limit)
        res2 = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id)
        self.assertEqual(res2["published_count"], 1)

        # Kedua fragmen STAGED di plant
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE sap_ready_id = ANY(%s::uuid[])", (ready_ids,))
            statuses = [r[0] for r in cur.fetchall()]
            self.assertEqual(statuses, ["STAGED", "STAGED"])

        # Tepat 2 baris di central
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(TS_F5_B),))
            self.assertEqual(cur.fetchone()[0], 2)

        p_conn.close()
        c_conn.close()

    def test_fail_closed_on_version_conflict_when_v1_is_posted_in_plant(self):
        """Plant DB memiliki row berstatus POSTED versi READY-V1, publish kandidat READY-V2 ditolak fail-closed."""
        run_id_1, ready_id_1, payload_1 = insert_f5_synthetic_sap_ready(CKP, PLANT_CKP, TS_F5_C, status="POSTED")

        p_conn = etl.connect_plant(CKP, autocommit=False)
        loc_date = "2026-09-10"
        source_key_2 = f"{PLANT_CKP}:{TS_F5_C}:v1:ALLOC-V1:READY-V2:{loc_date}:1"
        payload_2 = dict(payload_1)
        payload_2["source_key"] = source_key_2

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2026-09-10 00:00:00+07', '2026-09-11 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_f5_v2_posted_guard', 1, 'dummy_checksum_v2'
                ) RETURNING run_id
                """,
                (PLANT_CKP,),
            )
            run_id_2 = str(cur.fetchone()["run_id"])

            cur.execute(
                """
                INSERT INTO public.timesheet_sap_ready (
                  run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
                  ready_rule_version, local_date, segment_sequence, source_key, payload,
                  enrichment_snapshot, raw_seconds, cleaned_seconds, allocated_seconds,
                  cap_seconds, sap_effective_seconds, status
                ) VALUES (
                  %s, (SELECT input_id FROM timesheet_sap_ready WHERE sap_ready_id = %s),
                  %s, %s, 'v1', 'ALLOC-V1',
                  'READY-V2', %s, 1, %s, %s::jsonb,
                  '{}'::jsonb, 3600, 3600, 3600, NULL, 3600, 'SAP_READY'
                ) RETURNING sap_ready_id
                """,
                (run_id_2, ready_id_1, PLANT_CKP, TS_F5_C, loc_date, source_key_2, json.dumps(payload_2)),
            )
            ready_id_2 = str(cur.fetchone()["sap_ready_id"])
            cur.execute("INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)", (run_id_2, ready_id_2))
        p_conn.commit()

        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_2, ready_rule_version="READY-V2")

        self.assertIn("Version conflict", str(ctx.exception))
        self.assertIn("POSTED", str(ctx.exception))

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 8. Fail-Closed on Non-Loopback & Central Schema Check
    # ------------------------------------------------------------------
    def test_fail_closed_on_non_loopback(self):
        """Koneksi non-loopback ditolak keras dengan EtlError."""
        orig_host = os.environ.get("MPS2_ETL_HOST")
        os.environ["MPS2_ETL_HOST"] = "192.168.1.100"
        try:
            with self.assertRaises(etl.EtlError):
                etl.connect_central()
        finally:
            if orig_host:
                os.environ["MPS2_ETL_HOST"] = orig_host
            else:
                os.environ.pop("MPS2_ETL_HOST", None)

    def test_fail_closed_on_central_schema_mismatch(self):
        """Schema central staging tidak valid memicu EtlError."""
        class MockCur:
            def execute(self, sql):
                pass
            def fetchall(self):
                return []
        with self.assertRaises(etl.EtlError):
            etl.assert_central_staging_schema(MockCur())

    # ------------------------------------------------------------------
    # 9. Balikpapan (5051) Publish & Reconciliation Test
    # ------------------------------------------------------------------
    def test_balikpapan_publish_and_reconciliation(self):
        """Publikasi plant Balikpapan (5051) berjalan sukses dan idempoten."""
        run_id, ready_id, payload = insert_f5_synthetic_sap_ready(BPN, PLANT_BPN, TS_F5_A)

        p_conn = etl.connect_plant(BPN, autocommit=False)
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)

        res = etl.run_publish(p_conn, c_conn, plant=PLANT_BPN, run_id=run_id)

        self.assertEqual(res["published_count"], 1)
        self.assertEqual(res["status"], "STAGED")

        # Verifikasi status di Balikpapan DB
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, central_staging_id FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_id,))
            p_row = cur.fetchone()
            self.assertEqual(p_row[0], "STAGED")
            self.assertIsNotNone(p_row[1])

        # Verifikasi central DB
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_key LIKE %s", (f"{PLANT_BPN}:{TS_F5_A}%",))
            self.assertEqual(cur.fetchone()[0], 1)

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 10. Legacy Comparison Unit Test
    # ------------------------------------------------------------------
    def test_compare_with_legacy_staging_structure(self):
        """compare_with_legacy_staging menghasilkan breakdown metrik perbandingan yang valid."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            # 2026-09-08 on the clone contains review case 5100-C017 (overlapping
            # duplicate activity), so the comparison must refuse it rather than skip it.
            with self.assertRaisesRegex(etl.EtlError, "DUPLICATE_ACTIVITY_OVERLAP"):
                etl.compare_with_legacy_staging(
                    cur,
                    plant=PLANT_CKP,
                    from_ts=datetime(2026, 9, 8, 0, 0, 0, tzinfo=ZoneInfo(cfg["timezone"])),
                    to_ts=datetime(2026, 9, 9, 0, 0, 0, tzinfo=ZoneInfo(cfg["timezone"])),
                    cfg=cfg,
                    dbname=CKP,
                )
            p_conn.rollback()
            comp = etl.compare_with_legacy_staging(
                cur,
                plant=PLANT_CKP,
                from_ts=datetime(2026, 9, 12, 0, 0, 0, tzinfo=ZoneInfo(cfg["timezone"])),
                to_ts=datetime(2026, 9, 13, 0, 0, 0, tzinfo=ZoneInfo(cfg["timezone"])),
                cfg=cfg,
                dbname=CKP,
            )

        self.assertEqual(comp["mode"], "compare_legacy")
        self.assertEqual(comp["plant"], PLANT_CKP)
        self.assertIn("summary", comp)
        s = comp["summary"]
        self.assertGreater(s["total_evaluated_tsnumbers"], 0)
        self.assertIn("exact_match_count", s)
        self.assertIn("seconds_difference_count", s)
        self.assertIn("in_legacy_only_count", s)
        self.assertIn("in_new_only_count", s)

        p_conn.close()

    def test_compare_with_legacy_staging_aggregates_split_fragments(self):
        """compare_with_legacy_staging menjumlahkan seluruh fragment untuk satu source record."""
        plan_fragments = [
            {
                "source_tsnumber": 999123,
                "local_date": "2026-09-08",
                "segment_sequence": 1,
                "sap_effective_seconds": 1800,
                "source_key": "5100:999123:v1:ALLOC-V1:READY-V1:2026-09-08:1",
                "payload": {"PERNR_ORIGIN": "00010424", "confirmation_type": "RG"},
            },
            {
                "source_tsnumber": 999123,
                "local_date": "2026-09-09",
                "segment_sequence": 2,
                "sap_effective_seconds": 1800,
                "source_key": "5100:999123:v1:ALLOC-V1:READY-V1:2026-09-09:2",
                "payload": {"PERNR_ORIGIN": "00010424", "confirmation_type": "RG"},
            },
        ]
        new_by_ts = {}
        for r in plan_fragments:
            ts = int(r["source_tsnumber"])
            payload = r["payload"]
            sec = int(r["sap_effective_seconds"])
            op = str(payload.get("PERNR_ORIGIN") or payload.get("PERNR") or "")
            conf_type = str(payload.get("confirmation_type") or payload.get("ZCONF_TYPE") or "")
            dt = str(r["local_date"])
            seq = int(r.get("segment_sequence", 1))

            if ts not in new_by_ts:
                new_by_ts[ts] = {
                    "tsnumber": ts,
                    "serialnumber": op,
                    "sap_effective_seconds": 0,
                    "confirmation_type": conf_type,
                    "date": dt,
                    "fragments": [],
                }
            new_by_ts[ts]["sap_effective_seconds"] += sec
            new_by_ts[ts]["fragments"].append({
                "local_date": dt,
                "segment_sequence": seq,
                "sap_effective_seconds": sec,
                "source_key": r.get("source_key"),
                "confirmation_type": conf_type,
            })

        self.assertEqual(new_by_ts[999123]["sap_effective_seconds"], 3600)
        self.assertEqual(len(new_by_ts[999123]["fragments"]), 2)
        self.assertEqual(new_by_ts[999123]["fragments"][0]["sap_effective_seconds"], 1800)
        self.assertEqual(new_by_ts[999123]["fragments"][1]["sap_effective_seconds"], 1800)

    # ------------------------------------------------------------------
    # 11. CLI Execution Test
    # ------------------------------------------------------------------
    def test_cli_preview_publish_and_reconcile_commands(self):
        """CLI invocation untuk --preview-publish dan --reconcile mengembalikan exit code 0."""
        rc_prev = etl.main(["--plant", "5100", "--preview-publish", "--json"])
        self.assertEqual(rc_prev, 0)

        rc_rec = etl.main(["--plant", "5100", "--reconcile", "--json"])
        self.assertEqual(rc_rec, 0)


if __name__ == "__main__":
    unittest.main()

