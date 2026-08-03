-- Bay booking: tipe booking non-job, tujuan (purpose), dan grup reservasi.
-- Plan: docs/MFG_PLAN_AREA_PLAN.md (§4 Fase 2, §5 keputusan D3).
--
-- KENAPA ADA:
--   1. Bay tidak hanya dipakai untuk order produksi. Parkir unit, taruh material, dan
--      maintenance bay juga memakan tempat, tapi skema lama memaksa order_no NOT NULL —
--      jadi booking non-job dipalsukan dengan order dummy atau tidak dicatat sama sekali.
--      -> booking_type + purpose, order_no jadi nullable, dijaga CHECK berpasangan.
--   2. Satu reservasi nyata = N baris jadwal (satu per task). Skema lama tidak punya
--      identitas grup, sehingga UI merangkai ulang "reservationKey" dari
--      (order_no, start_date, end_date, bay_codes) dan pembatalan jadi loop DELETE
--      non-atomik (A-09). -> schedule_group_id sebagai identitas grup yang eksplisit.
--
-- KENAPA TIDAK ADA is_exclusive / EXCLUDE constraint (keputusan D3 — JANGAN "diperbaiki"):
--   Di lapangan TIDAK ADA bay yang eksklusif. Semua bay — termasuk booth PT/BL dan booking
--   non-job — boleh ditumpuk beberapa order sekaligus; itu praktik normal, bukan kesalahan.
--   Karena itu database sengaja TIDAK melarang overlap: tanpa kolom is_exclusive, tanpa
--   EXCLUDE constraint, tanpa advisory lock. Menambahkannya akan memblokir pekerjaan yang sah.
--
-- KENAPA 409 BAY_SCHEDULE_CONFLICT DIHAPUS (D3, konsekuensi langsung dari poin di atas):
--   API lama menolak reservasi kedua di bay+tanggal yang sama dengan 409, padahal DB sendiri
--   tidak pernah melarangnya — aturan itu murni karangan lapisan API dan salah secara domain.
--   Sekarang overlap tetap DIQUERY (findBayOverlaps) tapi dikembalikan sebagai peringatan lunak
--   `warnings: [{ type: 'BAY_OVERLAP', occupants: [...] }]` pada respons 201. Sistem memberi
--   tahu, bukan mencegah. Kalau suatu saat overlap ingin dilarang lagi, itu keputusan domain
--   baru — bukan bug yang perlu ditambal di sini.
--
-- Runner (database/migrate.js) UP-ONLY & membungkus transaksi sendiri —
-- JANGAN tulis BEGIN/COMMIT di sini. Idempotent: aman dijalankan ulang.

-- --------------------------------------------------------------------------------------------
-- 1. Kolom baru
-- --------------------------------------------------------------------------------------------

-- DEFAULT 'ORDER' membuat seluruh baris lama otomatis valid sebagai reservasi order.
ALTER TABLE public.ms_project_bay_schedule
  ADD COLUMN IF NOT EXISTS booking_type      text NOT NULL DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS purpose           text,
  ADD COLUMN IF NOT EXISTS schedule_group_id uuid;

-- ADD CONSTRAINT tidak punya IF NOT EXISTS untuk CHECK — dijaga lewat katalog pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bay_schedule_booking_type'
      AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT chk_bay_schedule_booking_type
      CHECK (booking_type IN ('ORDER','PARKING','STORAGE','MAINTENANCE','OTHER'));
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 2. order_no jadi opsional — booking non-job tidak punya order
-- --------------------------------------------------------------------------------------------

-- DROP NOT NULL sudah idempotent (no-op bila kolom sudah nullable).
ALTER TABLE public.ms_project_bay_schedule
  ALTER COLUMN order_no DROP NOT NULL;

-- --------------------------------------------------------------------------------------------
-- 3. Bersihkan data sampah A-16 SEBELUM backfill supaya tidak ikut dapat schedule_group_id
-- --------------------------------------------------------------------------------------------

-- Sisa smoke-test dengan tanggal 2099 (2 baris per verifikasi 2026-08-03). Predikat sengaja
-- SANGAT sempit — status + created_by + tahun mustahil — agar tidak pernah menyentuh data nyata.
DELETE FROM public.ms_project_bay_schedule
 WHERE status = 'CANCELLED'
   AND created_by = 'codex-smoke-test'
   AND end_date > DATE '2090-01-01';

-- --------------------------------------------------------------------------------------------
-- 4. Backfill schedule_group_id untuk baris lama
-- --------------------------------------------------------------------------------------------

