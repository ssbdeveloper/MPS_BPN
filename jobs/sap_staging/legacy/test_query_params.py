"""Kontrak query staging tanpa DB: jumlah placeholder == jumlah parameter.

Kelas bug ini sudah dua kali lolos ke production karena unit test murni tidak
pernah menyentuh SQL: menambah satu predicate baru menggeser posisi semua
parameter berikutnya, dan psycopg2 hanya mengeluh saat dijalankan. Test ini
menghitung `%s` pada teks SQL lalu membandingkannya dengan params yang benar-benar
dikirim, memakai koneksi palsu.
"""
from __future__ import annotations

import os
import unittest
from datetime import date, datetime
from unittest import mock

os.environ.setdefault("PLANT_SSB", "5100")
os.environ.setdefault("TIMEZONE", "Asia/Jakarta")

import stage_timesheet_transaction as mod  # noqa: E402


class FakeCursor:
    def __init__(self, sink):
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.sink["sql"] = sql
        self.sink["params"] = params

    def fetchall(self):
        return []


class FakeConn:
    def __init__(self, sink):
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self, *_, **__):
        return FakeCursor(self.sink)

    def __getattr__(self, name):
        return lambda *a, **k: None


class TestFetchRowsParams(unittest.TestCase):
    def _run(self):
        sink: dict = {}
        with mock.patch.object(mod, "connect_source", lambda: FakeConn(sink)), \
             mock.patch.object(mod, "load_sap_rules", lambda conn: {
                 "break_windows": [],
                 "max_record_minutes": {"timesheet": {}},
                 "max_record_fallback": {},
             }), \
             mock.patch.object(mod, "load_plant_cutoff", lambda conn, plant: date(2026, 9, 1)):
            mod.fetch_rows(datetime(2026, 9, 21, 0, 0), datetime(2026, 9, 22, 0, 0), 50)
        return sink

    def test_jumlah_placeholder_sama_dengan_jumlah_params(self):
        sink = self._run()
        self.assertIn("sql", sink, "fetch_rows tidak menjalankan query")
        sql, params = sink["sql"], sink["params"]
        self.assertEqual(
            sql.count("%s"), len(params),
            f"placeholder {sql.count('%s')} != params {len(params)} — "
            "urutan/penambahan predicate menggeser posisi parameter",
        )

    def test_exclusion_bukan_predicate_tetapi_flag(self):
        sink = self._run()
        sql = sink["sql"]
        self.assertIn("AS excluded", sql, "exclusion harus dihitung sebagai flag")
        self.assertNotIn(
            "AND NOT EXISTS (\n          SELECT 1 FROM public.sap_staging_exclusion",
            sql,
            "exclusion tidak boleh membuang baris: companion tetap perlu jadi pembagi",
        )

    def test_ada_flag_master_dan_open_row(self):
        sql = self._run()["sql"]
        self.assertIn("AS master_missing", sql)
        self.assertIn(
            "AND t.longdate_checkin < w.longdate_checkout", sql,
            "klausa marker emit harus tetap ada",
        )
        self.assertIn("AS operator_has_open_row", sql)

    def test_companion_lintas_tengah_malam_pakai_overlap_bukan_tanggal_checkin(self):
        sql = self._run()["sql"]
        self.assertIn("t.longdate_checkin < w.longdate_checkout", sql)
        self.assertIn("t.longdate_checkout > w.longdate_checkin", sql)
        self.assertNotIn(
            "(w.longdate_checkin AT TIME ZONE %s)::date",
            sql,
            "companion beda tanggal check-in akan hilang jika dicocokkan per date",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
