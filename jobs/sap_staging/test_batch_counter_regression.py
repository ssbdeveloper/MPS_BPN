#!/usr/bin/env python3
"""Regresi counter batch > PAGE_SIZE (handoff: "counter salah untuk batch besar").

psycopg2.extras.execute_values hanya menyetel cur.rowcount untuk statement
TERAKHIR yang dieksekusinya. Bila seluruh batch dikirim dalam satu panggilan
dengan page_size internal, rowcount yang dibaca hanya mencerminkan page
terakhir — batch 2.500 baris dilaporkan sebagai 500.

Test ini memakai fake cursor yang meniru perilaku itu persis, sehingga jalur
produksi wajib mengakumulasi per page.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import sap_staging_common as common  # noqa: E402


class FakeCursor:
    """Meniru execute_values: rowcount = ukuran page TERAKHIR saja."""

    def __init__(self, recorder):
        self.rowcount = -1
        self.recorder = recorder

    def execute(self, sql, params=None):
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self):
        self.pages = []
        self.committed = False
        self._cur = FakeCursor(self.pages)

    def cursor(self, *a, **k):
        return self._cur

    def commit(self):
        self.committed = True


def fake_execute_values(cur, sql, argslist, template=None, page_size=100):
    """Replikasi kontrak psycopg2: eksekusi per page, rowcount = page terakhir."""
    last = 0
    for i in range(0, len(argslist), page_size):
        page = argslist[i : i + page_size]
        cur.recorder.append(len(page))
        last = len(page)
    cur.rowcount = last


class BaseCounterTest(unittest.TestCase):
    def setUp(self):
        self._orig = common.psycopg2.extras.execute_values
        common.psycopg2.extras.execute_values = fake_execute_values

    def tearDown(self):
        common.psycopg2.extras.execute_values = self._orig


class TestInsertStagingRowsCounter(BaseCounterTest):
    def _rows(self, n):
        rows = []
        for i in range(n):
            row = {c: "" for c in common.STAGING_COLUMNS}
            row["source_system"] = "TIMESHEET"
            row["source_key"] = f"5100:{i}"
            row["werks"] = "5100"
            rows.append(row)
        return rows

    def test_batch_2500_dilaporkan_2500_bukan_500(self):
        conn = FakeConn()
        n = 2500
        total = common.insert_staging_rows(conn, self._rows(n))
        self.assertEqual(
            total, n,
            f"counter harus {n}; nilai {total} berarti hanya page terakhir yang dihitung",
        )

    def test_batch_di_bawah_page_size_tetap_benar(self):
        conn = FakeConn()
        self.assertEqual(common.insert_staging_rows(conn, self._rows(37)), 37)

    def test_batch_tepat_kelipatan_page_size(self):
        conn = FakeConn()
        self.assertEqual(common.insert_staging_rows(conn, self._rows(2000)), 2000)

    def test_batch_kosong_nol(self):
        conn = FakeConn()
        self.assertEqual(common.insert_staging_rows(conn, []), 0)


class TestEligibilityAuditCounter(BaseCounterTest):
    def _rows(self, n):
        return [{
            "source_system": "TIMESHEET",
            "source_key": f"5100:{i}",
            "source_ref_id": str(i),
            "source_date": "2026-09-08",
            "plant": "5100",
            "eligibility_status": "BLOCKED",
            "block_reason": "INCOMPLETE_MASTER",
            "block_detail": "{}",
        } for i in range(n)]

    def test_audit_batch_2500_dilaporkan_2500(self):
        conn = FakeConn()
        total = common.upsert_eligibility_audit(conn, self._rows(2500))
        self.assertEqual(total, 2500)

    def test_audit_batch_kecil_benar(self):
        conn = FakeConn()
        self.assertEqual(common.upsert_eligibility_audit(conn, self._rows(12)), 12)

    def test_audit_kosong_nol(self):
        conn = FakeConn()
        self.assertEqual(common.upsert_eligibility_audit(conn, []), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
