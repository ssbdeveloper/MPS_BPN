#!/usr/bin/env python3
"""Kontrak F1: capture, run manifest, source hash, snapshot, idempotensi, keamanan.

Plan: docs/planning/2026-09-23-timesheet-etl-berlapis.md (§6 Tahap A, §7 CLI, §9 F1)

Dijalankan HANYA terhadap lab lokal (`localhost:5432`, user `postgres`).
Tidak ada koneksi central/AWS dan tidak ada HTTP.

Test wajib yang dicakup file ini:
  3  dry-run tidak mengubah checksum database
  4  execute membuat satu run manifest
  5  input snapshot sama dengan source pada saat capture
  6  source hash stabil untuk input yang sama
  7  perubahan satu field payroll mengubah source hash
  8  rerun identik tidak menggandakan versi input
  9  open timesheet tidak tertangkap
  10 interval invalid tidak tertangkap dan dilaporkan
  11 timezone Cikupa dan Balikpapan benar
  12 tidak ada koneksi central/AWS dan tidak ada HTTP SAP
  14 sabotase unique/hash/dry-run harus membuat test terkait gagal
"""
from __future__ import annotations

import inspect
import os
import sys
import unittest
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_timesheet_etl as etl  # noqa: E402

CKP = "mps_timesheet_ckp_test"
BPN = "mps_timesheet_bpn_test"

# Window uji kecil: SENGAJA sempit supaya test cepat dan tidak bergantung pada
# jumlah row snapshot (test wajib 13: jangan hard-code jumlah row).
TEST_FROM = datetime(2026, 9, 19, 0, 0, tzinfo=timezone.utc)
TEST_TO = datetime(2026, 9, 19, 6, 0, tzinfo=timezone.utc)


def lab_conn(dbname: str, autocommit: bool = False):
    conn = psycopg2.connect(host="localhost", port=5432, dbname=dbname, user="postgres")
    conn.autocommit = autocommit
    return conn


def set_correction_context(cur, actor: str = "etl-f1-test", reason: str = "cleanup row sintetis"):
    """Isi session context untuk guard audit payroll.

    Trigger `timesheet_guard_frozen_payroll` menolak UPDATE/DELETE pada
    timesheet_transaction tanpa actor dan reason. Ini perilaku yang BENAR dan
    justru sedang diuji; test yang menanam row sintetis harus menyediakan konteks
    yang sama seperti koreksi admin sungguhan.
    """
    cur.execute("SELECT set_config('mps.correction_actor', %s, true)", (actor,))
    cur.execute("SELECT set_config('mps.correction_reason', %s, true)", (reason,))


def delete_synthetic_row(conn, tsnumber: int):
    """Hapus row sintetis di SATU transaksi bersama konteks koreksinya.

    `set_config(..., is_local=true)` hanya berlaku sampai akhir transaksi. Kalau
    koneksi autocommit, SET dan DELETE jatuh di transaksi berbeda dan guard audit
    menolak DELETE dengan benar — jadi keduanya dipaksa satu transaksi di sini.
    """
    was_autocommit = conn.autocommit
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            set_correction_context(cur)
            cur.execute("DELETE FROM public.timesheet_transaction WHERE tsnumber = %s", (tsnumber,))
        conn.commit()
    finally:
        conn.autocommit = was_autocommit


def dict_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


