"""Test simulasi dan batasan rollback pada arsitektur ETL timesheet berlapis (F6).

SAFETY CONTRACT:
1. PENGUJIAN TERISOLASI 100% PADA SCRATCH DATABASE DINAMIS:
   - Nama unik per eksekusi: mps2_test_rb_plant_<uuid> & mps2_test_rb_central_<uuid>.
   - Ownership marker diverifikasi via pg_database comment sebelum DROP DATABASE ... WITH (FORCE).
   - STRICT GUARD: Memeriksa host & port yang benar-benar aktif (MPS2_ETL_HOST / MPS2_ETL_PORT, default localhost:5432 loopback).
   - TIDAK PERNAH membaca, menulis, atau menghapus data dari database lab bersama:
     mps_timesheet_ckp_test, mps_timesheet_bpn_test, mps_sap_staging_test.
2. Single-Transaction Atomic Targeted Rollback SOP:
   - Poster harus dihentikan terlebih dahulu.
   - Validasi kepemilikan publish: Ambil artefak melalui timesheet_etl_run_sap_ready join timesheet_sap_ready.
     Jika artefak diciptakan/dipublish oleh run lain (reused artifact / rerun lineage), run sekunder DILARANG
     membatalkan antrean milik run asal (FAIL-CLOSED: ABORTED_FOREIGN_ARTIFACT_OWNERSHIP).
   - Kunci & validasi seluruh baris di central staging dalam SATU transaksi atomik (SELECT ... FOR UPDATE).
   - Jika ada key yang hilang, berstatus POSTING, POSTED, FAILED, atau status non-PENDING:
     ROLLBACK seluruh transaksi (fail-closed, 0 baris diubah).
   - Hanya bila SEMUA baris ada dan strictly PENDING: ubah status menjadi SKIPPED dan COMMIT.
3. Integritas Freeze & Audit Plant:
   - Freeze (timesheet_staging_freeze) dan riwayat STAGED di plant DB bersifat permanen
     dan TIDAK BOLEH di-DELETE atau diubah menjadi INVALIDATED saat rollback.
4. Penggunaan Migrasi Asli:
   - Struktur DB scratch dibangun menggunakan file migrasi SQL resmi di database/migrations/
     (20260922_timesheet_derived_time_contract.sql, 20260922b_timesheet_freeze_and_audit.sql,
      20260923_timesheet_etl_pipeline.sql, 20260831_sap_staging_aws_schema.sql,
      20260922_sap_staging_provenance_snapshot.sql).
"""

from __future__ import annotations

import json
import os
import sys
import unittest
import uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
STAGING_DIR = REPO_ROOT / "jobs" / "sap_staging"
sys.path.insert(0, str(STAGING_DIR))

import run_timesheet_etl as etl

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
FORBIDDEN_DBS = {
    "mps_timesheet_ckp_test",
    "mps_timesheet_bpn_test",
    "mps_sap_staging_test",
    "mps_timesheet_lab",
    "ptssb",
}
OWNERSHIP_MARKER = "test_ownership_marker:test_rollback_simulation"
PLANT_CODE = "5100"

TS_RB_1 = 998201
TS_RB_2 = 998202
TS_RB_3 = 998203


def _assert_scratch_safety(host: str, port: int, dbname: str):
    # Periksa konfigurasi aktif dari environment atau default loopback
    active_host = os.environ.get("MPS2_ETL_HOST", host)
    active_port = int(os.environ.get("MPS2_ETL_PORT", port))

    if active_host not in LOCAL_HOSTS:
        raise RuntimeError(f"Host '{active_host}' ditolak: hanya loopback yang diizinkan.")
    if active_port != 5432:
        raise RuntimeError(f"Port '{active_port}' ditolak: hanya port 5432 lokal yang diizinkan.")
    if dbname in FORBIDDEN_DBS:
        raise RuntimeError(f"Target DB '{dbname}' DITOLAK: database lab bersama tidak boleh disentuh test!")


