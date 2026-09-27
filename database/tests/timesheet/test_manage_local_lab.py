#!/usr/bin/env python3
"""Kontrak pengelola local lab (handoff §7 "pengelola lab dapat memberi sukses palsu").

Semua test di sini murni: tidak menyentuh PostgreSQL, tidak menyentuh production.
Yang diuji adalah kontrak fail-closed yang review temukan hilang:

  1. instalasi function TIDAK boleh menelan exception (dulu `except: pass`);
  2. rebuild harus bisa offline dari snapshot lokal, tanpa koneksi production;
  3. setiap subprocess dicek returncode + stderr, dan restore memakai ON_ERROR_STOP=1.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import manage_local_lab as lab  # noqa: E402

REQUIRED_PIPELINE_FUNCTIONS = lab.REQUIRED_PIPELINE_FUNCTIONS


class FakeCursor:
    def __init__(self, fail_on=()):
        self.fail_on = fail_on
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append(sql)
        for token in self.fail_on:
            if token in sql:
                raise RuntimeError(f"syntax error near {token}")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestInstallFunctionsFailClosed(unittest.TestCase):
    def test_kegagalan_satu_function_harus_raise_bukan_warning(self):
        cur = FakeCursor(fail_on=("timesheet_mark_staged",))
        funcs = [
            ("resolve_shift_definition", "CREATE FUNCTION resolve_shift_definition() ..."),
            ("timesheet_mark_staged", "CREATE FUNCTION timesheet_mark_staged() ..."),
            *[(n, f"CREATE FUNCTION {n}() ...") for n in REQUIRED_PIPELINE_FUNCTIONS
              if n not in ("resolve_shift_definition", "timesheet_mark_staged")],
        ]
        with self.assertRaises(RuntimeError) as ctx:
            lab.install_functions(cur, funcs)
        self.assertIn("timesheet_mark_staged", str(ctx.exception))

    def test_semua_function_wajib_ada_mengembalikan_jumlah_terpasang(self):
        cur = FakeCursor()
        funcs = [(n, f"CREATE FUNCTION {n}() ...") for n in sorted(REQUIRED_PIPELINE_FUNCTIONS)]
        self.assertEqual(lab.install_functions(cur, funcs), len(REQUIRED_PIPELINE_FUNCTIONS))

    def test_clone_tanpa_function_pipeline_ditolak(self):
        """Function pipeline hilang -> RuntimeError, bukan diam-diam 0."""
        cur = FakeCursor()
        funcs = [("some_unrelated_prod_fn", "CREATE FUNCTION some_unrelated_prod_fn() ...")]
        with self.assertRaises(RuntimeError) as ctx:
            lab.install_functions(cur, funcs)
        msg = str(ctx.exception)
        for name in REQUIRED_PIPELINE_FUNCTIONS:
            self.assertIn(name, msg)
        self.assertEqual(cur.executed, [], "Function di luar allowlist tidak boleh dieksekusi")


class TestOfflineRebuild(unittest.TestCase):
    """Acceptance handoff: 'Rebuild dapat dilakukan dari snapshot lokal tanpa koneksi production'."""

    def test_recreate_plant_clone_tidak_memanggil_production(self):
        import inspect
        src = inspect.getsource(lab.recreate_plant_clone)
        self.assertNotIn(
            "get_prod_readonly_conn", src,
            "recreate_plant_clone tidak boleh menghubungi production — harus offline",
        )
        self.assertNotIn("copy_custom_functions(", src)

    def test_ada_jalur_snapshot_function_lokal(self):
        self.assertTrue(hasattr(lab, "snapshot_functions_to_lab"))
        self.assertTrue(hasattr(lab, "install_functions_from_lab"))

    def test_install_dari_lab_memakai_tabel_snapshot_lokal(self):
        import inspect
        src = inspect.getsource(lab.install_functions_from_lab)
        self.assertIn("mps_timesheet_lab", src)
        self.assertNotIn("get_prod_readonly_conn", src)


class TestRebuildOrder(unittest.TestCase):
    """Rebuild harus menerapkan migration (pembuat tabel state) SEBELUM function.

    Function `timesheet_mark_staged` menulis ke `timesheet_staging_freeze` yang
    dibuat migration Fase B. Versi lama memasang function lebih dulu dan gagal
    dengan 'relation does not exist' — atau, pada varian yang menelan exception,
    menghasilkan clone tanpa trigger.
    """

    def test_migration_kontrak_didefinisikan_dan_ada_di_disk(self):
        self.assertTrue(lab.LAB_MIGRATION_FILES, "Daftar migration tidak boleh kosong")
        for fname in lab.LAB_MIGRATION_FILES:
            self.assertTrue(
                (lab.LAB_MIGRATIONS_DIR / fname).exists(),
                f"Migration {fname} tidak ada di {lab.LAB_MIGRATIONS_DIR}",
            )

    def test_recreate_memanggil_migration_sebelum_install_function(self):
        import inspect
        src = inspect.getsource(lab.recreate_plant_clone)
        i_mig = src.find("apply_lab_migrations(")
        i_fn = src.find("install_functions_from_lab(")
        self.assertGreater(i_mig, -1, "recreate harus menerapkan migration kontrak")
        self.assertGreater(i_fn, -1)
        self.assertLess(i_mig, i_fn, "Migration wajib dijalankan sebelum function dipasang")

    def test_recreate_memverifikasi_kontrak_clone(self):
        import inspect
        src = inspect.getsource(lab.recreate_plant_clone)
        self.assertIn("verify_clone_contract(", src)

    def test_kontrak_clone_mencakup_tabel_dan_trigger(self):
        self.assertIn("timesheet_staging_freeze", lab.REQUIRED_CLONE_TABLES)
        self.assertIn("timesheet_staging_outbox", lab.REQUIRED_CLONE_TABLES)
        self.assertIn("trg_timesheet_sync_derived_time", lab.REQUIRED_CLONE_TRIGGERS)

    def test_recreate_tidak_menghapus_ledger_migration(self):
        """Ledger tidak boleh dibersihkan setelah migration diterapkan.

        Versi lama menjalankan `DELETE FROM schema_migrations WHERE filename
        LIKE '20260922%'` sesudah menerapkan migration. Akibatnya tabel kontrak
        ADA tapi ledger kosong: Test 1 gagal, dan siapapun yang memeriksa
        ledger akan menyimpulkan migration tidak pernah jalan.
        """
        import inspect
        src = inspect.getsource(lab.recreate_plant_clone)
        self.assertNotIn("DELETE FROM public.schema_migrations", src)


class TestSubprocessGuards(unittest.TestCase):
    def test_run_checked_menaikkan_error_saat_returncode_bukan_nol(self):
        with self.assertRaises(RuntimeError) as ctx:
            lab.run_checked(
                [sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"],
                what="probe",
            )
        msg = str(ctx.exception)
        self.assertIn("probe", msg)
        self.assertIn("boom", msg)

    def test_run_checked_sukses_mengembalikan_stdout(self):
        out = lab.run_checked(
            [sys.executable, "-c", "print('halo')"],
            what="probe",
        )
        self.assertIn("halo", out)

    def test_restore_selalu_on_error_stop(self):
        import inspect
        src = inspect.getsource(lab)
        # setiap pemanggilan psql restore harus membawa ON_ERROR_STOP=1
        psql_calls = src.count('"psql"')
        guarded = src.count("ON_ERROR_STOP=1")
        self.assertGreaterEqual(guarded, psql_calls,
                                "setiap psql restore wajib memakai ON_ERROR_STOP=1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