class SourceHashTest(unittest.TestCase):
    """Test 6 dan 7: hash deterministik, sensitif microsecond, dan sensitif terhadap setiap field payroll."""

    def _base_row(self) -> dict:
        return {
            "plant": "5100",
            "serialnumber": "12345",
            "activitytype": "",
            "order_no": "000123",
            "operation_no": 10,
            "workcentercode": "WC01",
            "confirmationnumber": "CONF-1",
            "state_flag": 2,
            "longdate_checkin": datetime(2026, 9, 15, 1, 0, 0, 123456, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 15, 2, 0, 0, 654321, tzinfo=timezone.utc),
        }

    def test_hash_stabil_untuk_input_sama(self):
        row = self._base_row()
        first = etl.compute_source_hash(row)
        second = etl.compute_source_hash(dict(row))
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64, "source_hash harus sha256 hex")

    def test_hash_tidak_terpengaruh_urutan_dict(self):
        row = self._base_row()
        shuffled = dict(reversed(list(row.items())))
        self.assertEqual(etl.compute_source_hash(row), etl.compute_source_hash(shuffled))

    def test_timezone_berbeda_menghasilkan_hash_sama_untuk_instan_sama(self):
        """Instant yang sama tidak boleh ber-hash beda hanya karena offset berbeda."""
        utc_row = self._base_row()
        wib = timezone(__import__("datetime").timedelta(hours=7))
        wita = timezone(__import__("datetime").timedelta(hours=8))
        local_row_wib = self._base_row()
        local_row_wib["longdate_checkin"] = utc_row["longdate_checkin"].astimezone(wib)
        local_row_wib["longdate_checkout"] = utc_row["longdate_checkout"].astimezone(wib)
        local_row_wita = self._base_row()
        local_row_wita["longdate_checkin"] = utc_row["longdate_checkin"].astimezone(wita)
        local_row_wita["longdate_checkout"] = utc_row["longdate_checkout"].astimezone(wita)

        utc_hash = etl.compute_source_hash(utc_row)
        self.assertEqual(utc_hash, etl.compute_source_hash(local_row_wib))
        self.assertEqual(utc_hash, etl.compute_source_hash(local_row_wita))

    def test_perubahan_100_microsecond_pada_checkin_mengubah_hash(self):
        from datetime import timedelta
        base = self._base_row()
        base_hash = etl.compute_source_hash(base)
        mutated = dict(base)
        mutated["longdate_checkin"] = base["longdate_checkin"] + timedelta(microseconds=100)
        self.assertNotEqual(
            etl.compute_source_hash(mutated),
            base_hash,
            "perubahan 100 microsecond pada checkin harus mengubah source_hash",
        )

    def test_perubahan_100_microsecond_pada_checkout_mengubah_hash(self):
        from datetime import timedelta
        base = self._base_row()
        base_hash = etl.compute_source_hash(base)
        mutated = dict(base)
        mutated["longdate_checkout"] = base["longdate_checkout"] + timedelta(microseconds=100)
        self.assertNotEqual(
            etl.compute_source_hash(mutated),
            base_hash,
            "perubahan 100 microsecond pada checkout harus mengubah source_hash",
        )

    def test_setiap_field_payroll_mengubah_hash(self):
        """Test 7: perubahan SATU field payroll harus mengubah hash."""
        mutations = {
            "serialnumber": "99999",
            "activitytype": "1680",
            "order_no": "000999",
            "operation_no": 99,
            "workcentercode": "WC99",
            "confirmationnumber": "CONF-9",
            "state_flag": 3,
            "longdate_checkin": datetime(2026, 9, 15, 1, 0, 1, 123456, tzinfo=timezone.utc),
            "longdate_checkout": datetime(2026, 9, 15, 2, 0, 1, 654321, tzinfo=timezone.utc),
        }
        base_hash = etl.compute_source_hash(self._base_row())
        for field, value in mutations.items():
            with self.subTest(field=field):
                row = self._base_row()
                row[field] = value
                self.assertNotEqual(
                    etl.compute_source_hash(row), base_hash,
                    f"mengubah {field} tidak mengubah source_hash",
                )

    def test_timestamp_naif_ditolak(self):
        row = self._base_row()
        row["longdate_checkin"] = datetime(2026, 9, 15, 1, 0, 0, 123456)  # naif
        with self.assertRaises(etl.EtlError):
            etl.compute_source_hash(row)

    def test_eligibility_durasi_satu_detik_tidak_mengubah_presisi_source_hash(self):
        """Durasi < 1 detik tetap memiliki presisi microsecond penuh pada identity hash-nya."""
        from datetime import timedelta
        row = self._base_row()
        # Selisih 0.5 detik (500_000 microsecond)
        row["longdate_checkout"] = row["longdate_checkin"] + timedelta(milliseconds=500)
        hash_1 = etl.compute_source_hash(row)

        row_plus_100us = dict(row)
        row_plus_100us["longdate_checkout"] = row["longdate_checkout"] + timedelta(microseconds=100)
        hash_2 = etl.compute_source_hash(row_plus_100us)

        self.assertNotEqual(
            hash_1, hash_2,
            "record sub-detik harus tetap peka terhadap microsecond pada source_hash",
        )