def get_admin_conn():
    _assert_scratch_safety("localhost", 5432, "postgres")
    conn = psycopg2.connect(host="localhost", port=5432, dbname="postgres", user="postgres")
    conn.autocommit = True
    return conn


def create_scratch_db(dbname: str) -> None:
    _assert_scratch_safety("localhost", 5432, dbname)
    if not dbname.startswith("mps2_test_rb_"):
        raise RuntimeError(f"Nama DB scratch '{dbname}' harus berawalan 'mps2_test_rb_'.")
    admin_conn = get_admin_conn()
    with admin_conn.cursor() as cur:
        cur.execute(f"CREATE DATABASE {dbname};")
        cur.execute(f"COMMENT ON DATABASE {dbname} IS '{OWNERSHIP_MARKER}';")
    admin_conn.close()


def safe_drop_scratch_db(dbname: str) -> None:
    _assert_scratch_safety("localhost", 5432, dbname)
    if not dbname.startswith("mps2_test_rb_"):
        raise RuntimeError(f"Nama DB scratch '{dbname}' harus berawalan 'mps2_test_rb_'.")
    admin_conn = get_admin_conn()
    with admin_conn.cursor() as cur:
        # Verifikasi kepemilikan test via database comment sebelum drop
        cur.execute(
            """
            SELECT pg_catalog.shobj_description(d.oid, 'pg_database')
            FROM pg_database d WHERE d.datname = %s
            """,
            (dbname,),
        )
        row = cur.fetchone()
        if not row or row[0] != OWNERSHIP_MARKER:
            raise RuntimeError(f"Database '{dbname}' tidak memiliki ownership marker yang valid! Drop dibatalkan.")
        cur.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = %s AND pid <> pg_backend_pid()
            """,
            (dbname,),
        )
        cur.execute(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE);")
    admin_conn.close()


def apply_migrations_to_scratch(plant_db: str, central_db: str) -> None:
    """Terapkan file migrasi asli ke database scratch."""
    _assert_scratch_safety("localhost", 5432, plant_db)
    _assert_scratch_safety("localhost", 5432, central_db)

    # 1. Setup Central DB menggunakan migrasi AWS asli
    conn_c = psycopg2.connect(host="localhost", port=5432, dbname=central_db, user="postgres")
    conn_c.autocommit = True
    with conn_c.cursor() as cur_c:
        cur_c.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        cur_c.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        aws_mig_1 = (REPO_ROOT / "database" / "migrations" / "aws" / "20260831_sap_staging_aws_schema.sql").read_text(encoding="utf-8")
        cur_c.execute(aws_mig_1)
        # Terapkan migrasi multi-source is_productive agar identik dengan AWS RDS production
        aws_mig_multi = (REPO_ROOT / "database" / "migrations" / "aws" / "20260928_sap_staging_is_productive_multi_source.sql").read_text(encoding="utf-8")
        cur_c.execute(aws_mig_multi)
        aws_mig_2 = (REPO_ROOT / "database" / "migrations" / "aws" / "20260922_sap_staging_provenance_snapshot.sql").read_text(encoding="utf-8")
        cur_c.execute(aws_mig_2)
    conn_c.close()

    # 2. Setup Plant DB menggunakan tabel dasar dan migrasi API asli
    conn_p = psycopg2.connect(host="localhost", port=5432, dbname=plant_db, user="postgres")
    conn_p.autocommit = True
    with conn_p.cursor() as cur_p:
        cur_p.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        cur_p.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        # Tabel dasar yang mendahului migrasi freeze/pipeline
        cur_p.execute("""
            CREATE TABLE public.plant_config (
              id integer PRIMARY KEY DEFAULT 1,
              plant_code text NOT NULL,
              plant_name text,
              timezone text NOT NULL,
              timesheet_allocation_cutoff_date date,
              auto_post_enabled boolean NOT NULL DEFAULT false
            );
            INSERT INTO public.plant_config (id, plant_code, plant_name, timezone, timesheet_allocation_cutoff_date, auto_post_enabled)
            VALUES (1, '5100', 'Cikupa', 'Asia/Jakarta', '2026-09-01', false);

            CREATE TABLE public.timesheet_transaction (
              tsnumber integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              plant text NOT NULL DEFAULT '5100',
              serialnumber text,
              order_no text,
              operation_no integer,
              workcentercode text,
              activitytype text,
              confirmationnumber text,
              state_flag smallint DEFAULT 1,
              longdate_checkin timestamptz,
              longdate_checkout timestamptz,
              date_checkin text,
              hour_checkin text,
              date_checkout text,
              hour_checkout text,
              duration integer
            );

            -- Tabel stub untuk backfill migrasi freeze
            CREATE TABLE IF NOT EXISTS public.sap_staging_source (
              id bigint, source_system text, plant text, source_row_id text, bucket_start timestamptz, seconds bigint, posted_at timestamptz, created_at timestamptz
            );
            CREATE TABLE IF NOT EXISTS public.sap_staging_exclusion (
              source_system text, plant text, source_row_id text, excluded_by text, excluded_at timestamptz, note text
            );
        """)

        # Terapkan migrasi API resmi secara berurutan
        mig_files = [
            "20260922_timesheet_derived_time_contract.sql",
            "20260922b_timesheet_freeze_and_audit.sql",
            "20260923_timesheet_etl_pipeline.sql",
        ]
        for mf in mig_files:
            sql_text = (REPO_ROOT / "database" / "migrations" / "api" / mf).read_text(encoding="utf-8")
            cur_p.execute(sql_text)
    conn_p.close()


def execute_targeted_rollback_procedure(
    conn_plant,
    conn_central,
    plant: str,
    target_run_id: str,
    incident_reason: str = "manual intervention per incident ticket",
) -> dict:
    """Prosedur SOP Targeted Rollback Resmi dalam Satu Transaksi Atomik dengan Validasi Kepemilikan Publish & Status.
    
    Kontrak Keselamatan:
    1. Ambil exact source_keys dari run_id melalui timesheet_etl_run_sap_ready join timesheet_sap_ready.
    2. Validasi kepemilikan publish: jika ada artefak yang diciptakan/dipublish oleh run LAIN (sr.run_id != target_run_id),
       atau jika status plant bukan 'STAGED', sistem FAIL-CLOSED (aborted).
    3. Buka transaksi di central staging, kunci baris dengan SELECT ... FOR UPDATE.
    4. Validasi status central:
       - Jumlah baris terkunci HARUS SAMA dengan jumlah candidate source_keys.
       - Seluruh baris HARUS berstatus strictly 'PENDING'.
       - Jika ada baris berstatus 'POSTING', 'POSTED', 'FAILED', atau key hilang -> ROLLBACK (fail-closed).
    5. Jika seluruh validasi lolos: UPDATE status = 'SKIPPED' & COMMIT.
    6. Plant DB freeze dan riwayat STAGED tetap permanen.
    """
    # Step 1: Resolusi exact candidate artifacts dari plant DB
    with conn_plant.cursor(cursor_factory=RealDictCursor) as cur_p:
        cur_p.execute(
            "SELECT run_id, started_at, status FROM public.timesheet_etl_run WHERE run_id = %s",
            (target_run_id,),
        )
        run_info = cur_p.fetchone()
        if not run_info:
            return {"status": "ABORTED_RUN_NOT_FOUND", "affected_count": 0}

        cur_p.execute(
            """
            SELECT sr.source_key, sr.source_tsnumber, sr.sap_ready_id, sr.run_id as creator_run_id,
                   sr.status as plant_status, sr.published_at
            FROM public.timesheet_etl_run_sap_ready rsr
            JOIN public.timesheet_sap_ready sr ON sr.sap_ready_id = rsr.sap_ready_id
            WHERE rsr.run_id = %s
            ORDER BY sr.source_tsnumber
            """,
            (target_run_id,),
        )
        artifacts = cur_p.fetchall()
        if not artifacts:
            return {"status": "NO_OP_EMPTY_RUN", "affected_count": 0}

        # Step 2: Validasi kepemilikan publish per exact source_key
        for art in artifacts:
            if str(art["creator_run_id"]) != str(target_run_id):
                # Fail-closed: Run ini bukan pemilik asli dari artefak yang dipakai ulang
                return {
                    "status": "ABORTED_FOREIGN_ARTIFACT_OWNERSHIP",
                    "reason": f"Artefak {art['source_key']} dibuat oleh run {art['creator_run_id']}, bukan run target {target_run_id}",
                    "affected_count": 0,
                }
            if art["plant_status"] != "STAGED":
                return {
                    "status": "ABORTED_INVALID_PLANT_STATUS",
                    "reason": f"Artefak {art['source_key']} berstatus {art['plant_status']}, bukan STAGED",
                    "affected_count": 0,
                }

        exact_source_keys = [art["source_key"] for art in artifacts]

    # Step 3: Single-Transaction Atomic Lock & Validation di Central
    with conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
        cur_c.execute(
            """
            SELECT source_key, status
            FROM public.sap_timesheet_staging
            WHERE source_system = 'TIMESHEET'
              AND werks = %s
              AND source_key = ANY(%s)
            FOR UPDATE
            """,
            (plant, exact_source_keys),
        )
        locked_rows = cur_c.fetchall()

        # Validasi: semua baris harus ada di central
        if len(locked_rows) != len(exact_source_keys):
            conn_central.rollback()
            return {
                "status": "ABORTED_MISSING_CENTRAL_KEYS",
                "reason": f"Ditemukan {len(locked_rows)} baris di central dari {len(exact_source_keys)} yang diharapkan",
                "affected_count": 0,
            }

        # Validasi: semua baris harus strictly PENDING
        non_pending = [r for r in locked_rows if r["status"] != "PENDING"]
        if non_pending:
            conn_central.rollback()
            return {
                "status": "ABORTED_NON_PENDING_STATUS",
                "reason": f"Baris memiliki status non-PENDING: {[r['status'] for r in non_pending]}",
                "affected_count": 0,
                "conflicting_statuses": [r["status"] for r in non_pending],
            }

        # Step 4: Update status ke SKIPPED
        cur_c.execute(
            """
            UPDATE public.sap_timesheet_staging
            SET status = 'SKIPPED',
                sap_error = %s,
                updated_at = now()
            WHERE source_system = 'TIMESHEET'
              AND werks = %s
              AND status = 'PENDING'
              AND source_key = ANY(%s)
            """,
            (f"Targeted rollback run_id={target_run_id}: {incident_reason}", plant, exact_source_keys),
        )
        affected = cur_c.rowcount
    conn_central.commit()

    return {
        "status": "SUCCESS_ROLLED_BACK",
        "affected_count": affected,
        "source_keys": exact_source_keys,
    }


class TestRollbackSimulationScratch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.session_id = uuid.uuid4().hex[:8]
        cls.plant_db = f"mps2_test_rb_plant_{cls.session_id}"
        cls.central_db = f"mps2_test_rb_central_{cls.session_id}"
        create_scratch_db(cls.plant_db)
        create_scratch_db(cls.central_db)
        apply_migrations_to_scratch(cls.plant_db, cls.central_db)

    @classmethod
    def tearDownClass(cls):
        safe_drop_scratch_db(cls.plant_db)
        safe_drop_scratch_db(cls.central_db)

    def setUp(self):
        _assert_scratch_safety("localhost", 5432, self.plant_db)
        _assert_scratch_safety("localhost", 5432, self.central_db)
        self.conn_plant = etl.connect_plant(self.plant_db, autocommit=False)
        self.conn_central = etl.connect_plant(self.central_db, autocommit=False)
        self._clean_scratch_data()

    def tearDown(self):
        try:
            self.conn_plant.rollback()
        except Exception:
            pass
        try:
            self.conn_central.rollback()
        except Exception:
            pass
        self._clean_scratch_data()
        self.conn_plant.close()
        self.conn_central.close()

    def _clean_scratch_data(self):
        """Bersihkan data hanya pada scratch DB sementara."""
        with self.conn_plant.cursor() as cur:
            cur.execute("""
                TRUNCATE TABLE
                  public.timesheet_etl_run_sap_ready,
                  public.timesheet_sap_ready,
                  public.timesheet_allocated_segment,
                  public.timesheet_cleaned_segment,
                  public.timesheet_etl_run_input,
                  public.timesheet_etl_input,
                  public.timesheet_etl_run,
                  public.timesheet_staging_freeze,
                  public.timesheet_staging_outbox,
                  public.timesheet_correction_audit,
                  public.timesheet_transaction
                CASCADE;
            """)
        self.conn_plant.commit()
        with self.conn_central.cursor() as cur:
            cur.execute("""
                TRUNCATE TABLE
                  public.sap_staging_source,
                  public.sap_timesheet_staging,
                  public.sap_staging_exclusion,
                  public.sap_stage_cursor
                CASCADE;
            """)
        self.conn_central.commit()

    def _seed_run_and_ready(self, tsnumbers: list[int]) -> str:
        """Buat run dan row timesheet_sap_ready di scratch plant DB dengan relasi run_sap_ready lengkap."""
        with self.conn_plant.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2027-01-01 00:00:00+07', '2027-01-02 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_scratch_rb', %s, 'rb_checksum'
                ) RETURNING run_id
                """,
                (PLANT_CODE, len(tsnumbers)),
            )
            run_id = str(cur.fetchone()["run_id"])

            for ts in tsnumbers:
                source_key = f"{PLANT_CODE}:{ts}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
                payload = {
                    "WERKS": PLANT_CODE,
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
                    "ISDD": "20270101",
                    "ISDZ": "080000",
                    "IEDD": "20270101",
                    "IEDZ": "120000",
                    "AUERU": "",
                    "ZBARCODEID": "",
                    "longdate_checkin": "2027-01-01T01:00:00.000000+00:00",
                    "longdate_checkout": "2027-01-01T05:00:00.000000+00:00",
                    "confirmation_type": "RG",
                    "source_key": source_key,
                }
                snap = {
                    "raw_seconds": 14400,
                    "cleaned_seconds": 14400,
                    "allocated_seconds": 14400,
                    "cap_seconds": None,
                    "sap_effective_seconds": 14400,
                    "ready_rule_version": "READY-V1",
                }

                # Insert input
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
                      '6998430', 1, '2027-01-01 01:00:00+00', '2027-01-01 05:00:00+00',
                      14400, '2027-01-01', '{}'::jsonb
                    ) RETURNING input_id
                    """,
                    (run_id, PLANT_CODE, ts),
                )
                input_id = cur.fetchone()["input_id"]

                # Insert transaction in plant DB
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction (
                      tsnumber, plant, serialnumber, order_no, operation_no, workcentercode,
                      confirmationnumber, state_flag, longdate_checkin, longdate_checkout, duration
                    ) VALUES (
                      %s, %s, '00010424', '1000128545', 170, 'C5100FIT',
                      '6998430', 1, '2027-01-01 01:00:00+00', '2027-01-01 05:00:00+00', 14400
                    )
                    """,
                    (ts, PLANT_CODE),
                )

                cur.execute(
                    """
                    INSERT INTO public.timesheet_sap_ready (
                      run_id, input_id, plant, source_tsnumber, source_version,
                      allocation_version, ready_rule_version, local_date, segment_sequence,
                      source_key, payload, enrichment_snapshot, raw_seconds, cleaned_seconds,
                      allocated_seconds, cap_seconds, sap_effective_seconds, status
                    ) VALUES (
                      %s, %s, %s, %s, 'v1',
                      'ALLOC-V1', 'READY-V1', '2027-01-01', 1,
                      %s, %s::jsonb, %s::jsonb, 14400, 14400,
                      14400, NULL, 14400, 'SAP_READY'
                    ) RETURNING sap_ready_id
                    """,
                    (run_id, input_id, PLANT_CODE, ts, source_key, json.dumps(payload), json.dumps(snap)),
                )
                sap_ready_id = cur.fetchone()["sap_ready_id"]
                cur.execute(
                    "INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)",
                    (run_id, sap_ready_id),
                )
        self.conn_plant.commit()
        return run_id

    def test_targeted_rollback_single_transaction_atomic_validation_safe_path(self):
        """Uji targeted rollback atomik SOP resmi:
        1. Query exact source_keys via timesheet_etl_run_sap_ready.
        2. Kunci & validasi seluruh baris di central dalam 1 transaksi (SELECT FOR UPDATE).
        3. Jika semua strictly PENDING -> update ke SKIPPED dan COMMIT.
        4. Freeze & riwayat STAGED di plant DB tetap utuh permanen.
        """
        run_id = self._seed_run_and_ready([TS_RB_1, TS_RB_2])

        # Publish ke central staging
        pub_res = etl.run_publish(self.conn_plant, self.conn_central, plant=PLANT_CODE, run_id=run_id, batch_size=500)
        self.assertEqual(pub_res["status"], "STAGED")
        self.assertEqual(pub_res["published_count"], 2)

        # Eksekusi SOP Rollback Terarah Resmi
        rb_res = execute_targeted_rollback_procedure(self.conn_plant, self.conn_central, PLANT_CODE, run_id)
        self.assertEqual(rb_res["status"], "SUCCESS_ROLLED_BACK")
        self.assertEqual(rb_res["affected_count"], 2)

        # Invariant checks post-rollback:
        # 1. Central status is SKIPPED
        with self.conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
            cur_c.execute(
                "SELECT source_key, status, sap_error FROM public.sap_timesheet_staging WHERE source_key = ANY(%s)",
                (rb_res["source_keys"],),
            )
            post_rb_central = cur_c.fetchall()
            for row in post_rb_central:
                self.assertEqual(row["status"], "SKIPPED")
                self.assertIn(f"Targeted rollback run_id={run_id}", row["sap_error"])

        # 2. Plant DB freeze REMAINS PERMANENT (never deleted)
        with self.conn_plant.cursor(cursor_factory=RealDictCursor) as cur_p:
            cur_p.execute(
                "SELECT tsnumber, first_seen_status FROM public.timesheet_staging_freeze WHERE tsnumber = ANY(%s)",
                ([TS_RB_1, TS_RB_2],),
            )
            post_rb_freeze = cur_p.fetchall()
            self.assertEqual(len(post_rb_freeze), 2)
            for fr in post_rb_freeze:
                self.assertEqual(fr["first_seen_status"], "STAGED")

            # 3. timesheet_sap_ready preserves historical STAGED record
            cur_p.execute(
                "SELECT source_tsnumber, status FROM public.timesheet_sap_ready WHERE source_tsnumber = ANY(%s)",
                ([TS_RB_1, TS_RB_2],),
            )
            post_rb_sr = cur_p.fetchall()
            self.assertEqual(len(post_rb_sr), 2)
            for r in post_rb_sr:
                self.assertEqual(r["status"], "STAGED")

            # 4. Trigger guard freeze memblokir modifikasi payroll pada record ter-freeze
            with self.assertRaises(psycopg2.IntegrityError):
                cur_p.execute(
                    "UPDATE public.timesheet_transaction SET state_flag = 5 WHERE tsnumber = %s",
                    (TS_RB_1,),
                )
            self.conn_plant.rollback()

    def test_targeted_rollback_mixed_batch_with_posting_fails_closed(self):
        """Batch campuran (1 PENDING, 1 POSTING): Seluruh transaksi ROLLBACK (0 baris diubah)."""
        run_id = self._seed_run_and_ready([TS_RB_1, TS_RB_2])
        pub_res = etl.run_publish(self.conn_plant, self.conn_central, plant=PLANT_CODE, run_id=run_id, batch_size=500)
        self.assertEqual(pub_res["status"], "STAGED")

        # Simulasikan Poster SAP telah mengklaim TS_RB_2 menjadi 'POSTING'
        sk_2 = f"{PLANT_CODE}:{TS_RB_2}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
        with self.conn_central.cursor() as cur_c:
            cur_c.execute("UPDATE public.sap_timesheet_staging SET status = 'POSTING' WHERE source_key = %s", (sk_2,))
        self.conn_central.commit()

        # Eksekusi SOP Rollback: Ditolak karena status campuran
        rb_res = execute_targeted_rollback_procedure(self.conn_plant, self.conn_central, PLANT_CODE, run_id)
        self.assertEqual(rb_res["status"], "ABORTED_NON_PENDING_STATUS")
        self.assertEqual(rb_res["affected_count"], 0)

        # Buktikan status central: Key 1 tetap PENDING, Key 2 tetap POSTING (TIDAK ADA yang berubah menjadi SKIPPED)
        with self.conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
            sk_1 = f"{PLANT_CODE}:{TS_RB_1}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
            cur_c.execute(
                "SELECT source_key, status FROM public.sap_timesheet_staging WHERE source_key = ANY(%s) ORDER BY source_key",
                ([sk_1, sk_2],),
            )
            rows = {r["source_key"]: r["status"] for r in cur_c.fetchall()}
            self.assertEqual(rows[sk_1], "PENDING")
            self.assertEqual(rows[sk_2], "POSTING")

    def test_targeted_rollback_batch_with_posted_fails_closed(self):
        """Batch dengan baris yang sudah POSTED: Seluruh transaksi ROLLBACK dan fail-closed."""
        run_id = self._seed_run_and_ready([TS_RB_1, TS_RB_2])
        pub_res = etl.run_publish(self.conn_plant, self.conn_central, plant=PLANT_CODE, run_id=run_id, batch_size=500)
        self.assertEqual(pub_res["status"], "STAGED")

        # Simulasikan Poster SAP telah menyelesaikan posting TS_RB_2 menjadi 'POSTED'
        sk_2 = f"{PLANT_CODE}:{TS_RB_2}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
        with self.conn_central.cursor() as cur_c:
            cur_c.execute(
                "UPDATE public.sap_timesheet_staging SET status = 'POSTED', posted_at = now() WHERE source_key = %s",
                (sk_2,),
            )
        self.conn_central.commit()

        # Eksekusi SOP Rollback: Ditolak keras
        rb_res = execute_targeted_rollback_procedure(self.conn_plant, self.conn_central, PLANT_CODE, run_id)
        self.assertEqual(rb_res["status"], "ABORTED_NON_PENDING_STATUS")
        self.assertEqual(rb_res["affected_count"], 0)
        self.assertIn("POSTED", rb_res["conflicting_statuses"])

        # Buktikan status central: Key 1 tetap PENDING, Key 2 tetap POSTED
        with self.conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
            sk_1 = f"{PLANT_CODE}:{TS_RB_1}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
            cur_c.execute(
                "SELECT source_key, status FROM public.sap_timesheet_staging WHERE source_key = ANY(%s) ORDER BY source_key",
                ([sk_1, sk_2],),
            )
            rows = {r["source_key"]: r["status"] for r in cur_c.fetchall()}
            self.assertEqual(rows[sk_1], "PENDING")
            self.assertEqual(rows[sk_2], "POSTED")

    def test_targeted_rollback_missing_or_ambiguous_key_fails_closed(self):
        """Jika ada source_key dari run yang hilang di central (mis. FDW putus saat publish): Transaksi di-ROLLBACK."""
        run_id = self._seed_run_and_ready([TS_RB_1, TS_RB_2])
        etl.run_publish(self.conn_plant, self.conn_central, plant=PLANT_CODE, run_id=run_id, batch_size=500)

        # Simulasikan anomali: 1 baris hilang di central
        sk_2 = f"{PLANT_CODE}:{TS_RB_2}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
        with self.conn_central.cursor() as cur_c:
            cur_c.execute("DELETE FROM public.sap_timesheet_staging WHERE source_key = %s", (sk_2,))
        self.conn_central.commit()

        # Eksekusi SOP Rollback: Ditolak karena key tidak lengkap di central
        rb_res = execute_targeted_rollback_procedure(self.conn_plant, self.conn_central, PLANT_CODE, run_id)
        self.assertEqual(rb_res["status"], "ABORTED_MISSING_CENTRAL_KEYS")
        self.assertEqual(rb_res["affected_count"], 0)

        # Status key 1 tetap PENDING (tidak diubah menjadi SKIPPED)
        sk_1 = f"{PLANT_CODE}:{TS_RB_1}:v1:ALLOC-V1:READY-V1:2027-01-01:1"
        with self.conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
            cur_c.execute("SELECT status FROM public.sap_timesheet_staging WHERE source_key = %s", (sk_1,))
            self.assertEqual(cur_c.fetchone()["status"], "PENDING")

    def test_reused_artifact_foreign_ownership_fails_closed_without_modifying_original_publish(self):
        """Membuktikan run sekunder (Run 2) yang memakai ulang artefak STAGED dari Run 1 DILARANG membatalkan publish Run 1."""
        # 1. Run 1 membuat dan mem-publish artefak TS_RB_1
        run_1 = self._seed_run_and_ready([TS_RB_1])
        etl.run_publish(self.conn_plant, self.conn_central, plant=PLANT_CODE, run_id=run_1, batch_size=500)

        with self.conn_plant.cursor(cursor_factory=RealDictCursor) as cur_p:
            cur_p.execute("SELECT sap_ready_id, source_key FROM public.timesheet_sap_ready WHERE source_tsnumber = %s", (TS_RB_1,))
            sr_row = cur_p.fetchone()
            sr_id = sr_row["sap_ready_id"]
            sk_1 = sr_row["source_key"]

            # 2. Run 2 menyertakan ulang artefak yang sama (reused artifact)
            cur_p.execute(
                """
                INSERT INTO public.timesheet_etl_run (
                  plant, from_ts, to_ts, plant_timezone, allocation_version, status,
                  created_by, input_count, input_checksum
                ) VALUES (
                  %s, '2027-01-01 00:00:00+07', '2027-01-02 00:00:00+07', 'Asia/Jakarta', 'ALLOC-V1', 'SAP_READY',
                  'test_scratch_rb_2', 1, 'rb_checksum_2'
                ) RETURNING run_id
                """,
                (PLANT_CODE,),
            )
            run_2 = str(cur_p.fetchone()["run_id"])
            cur_p.execute(
                "INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id) VALUES (%s, %s)",
                (run_2, sr_id),
            )
        self.conn_plant.commit()

        # 3. Percobaan Rollback menargetkan Run 2: DITOLAK KERAS (Fail-Closed: ABORTED_FOREIGN_ARTIFACT_OWNERSHIP)
        rb_res = execute_targeted_rollback_procedure(self.conn_plant, self.conn_central, PLANT_CODE, run_2)
        self.assertEqual(rb_res["status"], "ABORTED_FOREIGN_ARTIFACT_OWNERSHIP")
        self.assertEqual(rb_res["affected_count"], 0)

        # 4. Baris central hasil publish Run 1 TETAP UTUH sebagai PENDING
        with self.conn_central.cursor(cursor_factory=RealDictCursor) as cur_c:
            cur_c.execute("SELECT status FROM public.sap_timesheet_staging WHERE source_key = %s", (sk_1,))
            self.assertEqual(cur_c.fetchone()["status"], "PENDING")


if __name__ == "__main__":
    unittest.main()
