-- Tautkan aktor reservasi bay ke public.users, bukan menyimpan teks bebas.
--
-- MASALAH: ms_project_bay_schedule.created_by / updated_by bertipe text tanpa foreign key.
-- Isinya di prod bercampur tiga generasi: 'web-manufacturing' (aktor hardcode lama),
-- '2' / '37' (ID user yang bocor ke layar karena helper readLoginActor mengembalikan
-- String(user.id) lebih dulu), dan 'Tee San' (nama, setelah perbaikan Fase 0). Owner melihat
-- angka 37 di kolom "created by" — itu id user mell.sandy, bukan nama.
--
-- Nilai numerik sudah di-backfill jadi nama lewat DML terpisah, tapi teks bebas tetap rapuh:
--   * ganti nama di users tidak ikut ke reservasi lama
--   * tidak ada yang mencegah nilai sampah masuk lagi ('codex-smoke-test' pernah masuk)
--   * aturan kepemilikan ("hanya pembuat yang boleh membatalkan") tidak bisa ditegakkan
--
-- PERBAIKAN: simpan ID user dengan FK. Nama di-resolve saat DIBACA (listBaySchedules
-- LEFT JOIN users), sehingga rename otomatis ikut dan ID tidak pernah bocor ke UI.
--
-- Kolom teks created_by/updated_by SENGAJA DIPERTAHANKAN, bukan di-drop:
--   * aktor non-user yang sah ('web-manufacturing', job/skrip) tidak punya baris users
--   * jadi jejak historis untuk baris yang user-nya kelak dihapus (FK ON DELETE SET NULL)
-- Pembacaan memakai coalesce(users.name, created_by) — ID sebagai sumber kebenaran, teks
-- sebagai cadangan.
--
-- Backfill aman: public.users.name terverifikasi UNIK (38 dari 38 baris) per 2026-08-04, jadi
-- pencocokan nama tidak ambigu. 'web-manufacturing' tidak cocok dengan user mana pun dan
-- sengaja dibiarkan NULL — itu memang bukan orang.
--
-- Runner up-only, membungkus transaksinya sendiri: tanpa BEGIN/COMMIT, tanpa CONCURRENTLY.

ALTER TABLE public.ms_project_bay_schedule
  ADD COLUMN IF NOT EXISTS created_by_user_id integer,
  ADD COLUMN IF NOT EXISTS updated_by_user_id integer;

-- ADD CONSTRAINT tidak punya IF NOT EXISTS — dijaga lewat katalog supaya re-run jadi no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bay_schedule_created_by_user'
       AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT fk_bay_schedule_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bay_schedule_updated_by_user'
       AND conrelid = 'public.ms_project_bay_schedule'::regclass
  ) THEN
    ALTER TABLE public.ms_project_bay_schedule
      ADD CONSTRAINT fk_bay_schedule_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Postgres TIDAK mengindeks kolom FK secara otomatis; tanpa ini, DELETE satu user memindai
-- seluruh tabel untuk menegakkan ON DELETE SET NULL.
CREATE INDEX IF NOT EXISTS idx_bay_schedule_created_by_user
  ON public.ms_project_bay_schedule (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

-- Backfill: cocokkan teks yang ada ke users, lewat name DULU lalu username. Hanya baris yang
-- cocok TEPAT SATU user yang diisi — sisanya (aktor sistem) tetap NULL.
UPDATE public.ms_project_bay_schedule b
   SET created_by_user_id = u.id
  FROM public.users u
 WHERE b.created_by_user_id IS NULL
   AND b.created_by IS NOT NULL
   AND lower(btrim(u.name)) = lower(btrim(b.created_by));

UPDATE public.ms_project_bay_schedule b
   SET created_by_user_id = u.id
  FROM public.users u
 WHERE b.created_by_user_id IS NULL
   AND b.created_by IS NOT NULL
   AND lower(btrim(u.username)) = lower(btrim(b.created_by));

UPDATE public.ms_project_bay_schedule b
   SET updated_by_user_id = u.id
  FROM public.users u
 WHERE b.updated_by_user_id IS NULL
   AND b.updated_by IS NOT NULL
   AND lower(btrim(u.name)) = lower(btrim(b.updated_by));

UPDATE public.ms_project_bay_schedule b
   SET updated_by_user_id = u.id
  FROM public.users u
 WHERE b.updated_by_user_id IS NULL
   AND b.updated_by IS NOT NULL
   AND lower(btrim(u.username)) = lower(btrim(b.updated_by));

COMMENT ON COLUMN public.ms_project_bay_schedule.created_by_user_id IS
  'Pembuat reservasi, ditautkan ke public.users(id). SUMBER KEBENARAN untuk menampilkan nama — '
  'kolom teks created_by hanya cadangan untuk aktor non-user (job/skrip) dan jejak historis.';
COMMENT ON COLUMN public.ms_project_bay_schedule.updated_by_user_id IS
  'Pengubah terakhir, ditautkan ke public.users(id). Lihat catatan di created_by_user_id.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan sebagai .sql aktif di migrations/api).
--
--   ALTER TABLE public.ms_project_bay_schedule
--     DROP CONSTRAINT IF EXISTS fk_bay_schedule_created_by_user,
--     DROP CONSTRAINT IF EXISTS fk_bay_schedule_updated_by_user;
--   DROP INDEX IF EXISTS public.idx_bay_schedule_created_by_user;
--   ALTER TABLE public.ms_project_bay_schedule
--     DROP COLUMN IF EXISTS created_by_user_id,
--     DROP COLUMN IF EXISTS updated_by_user_id;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804c_bay_schedule_actor_user_id.sql';
-- ============================================================================================