class DryRunReadOnlyTest(unittest.TestCase):
    """Test 3: dry-run tidak mengubah checksum database."""

    def test_dry_run_tidak_menulis(self):
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                summary = etl.run_dry_run(
                    cur, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version=etl.ALLOCATION_VERSION,
                )
                self.assertEqual(summary["wrote_rows"], 0)
                self.assertEqual(summary["fingerprint_before"], summary["fingerprint_after"])
        finally:
            conn.rollback()
            conn.close()

    def test_fingerprint_berubah_bila_ada_tulis(self):
        """Sabotase: fingerprint HARUS sensitif, kalau tidak bukti read-only palsu."""
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                before = etl.database_fingerprint(cur)
                cur.execute(
                    """
                    INSERT INTO public.timesheet_etl_run
                      (plant, from_ts, to_ts, plant_timezone, allocation_version, created_by)
                    VALUES ('5100', %s, %s, 'Asia/Jakarta', 'v-test', 'fingerprint-sabotage')
                    """,
                    (TEST_FROM, TEST_TO),
                )
                after = etl.database_fingerprint(cur)
                self.assertNotEqual(
                    before, after,
                    "fingerprint tidak mendeteksi tulis — bukti dry-run read-only tidak sah",
                )
        finally:
            conn.rollback()
            conn.close()


