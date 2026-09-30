"""Kontrak konsumen SAP (review P1 #18-#20).

#18 cutoff_date + auto_post_enabled per plant.
#19 hanya SATU rumus SAP untuk source_system='TIMESHEET'.
#20 dry-run poster memakai guard yang sama dengan posting sebenarnya.
"""

import subprocess
import sys
import unittest
from unittest import mock
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE / "legacy"))

import post_sap_staging as post  # noqa: E402


class TestLegacyTimesheetCutoff(unittest.TestCase):
    """Jalur legacy sementara hanya berlaku pada window yang disetujui owner."""

    def test_range_15_sampai_22_diterima(self):
        import argparse
        import stage_sap_timesheet as legacy

        args = argparse.Namespace(
            tsnumbers=None, from_date="2026-09-15", to_date="2026-09-22", dry_run=True,
        )
        with mock.patch.object(legacy, "fetch_timesheet_rows", return_value=[]) as fetch, \
             mock.patch.object(legacy, "stage_rows", return_value=0) as stage:
            legacy.cmd_timesheet(args)
        fetch.assert_called_once_with([], "2026-09-15", "2026-09-22")
        stage.assert_called_once_with([], True)

    def test_tanggal_23_ditolak(self):
        import argparse
        import stage_sap_timesheet as legacy

        args = argparse.Namespace(
            tsnumbers=None, from_date="2026-09-15", to_date="2026-09-23", dry_run=True,
        )
        with self.assertRaisesRegex(ValueError, "2026-09-22"):
            legacy.cmd_timesheet(args)

    def test_tsnumber_ad_hoc_ditolak(self):
        import argparse
        import stage_sap_timesheet as legacy

        args = argparse.Namespace(tsnumbers="1", from_date=None, to_date=None, dry_run=True)
        with self.assertRaisesRegex(ValueError, "from-date"):
            legacy.cmd_timesheet(args)

    def test_lookup_ph3_memilih_satu_master_terbaru(self):
        import inspect
        import stage_sap_timesheet as legacy

        source = inspect.getsource(legacy.fetch_timesheet_rows)
        self.assertIn("LEFT JOIN LATERAL", source)
        self.assertIn("ORDER BY p.created_at DESC NULLS LAST, p.id DESC", source)
        self.assertIn("LIMIT 1", source)

    def test_subcommand_mchours_tidak_ikut_dinonaktifkan(self):
        """MCH_HOURS adalah source_system berbeda — tidak boleh kena imbas."""
        proc = subprocess.run(
            [sys.executable, "stage_sap_timesheet.py", "mchours", "--help"],
            cwd=HERE, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, "mchours harus tetap tersedia")


class TestCutoff(unittest.TestCase):
    """#18: cutoff per plant menentukan batas bawah alokasi."""

    def setUp(self):
        from stage_cutoff import allow_operator_day, CutoffError
        self.allow = allow_operator_day
        self.CutoffError = CutoffError

    def test_hari_sebelum_cutoff_ditolak(self):
        self.assertFalse(self.allow(day=date(2026, 8, 31), cutoff=date(2026, 9, 1)))

    def test_hari_pada_cutoff_diterima(self):
        self.assertTrue(self.allow(day=date(2026, 9, 1), cutoff=date(2026, 9, 1)))

    def test_hari_setelah_cutoff_diterima(self):
        self.assertTrue(self.allow(day=date(2026, 9, 5), cutoff=date(2026, 9, 1)))

    def test_cutoff_tidak_diset_adalah_fail_closed(self):
        """Tanpa cutoff eksplisit jangan diam-diam memproses seluruh sejarah."""
        with self.assertRaises(self.CutoffError):
            self.allow(day=date(2026, 9, 5), cutoff=None)


class TestAutoPost(unittest.TestCase):
    """#18: auto-post harus mati dan hanya bisa hidup secara eksplisit."""

    def setUp(self):
        from stage_cutoff import auto_post_allowed
        self.auto = auto_post_allowed

    def test_default_mati(self):
        self.assertFalse(self.auto({}))
        self.assertFalse(self.auto({"auto_post_enabled": None}))

    def test_false_tetap_mati(self):
        self.assertFalse(self.auto({"auto_post_enabled": False}))

    def test_hanya_true_eksplisit_yang_menghidupkan(self):
        self.assertTrue(self.auto({"auto_post_enabled": True}))

    def test_string_truthy_tidak_menghidupkan(self):
        """'false' adalah string truthy di Python — jangan sampai lolos."""
        self.assertFalse(self.auto({"auto_post_enabled": "false"}))


class TestDryRunSharesGuards(unittest.TestCase):
    """#20: dry-run dan posting nyata harus memakai filter yang SAMA."""

    def test_preview_dan_claim_memakai_predikat_yang_sama(self):
        import post_sap_staging as p

        pred, _params = p.eligibility_predicate(statuses=["PENDING"])
        self.assertIn("exclusion", pred.lower(), "filter exclusion harus ada")
        self.assertIn("status", pred.lower(), "filter status harus ada")

    def test_preview_rows_memakai_eligibility_predicate(self):
        import inspect
        import post_sap_staging as p

        src = inspect.getsource(p.preview_rows)
        self.assertIn(
            "eligibility_predicate",
            src,
            "preview_rows harus memanggil eligibility_predicate(), bukan menyalin filter",
        )

    def test_claim_rows_memakai_eligibility_predicate(self):
        import inspect
        import post_sap_staging as p

        src = inspect.getsource(p.claim_rows)
        self.assertIn(
            "eligibility_predicate",
            src,
            "claim_rows harus memanggil eligibility_predicate() yang sama",
        )


class TestSelectedPathSharesGuard(unittest.TestCase):
    """#20: jalur --ids/--ztimesheetids tidak boleh punya filter sendiri.

    Bukti live: jalur ini sebelumnya melewati guard exclusion, sehingga bundel
    yang masih mengandung record excluded bisa terkirim (over-post).
    """

    def _capture(self, fn):
        captured = {}

        class Cur:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def execute(self, sql, params=None): captured["sql"] = sql
            def fetchall(self): return []

        class Conn:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def set_session(self, **k): captured["readonly"] = k.get("readonly")
            def cursor(self, *a, **k): return Cur()
            def commit(self): pass

        with mock.patch.object(post, "connect_staging", lambda: Conn()), \
             mock.patch.object(post, "ensure_staging_schema", lambda conn: None):
            fn()
        return captured

    def test_claim_selected_rows_memakai_guard_exclusion(self):
        cap = self._capture(lambda: post.claim_selected_rows(["1"], [], False, "5100"))
        self.assertIn("sap_staging_exclusion", cap.get("sql", ""),
                      "claim_selected_rows wajib memakai guard exclusion")

    def test_dry_run_ids_memakai_guard_dan_tanpa_limit(self):
        import argparse
        args = argparse.Namespace(
            ids="1,2", ztimesheetids=None, allow_posted=False, all_plants=False,
            plant="5100", source_system=None, limit=50, date=None, date_from=None,
            date_to=None, pernr=None, retry_failed=False, failed_only=False,
            include_today=False, productive_only=False, unproductive_only=False,
        )
        cap = self._capture(lambda: post.preview_rows(args))
        sql = cap.get("sql", "")
        self.assertIn("sap_staging_exclusion", sql,
                      "dry-run --ids wajib memakai guard exclusion yang sama")
        self.assertNotIn("LIMIT", sql.upper(),
                         "claim_selected_rows tidak memakai LIMIT; dry-run harus sama")


if __name__ == "__main__":
    unittest.main(verbosity=2)
