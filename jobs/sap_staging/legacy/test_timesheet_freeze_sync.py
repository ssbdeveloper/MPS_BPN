"""Kontrak sinkronisasi freeze sesudah staging berhasil (#5-#6).

Tidak memakai DB production. Fake connection mencatat SQL/transaksi.
"""
from __future__ import annotations

import unittest
import json

from stage_timesheet_transaction import (
    mark_rows_frozen,
    reconcile_freeze_registry,
    reserve_staging_rows,
    mark_reservation_staged,
    list_pending_reservations,
    retry_staging_reservations,
    validate_manual_window,
)


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self.rowcount = 0
        self.description = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.conn.calls.append((" ".join(sql.split()), params))
        self.rowcount = self.conn.next_rowcount

    def fetchone(self):
        return (self.conn.fetch_value,)

    def fetchall(self):
        if self.conn.calls and "information_schema.tables" in self.conn.calls[-1][0]:
            return [("timesheet_staging_outbox",), ("timesheet_staging_freeze",)]
        return self.conn.fetchall_values


class FakeConnection:
    def __init__(self, *, fetch_value=0, next_rowcount=0, fetchall_values=None):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.fetch_value = fetch_value
        self.next_rowcount = next_rowcount
        self.fetchall_values = fetchall_values or []

    def cursor(self, *_, **__):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class TestFreezeSync(unittest.TestCase):
    def test_reserve_staging_rows_membuat_outbox_dan_freeze_source(self):
        conn = FakeConnection(fetch_value=2)
        batch_id, count = reserve_staging_rows(conn, [
            {"source_ref_id": "101", "werks": "5100"},
            {"source_ref_id": "102", "werks": "5100"},
        ], batch_id="batch-001")
        self.assertEqual(count, 2)
        self.assertEqual(batch_id, "batch-001")
        self.assertEqual(conn.commits, 1)  # Read-only schema check does not commit, 1 commit for reserve
        # Pastikan mark_staged dipanggil dengan STAGING_RESERVED
        mark_call = next(c for c in conn.calls if "timesheet_mark_staged" in c[0])
        self.assertIn("STAGING_RESERVED", mark_call[1][2])
        # Pastikan outbox di-insert dengan status RESERVED
        outbox_call = next(c for c in conn.calls if "timesheet_staging_outbox" in c[0] and "INSERT" in c[0])
        self.assertEqual(outbox_call[1][0], "batch-001")
        self.assertEqual(outbox_call[1][1], "5100")
        self.assertEqual(outbox_call[1][2], [101, 102])

    def test_mark_reservation_staged_mengubah_status_menjadi_staged(self):
        conn = FakeConnection(next_rowcount=2)
        count = mark_reservation_staged(conn, batch_id="batch-001", ids=[101, 102])
        self.assertEqual(count, 2)
        self.assertEqual(conn.commits, 1)
        outbox_call = next(c for c in conn.calls if "timesheet_staging_outbox" in c[0] and "UPDATE" in c[0])
        self.assertEqual(outbox_call[1][0], "batch-001")
        freeze_call = next(c for c in conn.calls if "timesheet_staging_freeze" in c[0] and "UPDATE" in c[0])
        self.assertEqual(freeze_call[1][0], [101, 102])

    def test_mark_rows_frozen_tolak_plant_campur(self):
        conn = FakeConnection()
        with self.assertRaisesRegex(ValueError, "plant"):
            mark_rows_frozen(conn, [
                {"source_ref_id": "101", "werks": "5100"},
                {"source_ref_id": "102", "werks": "5051"},
            ])
        self.assertEqual(conn.commits, 0)

    def test_snapshot_raw_alloc_cap_final_ikut_dikirim(self):
        conn = FakeConnection(fetch_value=1)
        mark_rows_frozen(conn, [{
            "source_ref_id": "101", "werks": "5100",
            "raw_seconds": 21600, "allocated_seconds": 10800,
            "cap_minutes": 240, "sap_effective_seconds": 10800,
        }])
        mark_call = next(c for c in conn.calls if "timesheet_mark_staged" in c[0])
        snapshot = json.loads(mark_call[1][4])
        self.assertEqual(snapshot["101"]["raw"], 21600)
        self.assertEqual(snapshot["101"]["alloc"], 10800)
        self.assertEqual(snapshot["101"]["cap"], 240 * 60)
        self.assertEqual(snapshot["101"]["sec"], 10800)
        self.assertEqual(snapshot["101"]["raw_seconds"], 21600)
        self.assertEqual(snapshot["101"]["allocated_seconds"], 10800)
        self.assertEqual(snapshot["101"]["cap_seconds"], 240 * 60)
        self.assertEqual(snapshot["101"]["sap_effective_seconds"], 10800)
        self.assertEqual(snapshot["101"]["allocation_version"], "effective-segments-v1")

    def test_reconcile_dari_provenance_dan_exclusion_monotonic(self):
        conn = FakeConnection(next_rowcount=7)
        count = reconcile_freeze_registry(conn, plant="5100")
        self.assertEqual(count, 7)
        self.assertEqual(conn.commits, 1)
        sql, params = conn.calls[0]
        self.assertIn("sap_staging_source", sql)
        self.assertIn("sap_staging_exclusion", sql)
        self.assertIn("ON CONFLICT (tsnumber) DO NOTHING", sql)
        self.assertEqual(params, ("5100", "5100"))


