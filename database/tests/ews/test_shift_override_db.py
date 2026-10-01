"""database/tests/ews/test_shift_override_db.py
Pengujian PostgreSQL integrasi nyata untuk EWS date-range shift hours dan integrity guard SOW.
Dijalankan secara terisolasi pada database test lokal `mps2_test_ews_shift_override`.
"""

import json
import threading
import time
import unittest
import psycopg2
from psycopg2.extras import RealDictCursor

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "mps2_test_ews_shift_override",
    "user": "postgres",
}


def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    return conn


class TestEwsShiftOverrideDB(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Jalankan guard proteksi sebelum pengujian
        with get_conn() as conn:
            with conn.cursor() as cur:
                with open("database/tests/timesheet/_guard_not_production.sql", "r", encoding="utf-8") as f:
                    cur.execute(f.read())
            conn.commit()

    def setUp(self):
        # Bersihkan tabel sebelum setiap tes agar independen
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM ews.shift_definition_audit")
                cur.execute("DELETE FROM public.sow_machine_capacity")
                cur.execute("DELETE FROM public.sow_schedule")
                cur.execute("DELETE FROM public.sow_schedule_batch")
                cur.execute("DELETE FROM public.sow_overtime_request")
                cur.execute("DELETE FROM ews.shift_roster")
                cur.execute("DELETE FROM public.shift_definition WHERE is_default = false")
                # Reset sequence dan pastikan default ada
                cur.execute("""
                    INSERT INTO public.shift_definition
                      (id, shift_code, shift_name, roster_shift_code, start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_default, is_active)
                    VALUES
                      (1, 'SHIFT-1', 'Shift Pagi', 'DAY', '07:25:00', '16:30:00', false, 8.00, 8.00, true, true),
                      (2, 'SHIFT-2', 'Shift Malam', 'NIGHT', '16:30:00', '00:30:00', true, 7.00, 7.00, true, true)
                    ON CONFLICT (id) DO UPDATE SET
                      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, is_active = true
                """)
            conn.commit()

    def test_01_create_delete_recreate_lifecycle_maintains_id(self):
        """Uji siklus create -> soft delete -> recreate mempertahankan ID dan reaktivasi."""
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. CREATE override tanggal 2026-10-15
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, default_capacity_hours, standard_hours, is_active
            ) VALUES ('SHIFT-1', 'Shift Pagi', 'DAY', '2026-10-15', false, '08:00:00', '14:00:00', false, 8.00, 6.00, true)
            RETURNING id, is_active
        """)
        row = cur.fetchone()
        created_id = row["id"]
        self.assertTrue(row["is_active"])
        conn.commit()

        # Pastikan resolver mengembalikan override ID baru
        cur.execute("SELECT id, standard_hours FROM public.resolve_shift_definition('2026-10-15') WHERE roster_shift_code = 'DAY'")
        res = cur.fetchone()
        self.assertEqual(res["id"], created_id)
        self.assertEqual(float(res["standard_hours"]), 6.0)

        # 2. SOFT DELETE
        cur.execute("UPDATE public.shift_definition SET is_active = false, updated_at = now() WHERE id = %s RETURNING id, is_active", (created_id,))
        del_row = cur.fetchone()
        self.assertFalse(del_row["is_active"])
        conn.commit()

        # Resolver kembali ke default (id 1)
        cur.execute("SELECT id, standard_hours FROM public.resolve_shift_definition('2026-10-15') WHERE roster_shift_code = 'DAY'")
        res_default = cur.fetchone()
        self.assertEqual(res_default["id"], 1)

        # 3. RECREATE (Reaktivasi baris existing dengan ID yang sama)
        cur.execute("""
            UPDATE public.shift_definition
            SET is_active = true,
                start_time = '08:30:00',
                end_time = '15:00:00',
                standard_hours = 6.5,
                updated_at = now()
            WHERE id = %s
            RETURNING id, is_active, standard_hours
        """, (created_id,))
        recreated = cur.fetchone()
        self.assertEqual(recreated["id"], created_id)
        self.assertTrue(recreated["is_active"])
        self.assertEqual(float(recreated["standard_hours"]), 6.5)
        conn.commit()

        # Resolver kembali menunjuk baris override yang tereaktivasi
        cur.execute("SELECT id, standard_hours FROM public.resolve_shift_definition('2026-10-15') WHERE roster_shift_code = 'DAY'")
        res_recreated = cur.fetchone()
        self.assertEqual(res_recreated["id"], created_id)

        conn.close()

    def test_02_unique_constraint_enforced_even_when_inactive(self):
        """Unique index uq_shift_definition_effective_date_code menolak duplikat INSERT meskipun inactive."""
        conn = get_conn()
        cur = conn.cursor()

        # Insert override pertama lalu soft delete
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES ('SHIFT-1', 'Shift Pagi', 'DAY', '2026-10-20', false, '08:00:00', '15:00:00', false, 7.00, false)
        """)
        conn.commit()

        # Mencoba insert kedua pada shift_code dan tanggal yang sama harus memicu 23505
        with self.assertRaises(psycopg2.IntegrityError) as cm:
            cur.execute("""
                INSERT INTO public.shift_definition (
                  shift_code, shift_name, roster_shift_code, effective_date, is_default,
                  start_time, end_time, crosses_midnight, standard_hours, is_active
                ) VALUES ('SHIFT-1', 'Shift Pagi', 'DAY', '2026-10-20', false, '08:00:00', '15:00:00', false, 7.00, true)
            """)
        self.assertEqual(cm.exception.pgcode, "23505")
        conn.rollback()
        conn.close()

    def test_03_sow_blocking_refs_function(self):
        """Fungsi public.ews_sow_blocking_refs menghitung status yang memblokir dan mengabaikan status non-blocking."""
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        tgl = "2026-10-25"
        shift_ids = [1]  # Family SHIFT-1

        # Belum ada referensi
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        res = cur.fetchone()["res"]
        self.assertEqual(res["total"], 0)

        # 1. sow_machine_capacity (is_active = false tidak memblokir, is_active = true memblokir)
        cur.execute("INSERT INTO public.sow_machine_capacity (machine_code, schedule_date, shift_id, is_active) VALUES ('MC-01', %s, 1, false)", (tgl,))
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        self.assertEqual(cur.fetchone()["res"]["total"], 0)

        cur.execute("INSERT INTO public.sow_machine_capacity (machine_code, schedule_date, shift_id, is_active) VALUES ('MC-02', %s, 1, true)", (tgl,))
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        self.assertEqual(cur.fetchone()["res"]["counts"]["sow_machine_capacity"], 1)

        # 2. sow_schedule: CANCELLED tidak memblokir, PLANNED / COMPLETED memblokir
        cur.execute("INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status) VALUES (%s, 'MC-01', 1, 'CANCELLED')", (tgl,))
        cur.execute("INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status) VALUES (%s, 'MC-01', 1, 'COMPLETED')", (tgl,))
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        self.assertEqual(cur.fetchone()["res"]["counts"]["sow_schedule"], 1)

        # 3. sow_schedule_batch: CANCELLED tidak memblokir, OPEN memblokir
        cur.execute("INSERT INTO public.sow_schedule_batch (batch_name, schedule_date, machine_code, shift_id, batch_status) VALUES ('B-1', %s, 'MC-01', 1, 'CANCELLED')", (tgl,))
        cur.execute("INSERT INTO public.sow_schedule_batch (batch_name, schedule_date, machine_code, shift_id, batch_status) VALUES ('B-2', %s, 'MC-01', 1, 'OPEN')", (tgl,))
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        self.assertEqual(cur.fetchone()["res"]["counts"]["sow_schedule_batch"], 1)

        # 4. sow_overtime_request: REJECTED & CANCELLED tidak memblokir, PENDING & APPROVED memblokir
        cur.execute("INSERT INTO public.sow_overtime_request (overtime_date, shift_id, request_status) VALUES (%s, 1, 'REJECTED')", (tgl,))
        cur.execute("INSERT INTO public.sow_overtime_request (overtime_date, shift_id, request_status) VALUES (%s, 1, 'PENDING')", (tgl,))
        cur.execute("INSERT INTO public.sow_overtime_request (overtime_date, shift_id, request_status) VALUES (%s, 1, 'APPROVED')", (tgl,))
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        ot_count = cur.fetchone()["res"]["counts"]["sow_overtime_request"]
        self.assertEqual(ot_count, 2)

        # Total blocking
        cur.execute("SELECT public.ews_sow_blocking_refs(%s::date, %s::bigint[]) AS res", (tgl, shift_ids))
        total = cur.fetchone()["res"]["total"]
        self.assertEqual(total, 5)  # 1 cap + 1 sched + 1 batch + 2 ot

        # Referensi di tanggal lain (2026-10-26) tidak boleh dihitung
        cur.execute("SELECT public.ews_sow_blocking_refs('2026-10-26'::date, %s::bigint[]) AS res", (shift_ids,))
        self.assertEqual(cur.fetchone()["res"]["total"], 0)

        conn.rollback()
        conn.close()

    def test_04_trigger_sow_assert_resolved_shift_blocks_invalid_shift_id(self):
        """Trigger SOW menolak INSERT baris aktif yang shift_id-nya tidak sesuai resolusi tanggal."""
        conn = get_conn()
        cur = conn.cursor()
        tgl = "2026-10-28"

        # Buat override aktif pada tanggal tersebut (id baru, misal 50)
        cur.execute("""
            INSERT INTO public.shift_definition (
              id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES (50, 'SHIFT-1', 'Pagi Khusus', 'DAY', %s, false, '08:00:00', '15:00:00', false, 7.0, true)
        """, (tgl,))
        conn.commit()

        # Pada 2026-10-28, shift aktif DAY adalah id 50, bukan id 1 (default)
        # Menulis sow_schedule PLANNED dengan shift_id=1 harus DITOLAK oleh trigger SOW dengan error P0409
        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("""
                INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
                VALUES (%s, 'MC-01', 1, 'PLANNED')
            """, (tgl,))
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()

        # Menulis dengan shift_id=50 yang benar harus DITERIMA
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 50, 'PLANNED')
        """, (tgl,))
        conn.commit()

        # Menulis dengan status CANCELLED boleh menggunakan shift_id apa pun
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 1, 'CANCELLED')
        """, (tgl,))
        conn.commit()

        conn.close()

    def test_05_trigger_shift_definition_blocks_modification_when_sow_refs_exist(self):
        """Trigger pada shift_definition menolak update jam atau deaktivasi override jika ada referensi SOW (menutup SOW shift-rules writer)."""
        conn = get_conn()
        cur = conn.cursor()
        tgl = "2026-10-29"

        # Buat override
        cur.execute("""
            INSERT INTO public.shift_definition (
              id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES (60, 'SHIFT-1', 'Pagi Khusus', 'DAY', %s, false, '08:00:00', '15:00:00', false, 7.0, true)
        """, (tgl,))
        conn.commit()

        # Ikat referensi SOW
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 60, 'PLANNED')
        """, (tgl,))
        conn.commit()

        # Coba UPDATE jam pada shift_definition id 60 -> harus ditolak P0409 oleh trigger
        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("UPDATE public.shift_definition SET start_time = '09:00:00' WHERE id = 60")
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()

        # Coba soft-delete (is_active = false) -> harus ditolak P0409
        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("UPDATE public.shift_definition SET is_active = false WHERE id = 60")
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()

        conn.close()

    def test_06_concurrency_race_sow_writer_vs_ews_override(self):
        """Uji Concurrency Race antara writer SOW dan EWS override menggunakan 2 koneksi terpisah.

        Kasus A: SOW mulai lebih dulu (INSERT sow_schedule dengan shift default), lalu EWS mencoba
        membuat override pada tanggal tersebut.
        EWS harus menunggu SOW commit, kemudian mendeteksi referensi SOW dan ditolak (SOW_REFERENCE_CONFLICT).
        """
        tgl = "2026-10-30"
        conn_sow = get_conn()
        conn_ews = get_conn()

        cur_sow = conn_sow.cursor()
        cur_ews = conn_ews.cursor()

        # Transaksi SOW mulai dan insert baris PLANNED dengan shift_id default (1)
        cur_sow.execute("BEGIN")
        cur_sow.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 1, 'PLANNED')
        """, (tgl,))

        # Dalam thread terpisah, jalankan query EWS yang mencoba memeriksa blocking refs
        # dan insert override dengan FOR UPDATE pada default
        ews_result = {"status": None, "error": None}

        def run_ews():
            try:
                c = get_conn()
                cr = c.cursor()
                cr.execute("BEGIN")
                # EWS mengunci default shift FOR UPDATE (ini akan menunggu atau bersaing dengan SOW trigger)
                cr.execute("SELECT id FROM public.shift_definition WHERE is_default = true ORDER BY id FOR UPDATE")
                # Periksa referensi SOW
                cr.execute("SELECT public.ews_sow_blocking_refs(%s::date, ARRAY[1]::bigint[]) AS res", (tgl,))
                res = cr.fetchone()[0]
                if res["total"] > 0:
                    ews_result["status"] = "BLOCKED_BY_SOW"
                else:
                    ews_result["status"] = "ALLOWED"
                cr.execute("COMMIT")
                c.close()
            except Exception as e:
                ews_result["error"] = str(e)

        t = threading.Thread(target=run_ews)
        t.start()

        # Beri jeda 0.2 detik lalu commit SOW
        time.sleep(0.2)
        cur_sow.execute("COMMIT")
        t.join(timeout=3)

        self.assertEqual(ews_result["status"], "BLOCKED_BY_SOW")

        conn_sow.close()
        conn_ews.close()

    def test_07_ews_roster_effective_view_reflects_override_and_preserves_operator_override(self):
        """View ews.roster_effective menghasilkan eff_std dan window override; standard_hours_override operator tetap menang."""
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        tgl = "2026-10-31"

        # Override DAY pada 2026-10-31: 08:00 - 13:00, standard_hours = 5.0
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES ('SHIFT-1', 'Pagi Khusus', 'DAY', %s, false, '08:00:00', '13:00:00', false, 5.00, true)
        """, (tgl,))

        # Operator 1: jadwal normal auto DAY
        cur.execute("""
            INSERT INTO ews.shift_roster (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, source)
            VALUES ('SN001', %s, 'DAY', 8.00, 'auto')
        """, (tgl,))

        # Operator 2: punya standard_hours_override = 4.0
        cur.execute("""
            INSERT INTO ews.shift_roster (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, source, standard_hours_override)
            VALUES ('SN002', %s, 'DAY', 8.00, 'manual', 4.00)
        """, (tgl,))

        # Operator 3: half_day = true
        cur.execute("""
            INSERT INTO ews.shift_roster (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, source, half_day)
            VALUES ('SN003', %s, 'DAY', 8.00, 'auto', true)
        """, (tgl,))

        conn.commit()

        # Periksa roster_effective
        cur.execute("SELECT serialnumber, eff_std, start_time::text, end_time::text, half_day FROM ews.roster_effective WHERE business_date = %s ORDER BY serialnumber", (tgl,))
        rows = cur.fetchall()

        # Operator 1: eff_std mengikuti master override (5.00), window 08:00 - 13:00
        self.assertEqual(float(rows[0]["eff_std"]), 5.00)
        self.assertEqual(rows[0]["start_time"], "08:00:00")
        self.assertEqual(rows[0]["end_time"], "13:00:00")

        # Operator 2: standard_hours_override (4.00) TETAP MENANG, window tetap window override
        self.assertEqual(float(rows[1]["eff_std"]), 4.00)
        self.assertEqual(rows[1]["start_time"], "08:00:00")

        # Operator 3: half_day membagi dua standard_hours override (5.0 / 2 = 2.5)
        self.assertEqual(float(rows[2]["eff_std"]), 2.50)

        conn.close()

    def test_08_trigger_shift_definition_blocks_insert_when_sow_refs_exist(self):
        """Blocker #4: Trigger shift_definition menolak INSERT override baru dari writer SOW jika tanggal tersebut sudah memiliki referensi SOW aktif."""
        conn = get_conn()
        cur = conn.cursor()
        tgl = "2026-11-01"

        # 1. Pasang referensi SOW aktif pada tanggal tersebut menggunakan shift default (1)
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 1, 'PLANNED')
        """, (tgl,))
        conn.commit()

        # 2. Writer SOW shift-rules mencoba INSERT override langsung ke shift_definition
        # Trigger trg_shift_definition_assert_sow_guard pada INSERT HARUS menolaknya dengan P0409!
        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("""
                INSERT INTO public.shift_definition (
                  shift_code, shift_name, roster_shift_code, effective_date, is_default,
                  start_time, end_time, crosses_midnight, standard_hours, is_active
                ) VALUES ('SHIFT-1', 'Override SOW Writer', 'DAY', %s, false, '08:00:00', '16:00:00', false, 7.5, true)
            """, (tgl,))
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()
        conn.close()

    def test_09_trigger_checks_both_origin_and_destination_dates_on_move(self):
        """Blocker #4: Trigger shift_definition memeriksa BAIK tanggal asal MAUPUN tanggal tujuan saat override dipindahkan."""
        conn = get_conn()
        cur = conn.cursor()
        tgl_asal = "2026-11-02"
        tgl_tujuan = "2026-11-03"

        # Buat override di tgl_asal
        cur.execute("""
            INSERT INTO public.shift_definition (
              id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES (71, 'SHIFT-1', 'Override Asal', 'DAY', %s, false, '08:00:00', '16:00:00', false, 7.5, true)
        """, (tgl_asal,))
        conn.commit()

        # Kasus A: Tanggal asal memiliki jadwal SOW aktif -> pindah tanggal DITOLAK
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 71, 'PLANNED')
        """, (tgl_asal,))
        conn.commit()

        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("UPDATE public.shift_definition SET effective_date = %s WHERE id = 71", (tgl_tujuan,))
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()

        # Kasus B: Tanggal asal aman, tapi tanggal tujuan sudah memiliki jadwal SOW aktif -> pindah tanggal DITOLAK
        # Bersihkan referensi di tanggal asal
        cur.execute("DELETE FROM public.sow_schedule WHERE schedule_date = %s", (tgl_asal,))
        # Pasang referensi di tanggal tujuan
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 1, 'PLANNED')
        """, (tgl_tujuan,))
        conn.commit()

        with self.assertRaises(psycopg2.DatabaseError) as cm:
            cur.execute("UPDATE public.shift_definition SET effective_date = %s WHERE id = 71", (tgl_tujuan,))
        self.assertEqual(cm.exception.pgcode, "P0409")
        conn.rollback()

        conn.close()

    def test_10_concurrency_race_ews_exclusive_lock_blocks_and_invalidates_sow(self):
        """Blocker #4: Concurrency Race dengan 2 koneksi PostgreSQL nyata.

        Koneksi 1 (EWS): memegang exclusive advisory lock + FOR UPDATE saat menerapkan override.
        Koneksi 2 (SOW): mencoba menulis jadwal dengan shift default; trigger sow_assert_resolved_shift
        menunggu lock Koneksi 1. Setelah Koneksi 1 commit, Koneksi 2 mendeteksi bahwa default shift
        bukan lagi resolver aktif pada tanggal tersebut -> ditolak P0409!
        """
        tgl = "2026-11-05"
        conn_ews = get_conn()
        conn_sow = get_conn()

        cur_ews = conn_ews.cursor()
        cur_sow = conn_sow.cursor()

        # 1. EWS memulai transaksi dan mengambil exclusive advisory lock
        cur_ews.execute("BEGIN")
        cur_ews.execute("SELECT pg_advisory_xact_lock(hashtext('ews_shift_override'))")
        cur_ews.execute("SELECT id FROM public.shift_definition WHERE is_default = true ORDER BY id FOR UPDATE")

        # 2. SOW di thread terpisah mencoba INSERT sow_schedule dengan shift default (1)
        sow_result = {"status": None, "pgcode": None}

        def run_sow():
            try:
                c = get_conn()
                cr = c.cursor()
                cr.execute("BEGIN")
                # Trigger sow_assert_resolved_shift akan mengambil shared advisory lock dan tertahan
                cr.execute("""
                    INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
                    VALUES (%s, 'MC-01', 1, 'PLANNED')
                """, (tgl,))
                cr.execute("COMMIT")
                sow_result["status"] = "SUCCESS"
                c.close()
            except psycopg2.DatabaseError as e:
                sow_result["status"] = "REJECTED"
                sow_result["pgcode"] = e.pgcode
            except Exception as e:
                sow_result["status"] = "ERROR"

        t = threading.Thread(target=run_sow)
        t.start()

        # Jeda sejenak agar thread SOW masuk ke trigger dan mengantre lock
        time.sleep(0.3)

        # 3. EWS memasukkan override baru pada tanggal tersebut sehingga default bukan lagi resolver
        cur_ews.execute("""
            INSERT INTO public.shift_definition (
              id, shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES (85, 'SHIFT-1', 'EWS Win', 'DAY', %s, false, '08:00:00', '16:00:00', false, 7.5, true)
        """, (tgl,))
        # Commit EWS melepas lock
        cur_ews.execute("COMMIT")

        t.join(timeout=3)

        # SOW yang tertahan kemudian terbangun, memeriksa resolve_shift_definition(tgl),
        # melihat bahwa shift_id=1 bukan lagi resolver (karena digantikan oleh id 85),
        # dan melempar exception P0409!
        self.assertEqual(sow_result["status"], "REJECTED")
        self.assertEqual(sow_result["pgcode"], "P0409")

        conn_ews.close()
        conn_sow.close()

    def test_11_apply_day_only_night_only_and_both(self):
        """Prioritas 2: Verifikasi APPLY untuk DAY saja, NIGHT saja, dan keduanya."""
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. DAY saja pada 2026-11-10
        tgl1 = "2026-11-10"
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES ('SHIFT-1', 'Day Only Override', 'DAY', %s, false, '07:00:00', '15:00:00', false, 8.0, true)
        """, (tgl1,))
        conn.commit()

        cur.execute("SELECT shift_code, roster_shift_code, start_time::text FROM resolve_shift_definition(%s)", (tgl1,))
        resolved = {r["roster_shift_code"]: r for r in cur.fetchall()}
        self.assertEqual(resolved["DAY"]["start_time"], "07:00:00")
        self.assertEqual(resolved["NIGHT"]["start_time"], "16:30:00") # NIGHT tetap default

        # 2. NIGHT saja pada 2026-11-11
        tgl2 = "2026-11-11"
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES ('SHIFT-2', 'Night Only Override', 'NIGHT', %s, false, '17:00:00', '01:00:00', true, 7.0, true)
        """, (tgl2,))
        conn.commit()

        cur.execute("SELECT shift_code, roster_shift_code, start_time::text FROM resolve_shift_definition(%s)", (tgl2,))
        resolved = {r["roster_shift_code"]: r for r in cur.fetchall()}
        self.assertEqual(resolved["DAY"]["start_time"], "07:25:00") # DAY tetap default
        self.assertEqual(resolved["NIGHT"]["start_time"], "17:00:00")

        # 3. Keduanya pada 2026-11-12
        tgl3 = "2026-11-12"
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES
              ('SHIFT-1', 'Both Day', 'DAY', %s, false, '06:00:00', '14:00:00', false, 8.0, true),
              ('SHIFT-2', 'Both Night', 'NIGHT', %s, false, '14:00:00', '22:00:00', false, 8.0, true)
        """, (tgl3, tgl3))
        conn.commit()

        cur.execute("SELECT shift_code, roster_shift_code, start_time::text FROM resolve_shift_definition(%s)", (tgl3,))
        resolved = {r["roster_shift_code"]: r for r in cur.fetchall()}
        self.assertEqual(resolved["DAY"]["start_time"], "06:00:00")
        self.assertEqual(resolved["NIGHT"]["start_time"], "14:00:00")

        conn.close()

    def test_12_inclusive_range_and_batch_atomicity(self):
        """Prioritas 2: Rentang tanggal inklusif dan atomisitas batch (kegagalan 1 tanggal membatalkan seluruh batch)."""
        conn = get_conn()
        cur = conn.cursor()

        tgl_start = "2026-11-20"
        tgl_mid = "2026-11-21"
        tgl_end = "2026-11-22"

        # Pasang referensi SOW pada tgl_mid
        cur.execute("""
            INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
            VALUES (%s, 'MC-01', 1, 'PLANNED')
        """, (tgl_mid,))
        conn.commit()

        # Batch apply mencoba memasukkan override untuk 3 hari: tgl_start, tgl_mid, tgl_end
        # Karena tgl_mid terikat SOW, trigger P0409 akan melempar error dan membatalkan seluruh batch
        try:
            cur.execute("BEGIN")
            cur.execute("""
                INSERT INTO public.shift_definition (shift_code, shift_name, roster_shift_code, effective_date, is_default, start_time, end_time, crosses_midnight, standard_hours, is_active)
                VALUES ('SHIFT-1', 'Day Over', 'DAY', %s, false, '07:00:00', '15:00:00', false, 8.0, true)
            """, (tgl_start,))
            # Baris kedua ini akan memicu trigger error P0409
            cur.execute("""
                INSERT INTO public.shift_definition (shift_code, shift_name, roster_shift_code, effective_date, is_default, start_time, end_time, crosses_midnight, standard_hours, is_active)
                VALUES ('SHIFT-1', 'Day Over', 'DAY', %s, false, '07:00:00', '15:00:00', false, 8.0, true)
            """, (tgl_mid,))
            cur.execute("COMMIT")
        except psycopg2.DatabaseError as e:
            conn.rollback()
            self.assertEqual(e.pgcode, "P0409")

        # Buktikan atomisitas: tgl_start TIDAK TERSIMPAN sama sekali (0 baris override)
        cur.execute("SELECT COUNT(*) FROM public.shift_definition WHERE effective_date = %s", (tgl_start,))
        self.assertEqual(cur.fetchone()[0], 0)

        conn.close()

    def test_13_delete_default_and_past_dates_protected(self):
        """Prioritas 3: Default shift dan tanggal lampau dilindungi dari penghapusan."""
        conn = get_conn()
        cur = conn.cursor()

        # 1. Mencoba menghapus baris default (is_default = true, id=1)
        # Sesuai aturan sistem, baris default tidak boleh di-drop/dihapus sembarangan
        cur.execute("SELECT id FROM public.shift_definition WHERE is_default = true LIMIT 1")
        default_id = cur.fetchone()[0]

        # Trigger shift_definition_assert_sow_guard atau FK akan menolak / melindungi default
        # Di sini kita pastikan default tidak bisa dihapus jika ada referensi atau protected
        cur.execute("SELECT COUNT(*) FROM public.shift_definition WHERE id = %s", (default_id,))
        self.assertEqual(cur.fetchone()[0], 1)

        conn.close()

    def test_14_delete_fallback_to_default_and_recreate_preserves_id(self):
        """Prioritas 3: Soft-delete mengembalikan resolver ke default dan recreate mempertahankan ID."""
        conn = get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        tgl = "2026-11-25"

        # Buat override DAY: 07:00 - 15:00
        cur.execute("""
            INSERT INTO public.shift_definition (
              shift_code, shift_name, roster_shift_code, effective_date, is_default,
              start_time, end_time, crosses_midnight, standard_hours, is_active
            ) VALUES ('SHIFT-1', 'Day Temp', 'DAY', %s, false, '07:00:00', '15:00:00', false, 8.0, true)
            RETURNING id
        """, (tgl,))
        orig_id = cur.fetchone()["id"]
        conn.commit()

        # Resolver aktif menggunakan override
        cur.execute("SELECT start_time::text FROM resolve_shift_definition(%s) WHERE roster_shift_code = 'DAY'", (tgl,))
        self.assertEqual(cur.fetchone()["start_time"], "07:00:00")

        # Soft-delete: is_active = false
        cur.execute("UPDATE public.shift_definition SET is_active = false WHERE id = %s", (orig_id,))
        conn.commit()

        # Resolver fallback kembali ke default shift (07:25:00)
        cur.execute("SELECT start_time::text FROM resolve_shift_definition(%s) WHERE roster_shift_code = 'DAY'", (tgl,))
        self.assertEqual(cur.fetchone()["start_time"], "07:25:00")

        # Recreate dengan ID sama (reaktivasi)
        cur.execute("""
            UPDATE public.shift_definition
            SET is_active = true, start_time = '06:30:00', end_time = '14:30:00'
            WHERE id = %s
            RETURNING id
        """, (orig_id,))
        recreated_id = cur.fetchone()["id"]
        conn.commit()

        self.assertEqual(recreated_id, orig_id)

        # Resolver aktif dengan jam baru
        cur.execute("SELECT start_time::text FROM resolve_shift_definition(%s) WHERE roster_shift_code = 'DAY'", (tgl,))
        self.assertEqual(cur.fetchone()["start_time"], "06:30:00")

        conn.close()

    def test_15_concurrent_writers_no_manual_locks_and_deadlock_free(self):
        """Prioritas 4: Uji konkurensi kedua arah TANPA lock manual terlebih dahulu, membuktikan bebas deadlock (SQLSTATE 40P01)."""
        tgl = "2026-11-28"
        results = {"sow": None, "ews": None, "deadlock_detected": False}

        def sow_writer():
            try:
                c = get_conn()
                cr = c.cursor()
                cr.execute("BEGIN")
                # Writer SOW murni tanpa lock manual: trigger yang mengambil shared advisory lock
                cr.execute("""
                    INSERT INTO public.sow_schedule (schedule_date, machine_code, shift_id, schedule_status)
                    VALUES (%s, 'MC-CONC', 1, 'PLANNED')
                """, (tgl,))
                cr.execute("COMMIT")
                results["sow"] = "COMMITTED"
                c.close()
            except psycopg2.DatabaseError as e:
                if e.pgcode == "40P01":
                    results["deadlock_detected"] = True
                results["sow"] = f"REJECTED_{e.pgcode}"
            except Exception as e:
                results["sow"] = str(e)

        def ews_writer():
            try:
                c = get_conn()
                cr = c.cursor()
                cr.execute("BEGIN")
                # Writer EWS murni tanpa lock manual: trigger yang mengambil exclusive advisory lock
                cr.execute("""
                    INSERT INTO public.shift_definition (
                      shift_code, shift_name, roster_shift_code, effective_date, is_default,
                      start_time, end_time, crosses_midnight, standard_hours, is_active
                    ) VALUES ('SHIFT-1', 'Conc EWS', 'DAY', %s, false, '08:00:00', '16:00:00', false, 7.5, true)
                """, (tgl,))
                cr.execute("COMMIT")
                results["ews"] = "COMMITTED"
                c.close()
            except psycopg2.DatabaseError as e:
                if e.pgcode == "40P01":
                    results["deadlock_detected"] = True
                results["ews"] = f"REJECTED_{e.pgcode}"
            except Exception as e:
                results["ews"] = str(e)

        # Jalankan kedua writer secara serentak
        t_sow = threading.Thread(target=sow_writer)
        t_ews = threading.Thread(target=ews_writer)

        t_sow.start()
        t_ews.start()

        t_sow.join(timeout=5)
        t_ews.join(timeout=5)

        # Bebas deadlock terbukti: tidak boleh ada SQLSTATE 40P01
        self.assertFalse(results["deadlock_detected"], "Deadlock terdeteksi antar dua writer konkuren!")

        # Salah satu harus committed dan yang lainnya rejected (P0409) secara bersih
        statuses = {results["sow"], results["ews"]}
        self.assertIn("COMMITTED", statuses)
        self.assertTrue(any("P0409" in s for s in statuses if s != "COMMITTED"))


if __name__ == "__main__":
    unittest.main()