class CaptureContractTest(unittest.TestCase):
    """Test 4, 5, 9, 10: run manifest, snapshot, open, interval invalid."""

    def test_dry_run_report_rekonsiliasi(self):
        """kandidat + subdetik + inverted harus sama dengan total closed."""
        for dbname in (CKP, BPN):
            with self.subTest(db=dbname):
                conn = lab_conn(dbname)
                try:
                    with dict_cursor(conn) as cur:
                        cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                        row = cur.fetchone()
                        cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                        summary = etl.run_dry_run(
                            cur, cfg=cfg, dbname=dbname, from_ts=TEST_FROM, to_ts=TEST_TO,
                            allocation_version=etl.ALLOCATION_VERSION,
                        )
                        # Ambil ulang komponennya lewat query yang sama seperti capture.
                        captured = etl.capture_candidates(
                            cur, plant=cfg["plant"], tz=cfg["timezone"],
                            from_ts=TEST_FROM, to_ts=TEST_TO,
                        )
                        self.assertEqual(
                            len(captured["rows"]) + captured["subsecond_count"]
                            + captured["invalid_count"],
                            captured["total_closed"],
                        )
                        self.assertEqual(summary["candidates"], len(captured["rows"]))
                finally:
                    conn.rollback()
                    conn.close()

    def test_open_timesheet_tidak_tertangkap(self):
        """Test 9: row tanpa checkout tidak boleh masuk capture."""
        conn = lab_conn(CKP, autocommit=True)
        ts = 995001
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, longdate_checkin, longdate_checkout, state_flag)
                    VALUES (%s, '5100', '99001', '2026-09-15T01:00:00+00:00', NULL, 0)
                    """,
                    (ts,),
                )
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                captured = etl.capture_candidates(
                    cur, plant=cfg["plant"], tz=cfg["timezone"],
                    from_ts=TEST_FROM, to_ts=TEST_TO,
                )
                tsnumbers = [r["tsnumber"] for r in captured["rows"]]
                self.assertNotIn(ts, tsnumbers, "row open ikut tertangkap")
        finally:
            delete_synthetic_row(conn, ts)
            conn.close()

    def test_interval_terbalik_dilaporkan_tidak_diambil(self):
        """Test 10: interval invalid tidak tertangkap dan dilaporkan."""
        conn = lab_conn(CKP, autocommit=True)
        ts = 995002
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, longdate_checkin, longdate_checkout, state_flag)
                    VALUES (%s, '5100', '99002', '2026-09-19T03:00:00+00:00', '2026-09-19T02:00:00+00:00', 0)
                    """,
                    (ts,),
                )
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                captured = etl.capture_candidates(
                    cur, plant=cfg["plant"], tz=cfg["timezone"],
                    from_ts=TEST_FROM, to_ts=TEST_TO,
                )
                self.assertNotIn(ts, [r["tsnumber"] for r in captured["rows"]])
                self.assertGreaterEqual(captured["invalid_count"], 1, "inverted tidak dilaporkan")
                self.assertIn("INVALID_INTERVAL", captured["exclusions"])
                self.assertIn("DURATION_LT_1_SECOND", captured["exclusions"])
                self.assertEqual(captured["exclusions"]["INVALID_INTERVAL"], captured["invalid_count"])
                self.assertEqual(captured["exclusions"]["DURATION_LT_1_SECOND"], captured["subsecond_count"])
        finally:
            delete_synthetic_row(conn, ts)
            conn.close()

    def test_synthetic_subsecond_vs_inverted_classification(self):
        """Uji row sintetis: pastikan INVALID_INTERVAL dan DURATION_LT_1_SECOND tidak tertukar."""
        conn = lab_conn(CKP, autocommit=True)
        ts_inverted = 995003
        ts_subsecond = 995004
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                base = etl.capture_candidates(
                    cur, plant=cfg["plant"], tz=cfg["timezone"],
                    from_ts=TEST_FROM, to_ts=TEST_TO,
                )
            base_inv = base["exclusions"]["INVALID_INTERVAL"]
            base_sub = base["exclusions"]["DURATION_LT_1_SECOND"]

            # 1. Inverted: checkout <= checkin
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, longdate_checkin, longdate_checkout, state_flag)
                    VALUES (%s, '5100', '99003', '2026-09-19T03:00:00+00:00', '2026-09-19T02:00:00+00:00', 0)
                    """,
                    (ts_inverted,),
                )
            with dict_cursor(conn) as cur:
                res1 = etl.capture_candidates(
                    cur, plant=cfg["plant"], tz=cfg["timezone"],
                    from_ts=TEST_FROM, to_ts=TEST_TO,
                )
                self.assertEqual(res1["exclusions"]["INVALID_INTERVAL"], base_inv + 1)
                self.assertEqual(res1["exclusions"]["DURATION_LT_1_SECOND"], base_sub)

            # 2. Subsecond: 0 < checkout - checkin < 1 detik (mis. 200 ms)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.timesheet_transaction
                      (tsnumber, plant, serialnumber, longdate_checkin, longdate_checkout, state_flag)
                    VALUES (%s, '5100', '99004', '2026-09-19T01:00:00.000000+00:00', '2026-09-19T01:00:00.200000+00:00', 0)
                    """,
                    (ts_subsecond,),
                )
            with dict_cursor(conn) as cur:
                res2 = etl.capture_candidates(
                    cur, plant=cfg["plant"], tz=cfg["timezone"],
                    from_ts=TEST_FROM, to_ts=TEST_TO,
                )
                self.assertEqual(res2["exclusions"]["INVALID_INTERVAL"], base_inv + 1)
                self.assertEqual(res2["exclusions"]["DURATION_LT_1_SECOND"], base_sub + 1)
        finally:
            delete_synthetic_row(conn, ts_inverted)
            delete_synthetic_row(conn, ts_subsecond)
            conn.close()

    def test_exclusions_reason_codes_and_counts_not_swapped_on_baseline(self):
        """Verifikasi reason code dan count tidak tertukar pada dataset baseline CKP dan BPN."""
        expectations = {
            CKP: {
                "plant": "5100",
                "from_ts": datetime(2026, 9, 1, 0, 0, tzinfo=timezone(__import__("datetime").timedelta(hours=7))),
                "to_ts": datetime(2026, 9, 22, 0, 0, tzinfo=timezone(__import__("datetime").timedelta(hours=7))),
                "candidates": 22496,
                "invalid": 0,
                "subsecond": 63,
                "total_closed": 22559,
            },
            BPN: {
                "plant": "5051",
                "from_ts": datetime(2026, 9, 1, 0, 0, tzinfo=timezone(__import__("datetime").timedelta(hours=8))),
                "to_ts": datetime(2026, 9, 22, 0, 0, tzinfo=timezone(__import__("datetime").timedelta(hours=8))),
                "candidates": 16310,
                "invalid": 2,
                "subsecond": 10,
                "total_closed": 16322,
            },
        }
        for dbname, exp in expectations.items():
            with self.subTest(db=dbname):
                conn = lab_conn(dbname)
                try:
                    with dict_cursor(conn) as cur:
                        cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                        row = cur.fetchone()
                        cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                        captured = etl.capture_candidates(
                            cur, plant=cfg["plant"], tz=cfg["timezone"],
                            from_ts=exp["from_ts"], to_ts=exp["to_ts"],
                        )
                        excl = captured["exclusions"]
                        self.assertEqual(excl["INVALID_INTERVAL"], exp["invalid"])
                        self.assertEqual(excl["DURATION_LT_1_SECOND"], exp["subsecond"])
                        self.assertEqual(len(captured["rows"]), exp["candidates"])

                        # Tegaskan secara eksplisit bahwa label/angka tidak tertukar
                        if exp["invalid"] != exp["subsecond"]:
                            self.assertNotEqual(
                                excl["INVALID_INTERVAL"], exp["subsecond"],
                                f"{dbname}: label INVALID_INTERVAL tertukar dengan DURATION_LT_1_SECOND",
                            )
                            self.assertNotEqual(
                                excl["DURATION_LT_1_SECOND"], exp["invalid"],
                                f"{dbname}: label DURATION_LT_1_SECOND tertukar dengan INVALID_INTERVAL",
                            )

                        # Invariant rekonsiliasi
                        self.assertEqual(
                            len(captured["rows"]) + excl["INVALID_INTERVAL"] + excl["DURATION_LT_1_SECOND"],
                            exp["total_closed"],
                        )
                finally:
                    conn.close()

    def test_snapshot_sama_dengan_source(self):
        """Test 5: raw_snapshot harus sama dengan row source saat capture.

        Test ini membuat snapshotnya SENDIRI untuk sebuah window kecil, bukan
        bergantung pada run yang kebetulan sudah ada. Versi sebelumnya membaca
        tabel input apa adanya dan gagal begitu test lain (mis. integrasi lab)
        mereset state — kegagalan yang menyesatkan, karena yang salah adalah
        prasyarat test, bukan capture-nya.
        """
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                summary = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version="ALLOC-TEST-SNAPSHOT", created_by="test-snapshot",
                )
                self.assertGreater(summary["candidates"], 0, "window uji tidak punya kandidat")

                cur.execute(
                    """
                    SELECT i.source_tsnumber, i.raw_snapshot, i.longdate_checkin,
                           i.longdate_checkout, i.serialnumber, i.raw_seconds,
                           t.longdate_checkin AS src_checkin, t.longdate_checkout AS src_checkout,
                           t.serialnumber AS src_serial
                    FROM public.timesheet_etl_run_input ri
                    JOIN public.timesheet_etl_input i ON i.input_id = ri.input_id
                    JOIN public.timesheet_transaction t ON t.tsnumber = i.source_tsnumber
                    WHERE ri.run_id = %s
                    ORDER BY i.source_tsnumber
                    """,
                    (summary["run_id"],),
                )
                rows = cur.fetchall()
                self.assertEqual(len(rows), summary["candidates"])
                for row in rows:
                    with self.subTest(tsnumber=row["source_tsnumber"]):
                        self.assertEqual(row["longdate_checkin"], row["src_checkin"])
                        self.assertEqual(row["longdate_checkout"], row["src_checkout"])
                        self.assertEqual(row["serialnumber"], row["src_serial"])
                        self.assertEqual(
                            int(row["raw_snapshot"]["tsnumber"]), row["source_tsnumber"],
                            "snapshot tidak memuat tsnumber yang benar",
                        )
                        self.assertIsNotNone(row["raw_snapshot"]["longdate_checkout"])

                # Snapshot immutable: koreksi harus membuat versi baru, bukan menimpa.
                cur.execute(
                    """
                    SELECT input_id FROM public.timesheet_etl_input
                    WHERE plant='5100' AND allocation_version='ALLOC-TEST-SNAPSHOT'
                    ORDER BY source_tsnumber LIMIT 1
                    """
                )
                target = cur.fetchone()["input_id"]
                conn.rollback()  # lepas read-only view sebelum tulis
                with self.assertRaises(psycopg2.errors.RestrictViolation):
                    cur.execute(
                        "UPDATE public.timesheet_etl_input SET source_hash='palsu' WHERE input_id=%s",
                        (target,),
                    )
        finally:
            conn.rollback()
            conn.close()


