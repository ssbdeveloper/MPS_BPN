#!/usr/bin/env python3
"""Kontrak F0: schema tabel pipeline ETL timesheet.

Plan: docs/planning/2026-09-23-timesheet-etl-berlapis.md (§4, §9 F0)

Dijalankan HANYA terhadap lab lokal (`localhost:5432`, user `postgres`).
Tidak ada koneksi central/AWS dan tidak ada HTTP.

Test WAJIB 1 (migration diterapkan pada clone BPN dan CKP lokal) dan
Test WAJIB 2 (schema dan constraint sesuai kontrak) ada di file ini.
"""
from __future__ import annotations

import os
import sys
import unittest

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "jobs", "sap_staging"))
sys.path.insert(0, JOBS)

CLONES = {
    "ckp": ("mps_timesheet_ckp_test", "5100", "Asia/Jakarta"),
    "bpn": ("mps_timesheet_bpn_test", "5051", "Asia/Makassar"),
}

PIPELINE_TABLES = (
    "timesheet_etl_run",
    "timesheet_etl_input",
    # Lineage eksplisit run -> input version. Wajib ada: tanpa ini, run yang
    # memakai ulang version lama tidak punya bukti apa yang sebenarnya dibacanya.
    "timesheet_etl_run_input",
    "timesheet_cleaned_segment",
    "timesheet_allocated_segment",
    "timesheet_sap_ready",
)


LOCAL_HOST = "localhost"
LOCAL_PORT = 5432
LOCAL_USER = "postgres"


def local_conn(dbname: str, autocommit: bool = True):
    """Koneksi lab lokal saja. Guard: host wajib loopback.

    Kredensial TIDAK pernah ditulis di source: psycopg2 mengambilnya dari
    PGPASSWORD / pgpass seperti pengelola lab lainnya.
    """
    assert LOCAL_HOST in ("localhost", "127.0.0.1"), "test pipeline hanya untuk lab lokal"
    conn = psycopg2.connect(host=LOCAL_HOST, port=LOCAL_PORT, dbname=dbname, user=LOCAL_USER)
    conn.autocommit = autocommit
    return conn