class TestManualWindowValidation(unittest.TestCase):
    """Work A: Mode cursor diparkir & validasi rentang manual ketat."""

    def test_tanpa_rentang_ditolak(self):
        import argparse
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        args = argparse.Namespace(from_ts=None, to_ts=None, loop=0)
        with self.assertRaisesRegex(ValueError, "wajib dijalankan manual"):
            validate_manual_window(args, tz)

    def test_hanya_satu_parameter_ditolak(self):
        import argparse
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        args = argparse.Namespace(from_ts="2026-09-20T00:00:00", to_ts=None, loop=0)
        with self.assertRaisesRegex(ValueError, "harus digunakan berpasangan"):
            validate_manual_window(args, tz)

    def test_mode_loop_cursor_ditolak(self):
        import argparse
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        args = argparse.Namespace(from_ts="2026-09-20T00:00:00", to_ts="2026-09-21T00:00:00", loop=3)
        with self.assertRaisesRegex(ValueError, "dinonaktifkan"):
            validate_manual_window(args, tz)

    def test_rentang_kosong_atau_terbalik_ditolak(self):
        import argparse
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        args = argparse.Namespace(from_ts="2026-09-21T00:00:00", to_ts="2026-09-20T00:00:00", loop=0)
        with self.assertRaisesRegex(ValueError, "harus lebih awal"):
            validate_manual_window(args, tz)

    def test_hari_berjalan_ditolak(self):
        import argparse
        from datetime import datetime
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        now = datetime.now(tz)
        today_str = now.strftime("%Y-%m-%d")
        args = argparse.Namespace(
            from_ts=f"{today_str}T00:00:00",
            to_ts=f"{today_str}T12:00:00",
            loop=0,
        )
        with self.assertRaisesRegex(ValueError, "hari berjalan"):
            validate_manual_window(args, tz)

    def test_hari_lampau_lengkap_diterima(self):
        import argparse
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Jakarta")
        args = argparse.Namespace(
            from_ts="2026-09-18T00:00:00",
            to_ts="2026-09-19T00:00:00",
            loop=0,
        )
        f, t = validate_manual_window(args, tz)
        self.assertEqual(f.strftime("%Y-%m-%d"), "2026-09-18")
        self.assertEqual(t.strftime("%Y-%m-%d"), "2026-09-19")


class TestProvenanceSnapshot(unittest.TestCase):
    """#17: empat angka harus bertahan sampai ke payload staging pusat."""

    def test_staging_columns_memuat_provenance_snapshot(self):
        import sap_staging_common as common
        self.assertIn("provenance_snapshot", common.STAGING_COLUMNS,
                      "snapshot harus ikut ditulis ke staging, bukan hanya ke memory")
        self.assertIn("PROVENANCE_SNAPSHOT", common.PAYLOAD_UPDATE_SQL,
                      "payload staging harus menyimpan snapshot rekonsiliasi")

    def test_ddl_membuat_kolom_snapshot_idempotent(self):
        import sap_staging_common as common
        self.assertIn("provenance_snapshot jsonb", common.DDL)
        self.assertIn("ADD COLUMN IF NOT EXISTS provenance_snapshot", common.DDL,
                      "tabel lama harus di-upgrade idempotent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