class IdempotencyTest(unittest.TestCase):
    """Test 8: rerun identik tidak menggandakan versi input."""

    def test_rerun_tidak_menggandakan_input(self):
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}

                before = self._count_input(cur, cfg["plant"])
                first = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version="ALLOC-TEST-IDEMPOTENT", created_by="test",
                )
                after_first = self._count_input(cur, cfg["plant"])
                second = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version="ALLOC-TEST-IDEMPOTENT", created_by="test-rerun",
                )
                after_second = self._count_input(cur, cfg["plant"])

                self.assertEqual(after_first - before, first["inserted"])
                self.assertEqual(second["inserted"], 0, "rerun menggandakan input")
                self.assertEqual(second["reused"], first["candidates"])
                self.assertEqual(after_second, after_first, "jumlah input bertambah pada rerun")
                self.assertEqual(first["plan_checksum"], second["plan_checksum"])
                # Dua run berbeda tetap tercatat sebagai manifest tersendiri.
                self.assertNotEqual(first["run_id"], second["run_id"])
        finally:
            conn.close()

    def _count_input(self, cur, plant):
        cur.execute(
            "SELECT count(*) AS n FROM public.timesheet_etl_input WHERE plant = %s "
            "AND allocation_version = 'ALLOC-TEST-IDEMPOTENT'",
            (plant,),
        )
        return cur.fetchone()["n"]

    def test_lineage_run_ke_input_terbukti_untuk_run_kedua(self):
        """Plan §4.2: run baru boleh memakai ULANG input version yang sama, TETAPI
        hanya "bila desain lineage membuktikannya".

        Tanpa tabel penghubung eksplisit, satu-satunya jejak adalah
        `timesheet_etl_input.run_id`, yang menunjuk run PERTAMA. Run kedua lalu
        tidak punya bukti apa pun bahwa ia membaca version yang sama — jumlah
        input benar, tetapi lineage-nya bohong. Test ini mengunci bukti itu.
        """
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}

                first = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version="ALLOC-TEST-LINEAGE", created_by="test-lineage-1",
                )
                second = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version="ALLOC-TEST-LINEAGE", created_by="test-lineage-2",
                )
                self.assertEqual(second["inserted"], 0, "rerun menyalin snapshot ulang")

                for label, run in (("pertama", first), ("kedua", second)):
                    with self.subTest(run=label):
                        cur.execute(
                            "SELECT count(*) AS n FROM public.timesheet_etl_run_input WHERE run_id = %s",
                            (run["run_id"],),
                        )
                        self.assertEqual(
                            cur.fetchone()["n"], run["candidates"],
                            f"run {label} tidak punya baris lineage ke input yang dibacanya",
                        )

                # Kedua run harus menunjuk HIMPUNAN input version yang identik.
                cur.execute(
                    """
                    SELECT count(*) AS n
                    FROM (
                      SELECT input_id FROM public.timesheet_etl_run_input WHERE run_id = %s
                      INTERSECT
                      SELECT input_id FROM public.timesheet_etl_run_input WHERE run_id = %s
                    ) x
                    """,
                    (first["run_id"], second["run_id"]),
                )
                self.assertEqual(cur.fetchone()["n"], first["candidates"])
        finally:
            conn.close()

    def test_lineage_downstream_artifact_rerun_contract(self):
        """Kontrak lineage downstream:
        1. run_id pada artifact downstream menunjuk run pembuat pertama (created_by_run_id).
        2. Rerun kedua menelusuri artifact melalui:
             timesheet_etl_run_input (run_id_2) -> input_id -> timesheet_cleaned_segment
        3. Rerun kedua tidak mengklaim kepemilikan artifact lama.
        4. Rerun kedua tidak membuat input atau artifact duplikat.
        """
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id=1")
                row = cur.fetchone()
                cfg = {"plant": row["plant_code"], "timezone": row["timezone"]}
                alloc_ver = "ALLOC-TEST-DOWNSTREAM-CONTRACT"

                # Bersihkan test version lama bila ada dari run sebelumnya
                cur.execute(
                    """
                    DELETE FROM public.timesheet_sap_ready
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_allocated_segment
                    WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_cleaned_segment
                    WHERE input_id IN (SELECT input_id FROM public.timesheet_etl_input WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_run_input
                    WHERE run_id IN (SELECT run_id FROM public.timesheet_etl_run WHERE allocation_version = %s);
                    DELETE FROM public.timesheet_etl_input WHERE allocation_version = %s;
                    DELETE FROM public.timesheet_etl_run WHERE allocation_version = %s;
                    """,
                    (alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver, alloc_ver),
                )
                conn.commit()

                first = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version=alloc_ver, created_by="test-creator-run-1",
                )
                self.assertGreater(first["candidates"], 0)

                # Ambil satu input_id dari run pertama untuk dipasangi artifact tiruan
                cur.execute(
                    """
                    SELECT i.input_id, i.source_tsnumber
                    FROM public.timesheet_etl_run_input ri
                    JOIN public.timesheet_etl_input i ON i.input_id = ri.input_id
                    WHERE ri.run_id = %s
                    ORDER BY i.source_tsnumber LIMIT 1
                    """,
                    (first["run_id"],),
                )
                target_input = cur.fetchone()
                target_input_id = target_input["input_id"]
                target_ts = target_input["source_tsnumber"]

                # Ambil artifact downstream (cleaned segment) yang dibuat oleh run pertama
                cur.execute(
                    """
                    SELECT cleaned_segment_id
                    FROM public.timesheet_cleaned_segment
                    WHERE input_id = %s
                    ORDER BY segment_sequence LIMIT 1
                    """,
                    (target_input_id,),
                )
                artifact_id = cur.fetchone()["cleaned_segment_id"]

                cur.execute(
                    "SELECT count(*) AS n FROM public.timesheet_cleaned_segment WHERE input_id = %s",
                    (target_input_id,),
                )
                initial_seg_count = cur.fetchone()["n"]

                # Jalankan rerun kedua atas window yang sama
                second = etl.run_execute(
                    cur, conn, cfg=cfg, dbname=CKP, from_ts=TEST_FROM, to_ts=TEST_TO,
                    allocation_version=alloc_ver, created_by="test-consumer-run-2",
                )

                # 1. Rerun kedua punya lineage ke seluruh input
                self.assertEqual(second["inserted"], 0, "rerun kedua tidak boleh insert input baru")
                self.assertEqual(second["reused"], first["candidates"])
                cur.execute(
                    "SELECT count(*) AS n FROM public.timesheet_etl_run_input WHERE run_id = %s",
                    (second["run_id"],),
                )
                self.assertEqual(cur.fetchone()["n"], second["candidates"])

                # 2. Rerun kedua dapat menelusuri artifact downstream lewat:
                #    timesheet_etl_run_input -> input_id -> timesheet_cleaned_segment
                cur.execute(
                    """
                    SELECT c.cleaned_segment_id, c.run_id AS artifact_created_by, c.input_id
                    FROM public.timesheet_etl_run_input ri
                    JOIN public.timesheet_cleaned_segment c ON c.input_id = ri.input_id
                    WHERE ri.run_id = %s AND c.input_id = %s
                    """,
                    (second["run_id"], target_input_id),
                )
                traced = cur.fetchone()
                self.assertIsNotNone(traced, "rerun kedua gagal menelusuri artifact via lineage input")
                self.assertEqual(traced["cleaned_segment_id"], artifact_id)

                # 3. Rerun kedua tidak mengklaim sebagai pembuat artifact lama
                self.assertEqual(
                    str(traced["artifact_created_by"]), str(first["run_id"]),
                    "artifact downstream harus tetap mempertahankan run_id pembuat pertama",
                )
                self.assertNotEqual(
                    str(traced["artifact_created_by"]), str(second["run_id"]),
                    "rerun kedua tidak boleh menjadi owner created_by artifact lama",
                )

                # 4. Tidak ada input atau artifact duplikat
                cur.execute(
                    "SELECT count(*) AS n FROM public.timesheet_cleaned_segment WHERE input_id = %s",
                    (target_input_id,),
                )
                self.assertEqual(cur.fetchone()["n"], initial_seg_count, "artifact downstream terduplikasi")

                cur.execute(
                    "SELECT count(*) AS n FROM public.timesheet_etl_input WHERE plant = '5100' AND allocation_version = %s",
                    (alloc_ver,),
                )
                self.assertEqual(cur.fetchone()["n"], first["candidates"], "input version terduplikasi")
        finally:
            conn.close()


