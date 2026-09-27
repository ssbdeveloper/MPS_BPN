#!/usr/bin/env python3
"""Kontrak crash/retry protokol outbox + kontrak cursor fail-closed.

Dijalankan HANYA terhadap lab lokal (`localhost:5432`, user `postgres`).
Tidak ada koneksi production, tidak ada HTTP ke SAP.

Yang dikunci di sini (permintaan owner):

Protokol outbox
  1. transaksi source membuat reservation/outbox `STAGING_RESERVED`;
  2. record yang sudah RESERVED terkunci dari perubahan payroll;
  3. commit reservation source lebih dulu (sebelum central);
  4. insert central staging + provenance idempoten;
  5. setelah central berhasil: freeze permanen + outbox `STAGED`;
  6. reconciler melanjutkan `STAGING_RESERVED` setelah crash;
  7. bila row central sudah ada, reconciler memfinalisasi tanpa duplikat;
  8. kegagalan tidak pasti TIDAK menghapus reservation/freeze.

Kontrak cursor
  9. mode manual `--from-ts/--to-ts` tidak membaca/memajukan cursor;
 10. tidak ada fallback ke `to_ts`;
 11. cursor mode fail-closed dan bukan default.
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[3]
JOBS_DIR = REPO_ROOT / "jobs" / "sap_staging"
sys.path.insert(0, str(JOBS_DIR))

LOCAL_HOST = "localhost"
LOCAL_PORT = 5432
LOCAL_USER = "postgres"
SOURCE_DB = "mps_timesheet_ckp_test"
STAGING_DB = "mps_sap_staging_test"
PLANT = "5100"

os.environ["DB_HOST"] = LOCAL_HOST
os.environ["DB_PORT"] = str(LOCAL_PORT)
os.environ["DB_NAME"] = SOURCE_DB
os.environ["DB_USER"] = LOCAL_USER
os.environ["SAP_STAGING_DB_HOST"] = LOCAL_HOST
os.environ["SAP_STAGING_DB_PORT"] = str(LOCAL_PORT)
os.environ["SAP_STAGING_DB_NAME"] = STAGING_DB
os.environ["SAP_STAGING_DB_USER"] = LOCAL_USER
os.environ["PLANT_SSB"] = PLANT
os.environ.setdefault("TIMEZONE", "Asia/Jakarta")

import stage_timesheet_transaction as stt  # noqa: E402
from sap_staging_common import insert_staging_rows  # noqa: E402

# tsnumber sintetis khusus test ini (jauh di atas data klon nyata).
TS_A = 990201
TS_B = 990202
TS_IDS = [TS_A, TS_B]


def conn_for(dbname: str, autocommit: bool = True):
    conn = psycopg2.connect(host=LOCAL_HOST, port=LOCAL_PORT, dbname=dbname, user=LOCAL_USER)
    with conn.cursor() as cur:
        cur.execute("SELECT inet_server_addr()")
        addr = cur.fetchone()[0]
        if addr is not None and str(addr).strip() not in ("127.0.0.1", "::1"):
            conn.close()
            raise RuntimeError(f"Koneksi {dbname} bukan loopback: {addr}")
    conn.commit()
    conn.autocommit = autocommit
    return conn


def mock_row(ref_id: int) -> dict:
    """Satu baris staging lengkap, meniru output fetch_rows() untuk satu segment."""
    start = datetime(2026, 9, 10, 8, 0, 0)
    end = datetime(2026, 9, 10, 9, 0, 0)
    return {
        "source_system": "TIMESHEET",
        "source_key": f"{PLANT}:{ref_id}",
        "is_correction": False,
        "source_ref_id": str(ref_id),
        "werks": PLANT,
        "pernr": "19722",
        "pernr_origin": "19722",
        "rueck": "123",
        "aufnr": "999901",
        "vornr": "0010",
        "flgat": "",
        "plnfl": "00",
        "vornr_b": "",
        "vornr_r": "",
        "zconf_type": "FINAL",
        "arbpl": "WS01",
        "lstar": "M1",
        "isdd": "20260910",
        "isdz": "080000",
        "iedd": "20260910",
        "iedz": "090000",
        "aueru": "X",
        "zbarcodeid": "",
        "bucket_start": start,
        "synthetic_start": start,
        "synthetic_end": end,
        "total_seconds": 3600,
        "source_row_count": 1,
        "source_min_start": start,
        "source_max_end": end,
        "provenance_snapshot": {"raw": 3600, "alloc": 3600, "cap": None, "sec": 3600},
        # insert_provenance() membaca row["segments"] -> satu provenance per source
        # segment. Di alur nyata segments datang dari jsonb_build_array() sehingga
        # `bucket` sudah berupa string ISO, bukan datetime Python.
        "segments": [{"id": str(ref_id), "bucket": start.isoformat(), "sec": 3600}],
        "raw_seconds": 3600,
        "allocated_seconds": 3600,
        "sap_effective_seconds": 3600,
    }


def clean_test_rows():
    src = conn_for(SOURCE_DB, autocommit=False)
    with src.cursor() as cur:
        cur.execute("DELETE FROM public.timesheet_staging_outbox WHERE plant = %s", (PLANT,))
        cur.execute("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber = ANY(%s)", (TS_IDS,))
    src.commit()
    src.close()

    stg = conn_for(STAGING_DB, autocommit=False)
    keys = [f"{PLANT}:{i}" for i in TS_IDS]
    refs = [str(i) for i in TS_IDS]
    with stg.cursor() as cur:
        cur.execute(
            "DELETE FROM public.sap_staging_source WHERE source_row_id = ANY(%s) AND plant = %s",
            (refs, PLANT),
        )
        cur.execute("DELETE FROM public.sap_timesheet_staging WHERE source_key = ANY(%s)", (keys,))
        cur.execute("DELETE FROM public.sap_staging_eligibility_audit WHERE source_key = ANY(%s)", (keys,))
    stg.commit()
    stg.close()


def count_central() -> tuple[int, int]:
    """(jumlah payload central, jumlah provenance) untuk tsnumber test."""
    keys = [f"{PLANT}:{i}" for i in TS_IDS]
    refs = [str(i) for i in TS_IDS]
    stg = conn_for(STAGING_DB)
    with stg.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.sap_timesheet_staging WHERE source_key = ANY(%s)", (keys,))
        payload = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM public.sap_staging_source WHERE source_row_id = ANY(%s) AND plant = %s",
            (refs, PLANT),
        )
        prov = cur.fetchone()[0]
    stg.close()
    return payload, prov


def outbox_rows() -> list[dict]:
    src = conn_for(SOURCE_DB)
    with src.cursor() as cur:
        cur.execute(
            "SELECT batch_id, status, source_ref_ids FROM public.timesheet_staging_outbox "
            "WHERE plant = %s ORDER BY id",
            (PLANT,),
        )
        rows = [{"batch_id": r[0], "status": r[1], "ids": r[2]} for r in cur.fetchall()]
    src.close()
    return rows


def freeze_state() -> dict[int, str]:
    src = conn_for(SOURCE_DB)
    with src.cursor() as cur:
        cur.execute(
            "SELECT tsnumber, first_seen_status FROM public.timesheet_staging_freeze "
            "WHERE tsnumber = ANY(%s)",
            (TS_IDS,),
        )
        state = {int(r[0]): r[1] for r in cur.fetchall()}
    src.close()
    return state


class OutboxCrashRetryTest(unittest.TestCase):
    """Skenario crash nyata pada protokol dua-database."""

    def setUp(self):
        clean_test_rows()
        self.addCleanup(clean_test_rows)
        self.rows = [mock_row(TS_A), mock_row(TS_B)]

    # ---------------------------------------------------------------- crash 1
    def test_crash_sebelum_central_insert_menyisakan_reservation_utuh(self):
        """Gagal SEBELUM central insert: reservation + freeze tetap ada, central kosong."""
        src = conn_for(SOURCE_DB, autocommit=False)
        batch_id, reserved = stt.reserve_staging_rows(src, self.rows)
        src.close()

        self.assertEqual(reserved, 2, "kedua tsnumber harus ter-reserve")

        # Commit reservation source HARUS sudah terjadi sebelum central disentuh.
        box = outbox_rows()
        self.assertEqual(len(box), 1)
        self.assertEqual(box[0]["status"], "STAGING_RESERVED")
        self.assertEqual(sorted(box[0]["ids"]), TS_IDS)

        # Freeze source sudah terpasang, statusnya menandai reservation.
        self.assertEqual(freeze_state(), {TS_A: "STAGING_RESERVED", TS_B: "STAGING_RESERVED"})

        # Central belum tersentuh — inilah titik crash.
        self.assertEqual(count_central(), (0, 0))

        # Kegagalan TIDAK BOLEH menghapus reservation/freeze secara otomatis.
        self.assertEqual(len(outbox_rows()), 1)

    # ---------------------------------------------------------------- crash 2
    def test_central_sudah_insert_tetapi_freeze_belum_selesai_difinalisasi_reconciler(self):
        """Central sukses, proses mati sebelum finalisasi: reconciler menutup gap tanpa duplikat."""
        src = conn_for(SOURCE_DB, autocommit=False)
        batch_id, _ = stt.reserve_staging_rows(src, self.rows)
        src.close()

        # Central insert BERHASIL...
        stg = conn_for(STAGING_DB, autocommit=False)
        insert_staging_rows(stg, self.rows)
        stg.close()
        self.assertEqual(count_central(), (2, 2), "2 payload + 2 provenance")

        # ...lalu proses mati: outbox masih STAGING_RESERVED.
        self.assertEqual(outbox_rows()[0]["status"], "STAGING_RESERVED")

        # Reconciler dijalankan pada run berikutnya.
        src = conn_for(SOURCE_DB, autocommit=False)
        stg = conn_for(STAGING_DB, autocommit=False)
        stt.retry_staging_reservations(src, stg, plant=PLANT)
        src.close()
        stg.close()

        # Tidak ada duplikat: tetap 2 payload dan 2 provenance.
        self.assertEqual(count_central(), (2, 2), "reconciler tidak boleh menduplikasi")

        # Status akhir STAGED, freeze menjadi permanen.
        box = outbox_rows()
        self.assertEqual(len(box), 1, "tidak boleh ada batch tambahan")
        self.assertEqual(box[0]["status"], "STAGED")
        self.assertEqual(freeze_state(), {TS_A: "PENDING", TS_B: "PENDING"})

    # ---------------------------------------------------------------- crash 3
    def test_rerun_reconciler_idempoten(self):
        """Reconciler dijalankan dua kali tidak menambah payload/provenance/freeze."""
        src = conn_for(SOURCE_DB, autocommit=False)
        stt.reserve_staging_rows(src, self.rows)
        src.close()

        for _ in range(2):
            src = conn_for(SOURCE_DB, autocommit=False)
            stg = conn_for(STAGING_DB, autocommit=False)
            stt.retry_staging_reservations(src, stg, plant=PLANT)
            src.close()
            stg.close()

        self.assertEqual(count_central(), (2, 2), "satu payload central saja per source row")
        self.assertEqual(len(outbox_rows()), 1)
        self.assertEqual(outbox_rows()[0]["status"], "STAGED")
        self.assertEqual(len(freeze_state()), 2, "satu freeze per source row")

    # ---------------------------------------------------------------- guard
    def test_record_reserved_terkunci_dari_perubahan_payroll(self):
        """Begitu RESERVED, field payroll source terkunci (bukan menunggu STAGED)."""
        # Pakai tsnumber nyata dari klon supaya trigger punya baris untuk diuji.
        src = conn_for(SOURCE_DB, autocommit=False)
        with src.cursor() as cur:
            cur.execute(
                "SELECT tsnumber FROM public.timesheet_transaction "
                "WHERE longdate_checkout IS NOT NULL "
                "  AND tsnumber NOT IN (SELECT tsnumber FROM public.timesheet_staging_freeze) "
                "LIMIT 1"
            )
            row = cur.fetchone()
        if not row:
            src.close()
            self.skipTest("tidak ada baris timesheet bebas freeze di klon")
        ts = int(row[0])

        with src.cursor() as cur:
            cur.execute(
                "SELECT public.timesheet_mark_staged(%s::integer[], %s, %s, %s, NULL)",
                ([ts], PLANT, "STAGING_RESERVED", "test reservation lock"),
            )
        src.commit()

        try:
            with self.assertRaises(psycopg2.Error) as ctx:
                with src.cursor() as cur:
                    cur.execute(
                        "UPDATE public.timesheet_transaction "
                        "SET longdate_checkout = longdate_checkout + interval '1 hour' "
                        "WHERE tsnumber = %s",
                        (ts,),
                    )
            src.rollback()
            self.assertIn("frozen", str(ctx.exception).lower())
        finally:
            with src.cursor() as cur:
                cur.execute("DELETE FROM public.timesheet_staging_freeze WHERE tsnumber = %s", (ts,))
            src.commit()
            src.close()


class PayloadSerializationTest(unittest.TestCase):
    """Payload outbox adalah satu-satunya salinan baris untuk crash-recovery."""

    def test_serializer_menangani_datetime_bersarang(self):
        """datetime di dalam list/dict bersarang harus ikut dikonversi.

        Kalau tidak, json.dumps() meledak SETELAH freeze terpasang tetapi SEBELUM
        commit reservation, sehingga run mati tanpa payload yang bisa di-resume.
        """
        from stage_timesheet_transaction import _json_safe
        import json

        payload = {
            "top": datetime(2026, 9, 10, 8, 0, 0),
            "segments": [{"id": "1", "bucket": datetime(2026, 9, 10, 8, 0, 0)}],
            "nested": {"deep": {"when": datetime(2026, 9, 10, 9, 0, 0)}},
            "plain": 3600,
        }
        out = _json_safe(payload)
        json.dumps(out)  # tidak boleh raise
        self.assertEqual(out["top"], "2026-09-10T08:00:00")
        self.assertEqual(out["segments"][0]["bucket"], "2026-09-10T08:00:00")
        self.assertEqual(out["nested"]["deep"]["when"], "2026-09-10T09:00:00")
        self.assertEqual(out["plain"], 3600)


class CursorContractTest(unittest.TestCase):
    """Kontrak cursor: manual window tidak menyentuh cursor; cursor mode fail-closed."""

    def _args(self, **kw):
        import argparse

        base = dict(
            from_ts="2026-09-08T00:00:00",
            to_ts="2026-09-09T00:00:00",
            limit=1000,
            dry_run=False,
            retry_reservations=False,
            loop=0,
        )
        base.update(kw)
        return argparse.Namespace(**base)

    def test_manual_window_tidak_mengubah_sap_stage_cursor(self):
        """Explicit window tidak boleh membaca maupun memajukan cursor."""
        # Prasyarat: cutoff plant harus terisi, kalau tidak stager fail-closed
        # sebelum sempat menyentuh cursor (rebuild lab mengosongkannya).
        src = conn_for(SOURCE_DB, autocommit=False)
        with src.cursor() as cur:
            cur.execute(
                "UPDATE public.plant_config SET timesheet_allocation_cutoff_date = %s "
                "WHERE timesheet_allocation_cutoff_date IS NULL",
                (datetime(2026, 1, 1).date(),),
            )
        src.commit()
        src.close()

        stg = conn_for(STAGING_DB, autocommit=False)
        with stg.cursor() as cur:
            cur.execute("DELETE FROM public.sap_stage_cursor WHERE source_system = 'TIMESHEET'")
            cur.execute(
                "INSERT INTO public.sap_stage_cursor (source_system, plant, last_processed_at) "
                "VALUES ('TIMESHEET', %s, %s)",
                (PLANT, datetime(2026, 1, 1, 0, 0, 0)),
            )
        stg.commit()
        stg.close()

        args = self._args(dry_run=True)
        stt.run_once(args)

        stg = conn_for(STAGING_DB)
        with stg.cursor() as cur:
            cur.execute(
                "SELECT last_processed_at FROM public.sap_stage_cursor "
                "WHERE source_system = 'TIMESHEET' AND plant = %s",
                (PLANT,),
            )
            got = cur.fetchone()
        stg.close()
        self.assertIsNotNone(got, "baris cursor tidak boleh dihapus")
        self.assertEqual(
            got[0], datetime(2026, 1, 1, 0, 0, 0),
            "manual explicit window TIDAK BOLEH memajukan sap_stage_cursor",
        )

    def test_cursor_mode_fail_closed_dan_bukan_default(self):
        """Tanpa window eksplisit harus gagal keras, bukan diam-diam memakai cursor."""
        with self.assertRaises(ValueError) as ctx:
            stt.validate_manual_window(self._args(from_ts=None, to_ts=None), "Asia/Jakarta")
        self.assertIn("fail-closed", str(ctx.exception).lower())

    def test_cursor_tidak_boleh_fallback_ke_to_ts(self):
        """next_cursor_value tidak boleh melompat ke to_ts ketika batch tertahan LIMIT.

        Bila sebagian row tertahan LIMIT, cursor harus tetap berada pada checkout
        terakhir yang BENAR-BENAR diproses, bukan melompat ke akhir window.
        """
        from stage_batching import next_cursor_value

        to_ts = datetime(2026, 9, 9, 0, 0, 0)
        processed = [
            {"longdate_checkout": datetime(2026, 9, 8, 10, 0, 0)},
            {"longdate_checkout": datetime(2026, 9, 8, 11, 0, 0)},
        ]
        got = next_cursor_value(processed, fallback=to_ts)
        self.assertEqual(
            got, datetime(2026, 9, 8, 11, 0, 0),
            "cursor harus berhenti di checkout terakhir yang diproses, bukan to_ts",
        )
        self.assertLess(got, to_ts, "cursor tidak boleh melewati row yang belum diproses")

    def test_cursor_window_helper_tidak_boleh_dipakai_stager_timesheet(self):
        """Helper cursor otomatis harus mati total di jalur timesheet (fail-closed)."""
        self.assertTrue(
            hasattr(stt, "cursor_window"),
            "helper masih ada — kalau dihapus, test ini harus ikut diperbarui",
        )
        with self.assertRaises(RuntimeError) as ctx:
            stt.cursor_window(None, 0, 0)
        self.assertIn("fail-closed", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