def columns(cur, table: str) -> dict:
    cur.execute(
        """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return {r[0]: {"type": r[1], "nullable": r[2], "default": r[3]} for r in cur.fetchall()}


def constraint_defs(cur, table: str) -> dict:
    cur.execute(
        """
        SELECT con.conname, pg_get_constraintdef(con.oid)
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public' AND rel.relname = %s
        """,
        (table,),
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def index_names(cur, table: str) -> set:
    cur.execute(
        """
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = %s
        """,
        (table,),
    )
    return {r[0] for r in cur.fetchall()}


class MigrationAppliedTest(unittest.TestCase):
    """Test WAJIB 1: migration diterapkan pada clone BPN dan CKP lokal."""

    def test_ledger_mencatat_migration_pipeline_di_kedua_clone(self):
        for label, (dbname, _plant, _tz) in CLONES.items():
            with self.subTest(clone=label):
                conn = local_conn(dbname)
                cur = conn.cursor()
                cur.execute(
                    "SELECT filename FROM public.schema_migrations WHERE filename LIKE '20260923%'"
                )
                rows = [r[0] for r in cur.fetchall()]
                conn.close()
                self.assertIn(
                    "20260923_timesheet_etl_pipeline.sql", rows,
                    f"{dbname}: ledger tidak mencatat migration pipeline; dapat {rows}",
                )

    def test_lima_tabel_pipeline_ada_di_kedua_clone(self):
        for label, (dbname, _plant, _tz) in CLONES.items():
            with self.subTest(clone=label):
                conn = local_conn(dbname)
                cur = conn.cursor()
                for table in PIPELINE_TABLES:
                    self.assertTrue(
                        columns(cur, table),
                        f"{dbname}: tabel {table} tidak ada",
                    )
                conn.close()


class SchemaContractTest(unittest.TestCase):
    """Test WAJIB 2: schema dan constraint sesuai kontrak."""

    @classmethod
    def setUpClass(cls):
        cls.conn = local_conn("mps_timesheet_ckp_test")
        cls.cur = cls.conn.cursor()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_run_id_uuid_dan_pk(self):
        cols = columns(self.cur, "timesheet_etl_run")
        self.assertEqual(cols["run_id"]["type"], "uuid")
        cons = constraint_defs(self.cur, "timesheet_etl_run")
        self.assertTrue(any("PRIMARY KEY" in d and "run_id" in d for d in cons.values()))

    def test_run_status_check_constraint_ada(self):
        cons = constraint_defs(self.cur, "timesheet_etl_run")
        self.assertIn("ck_timesheet_etl_run_status", cons)
        self.assertIn("CAPTURED", cons["ck_timesheet_etl_run_status"])
        self.assertIn("FAILED_CAPTURE", cons["ck_timesheet_etl_run_status"])

    def test_run_window_check_from_lt_to(self):
        cons = constraint_defs(self.cur, "timesheet_etl_run")
        self.assertIn("ck_timesheet_etl_run_window", cons)
        self.assertIn("from_ts < to_ts", cons["ck_timesheet_etl_run_window"])

    def test_semua_timestamp_timestamptz(self):
        for table, expected in (
            ("timesheet_etl_run", ("from_ts", "to_ts", "started_at", "finished_at")),
            ("timesheet_etl_input", ("longdate_checkin", "longdate_checkout", "captured_at", "source_updated_at")),
        ):
            cols = columns(self.cur, table)
            for name in expected:
                with self.subTest(table=table, column=name):
                    self.assertEqual(
                        cols[name]["type"], "timestamp with time zone",
                        f"{table}.{name} harus timestamptz, dapat {cols[name]['type']}",
                    )

    def test_unique_input_version(self):
        cons = constraint_defs(self.cur, "timesheet_etl_input")
        self.assertIn("uq_timesheet_etl_input_version", cons)
        definition = cons["uq_timesheet_etl_input_version"]
        for part in ("plant", "source_tsnumber", "source_hash", "allocation_version"):
            self.assertIn(part, definition)

    def test_raw_snapshot_jsonb_not_null(self):
        cols = columns(self.cur, "timesheet_etl_input")
        self.assertEqual(cols["raw_snapshot"]["type"], "jsonb")
        self.assertEqual(cols["raw_snapshot"]["nullable"], "NO")

    def test_foreign_key_lineage_input_ke_run(self):
        cons = constraint_defs(self.cur, "timesheet_etl_input")
        fks = [d for d in cons.values() if "FOREIGN KEY" in d and "run_id" in d]
        self.assertTrue(fks, "timesheet_etl_input harus punya FK run_id -> timesheet_etl_run")
        self.assertIn("timesheet_etl_run", fks[0])

    def test_foreign_key_lineage_cleaned_ke_input_dan_run(self):
        cons = constraint_defs(self.cur, "timesheet_cleaned_segment")
        fks = [d for d in cons.values() if "FOREIGN KEY" in d]
        joined = " ".join(fks)
        self.assertIn("timesheet_etl_run", joined)
        self.assertIn("timesheet_etl_input", joined)

    def test_foreign_key_lineage_allocated_ke_cleaned(self):
        cons = constraint_defs(self.cur, "timesheet_allocated_segment")
        joined = " ".join(d for d in cons.values() if "FOREIGN KEY" in d)
        self.assertIn("timesheet_cleaned_segment", joined)
        self.assertIn("timesheet_etl_input", joined)

    def test_index_wajib_ada(self):
        """Index untuk run_id, source_tsnumber, status, dan rentang waktu."""
        expectations = {
            "timesheet_etl_run": ("run", "status"),
            "timesheet_etl_input": ("run", "tsnumber", "status", "window"),
            "timesheet_cleaned_segment": ("run", "tsnumber", "window"),
            "timesheet_allocated_segment": ("run", "tsnumber", "window"),
            "timesheet_sap_ready": ("run", "tsnumber", "status"),
        }
        for table, needles in expectations.items():
            names = index_names(self.cur, table)
            for needle in needles:
                with self.subTest(table=table, index=needle):
                    self.assertTrue(
                        any(needle in n for n in names),
                        f"{table}: tidak ada index memuat '{needle}'; ada {sorted(names)}",
                    )

    def test_sap_ready_idempotency_key(self):
        cons = constraint_defs(self.cur, "timesheet_sap_ready")
        self.assertIn("uq_timesheet_sap_ready_identity", cons)
        definition = cons["uq_timesheet_sap_ready_identity"]
        for part in ("plant", "source_version", "allocation_version", "ready_rule_version", "local_date", "segment_sequence"):
            self.assertIn(part, definition)

    def test_lineage_run_input_pk_dan_fk(self):
        """Tabel lineage: PK (run_id, input_id) + FK ke kedua ujungnya."""
        cons = constraint_defs(self.cur, "timesheet_etl_run_input")
        pk = [d for d in cons.values() if "PRIMARY KEY" in d]
        self.assertTrue(pk, "timesheet_etl_run_input harus punya PK")
        self.assertIn("run_id", pk[0])
        self.assertIn("input_id", pk[0])

        fks = " ".join(d for d in cons.values() if "FOREIGN KEY" in d)
        self.assertIn("timesheet_etl_run", fks)
        self.assertIn("timesheet_etl_input", fks)

    def test_migration_idempoten(self):
        """Migration dapat dijalankan ulang tanpa merusak data."""
        sql_path = os.path.join(
            HERE, "..", "..", "migrations", "api", "20260923_timesheet_etl_pipeline.sql"
        )
        with open(sql_path, encoding="utf-8") as fh:
            sql = fh.read()
        conn = local_conn("mps_timesheet_ckp_test", autocommit=False)
        try:
            cur = conn.cursor()
            # Sisipkan bukti bahwa data tidak hilang saat migration diulang.
            cur.execute(
                """
                INSERT INTO public.timesheet_etl_run
                  (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by)
                VALUES ('5100', '2026-09-01T00:00:00+07:00', '2026-09-02T00:00:00+07:00',
                        'Asia/Jakarta', 'v1', 'test-idempotensi')
                RETURNING run_id
                """
            )
            run_id = cur.fetchone()[0]
            cur.execute(sql)
            cur.execute("SELECT count(*) FROM public.timesheet_etl_run WHERE run_id = %s", (run_id,))
            self.assertEqual(cur.fetchone()[0], 1, "migration ulang menghapus data yang ada")
        finally:
            conn.rollback()
            conn.close()


class ImmutabilityTest(unittest.TestCase):
    """Snapshot input immutable; koreksi membuat versi baru, bukan menimpa."""

    @classmethod
    def setUpClass(cls):
        cls.conn = local_conn("mps_timesheet_ckp_test")
        cls.cur = cls.conn.cursor()
        cls.cur.execute(
            """
            INSERT INTO public.timesheet_etl_run
              (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by)
            VALUES ('5100', '2026-09-01T00:00:00+07:00', '2026-09-02T00:00:00+07:00',
                    'Asia/Jakarta', 'v1', 'test-immutability')
            RETURNING run_id
            """
        )
        cls.run_id = cls.cur.fetchone()[0]

    @classmethod
    def tearDownClass(cls):
        with cls.conn.cursor() as cur:
            cur.execute("DELETE FROM public.timesheet_etl_input WHERE run_id = %s", (cls.run_id,))
            cur.execute("DELETE FROM public.timesheet_etl_run WHERE run_id = %s", (cls.run_id,))
        cls.conn.close()

    def _insert_input(self, tsnumber, source_hash):
        self.cur.execute(
            """
            INSERT INTO public.timesheet_etl_input
              (run_id, plant, source_tsnumber, source_hash, allocation_version,
               longdate_checkin, longdate_checkout, raw_seconds, local_date_checkin, raw_snapshot)
            VALUES (%s, '5100', %s, %s, 'v1',
                    '2026-09-01T08:00:00+07:00', '2026-09-01T09:00:00+07:00', 3600,
                    '2026-09-01', '{}'::jsonb)
            RETURNING input_id
            """,
            (self.run_id, tsnumber, source_hash),
        )
        return self.cur.fetchone()[0]

    def test_payload_field_tidak_bisa_diubah(self):
        input_id = self._insert_input(900001, "hash-a")
        with self.assertRaises(psycopg2.errors.RestrictViolation):
            self.cur.execute(
                "UPDATE public.timesheet_etl_input SET raw_snapshot = '{\"tampered\": true}'::jsonb "
                "WHERE input_id = %s",
                (input_id,),
            )
        self.conn.rollback()

    def test_status_boleh_berubah(self):
        input_id = self._insert_input(900002, "hash-b")
        self.cur.execute(
            "UPDATE public.timesheet_etl_input SET status = 'CLEANED' WHERE input_id = %s",
            (input_id,),
        )
        self.cur.execute("SELECT status FROM public.timesheet_etl_input WHERE input_id = %s", (input_id,))
        self.assertEqual(self.cur.fetchone()[0], "CLEANED")

    def test_unique_menolak_versi_duplikat(self):
        self._insert_input(900003, "hash-c")
        with self.assertRaises(psycopg2.errors.UniqueViolation):
            self._insert_input(900003, "hash-c")
        self.conn.rollback()

    def test_hash_berbeda_membuat_versi_baru(self):
        first = self._insert_input(900004, "hash-d")
        second = self._insert_input(900004, "hash-e")
        self.assertNotEqual(first, second)

    def test_status_invalidated_wajib_bawa_alasan(self):
        input_id = self._insert_input(900005, "hash-f")
        with self.assertRaises(psycopg2.errors.CheckViolation):
            self.cur.execute(
                "UPDATE public.timesheet_etl_input SET status = 'INVALIDATED' WHERE input_id = %s",
                (input_id,),
            )
        self.conn.rollback()

    def test_status_invalidated_dengan_alasan_diterima(self):
        input_id = self._insert_input(900006, "hash-g")
        self.cur.execute(
            """
            UPDATE public.timesheet_etl_input
               SET status = 'INVALIDATED', invalidated_at = now(), invalidated_reason = 'koreksi checkout'
             WHERE input_id = %s
            """,
            (input_id,),
        )
        self.cur.execute("SELECT status FROM public.timesheet_etl_input WHERE input_id = %s", (input_id,))
        self.assertEqual(self.cur.fetchone()[0], "INVALIDATED")

    def test_interval_terbalik_ditolak(self):
        with self.assertRaises(psycopg2.errors.CheckViolation):
            self.cur.execute(
                """
                INSERT INTO public.timesheet_etl_input
                  (run_id, plant, source_tsnumber, source_hash, allocation_version,
                   longdate_checkin, longdate_checkout, raw_seconds, local_date_checkin, raw_snapshot)
                VALUES (%s, '5100', 900007, 'hash-h', 'v1',
                        '2026-09-01T10:00:00+07:00', '2026-09-01T09:00:00+07:00', 3600,
                        '2026-09-01', '{}'::jsonb)
                """,
                (self.run_id,),
            )
        self.conn.rollback()

    def test_run_window_terbalik_ditolak(self):
        with self.assertRaises(psycopg2.errors.CheckViolation):
            self.cur.execute(
                """
                INSERT INTO public.timesheet_etl_run
                  (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by)
                VALUES ('5100', '2026-09-02T00:00:00+07:00', '2026-09-01T00:00:00+07:00',
                        'Asia/Jakarta', 'v1', 'test')
                """
            )
        self.conn.rollback()


if __name__ == "__main__":
    unittest.main(verbosity=2)