class TimezoneTest(unittest.TestCase):
    """Test 11: timezone Cikupa dan Balikpapan benar."""

    def test_plant_config_cocok_dengan_klon(self):
        expectations = {
            CKP: ("5100", "Asia/Jakarta"),
            BPN: ("5051", "Asia/Makassar"),
        }
        for dbname, (plant, tz) in expectations.items():
            with self.subTest(db=dbname):
                conn = lab_conn(dbname)
                try:
                    with dict_cursor(conn) as cur:
                        cfg = etl.load_plant_config(cur, plant)
                        self.assertEqual(cfg["plant"], plant)
                        self.assertEqual(cfg["timezone"], tz)
                finally:
                    conn.close()

    def test_plant_salah_ditolak(self):
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                with self.assertRaises(etl.EtlError):
                    etl.load_plant_config(cur, "5051")
        finally:
            conn.close()

    def test_local_date_memakai_timezone_plant(self):
        """Tanggal lokal harus dihitung dengan offset plant, bukan UTC."""
        conn = lab_conn(CKP)
        try:
            with dict_cursor(conn) as cur:
                # 2026-09-14T18:00Z = 15 Sep 01:00 WIB (Cikupa) tetapi masih 14 Sep UTC.
                cur.execute(
                    """
                    SELECT (TIMESTAMPTZ '2026-09-14T18:00:00+00:00'
                            AT TIME ZONE %s)::date AS local_date, %s AS tz
                    """,
                    ("Asia/Jakarta", "Asia/Jakarta"),
                )
                self.assertEqual(str(cur.fetchone()["local_date"]), "2026-09-15")
                cur.execute(
                    """
                    SELECT (TIMESTAMPTZ '2026-09-14T18:00:00+00:00'
                            AT TIME ZONE %s)::date AS local_date
                    """,
                    ("Asia/Makassar",),
                )
                self.assertEqual(str(cur.fetchone()["local_date"]), "2026-09-15")

                # 2026-09-14T16:30Z = 14 Sep 23:30 WIB, 15 Sep 00:30 WITA.
                # Perbedaan satu jam ini yang membuktikan offset plant benar-benar dipakai.
                cur.execute(
                    "SELECT (TIMESTAMPTZ '2026-09-14T16:30:00+00:00' AT TIME ZONE %s)::date AS d",
                    ("Asia/Jakarta",),
                )
                self.assertEqual(str(cur.fetchone()["d"]), "2026-09-14")
                cur.execute(
                    "SELECT (TIMESTAMPTZ '2026-09-14T16:30:00+00:00' AT TIME ZONE %s)::date AS d",
                    ("Asia/Makassar",),
                )
                self.assertEqual(str(cur.fetchone()["d"]), "2026-09-15")
        finally:
            conn.close()


