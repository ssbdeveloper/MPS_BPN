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


if __name__ == "__main__":
    unittest.main()