-- Kelompok = kunci yang selama ini dipakai FE sebagai reservationKey:
-- (order_no, start_date, end_date, bay_codes). Satu uuid per kelompok; gen_random_uuid()
-- di dalam query ber-GROUP BY dievaluasi sekali per baris hasil (= sekali per kelompok).
--
-- AS MATERIALIZED wajib, bukan gaya: gen_random_uuid() itu VOLATILE. Sebagai sub-select biasa
-- di FROM, sisi dalam nested loop bisa di-rescan dan menghasilkan uuid BERBEDA untuk baris-baris
-- dalam kelompok yang sama — persis kebalikan dari tujuan backfill ini. CTE MATERIALIZED
-- menjamin evaluasi tepat sekali (PG12+).
--
-- order_no & bay_codes dijodohkan dengan IS NOT DISTINCT FROM: order_no kini nullable, dan
-- perbandingan '=' akan menghasilkan NULL (baris tidak ter-update) untuk booking non-job.
WITH g AS MATERIALIZED (
  SELECT order_no, start_date, end_date, bay_codes, gen_random_uuid() AS gid
    FROM public.ms_project_bay_schedule
   WHERE schedule_group_id IS NULL
   GROUP BY order_no, start_date, end_date, bay_codes
)
UPDATE public.ms_project_bay_schedule s
   SET schedule_group_id = g.gid
  FROM g
 WHERE s.schedule_group_id IS NULL
   AND s.order_no   IS NOT DISTINCT FROM g.order_no
   AND s.bay_codes  IS NOT DISTINCT FROM g.bay_codes
   AND s.start_date = g.start_date
   AND s.end_date   = g.end_date;

CREATE INDEX IF NOT EXISTS idx_ms_project_bay_schedule_group
  ON public.ms_project_bay_schedule (schedule_group_id);

-- --------------------------------------------------------------------------------------------
-- 5. CHECK berpasangan order_no <-> purpose
-- --------------------------------------------------------------------------------------------

-- Ditambahkan PALING AKHIR: setelah DELETE sampah dan setelah semua baris lama punya
-- booking_type = 'ORDER' + order_no terisi, sehingga validasi atas data lama lulus seketika
-- (diverifikasi 2026-08-03: 0 baris melanggar).
--   booking_type = 'ORDER'  -> order_no WAJIB (purpose bebas, boleh dipakai sebagai catatan)
--   booking_type <> 'ORDER' -> purpose  WAJIB (order_no boleh NULL: booking non-job)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bay_schedule_order_or_purpose'
      AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT chk_bay_schedule_order_or_purpose
      CHECK (
           (booking_type =  'ORDER' AND order_no IS NOT NULL AND btrim(order_no) <> '')
        OR (booking_type <> 'ORDER' AND purpose  IS NOT NULL AND btrim(purpose)  <> '')
      );
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 6. Dokumentasi kolom
-- --------------------------------------------------------------------------------------------

COMMENT ON COLUMN public.ms_project_bay_schedule.booking_type IS
  'Jenis pemakaian bay: ORDER (reservasi job, wajib order_no) atau PARKING/STORAGE/MAINTENANCE/'
  'OTHER (booking non-job, wajib purpose). Default ORDER agar baris lama tetap valid.';

COMMENT ON COLUMN public.ms_project_bay_schedule.purpose IS
  'Keterangan tujuan pemakaian bay. WAJIB bila booking_type <> ''ORDER'' (lihat '
  'chk_bay_schedule_order_or_purpose); opsional sebagai catatan bebas untuk booking ORDER.';

COMMENT ON COLUMN public.ms_project_bay_schedule.schedule_group_id IS
  'Identitas satu reservasi = N baris jadwal (satu per task). Dipakai endpoint '
  'PUT/DELETE /ms-project/bay-schedules/group/:schedule_group_id agar ubah & batal jadi atomik '
  'satu transaksi. Baris lama di-backfill per kelompok (order_no, start_date, end_date, bay_codes) '
  '— kunci yang dulu dirangkai ulang FE sebagai reservationKey.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan blok ini sebagai .sql hidup di migrations/api/).
-- Catatan: 2 baris sampah smoke-test yang dihapus di langkah 3 TIDAK bisa dikembalikan.
--
--   DROP INDEX IF EXISTS public.idx_ms_project_bay_schedule_group;
--   ALTER TABLE public.ms_project_bay_schedule
--     DROP CONSTRAINT IF EXISTS chk_bay_schedule_order_or_purpose;
--   ALTER TABLE public.ms_project_bay_schedule
--     DROP CONSTRAINT IF EXISTS chk_bay_schedule_booking_type;
--   -- Hanya aman bila belum ada booking non-job (order_no NULL) yang tercatat:
--   --   SELECT count(*) FROM public.ms_project_bay_schedule WHERE order_no IS NULL;  -- harus 0
--   ALTER TABLE public.ms_project_bay_schedule ALTER COLUMN order_no SET NOT NULL;
--   ALTER TABLE public.ms_project_bay_schedule
--     DROP COLUMN IF EXISTS schedule_group_id,
--     DROP COLUMN IF EXISTS purpose,
--     DROP COLUMN IF EXISTS booking_type;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260803_bay_booking_type.sql';
-- ============================================================================================