class SafetyBoundaryTest(unittest.TestCase):
    """Test 12: tidak ada koneksi central/AWS dan tidak ada HTTP SAP."""

    def test_modul_tidak_mengimpor_klien_production(self):
        source = inspect.getsource(etl)
        forbidden = ("sap_staging_common", "connect_staging", "requests", "urllib",
                     "http.client", "httpx", "aws_staging", "postgres_fdw")
        for needle in forbidden:
            with self.subTest(needle=needle):
                self.assertNotIn(
                    f"import {needle}", source,
                    f"modul ETL mengimpor {needle} — F1 harus mandiri dari jalur central",
                )
                self.assertNotIn(
                    f"from {needle}", source,
                    f"modul ETL mengimpor dari {needle} — F1 harus mandiri dari jalur central",
                )

    def test_tidak_ada_literal_kredensial(self):
        source = inspect.getsource(etl)
        for needle in ("password=", "PGPASSWORD", "100.80.101.53", "ssb_dw", "ptssb"):
            with self.subTest(needle=needle):
                self.assertNotIn(needle, source, f"modul ETL memuat {needle}")

    def test_host_non_loopback_ditolak(self):
        old = os.environ.get("MPS2_ETL_HOST")
        os.environ["MPS2_ETL_HOST"] = "100.80.101.53"
        try:
            with self.assertRaises(etl.EtlError):
                etl._etl_conn_params(CKP)
        finally:
            if old is None:
                os.environ.pop("MPS2_ETL_HOST", None)
            else:
                os.environ["MPS2_ETL_HOST"] = old

    def test_execute_tidak_boleh_dry_run_bersamaan(self):
        parser = etl.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args([
                "--plant", "5100",
                "--from-ts", "2026-09-01T00:00:00+07:00",
                "--to-ts", "2026-09-02T00:00:00+07:00",
                "--dry-run", "--execute",
            ])


class CliContractTest(unittest.TestCase):
    """Kontrak flag CLI dari planning §7."""

    def test_timestamp_naif_ditolak(self):
        parser = etl.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args([
                "--plant", "5100",
                "--from-ts", "2026-09-01T00:00:00",
                "--to-ts", "2026-09-02T00:00:00",
                "--dry-run",
            ])

    def test_window_terbalik_ditolak(self):
        rc = etl.main([
            "--plant", "5100",
            "--from-ts", "2026-09-22T00:00:00+07:00",
            "--to-ts", "2026-09-01T00:00:00+07:00",
            "--dry-run",
        ])
        self.assertEqual(rc, 2, "window terbalik harus ditolak dengan exit code 2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
