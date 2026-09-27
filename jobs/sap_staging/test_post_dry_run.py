"""Test Fase D: poster --dry-run tidak boleh menyentuh apa pun.

Kontrak dari docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md:
  - tidak claim (tidak ada UPDATE status='POSTING')
  - tidak UPDATE apa pun
  - tidak ada HTTP ke SAP

Test memakai Postgres lokal (bukan production). Set DSN lewat env:
    MPS2_TEST_STAGING_DSN=postgresql://postgres:...@127.0.0.1:55433/tsc_test

Jalankan:
    python test_post_dry_run.py
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

import psycopg2

DSN = os.environ.get("MPS2_TEST_STAGING_DSN")

SCHEMA = """
DROP TABLE IF EXISTS sap_timesheet_staging;
CREATE TABLE sap_timesheet_staging (
  id            bigserial PRIMARY KEY,
  ztimesheetid  text,
  source_system text NOT NULL,
  source_ref_id text,
  werks         text,
  status        text NOT NULL DEFAULT 'PENDING',
  pernr         text,
  pernr_origin  text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_seconds integer NOT NULL DEFAULT 0,
  bucket_start  timestamptz,
  is_correction boolean NOT NULL DEFAULT false,
  is_productive boolean NOT NULL DEFAULT true,
  sap_error     text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- #20: guard posting (dan karena itu dry-run) membaca provenance + exclusion.
-- Tabelnya harus ada di DB test seperti di production, walaupun kosong.
DROP TABLE IF EXISTS sap_staging_source;
CREATE TABLE sap_staging_source (
  staging_id    bigint,
  source_system text,
  plant         text,
  source_row_id text,
  bucket_start  timestamptz,
  seconds       bigint,
  posted_at     timestamptz
);
DROP TABLE IF EXISTS sap_staging_exclusion;
CREATE TABLE sap_staging_exclusion (
  source_system text,
  plant         text,
  source_row_id text,
  excluded_by   text
);
INSERT INTO sap_timesheet_staging
  (ztimesheetid, source_system, werks, status, pernr, payload, total_seconds)
VALUES
  ('Z1', 'TIMESHEET', '5100', 'PENDING', '1001',
   '{"ISDD":"20260920","AUFNR":"400001"}'::jsonb, 10800),
  ('Z2', 'TIMESHEET', '5100', 'PENDING', '1002',
   '{"ISDD":"20260920","AUFNR":"400002"}'::jsonb, 5400),
  ('Z3', 'TIMESHEET', '5100', 'POSTED',  '1003',
   '{"ISDD":"20260920","AUFNR":"400003"}'::jsonb, 3600);
"""


@unittest.skipUnless(DSN, "MPS2_TEST_STAGING_DSN tidak diset")
class TestPosterDryRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("PLANT_SSB", "5100")
        os.environ.setdefault("TIMEZONE", "Asia/Jakarta")
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA)
            conn.commit()

    def setUp(self):
        import post_sap_staging as mod
        self.mod = mod
        self.conn_patch = mock.patch.object(
            mod, "connect_staging", lambda: psycopg2.connect(DSN)
        )
        self.conn_patch.start()
        self.addCleanup(self.conn_patch.stop)

    def _snapshot(self):
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, status, updated_at, sap_error "
                    "FROM sap_timesheet_staging ORDER BY id"
                )
                return cur.fetchall()

    def _args(self, **over):
        parser = self.mod.build_parser()
        args = parser.parse_args([])
        for k, v in over.items():
            setattr(args, k, v)
        return args

    def test_dry_run_tidak_mengubah_status_atau_updated_at(self):
        before = self._snapshot()
        self.mod.preview_rows(self._args(plant="5100"))
        self.assertEqual(before, self._snapshot(),
                         "dry-run mengubah isi tabel staging")

    def test_dry_run_tidak_memanggil_http_ke_sap(self):
        with mock.patch.object(self.mod, "post_payload",
                               side_effect=AssertionError("HTTP dipanggil")) as http:
            self.mod.preview_rows(self._args(plant="5100"))
        http.assert_not_called()

    def test_dry_run_tidak_memanggil_claim(self):
        with mock.patch.object(self.mod, "claim_rows",
                               side_effect=AssertionError("claim dipanggil")) as c1, \
             mock.patch.object(self.mod, "claim_selected_rows",
                               side_effect=AssertionError("claim dipanggil")) as c2:
            self.mod.preview_rows(self._args(plant="5100"))
        c1.assert_not_called()
        c2.assert_not_called()

    def test_dry_run_hanya_menghitung_baris_pending(self):
        with self.assertLogs(self.mod.log, level="INFO") as cap:
            self.mod.preview_rows(self._args(plant="5100"))
        joined = "\n".join(cap.output)
        # Z1 + Z2 = 16200 detik = 4.50 jam; Z3 POSTED tidak ikut.
        self.assertIn("2 baris", joined)
        self.assertIn("4.50 jam", joined)

    def test_dry_run_transaksi_readonly_menolak_update(self):
        """Sesi read-only adalah guard terakhir: UPDATE apa pun harus gagal."""
        with self.mod.connect_staging() as conn:
            conn.set_session(readonly=True)
            with conn.cursor() as cur:
                with self.assertRaises(psycopg2.errors.ReadOnlySqlTransaction):
                    cur.execute("UPDATE sap_timesheet_staging SET status='X'")

    def test_main_dengan_dry_run_tidak_masuk_process_rows(self):
        argv = ["post_sap_staging.py", "--dry-run", "--plant", "5100"]
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(self.mod, "process_rows",
                               side_effect=AssertionError("process_rows dipanggil")) as pr, \
             mock.patch.object(self.mod, "preview_rows") as pv:
            self.mod.main()
        pr.assert_not_called()
        pv.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
