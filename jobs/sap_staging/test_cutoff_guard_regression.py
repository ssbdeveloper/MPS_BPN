"""Regresi blocker review 2026-10-01 (cutoff 30 September).

1. Jalur selected-ID (--ids / UI post_bundles / post_corrections) mengirim baris
   SKIPPED dan baris sebelum cutoff, karena claim_selected_rows() hanya
   mengecualikan POSTED.
2. Gagal membaca cutoff -> query disusun TANPA batas cutoff (fail-open).
3. Kegagalan MCH ditelan run_machinehours_cycle(); run_cycle() == True dan
   `stage_worker.py --once` keluar 0.

Test 1-2 memakai Postgres lokal throwaway (bukan production). HTTP ke SAP
selalu di-mock dan dihitung: angka kirim yang diharapkan dibuktikan, bukan
diasumsikan. Default DSN: postgres lokal db `mps2_test_cutoff_guard`.

    env -u PGPASSWORD python test_cutoff_guard_regression.py
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timezone
from unittest import mock

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

os.environ["PLANT_SSB"] = "5100"
os.environ.setdefault("TIMEZONE", "Asia/Jakarta")

import post_sap_staging as poster  # noqa: E402
import stage_worker  # noqa: E402

DSN = os.environ.get(
    "MPS2_TEST_CUTOFF_DSN",
    "host=localhost port=5432 user=postgres dbname=mps2_test_cutoff_guard",
)
CUTOFF = date(2026, 9, 30)

SCHEMA = """
DROP TABLE IF EXISTS sap_staging_source, sap_staging_exclusion, sap_timesheet_staging;
CREATE TABLE sap_timesheet_staging (
  id            bigint PRIMARY KEY,
  ztimesheetid  text,
  source_system text NOT NULL,
  source_ref_id text,
  source_key    text,
  werks         text,
  status        text NOT NULL,
  pernr         text,
  pernr_origin  text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_seconds integer NOT NULL DEFAULT 3600,
  bucket_start  timestamptz,
  is_correction boolean NOT NULL DEFAULT false,
  is_productive boolean NOT NULL DEFAULT true,
  sap_error     text,
  sap_response  jsonb,
  sap_response_text text,
  posted_at     timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sap_staging_source (
  staging_id bigint, source_system text, plant text, source_row_id text,
  bucket_start timestamptz, seconds bigint, posted_at timestamptz
);
CREATE TABLE sap_staging_exclusion (
  source_system text, plant text, source_row_id text, excluded_by text
);
-- id  status   ISDD      catatan
-- 1   SKIPPED  20260929  baris pra-cutoff yang ditahan (MANUAL_POSTED_PRE_CUTOFF)
-- 2   PENDING  20260929  pra-cutoff yang (seharusnya tidak) masih PENDING
-- 3   FAILED   20260928  pra-cutoff FAILED
-- 4   PENDING  20260930  sah: tepat di cutoff
-- 5   FAILED   20261001  sah: setelah cutoff, retry
-- 6   SKIPPED  20261001  ditahan guard lain (konflik) setelah cutoff
-- 7   POSTED   20261001  sudah terkirim
-- 8   PENDING  20261001  plant lain (5051)
-- 9   PENDING  -         ISDD hilang: tidak bisa dibuktikan setelah cutoff
-- 10  PENDING  20260929  bucket_start NULL (bentuk TIMESHEET 5051 di central)
-- 11  POSTED   20260929  pra-cutoff POSTED: --allow-posted pun tidak boleh
INSERT INTO sap_timesheet_staging (id, ztimesheetid, source_system, werks, status, pernr, payload, bucket_start) VALUES
 (1,'1','TIMESHEET','5100','SKIPPED','1001','{"ISDD":"20260929","AUFNR":"A1"}','2026-09-29 08:00+07'),
 (2,'2','TIMESHEET','5100','PENDING','1001','{"ISDD":"20260929","AUFNR":"A2"}','2026-09-29 08:00+07'),
 (3,'3','TIMESHEET','5100','FAILED','1001','{"ISDD":"20260928","AUFNR":"A3"}','2026-09-28 08:00+07'),
 (4,'4','TIMESHEET','5100','PENDING','1001','{"ISDD":"20260930","AUFNR":"A4"}','2026-09-30 08:00+07'),
 (5,'5','TIMESHEET','5100','FAILED','1001','{"ISDD":"20261001","AUFNR":"A5"}','2026-10-01 08:00+07'),
 (6,'6','TIMESHEET','5100','SKIPPED','1001','{"ISDD":"20261001","AUFNR":"A6"}','2026-10-01 08:00+07'),
 (7,'7','TIMESHEET','5100','POSTED','1001','{"ISDD":"20261001","AUFNR":"A7"}','2026-10-01 08:00+07'),
 (8,'8','TIMESHEET','5051','PENDING','1001','{"ISDD":"20261001","AUFNR":"A8"}','2026-10-01 08:00+08'),
 (9,'9','TIMESHEET','5100','PENDING','1001','{"AUFNR":"A9"}','2026-10-01 08:00+07'),
 (10,'10','TIMESHEET','5100','PENDING','1001','{"ISDD":"20260929","AUFNR":"A10"}',NULL),
 (11,'11','TIMESHEET','5100','POSTED','1001','{"ISDD":"20260929","AUFNR":"A11"}','2026-09-29 08:00+07');
"""

ALL_IDS = [str(i) for i in range(1, 12)]


def _ok_response(_payload, _timeout):
    return 200, '{"n0:ABM_CPP_223_MT_Timesheet_Res":{"STATUS":"S","MESSAGE":"ok"}}'


class _DbCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            psycopg2.connect(DSN).close()
        except Exception as exc:  # pragma: no cover
            raise unittest.SkipTest(f"Postgres lokal tidak tersedia: {exc}")

    def setUp(self):
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA)
            conn.commit()
        sent: list[str] = []
        self.sent = sent

        def fake_post(payload, timeout):
            sent.append(str(payload.get("ZTIMESHEETID")))
            return _ok_response(payload, timeout)

        patches = [
            mock.patch.object(poster, "connect_staging", lambda: psycopg2.connect(DSN)),
            mock.patch.object(poster, "ensure_staging_schema", lambda conn: None),
            mock.patch.object(poster, "apply_current_nfc_roles", lambda cur, rows: rows),
            mock.patch.object(poster, "find_posted_conflicts", lambda ids: {}),
            mock.patch.object(poster, "find_burned_ztimesheetids", lambda ids: {}),
            mock.patch.object(poster, "log_timesheet_sap", lambda payload, text: None),
            mock.patch.object(poster, "post_payload", side_effect=fake_post),
            mock.patch.object(poster, "load_plant_cutoff", lambda plant=None: CUTOFF),
            mock.patch.object(poster, "load_plant_timezone", lambda plant: "Asia/Makassar"),
            # Hari berjalan dibekukan jauh setelah data uji agar gerbang hari-selesai
            # tidak mengganggu tes cutoff; tes hari-selesai mem-patch ulang.
            mock.patch.object(poster, "plant_today", lambda tz: date(2026, 12, 31)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(poster._close_thread_conns)

    def _status(self) -> dict[int, str]:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, status FROM sap_timesheet_staging ORDER BY id")
                return dict(cur.fetchall())

    def _args(self, argv: list[str]):
        return poster.build_parser().parse_args(argv)


class SelectedIdCutoffTest(_DbCase):
    """Blocker 1: selected-ID tidak boleh mengirim SKIPPED atau baris pra-cutoff."""

    def test_ids_hanya_mengirim_pending_failed_setelah_cutoff(self):
        before = self._status()
        poster.process_rows(self._args(["--plant", "5100", "--ids", ",".join(ALL_IDS)]))
        self.assertEqual(sorted(self.sent, key=int), ["4", "5"])
        after = self._status()
        for rid in (1, 2, 3, 6, 7, 8, 9, 10, 11):
            self.assertEqual(after[rid], before[rid], f"id {rid} berubah status")
        self.assertEqual(after[1], "SKIPPED")
        self.assertEqual((after[4], after[5]), ("POSTED", "POSTED"))

    def test_skipped_pra_cutoff_tunggal_tidak_terkirim(self):
        # Reproduksi review: satu id SKIPPED historis dipost lewat --ids.
        poster.process_rows(self._args(["--plant", "5100", "--ids", "1"]))
        self.assertEqual(self.sent, [])
        self.assertEqual(self._status()[1], "SKIPPED")

    def test_ztimesheetids_juga_dijaga(self):
        poster.process_rows(self._args(["--plant", "5100", "--ztimesheetids", "1,2,3,10"]))
        self.assertEqual(self.sent, [])

    def test_allow_posted_tidak_membuka_skipped_atau_pra_cutoff(self):
        poster.process_rows(
            self._args(["--plant", "5100", "--allow-posted", "--ids", ",".join(ALL_IDS)])
        )
        # 7 = POSTED setelah cutoff (kirim ulang eksplisit). 11 = POSTED pra-cutoff: tidak.
        self.assertEqual(sorted(self.sent, key=int), ["4", "5", "7"])

    def test_ops_worker_post_bundles_dan_post_corrections_lewat_guard_yang_sama(self):
        import ops_worker
        for action in ("post_bundles", "post_corrections"):
            self.sent.clear()
            with psycopg2.connect(DSN) as conn:
                with conn.cursor() as cur:
                    cur.execute(SCHEMA)
                conn.commit()
            cmd = ops_worker.build_command(action, {"ids": [1, 2, 3, 10]})
            argv = cmd[cmd.index("post_sap_staging.py") + 1:]
            poster.process_rows(self._args(["--plant", "5100", *argv]))
            self.assertEqual(self.sent, [], action)

    def test_dry_run_ids_memakai_predikat_yang_sama(self):
        with self.assertLogs(poster.log, level="INFO") as cap:
            poster.preview_rows(self._args(["--dry-run", "--plant", "5100", "--ids", ",".join(ALL_IDS)]))
        joined = "\n".join(cap.output)
        self.assertIn("DRY-RUN: 2 baris", joined)
        self.assertIn("DRY-RUN: id 4,5", joined)

    def test_python_guard_membatalkan_claim_bila_sql_guard_bocor(self):
        # Simulasikan SQL guard rusak: baris pra-cutoff lolos SELECT.
        with mock.patch.object(poster, "cutoff_guard_sql", lambda: "(%s IS NOT NULL)"):
            with self.assertRaises(poster.PreCutoffRowClaimed):
                poster.process_rows(self._args(["--plant", "5100", "--ids", "2,4"]))
        self.assertEqual(self.sent, [])
        status = self._status()
        self.assertEqual((status[2], status[4]), ("PENDING", "PENDING"), "claim harus rollback")


class AutoPathCutoffTest(_DbCase):
    """Jalur otomatis + manual tanggal/operator/retry: tidak ada baris pra-cutoff."""

    def test_auto_retry_failed_hanya_setelah_cutoff(self):
        poster.process_rows(self._args(["--plant", "5100", "--retry-failed", "--limit", "100"]))
        self.assertEqual(sorted(self.sent, key=int), ["4", "5"])

    def test_post_date_pra_cutoff_kosong(self):
        poster.process_rows(
            self._args(["--plant", "5100", "--date", "2026-09-29", "--include-today",
                        "--retry-failed", "--limit", "1000"])
        )
        self.assertEqual(self.sent, [])

    def test_rentang_tanggal_melewati_cutoff_dipotong(self):
        poster.process_rows(
            self._args(["--plant", "5100", "--date-from", "2026-09-01", "--date-to", "2026-10-31",
                        "--retry-failed", "--limit", "1000"])
        )
        self.assertEqual(sorted(self.sent, key=int), ["4", "5"])

    def test_post_operator_pra_cutoff_tidak_terkirim(self):
        poster.process_rows(
            self._args(["--plant", "5100", "--pernr", "1001", "--include-today",
                        "--retry-failed", "--limit", "1000"])
        )
        self.assertEqual(sorted(self.sent, key=int), ["4", "5"])


WORKDATE_SCHEMA = """
-- Batas tengah malam UTC vs Asia/Makassar (UTC+8). bucket_start disimpan UTC.
-- 21: TIMESHEET shift 30 Sep 00:30 WITA = 29 Sep 16:30 UTC -> ISDD 20260930
-- 22: TIMESHEET 29 Sep 23:30 WITA (pra-cutoff, PENDING) -> ISDD 20260929
-- 23: MCH bundel hari selesai 30 Sep
-- 24: MCH bundel hari BERJALAN 1 Okt (WITA)
-- 25: TIMESHEET 1 Okt (bukan MCH, hari berjalan boleh)
INSERT INTO sap_timesheet_staging (id, ztimesheetid, source_system, werks, status, pernr, payload, bucket_start) VALUES
 (21,'21','TIMESHEET','5100','PENDING','1001','{"ISDD":"20260930","AUFNR":"B1"}','2026-09-29 16:30+00'),
 (22,'22','TIMESHEET','5100','PENDING','1001','{"ISDD":"20260929","AUFNR":"B2"}','2026-09-29 15:30+00'),
 (23,'23','MCH_HOURS','5100','PENDING','1001','{"ISDD":"20260930","AUFNR":"B3"}','2026-09-30 00:00+00'),
 (24,'24','MCH_HOURS','5100','PENDING','1001','{"ISDD":"20261001","AUFNR":"B4"}','2026-10-01 00:00+00'),
 (25,'25','TIMESHEET','5100','PENDING','1001','{"ISDD":"20261001","AUFNR":"B5"}','2026-09-30 17:00+00');
DELETE FROM sap_timesheet_staging WHERE id < 20;
"""


class WorkDateFilterTest(_DbCase):
    """Filter tanggal = tanggal kerja SAP (ISDD), bukan bucket_start UTC.
    Reproduksi produksi 5051: rentang 1 Agu-29 Sep memilih 291 baris ISDD 30 Sep."""

    def setUp(self):
        super().setUp()
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(WORKDATE_SCHEMA)
                # Sesi poster di produksi ber-TimeZone Asia/Jakarta; samakan.
                cur.execute("ALTER DATABASE mps2_test_cutoff_guard SET timezone TO 'Asia/Jakarta'")
            conn.commit()

    def _preview(self, argv):
        with self.assertLogs(poster.log, level="INFO") as cap:
            poster.preview_rows(self._args(["--dry-run", "--plant", "5100", *argv]))
        return "\n".join(cap.output)

    def test_rentang_sebelum_cutoff_tidak_memilih_isdd_30_sep(self):
        out = self._preview(["--date-from", "2026-08-01", "--date-to", "2026-09-29", "--limit", "1000"])
        self.assertIn("DRY-RUN: 0 baris", out)
        poster.process_rows(self._args(["--plant", "5100", "--date-from", "2026-08-01",
                                        "--date-to", "2026-09-29", "--limit", "1000"]))
        self.assertEqual(self.sent, [])

    def test_tanggal_tunggal_29_sep_kosong_30_sep_memilih_isdd(self):
        self.assertIn("DRY-RUN: 0 baris", self._preview(["--date", "2026-09-29"]))
        out = self._preview(["--date", "2026-09-30"])
        self.assertIn("DRY-RUN: id 21,23", out)
        poster.process_rows(self._args(["--plant", "5100", "--date", "2026-09-30"]))
        self.assertEqual(sorted(self.sent, key=int), ["21", "23"])

    def test_preview_dan_eksekusi_rentang_sama(self):
        out = self._preview(["--date-from", "2026-09-30", "--date-to", "2026-10-01"])
        self.assertIn("DRY-RUN: id 21,23,24,25", out)
        poster.process_rows(self._args(["--plant", "5100", "--date-from", "2026-09-30",
                                        "--date-to", "2026-10-01"]))
        self.assertEqual(sorted(self.sent, key=int), ["21", "23", "24", "25"])


class DayCompleteGateTest(_DbCase):
    """Bundel MCH hari BERJALAN (timezone plant) wajib tertahan di SEMUA jalur."""

    def setUp(self):
        super().setUp()
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(WORKDATE_SCHEMA)
            conn.commit()
        p = mock.patch.object(poster, "plant_today", lambda tz: date(2026, 10, 1))
        p.start()
        self.addCleanup(p.stop)

    def test_plant_today_batas_tengah_malam_utc_vs_makassar(self):
        class FakeDT(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 9, 30, 16, 30, tzinfo=timezone.utc).astimezone(tz)
        mock.patch.stopall()  # lepas patch plant_today untuk menguji fungsi aslinya
        with mock.patch.object(poster, "datetime", FakeDT):
            self.assertEqual(poster.plant_today("Asia/Makassar"), date(2026, 10, 1))
            self.assertEqual(poster.plant_today("UTC"), date(2026, 9, 30))
            self.assertEqual(poster.plant_today("Asia/Jakarta"), date(2026, 9, 30))

    def test_auto_tidak_mengirim_mch_hari_berjalan(self):
        poster.process_rows(self._args(["--plant", "5100", "--limit", "100"]))
        self.assertEqual(sorted(self.sent, key=int), ["21", "23", "25"])

    def test_include_today_diabaikan(self):
        poster.process_rows(self._args(["--plant", "5100", "--include-today", "--date", "2026-10-01"]))
        self.assertEqual(self.sent, ["25"])

    def test_selected_id_tidak_mengirim_mch_hari_berjalan(self):
        poster.process_rows(self._args(["--plant", "5100", "--ids", "23,24"]))
        self.assertEqual(self.sent, ["23"])
        self.assertEqual(self._status()[24], "PENDING")

    def test_ops_worker_post_date_dan_bundles_menahan_hari_berjalan(self):
        import ops_worker
        for action, params in (("post_date", {"date": "2026-10-01"}), ("post_bundles", {"ids": [24]}),
                               ("post_operator", {"pernr": "1001"})):
            cmd = ops_worker.build_command(action, params)
            self.assertNotIn("--include-today", cmd, action)
            argv = cmd[cmd.index("post_sap_staging.py") + 1:]
            self.sent.clear()
            poster.process_rows(self._args(["--plant", "5100", *argv]))
            self.assertNotIn("24", self.sent, action)

    def test_dry_run_sama_dengan_eksekusi(self):
        with self.assertLogs(poster.log, level="INFO") as cap:
            poster.preview_rows(self._args(["--dry-run", "--plant", "5100", "--include-today"]))
        self.assertIn("DRY-RUN: id 21,23,25", "\n".join(cap.output))

    def test_python_guard_membatalkan_claim_mch_hari_berjalan(self):
        with mock.patch.object(poster, "day_complete_guard_sql", lambda: "(%s IS NOT NULL)"):
            with self.assertRaises(poster.PreCutoffRowClaimed):
                poster.process_rows(self._args(["--plant", "5100", "--ids", "23,24"]))
        self.assertEqual(self.sent, [])
        self.assertEqual(self._status()[23], "PENDING", "claim harus rollback")

    def test_timezone_gagal_dibaca_berhenti(self):
        def boom(plant):
            raise psycopg2.OperationalError("down")
        mock.patch.stopall()
        with mock.patch.object(poster, "load_plant_cutoff", lambda plant=None: CUTOFF), \
             mock.patch.object(poster, "load_plant_timezone", boom):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.eligibility_predicate(statuses=["PENDING"], plant="5100", cutoff=CUTOFF)


class CutoffReadFailureTest(_DbCase):
    """Blocker 2: gagal membaca cutoff wajib menghentikan posting."""

    def _boom(self, plant=None):
        raise psycopg2.OperationalError("connection refused (simulasi)")

    def test_auto_berhenti_bila_cutoff_gagal_dibaca(self):
        with mock.patch.object(poster, "load_plant_cutoff", self._boom):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.process_rows(self._args(["--plant", "5100", "--retry-failed"]))
        self.assertEqual(self.sent, [])
        self.assertNotIn("POSTING", self._status().values())

    def test_ids_berhenti_bila_cutoff_gagal_dibaca(self):
        with mock.patch.object(poster, "load_plant_cutoff", self._boom):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.process_rows(self._args(["--plant", "5100", "--ids", "4,5"]))
        self.assertEqual(self.sent, [])

    def test_cutoff_kosong_juga_berhenti(self):
        with mock.patch.object(poster, "load_plant_cutoff", lambda plant=None: None):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.process_rows(self._args(["--plant", "5100"]))
        self.assertEqual(self.sent, [])

    def test_all_plants_ditolak(self):
        with self.assertRaises(poster.CutoffUnavailable):
            poster.process_rows(self._args(["--all-plants", "--retry-failed"]))
        self.assertEqual(self.sent, [])

    def test_dry_run_juga_berhenti(self):
        with mock.patch.object(poster, "load_plant_cutoff", self._boom):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.preview_rows(self._args(["--dry-run", "--plant", "5100"]))

    def test_predikat_tidak_pernah_tanpa_cutoff(self):
        with mock.patch.object(poster, "load_plant_cutoff", self._boom):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.eligibility_predicate(statuses=["PENDING"], plant="5100")

    def test_main_exit_nonzero(self):
        with mock.patch.object(poster, "load_plant_cutoff", self._boom), \
             mock.patch.object(sys, "argv", ["post_sap_staging.py", "--plant", "5100"]):
            with self.assertRaises(poster.CutoffUnavailable):
                poster.main()


class LoadPlantCutoffTest(unittest.TestCase):
    def test_load_plant_cutoff_tidak_menelan_error(self):
        import sap_staging_common as common
        with mock.patch.object(common, "connect_source",
                               side_effect=psycopg2.OperationalError("down")):
            with self.assertRaises(psycopg2.OperationalError):
                common.load_plant_cutoff("5100")

    def test_mch_managed_floor_fail_closed(self):
        import sap_staging_common as common
        import stage_machinehours as smh
        with mock.patch.object(common, "load_plant_cutoff",
                               side_effect=psycopg2.OperationalError("down")):
            with self.assertRaises(psycopg2.OperationalError):
                smh.managed_floor()
        with mock.patch.object(common, "load_plant_cutoff", return_value=None):
            with self.assertRaises(RuntimeError):
                smh.managed_floor()

    def test_mch_catchup_since_tidak_bisa_turun_di_bawah_cutoff(self):
        import stage_machinehours as smh
        args = smh.build_parser().parse_args(["--catchup", "--catchup-since", "2026-09-01"])
        with mock.patch.object(smh, "managed_floor", return_value=CUTOFF), \
             mock.patch.object(smh, "find_catchup_days", return_value=[]) as find:
            smh.run_catchup(args)
        self.assertEqual(find.call_args[0][1], CUTOFF)


class RebuildCutoffTest(unittest.TestCase):
    """recalc_date (UI) -> rebuild_machinehours: DELETE non-POSTED + re-stage PENDING.
    Di bawah cutoff itu menghidupkan kembali SKIPPED historis -> wajib ditolak."""

    def _run(self, argv, cutoff=CUTOFF):
        import rebuild_machinehours as rb
        with mock.patch.object(rb, "load_plant_cutoff", lambda plant=None: cutoff), \
             mock.patch.object(rb, "purge_unposted", side_effect=AssertionError("purge dipanggil")), \
             mock.patch.object(rb, "restage", side_effect=AssertionError("restage dipanggil")), \
             mock.patch.object(sys, "argv", ["rebuild_machinehours.py", *argv]):
            rb.main()

    def test_rebuild_pra_cutoff_ditolak(self):
        with self.assertRaises(SystemExit):
            self._run(["--from", "2026-09-29", "--to", "2026-09-30"])

    def test_rebuild_tanpa_cutoff_ditolak(self):
        with self.assertRaises(SystemExit):
            self._run(["--from", "2026-10-01", "--to", "2026-10-02"], cutoff=None)

    def test_rebuild_cutoff_gagal_dibaca_ditolak(self):
        import rebuild_machinehours as rb
        with mock.patch.object(rb, "load_plant_cutoff", side_effect=psycopg2.OperationalError("down")), \
             mock.patch.object(rb, "purge_unposted", side_effect=AssertionError("purge dipanggil")), \
             mock.patch.object(sys, "argv", ["rebuild_machinehours.py", "--from", "2026-10-01", "--to", "2026-10-02"]):
            with self.assertRaises(psycopg2.OperationalError):
                rb.main()


class MachineHoursFailurePropagationTest(unittest.TestCase):
    """Blocker 3: kegagalan MCH harus sampai ke run_cycle() dan exit code --once."""

    def _boom(self, args):
        raise RuntimeError("MCH meledak (simulasi)")

    def test_run_machinehours_cycle_melempar(self):
        import stage_machinehours as smh
        with mock.patch.object(smh, "run", self._boom):
            with self.assertRaises(RuntimeError):
                stage_worker.run_machinehours_cycle("5100")

    def test_run_cycle_false_bila_mch_gagal_walau_ts_sukses(self):
        import stage_machinehours as smh
        with mock.patch.object(smh, "run", self._boom), \
             mock.patch.object(stage_worker, "run_timesheet_cycle",
                               return_value={"status": "UP_TO_DATE"}) as ts:
            self.assertFalse(stage_worker.run_cycle("5100"))
        ts.assert_called_once()  # TS tetap dijalankan

    def test_once_exit_code_1_bila_mch_gagal(self):
        import stage_machinehours as smh
        with mock.patch.object(smh, "run", self._boom), \
             mock.patch.object(stage_worker, "run_timesheet_cycle",
                               return_value={"status": "UP_TO_DATE"}), \
             mock.patch.object(sys, "argv", ["stage_worker.py", "--once", "--plant", "5100"]):
            self.assertEqual(stage_worker.main(), 1)

    def test_once_exit_code_0_bila_semua_sukses(self):
        import stage_machinehours as smh
        with mock.patch.object(smh, "run", lambda args: None), \
             mock.patch.object(stage_worker, "run_timesheet_cycle",
                               return_value={"status": "UP_TO_DATE"}), \
             mock.patch.object(sys, "argv", ["stage_worker.py", "--once", "--plant", "5100"]):
            self.assertEqual(stage_worker.main(), 0)

    def test_plant_argumen_beda_dengan_env_ditolak(self):
        with self.assertRaises(RuntimeError):
            stage_worker.run_machinehours_cycle("5051")


if __name__ == "__main__":
    unittest.main(verbosity=2)
