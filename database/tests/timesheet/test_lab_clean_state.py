#!/usr/bin/env python3
"""Kontrak clean-state lab lokal (handoff: "state tidak dibersihkan menyeluruh").

Review menemukan Test 9 hanya menghapus sebagian tabel state, sehingga sisa
baris dari test sebelumnya bisa membuat hasil terlihat hijau padahal kotor.

Test ini murni: tidak menyentuh PostgreSQL, tidak menyentuh production.
Yang diuji: daftar tabel yang direset harus MENCAKUP SELURUH tabel state yang
mutable di kedua database lab.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import run_local_lab_integration as lab_it  # noqa: E402


# Seluruh tabel state mutable yang benar-benar ada di lab lokal.
EXPECTED_STAGING_STATE = {
    "sap_stage_cursor",
    "sap_staging_eligibility_audit",
    "sap_staging_exclusion",
    "sap_staging_source",
    "sap_timesheet_staging",
}
EXPECTED_SOURCE_STATE = {
    "timesheet_staging_freeze",
    "timesheet_staging_outbox",
}
# timesheet_correction_audit append-only: trigger DB menolak DELETE, jadi
# ledger ini TIDAK boleh masuk daftar reset — hanya dilaporkan baselinenya.
EXPECTED_APPEND_ONLY = {
    "timesheet_correction_audit",
}


class TestResetTableCoverage(unittest.TestCase):
    def test_modul_mengekspos_daftar_tabel_state(self):
        self.assertTrue(hasattr(lab_it, "STAGING_STATE_TABLES"))
        self.assertTrue(hasattr(lab_it, "SOURCE_STATE_TABLES"))

    def test_daftar_staging_mencakup_semua_tabel_mutable(self):
        self.assertEqual(set(lab_it.STAGING_STATE_TABLES), EXPECTED_STAGING_STATE)

    def test_daftar_source_mencakup_freeze_dan_outbox(self):
        self.assertEqual(set(lab_it.SOURCE_STATE_TABLES), EXPECTED_SOURCE_STATE)

    def test_audit_append_only_tidak_boleh_direset(self):
        """Trigger DB menolak DELETE pada ledger audit — reset harus menghormatinya."""
        self.assertEqual(set(lab_it.APPEND_ONLY_STATE_TABLES), EXPECTED_APPEND_ONLY)
        self.assertNotIn("timesheet_correction_audit", lab_it.SOURCE_STATE_TABLES)

    def test_ada_fungsi_reset_terpusat(self):
        self.assertTrue(hasattr(lab_it, "reset_local_state"))

    def test_reset_memakai_daftar_bukan_delete_adhoc(self):
        import inspect
        src = inspect.getsource(lab_it.reset_local_state)
        self.assertIn("STAGING_STATE_TABLES", src)
        self.assertIn("SOURCE_STATE_TABLES", src)

    def test_reset_memverifikasi_tabel_benar_benar_kosong(self):
        """Reset harus membuktikan hasilnya, bukan sekadar menjalankan DELETE."""
        import inspect
        src = inspect.getsource(lab_it.reset_local_state)
        self.assertIn("count(*)", src)
        self.assertIn("raise", src)


class TestResetDipakaiSebelumStaging(unittest.TestCase):
    def test_test9_memanggil_reset_terpusat(self):
        import inspect
        src = inspect.getsource(lab_it.run_test_suite)
        self.assertIn("reset_local_state(", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
