#!/usr/bin/env python3
"""Kontrak allowlist function lab (handoff §7: "pengelola lab memberi sukses palsu").

TIMESHEET_FUNCTION_ALLOWLIST menyaring function mana yang dipasang ke clone.
Bila isinya nama yang TIDAK PERNAH ADA, `install_functions` menyaring semuanya,
mengembalikan 0, dan rebuild tetap melaporkan sukses — clone lahir tanpa trigger
timesheet sama sekali. Test ini mengikat allowlist ke kenyataan database lokal.

Murni lokal: hanya menyentuh localhost:5432, tidak pernah production.
"""
import os
import sys
import unittest

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manage_local_lab as mll  # noqa: E402

LOCAL_DSN = dict(host="localhost", port=5432, user="postgres", dbname="mps_timesheet_ckp_test")

# Function timesheet yang benar-benar hidup di clone lokal dan dibutuhkan
# pipeline (trigger derived-time, freeze guard, audit append-only, staging).
REQUIRED_IN_CLONE = {
    "timesheet_sync_derived_time",
    "timesheet_mark_staged",
    "timesheet_guard_frozen_payroll",
    "timesheet_correction_audit_append_only",
    "resolve_shift_definition",
}


def local_function_names() -> set:
    pwd = os.environ.get("PGPASSWORD") or mll.load_secrets()[1]
    conn = psycopg2.connect(password=pwd, connect_timeout=5, **LOCAL_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT p.proname FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace "
                "LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e' "
                "WHERE n.nspname = 'public' AND d.objid IS NULL"
            )
            return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


class TestFunctionAllowlistMatchesReality(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.actual = local_function_names()

    def test_allowlist_tidak_berisi_nama_hantu(self):
        """Setiap nama di allowlist harus benar-benar ada di clone lokal."""
        ghosts = sorted(mll.TIMESHEET_FUNCTION_ALLOWLIST - self.actual)
        self.assertEqual(
            ghosts, [],
            f"Allowlist menyebut function yang tidak ada: {ghosts}. "
            "install_functions akan menyaring semuanya dan rebuild sukses palsu.",
        )

    def test_function_timesheet_wajib_ada_di_allowlist(self):
        """Function pipeline yang nyata harus lolos filter allowlist."""
        present_required = REQUIRED_IN_CLONE & self.actual
        missing = sorted(present_required - mll.TIMESHEET_FUNCTION_ALLOWLIST)
        self.assertEqual(
            missing, [],
            f"Function nyata ini tidak akan dipasang ke clone: {missing}",
        )

    def test_allowlist_menghasilkan_instalasi_tidak_nol(self):
        """Irisan allowlist dengan kenyataan tidak boleh kosong."""
        overlap = mll.TIMESHEET_FUNCTION_ALLOWLIST & self.actual
        self.assertGreater(
            len(overlap), 0,
            "Tidak ada satu pun function yang lolos allowlist — install_functions "
            "pasti mengembalikan 0 dan clone lahir tanpa trigger.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
