#!/usr/bin/env python3
"""Test suite komprehensif untuk ETL timesheet F6: Admin Correction Guard & Pipeline Invalidation (Lab Lokal).

Memverifikasi kontrak dan invariant F6:
1. Menjalankan migrasi SQL asli (database/migrations/api/20260922b_timesheet_freeze_and_audit.sql).
2. Koreksi pre-publish pada timesheet_transaction menginvalidasi artefak pipeline lama
   (timesheet_etl_input, timesheet_sap_ready) dan mencatat satu entri audit atomik di DB ledger.
3. Eksekusi pipeline berikutnya menghasilkan versi baru yang bersih (source_hash baru)
   dan mempublikasikannya ke central staging tanpa kontaminasi versi lama.
4. Perubahan state_flag (1 -> 5 / soft-delete) pre-publish menginvalidasi versi lama dan
   mengeluarkannya dari capture kandidat ETL berikutnya.
5. Perubahan workcentercode pre-publish menginvalidasi versi lama, memperbarui source_hash,
   dan menghasilkan payload SAP ARBPL yang baru.
6. Perubahan SQL langsung dengan context menghasilkan tepat satu entri audit atomik (channel='direct_sql').
7. Status PUBLISHING, STAGED, dan POSTED pada timesheet_staging_freeze secara permanen
   mengunci seluruh field payroll, workcentercode, state_flag, dan memblokir DELETE (fail-closed).
8. Koreksi payroll langsung tanpa session context (actor & reason) ditolak keras (check_violation).
9. Update non-payroll (misal note, workcenterdescription) diizinkan tanpa context,
   tidak membuat entri audit, dan tidak menginvalidasi pipeline.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
STAGING_DIR = os.path.abspath(os.path.join(REPO_ROOT, "jobs", "sap_staging"))
MIGRATION_FILE = os.path.abspath(
    os.path.join(REPO_ROOT, "database", "migrations", "api", "20260922b_timesheet_freeze_and_audit.sql")
)
sys.path.insert(0, STAGING_DIR)

import run_timesheet_etl as etl  # noqa: E402

CKP = "mps_timesheet_ckp_test"
BPN = "mps_timesheet_bpn_test"
CENTRAL_DB = "mps_sap_staging_test"
PLANT_CKP = "5100"
PLANT_BPN = "5051"

TS_F6_BASE = 998100
TS_F6_A = TS_F6_BASE + 1
TS_F6_B = TS_F6_BASE + 2
TS_F6_C = TS_F6_BASE + 3
TS_F6_D = TS_F6_BASE + 4
TS_F6_E = TS_F6_BASE + 5
TS_F6_F = TS_F6_BASE + 6
TS_F6_G = TS_F6_BASE + 7
TS_F6_H = TS_F6_BASE + 8
TS_F6_IDS = [TS_F6_A, TS_F6_B, TS_F6_C, TS_F6_D, TS_F6_E, TS_F6_F, TS_F6_G, TS_F6_H]


def apply_migration(conn):
    """Jalankan file migration asli database/migrations/api/20260922b_timesheet_freeze_and_audit.sql."""
    with open(MIGRATION_FILE, "r", encoding="utf-8") as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def clean_f6_test_data(plant_db: str, plant_code: str):
    """Bersihkan data sintetis pengujian F6 di plant DB dan central DB, lalu pasang migration asli."""
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
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_sap_ready
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_allocated_segment
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_cleaned_segment
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_etl_run_input
            WHERE input_id IN (
                SELECT input_id FROM public.timesheet_etl_input
                WHERE source_tsnumber = ANY(%s) AND plant = %s
            )
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_etl_input
            WHERE source_tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.timesheet_staging_freeze
            WHERE tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute(
            """
            ALTER TABLE public.timesheet_correction_audit DISABLE TRIGGER trg_timesheet_correction_audit_append_only;
            DELETE FROM public.timesheet_correction_audit
            WHERE tsnumber = ANY(%s) AND plant = %s;
            ALTER TABLE public.timesheet_correction_audit ENABLE TRIGGER trg_timesheet_correction_audit_append_only;
            """,
            (TS_F6_IDS, plant_code),
        )
        cur.execute("SET LOCAL mps.correction_actor = 'test_cleanup'")
        cur.execute("SET LOCAL mps.correction_reason = 'f6_test_cleanup'")
        cur.execute(
            """
            DELETE FROM public.timesheet_transaction
            WHERE tsnumber = ANY(%s) AND plant = %s
            """,
            (TS_F6_IDS, plant_code),
        )
    p_conn.commit()

    # Terapkan migration SQL asli
    apply_migration(p_conn)
    p_conn.close()

    c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
    with c_conn.cursor() as cur:
        keys_pattern = f"{plant_code}:{TS_F6_BASE}%"
        cur.execute(
            """
            DELETE FROM public.sap_staging_source
            WHERE source_row_id = ANY(%s) AND plant = %s
            """,
            ([str(i) for i in TS_F6_IDS], plant_code),
        )
        cur.execute(
            """
            DELETE FROM public.sap_timesheet_staging
            WHERE source_system = 'TIMESHEET' AND (source_key LIKE %s OR source_ref_id = ANY(%s))
            """,
            (keys_pattern, [str(i) for i in TS_F6_IDS]),
        )
    c_conn.commit()
    c_conn.close()


class TestEtlF6AdminGuardAndInvalidation(unittest.TestCase):
    """Test suite F6 untuk guard koreksi admin, invalidasi pipeline, dan audit atomik."""

    def setUp(self):
        clean_f6_test_data(CKP, PLANT_CKP)
        clean_f6_test_data(BPN, PLANT_BPN)
        self.addCleanup(lambda: clean_f6_test_data(CKP, PLANT_CKP))
        self.addCleanup(lambda: clean_f6_test_data(BPN, PLANT_BPN))

    # ------------------------------------------------------------------
    # 1. Pre-Publish Invalidation & Versioning
    # ------------------------------------------------------------------
    def test_admin_correction_pre_publish_invalidates_and_creates_new_version(self):
        """Koreksi pre-publish menginvalidasi input & sap_ready lama, lalu run berikutnya menghasilkan versi baru."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_A

        # 1. Insert initial raw transaction
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # 2. Run ETL manual execute pertama -> menghasilkan versi 1
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res_v1 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_v1",
            )
        p_conn.commit()

        run_id_v1 = res_v1["run_id"]
        self.assertEqual(res_v1["sap_ready_count"], 1)

        # Verifikasi input dan sap_ready v1 aktif (status = SAP_READY)
        with p_conn.cursor() as cur:
            cur.execute("SELECT input_id, status, source_hash FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            inp_v1 = cur.fetchone()
            self.assertEqual(inp_v1[1], "SAP_READY")
            hash_v1 = inp_v1[2]

            cur.execute("SELECT sap_ready_id, status FROM timesheet_sap_ready WHERE source_tsnumber = %s", (tsnumber,))
            ready_v1 = cur.fetchone()
            self.assertEqual(ready_v1[1], "SAP_READY")

        # 3. Admin melakukan koreksi jam checkout (pre-publish) dengan session context
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin_foreman'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi jam lembur dari kartu kerja'")
            cur.execute(
                """
                UPDATE public.timesheet_transaction
                SET longdate_checkout = '2026-09-30 03:00:00+00', duration = 7200
                WHERE tsnumber = %s
                """,
                (tsnumber,),
            )
        p_conn.commit()

        # 4. Verifikasi artefak v1 otomatis menjadi INVALIDATED dan audit tercatat
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, invalidated_at, invalidated_reason FROM timesheet_etl_input WHERE input_id = %s", (inp_v1[0],))
            inp_row = cur.fetchone()
            self.assertEqual(inp_row[0], "INVALIDATED")
            self.assertIsNotNone(inp_row[1])
            self.assertIn("koreksi jam lembur", inp_row[2])

            cur.execute("SELECT status FROM timesheet_sap_ready WHERE sap_ready_id = %s", (ready_v1[0],))
            ready_row = cur.fetchone()
            self.assertEqual(ready_row[0], "INVALIDATED")

            cur.execute("SELECT actor, reason, channel FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            audits = cur.fetchall()
            self.assertEqual(len(audits), 1)
            self.assertEqual(audits[0][0], "admin_foreman")
            self.assertEqual(audits[0][1], "koreksi jam lembur dari kartu kerja")

        # 5. Run ETL kedua -> menghasilkan versi 2
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            res_v2 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_v2",
            )
        p_conn.commit()

        run_id_v2 = res_v2["run_id"]
        self.assertEqual(res_v2["sap_ready_count"], 1)

        # Verifikasi input v2 memiliki hash berbeda dan status SAP_READY
        with p_conn.cursor() as cur:
            cur.execute("SELECT input_id, status, source_hash FROM timesheet_etl_input WHERE source_tsnumber = %s AND status = 'SAP_READY'", (tsnumber,))
            inp_v2 = cur.fetchone()
            self.assertIsNotNone(inp_v2)
            self.assertNotEqual(inp_v2[2], hash_v1)

            cur.execute("SELECT sap_ready_id, status, sap_effective_seconds FROM timesheet_sap_ready WHERE source_tsnumber = %s AND status = 'SAP_READY'", (tsnumber,))
            ready_v2 = cur.fetchone()
            self.assertEqual(ready_v2[1], "SAP_READY")
            self.assertEqual(ready_v2[2], 7200)

        # 6. Publish run_id_v2 -> sukses masuk ke central
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        pub_res = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=run_id_v2)
        self.assertEqual(pub_res["published_count"], 1)
        self.assertEqual(pub_res["status"], "STAGED")

        # Central memiliki tepat 1 baris untuk tsnumber tersebut dengan durasi 7200
        with c_conn.cursor() as cur:
            cur.execute("SELECT count(*), sum(total_seconds) FROM sap_timesheet_staging WHERE source_system = 'TIMESHEET' AND source_ref_id = %s", (str(tsnumber),))
            cnt, sec = cur.fetchone()
            self.assertEqual(cnt, 1)
            self.assertEqual(sec, 7200)

        p_conn.close()
        c_conn.close()

    # ------------------------------------------------------------------
    # 2. state_flag 1 -> 5 (Soft-Delete / Cancellation)
    # ------------------------------------------------------------------
    def test_state_flag_pre_publish_1_to_5_invalidates_and_excludes_from_pipeline(self):
        """Perubahan state_flag 1->5 pre-publish menginvalidasi pipeline v1 dan mengecualikan record pada run berikutnya."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_D

        # 1. Insert initial transaction state_flag = 1
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Run execute -> SAP_READY v1
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res_v1 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_sf_v1",
            )
        p_conn.commit()
        self.assertEqual(res_v1["sap_ready_count"], 1)

        # 2. Admin menandai record dibatalkan / soft-delete (state_flag = 5) dengan context
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin_qc'")
            cur.execute("SET LOCAL mps.correction_reason = 'transaksi dibatalkan'")
            cur.execute("UPDATE public.timesheet_transaction SET state_flag = 5 WHERE tsnumber = %s", (tsnumber,))
        p_conn.commit()

        # 3. Buktikan artefak v1 terinvalidasi dan audit tercatat
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "INVALIDATED")
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "INVALIDATED")

            cur.execute("SELECT actor, reason, before_row->>'state_flag', after_row->>'state_flag' FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            audit_row = cur.fetchone()
            self.assertEqual(audit_row[0], "admin_qc")
            self.assertEqual(audit_row[1], "transaksi dibatalkan")
            self.assertEqual(audit_row[2], "1")
            self.assertEqual(audit_row[3], "5")

        # 4. Run execute berikutnya mengecualikan record state_flag=5 (candidates = 0)
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            res_v2 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_sf_v2",
            )
        p_conn.commit()
        self.assertEqual(res_v2["candidates"], 0)
        self.assertEqual(res_v2["sap_ready_count"], 0)

        p_conn.close()

    def test_state_flag_change_blocked_when_frozen(self):
        """Perubahan state_flag pada record yang sudah frozen di staging ditolak fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_D

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'STAGED', now(), 'staged in central')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Percobaan update state_flag ke 5 ditolak
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'batal'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute("UPDATE public.timesheet_transaction SET state_flag = 5 WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()
        p_conn.close()

    # ------------------------------------------------------------------
    # 3. workcentercode Alignment & SAP Payload Parity
    # ------------------------------------------------------------------
    def test_workcentercode_pre_publish_change_invalidates_and_updates_sap_payload(self):
        """Perubahan workcentercode pre-publish menginvalidasi v1, memperbarui source_hash, dan menghasilkan ARBPL baru."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_E

        # 1. Insert raw transaction workcentercode = 'C5100FIT'
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Run v1
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res_v1 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_wc_v1",
            )
        p_conn.commit()
        self.assertEqual(res_v1["sap_ready_count"], 1)

        with p_conn.cursor() as cur:
            cur.execute("SELECT source_hash FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            hash_v1 = cur.fetchone()[0]

        # 2. Admin koreksi workcentercode ke 'C5100WLD'
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'supervisor'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi workcenter pengelasan'")
            cur.execute("UPDATE public.timesheet_transaction SET workcentercode = 'C5100WLD' WHERE tsnumber = %s", (tsnumber,))
        p_conn.commit()

        # 3. Buktikan v1 terinvalidasi dan audit mencatat pergantian workcentercode
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "INVALIDATED")

            cur.execute("SELECT before_row->>'workcentercode', after_row->>'workcentercode' FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            audit_row = cur.fetchone()
            self.assertEqual(audit_row[0], "C5100FIT")
            self.assertEqual(audit_row[1], "C5100WLD")

        # 4. Run execute v2 -> hash baru, payload SAP ARBPL = 'C5100WLD'
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            res_v2 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_wc_v2",
            )
        p_conn.commit()
        self.assertEqual(res_v2["sap_ready_count"], 1)

        with p_conn.cursor() as cur:
            cur.execute("SELECT source_hash FROM timesheet_etl_input WHERE source_tsnumber = %s AND status = 'SAP_READY'", (tsnumber,))
            hash_v2 = cur.fetchone()[0]
            self.assertNotEqual(hash_v2, hash_v1)

            cur.execute("SELECT payload->>'ARBPL' FROM timesheet_sap_ready WHERE source_tsnumber = %s AND status = 'SAP_READY'", (tsnumber,))
            arbpl = cur.fetchone()[0]
            self.assertEqual(arbpl, "C5100WLD")

        p_conn.close()

    def test_workcentercode_change_blocked_when_frozen(self):
        """Perubahan workcentercode pada record yang sudah frozen ditolak fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_E

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'STAGED', now(), 'staged in central')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute("UPDATE public.timesheet_transaction SET workcentercode = 'C5100WLD' WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()
        p_conn.close()

    # ------------------------------------------------------------------
    # 4. Direct SQL Audit Atomic Verification
    # ------------------------------------------------------------------
    def test_direct_sql_audit_single_atomic_entry(self):
        """Koreksi direct SQL dengan context menghasilkan tepat satu entri audit atomik (channel='direct_sql')."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_C

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Eksekusi direct SQL UPDATE dengan context
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'dba_admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'direct sql update checkout'")
            cur.execute("UPDATE public.timesheet_transaction SET duration = 5400 WHERE tsnumber = %s", (tsnumber,))
        p_conn.commit()

        # Buktikan tepat ada 1 baris audit
        with p_conn.cursor() as cur:
            cur.execute("SELECT actor, reason, channel, before_row->>'duration', after_row->>'duration' FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            audits = cur.fetchall()
            self.assertEqual(len(audits), 1)
            self.assertEqual(audits[0][0], "dba_admin")
            self.assertEqual(audits[0][1], "direct sql update checkout")
            self.assertEqual(audits[0][2], "direct_sql")
            self.assertEqual(audits[0][3], "3600")
            self.assertEqual(audits[0][4], "5400")

        # Eksekusi direct SQL DELETE dengan context
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'dba_admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'direct sql delete row'")
            cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (tsnumber,))
        p_conn.commit()

        # Buktikan bertambah tepat 1 baris audit delete dengan after_row = {}
        with p_conn.cursor() as cur:
            cur.execute("SELECT actor, reason, channel, after_row FROM timesheet_correction_audit WHERE tsnumber = %s ORDER BY id ASC", (tsnumber,))
            audits = cur.fetchall()
            self.assertEqual(len(audits), 2)
            del_audit = audits[1]
            self.assertEqual(del_audit[0], "dba_admin")
            self.assertEqual(del_audit[1], "direct sql delete row")
            self.assertEqual(del_audit[2], "direct_sql")
            self.assertEqual(del_audit[3], {})

        p_conn.close()

    # ------------------------------------------------------------------
    # 5. Freeze Guard on PUBLISHING, STAGED, and POSTED
    # ------------------------------------------------------------------
    def test_admin_correction_blocked_when_publishing(self):
        """Record berstatus PUBLISHING pada freeze registry memblokir UPDATE payroll & DELETE fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_B

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'PUBLISHING', now(), 'locked during publish')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Update payroll diblokir
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute(
                    "UPDATE public.timesheet_transaction SET longdate_checkout = '2026-09-10 03:00:00+00' WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()

        # DELETE diblokir
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()
        p_conn.close()

    def test_admin_correction_blocked_when_staged(self):
        """Record berstatus STAGED pada freeze registry memblokir UPDATE payroll dan DELETE fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_B

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'STAGED', now(), 'staged in central')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Update payroll diblokir
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute(
                    "UPDATE public.timesheet_transaction SET duration = 5000 WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()

        # DELETE diblokir
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute(
                    "DELETE FROM public.timesheet_transaction WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()
        p_conn.close()

    def test_admin_correction_blocked_when_posted(self):
        """Record berstatus POSTED pada freeze registry memblokir UPDATE payroll dan DELETE fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_B

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'POSTED', now(), 'posted to sap')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute(
                    "UPDATE public.timesheet_transaction SET duration = 5000 WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()
        p_conn.close()

    # ------------------------------------------------------------------
    # 6. Context Check & Non-Payroll Updates
    # ------------------------------------------------------------------
    def test_admin_correction_without_context_rejected_fail_closed(self):
        """Koreksi field payroll / workcentercode / state_flag tanpa context ditolak dengan check_violation."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_C

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-10 01:00:00+00', '2026-09-10 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Update duration tanpa context -> ditolak
        with p_conn.cursor() as cur:
            with self.assertRaises(psycopg2.errors.CheckViolation):
                cur.execute("UPDATE public.timesheet_transaction SET duration = 5000 WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()

        # Update workcentercode tanpa context -> ditolak
        with p_conn.cursor() as cur:
            with self.assertRaises(psycopg2.errors.CheckViolation):
                cur.execute("UPDATE public.timesheet_transaction SET workcentercode = 'C5100WLD' WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()

        # Update state_flag tanpa context -> ditolak
        with p_conn.cursor() as cur:
            with self.assertRaises(psycopg2.errors.CheckViolation):
                cur.execute("UPDATE public.timesheet_transaction SET state_flag = 5 WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()

        # DELETE tanpa context -> ditolak
        with p_conn.cursor() as cur:
            with self.assertRaises(psycopg2.errors.CheckViolation):
                cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (tsnumber,))
        p_conn.rollback()
        p_conn.close()

    def test_non_payroll_update_allowed_without_context_and_does_not_invalidate(self):
        """Update kolom non-payroll (misal note, workcenterdescription) diizinkan tanpa context dan tidak menginvalidasi artefak."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_C

        # 1. Insert and capture
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_non_payroll",
            )
        p_conn.commit()
        self.assertEqual(res["sap_ready_count"], 1)

        # 2. Update non-payroll (note dan workcenterdescription) tanpa context
        with p_conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.timesheet_transaction
                SET note = 'catatan operasional lapangan',
                    workcenterdescription = 'Deskripsi Tambahan'
                WHERE tsnumber = %s
                """,
                (tsnumber,),
            )
        p_conn.commit()

        # 3. Buktikan artefak pipeline tetap aktif (tidak INVALIDATED) dan tidak ada audit tercatat
        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "SAP_READY")
            cur.execute("SELECT status FROM timesheet_sap_ready WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "SAP_READY")

            cur.execute("SELECT count(*) FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], 0)

        p_conn.close()

    # ------------------------------------------------------------------
    # 7. Captured NULL Confirmation -> Filled & API Flows
    # ------------------------------------------------------------------
    def test_capture_with_null_confirmation_then_filled_requires_context_and_invalidates(self):
        """Record tertutup yang sudah di-capture dengan confirmation NULL: pengisian confirmation wajib context dan menginvalidasi pipeline."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_F

        # 1. Record tertutup dengan confirmation NULL
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  NULL, '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Run execute 1 -> tertangkap di timesheet_etl_input tapi sap_ready excluded (UNKNOWN_CONFIRMATION)
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res_v1 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_conf_v1",
            )
        p_conn.commit()

        self.assertEqual(res_v1["candidates"], 1)
        self.assertEqual(res_v1["sap_ready_count"], 0)  # Excluded karena konfirmasi NULL

        with p_conn.cursor() as cur:
            cur.execute("SELECT status FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            self.assertEqual(cur.fetchone()[0], "SAP_READY")

        # 2. Coba update confirmation number TANPA context pada record yang sudah di-capture -> DITOLAK fail-closed
        with p_conn.cursor() as cur:
            with self.assertRaises(psycopg2.errors.CheckViolation):
                cur.execute(
                    "UPDATE public.timesheet_transaction SET confirmationnumber = '6866446RG' WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()

        # 3. Update confirmation number DENGAN context -> diizinkan, menginvalidasi input v1, dan mencatat audit
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin_timesheet'")
            cur.execute("SET LOCAL mps.correction_reason = 'input nomor konfirmasi kartu kerja'")
            cur.execute(
                "UPDATE public.timesheet_transaction SET confirmationnumber = '6866446RG' WHERE tsnumber = %s",
                (tsnumber,),
            )
        p_conn.commit()

        # Buktikan input v1 menjadi INVALIDATED
        with p_conn.cursor() as cur:
            cur.execute("SELECT status, invalidated_reason FROM timesheet_etl_input WHERE source_tsnumber = %s", (tsnumber,))
            inp_row = cur.fetchone()
            self.assertEqual(inp_row[0], "INVALIDATED")
            self.assertIn("input nomor konfirmasi", inp_row[1])

            cur.execute("SELECT actor, reason, before_row->>'confirmationnumber', after_row->>'confirmationnumber' FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            aud = cur.fetchone()
            self.assertEqual(aud[0], "admin_timesheet")
            self.assertIsNone(aud[2])
            self.assertEqual(aud[3], "6866446RG")

        # 4. Run execute 2 -> menghasilkan versi 2 dan berhasil lolos menjadi SAP_READY
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            res_v2 = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_conf_v2",
            )
        p_conn.commit()

        self.assertEqual(res_v2["candidates"], 1)
        self.assertEqual(res_v2["sap_ready_count"], 1)

        # 5. Publish sukses ke central
        c_conn = etl.connect_central(CENTRAL_DB, autocommit=False)
        pub_res = etl.run_publish(p_conn, c_conn, plant=PLANT_CKP, run_id=res_v2["run_id"])
        self.assertEqual(pub_res["published_count"], 1)
        self.assertEqual(pub_res["status"], "STAGED")

        p_conn.close()
        c_conn.close()

    def test_normal_open_record_checkout_allows_filling_confirmation_without_context(self):
        """Checkout normal pada record terbuka (checkin -> checkout) diizinkan mengisi konfirmasi tanpa context."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_G

        # Insert open record
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  NULL, '2026-09-30 01:00:00+00', NULL, NULL, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Checkout normal: mengisi longdate_checkout dan confirmationnumber tanpa session context
        with p_conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.timesheet_transaction
                SET longdate_checkout = '2026-09-30 02:00:00+00',
                    duration = 3600,
                    confirmationnumber = '6866446RG'
                WHERE tsnumber = %s
                """,
                (tsnumber,),
            )
        p_conn.commit()

        # Eksekusi ETL berhasil memproses record ini
        with p_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, PLANT_CKP)
            res = etl.run_execute(
                cur,
                p_conn,
                cfg=cfg,
                dbname=CKP,
                from_ts=datetime(2026, 9, 30, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                to_ts=datetime(2026, 10, 1, 0, 0, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
                allocation_version="ALLOC-V1",
                clean_rule_version="CLEAN-V1",
                ready_version="READY-V1",
                created_by="test_f6_open_checkout",
            )
        p_conn.commit()
        self.assertEqual(res["sap_ready_count"], 1)

        p_conn.close()

    def test_frozen_record_confirmation_update_blocked(self):
        """Perubahan confirmation number pada record yang sudah frozen ditolak fail-closed."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_H

        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  NULL, '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
            cur.execute(
                """
                INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note)
                VALUES (%s, %s, 'STAGED', now(), 'staged in central')
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Update konfirmasi pada record frozen ditolak meski ada context
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi konfirmasi'")
            with self.assertRaises(psycopg2.errors.IntegrityConstraintViolation):
                cur.execute(
                    "UPDATE public.timesheet_transaction SET confirmationnumber = '6866446RG' WHERE tsnumber = %s",
                    (tsnumber,),
                )
        p_conn.rollback()
        p_conn.close()

    def test_api_flow_updateadmin_and_remove_atomic_single_audit(self):
        """Simulasi alur API updateTimesheetadmin dan remove menghasilkan tepat satu entri audit tanpa duplikasi."""
        p_conn = etl.connect_plant(CKP, autocommit=False)
        tsnumber = TS_F6_H

        # Insert test transaction
        with p_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_transaction (
                  tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                  confirmationnumber, longdate_checkin, longdate_checkout, duration, state_flag
                ) VALUES (
                  %s, %s, '10423', 'P26-35021', 610, 'C5100FIT',
                  '6866446RG', '2026-09-30 01:00:00+00', '2026-09-30 02:00:00+00', 3600, 1
                )
                """,
                (tsnumber, PLANT_CKP),
            )
        p_conn.commit()

        # Alur API updateTimesheetadmin:
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'api_foreman'")
            cur.execute("SET LOCAL mps.correction_reason = 'koreksi jam dari portal'")
            cur.execute("SET LOCAL mps.correction_channel = 'updateadmin'")
            cur.execute(
                """
                UPDATE public.timesheet_transaction
                SET longdate_checkout = '2026-09-30 04:00:00+00', duration = 10800
                WHERE tsnumber = %s
                """,
                (tsnumber,),
            )
        p_conn.commit()

        # Verifikasi tepat 1 baris audit tercatat dengan channel 'updateadmin'
        with p_conn.cursor() as cur:
            cur.execute("SELECT actor, reason, channel FROM timesheet_correction_audit WHERE tsnumber = %s", (tsnumber,))
            audits = cur.fetchall()
            self.assertEqual(len(audits), 1)
            self.assertEqual(audits[0][0], "api_foreman")
            self.assertEqual(audits[0][1], "koreksi jam dari portal")
            self.assertEqual(audits[0][2], "updateadmin")

        # Alur API remove:
        with p_conn.cursor() as cur:
            cur.execute("SET LOCAL mps.correction_actor = 'api_admin'")
            cur.execute("SET LOCAL mps.correction_reason = 'hapus transaksi duplikat'")
            cur.execute("SET LOCAL mps.correction_channel = 'remove'")
            cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (tsnumber,))
        p_conn.commit()

        # Verifikasi bertambah tepat 1 baris audit dengan channel 'remove'
        with p_conn.cursor() as cur:
            cur.execute("SELECT actor, reason, channel FROM timesheet_correction_audit WHERE tsnumber = %s ORDER BY id ASC", (tsnumber,))
            audits = cur.fetchall()
            self.assertEqual(len(audits), 2)
            self.assertEqual(audits[1][0], "api_admin")
            self.assertEqual(audits[1][1], "hapus transaksi duplikat")
            self.assertEqual(audits[1][2], "remove")

        p_conn.close()


if __name__ == "__main__":
    unittest.main()
