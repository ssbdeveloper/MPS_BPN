-- Standar sub-task per OPERASI, didefinisikan sekali per part_number lalu dipakai ulang
-- di setiap order part tersebut.
--
-- KENAPA KUNCINYA operation_text, BUKAN operation_no
-- Diukur ke prod Cikupa 2026-08-04. Untuk part_number yang sama, nomor operasi BERGESER
-- antar order: SB10972 punya 15 order dengan 4 pola operation_no berbeda (49-51 operasi),
-- SB11202AE 11 order dengan 4 pola. Standar yang dikunci ke operation_no akan sering meleset.
-- Sebaliknya TEKS operasinya stabil - ada inti yang muncul di SEMUA order:
--     SB30081     14 order -> 78 dari 79 teks muncul di semua order
--     SB11502AA    7 order -> 95 dari 98
--     SB10972     15 order -> 47 dari 55
--     SB11202AE   11 order -> 47 dari 56
-- Pola ini sama dengan SOW_STANDARD_MATCH_JOIN yang sudah dipakai sowController untuk
-- mencocokkan sow ke sow_standard (part_number/model + operation_text), jadi standar sub-task
-- mengikuti mekanisme yang sudah terbukti, bukan bikin jalur pencocokan baru.
--
-- operation_no TETAP disimpan sebagai referensi/urutan tampilan, tapi TIDAK dipakai mencocokkan.
--
-- TIDAK ADA FK ke public.components. Kunci join sebenarnya di seluruh kodebase adalah
-- sow.part_number (teks), dan sebuah part bisa ada di sow tanpa pernah terdaftar di components.
-- Mem-FK-kannya akan menolak standar yang sah hanya karena master-nya belum di-seed.
--
-- Runner up-only, membungkus transaksinya sendiri: tanpa BEGIN/COMMIT, tanpa CONCURRENTLY.

CREATE TABLE IF NOT EXISTS public.sow_sub_operation_standard (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_number    text        NOT NULL,
  operation_text text        NOT NULL,
  operation_no   integer,
  title          text        NOT NULL,
  sort_order     integer     NOT NULL DEFAULT 0,
  weight         numeric(6,2) NOT NULL DEFAULT 1,
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  updated_at     timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_weight' AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_weight CHECK (weight > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sow_sub_op_std_not_blank' AND conrelid = 'public.sow_sub_operation_standard'::regclass
  ) THEN
    ALTER TABLE public.sow_sub_operation_standard
      ADD CONSTRAINT chk_sow_sub_op_std_not_blank
      CHECK (btrim(part_number) <> '' AND btrim(operation_text) <> '' AND btrim(title) <> '');
  END IF;
END $$;

-- Satu judul sub-task hanya boleh sekali per (part, operasi) yang AKTIF. Dinormalisasi
-- upper(btrim(...)) karena data SAP datang dengan spasi dan kapitalisasi tidak konsisten.
-- Partial WHERE is_active: menonaktifkan dipakai sebagai jalur hapus yang bisa dibalik.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_sub_op_std_active
  ON public.sow_sub_operation_standard
     (upper(btrim(part_number)), upper(btrim(operation_text)), upper(btrim(title)))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_sow_sub_op_std_part
  ON public.sow_sub_operation_standard (upper(btrim(part_number)))
  WHERE is_active;

COMMENT ON TABLE public.sow_sub_operation_standard IS
  'Standar sub-task per operasi, per part_number. Dicocokkan ke sow lewat '
  '(part_number, operation_text) - BUKAN operation_no, karena nomor operasi bergeser antar '
  'order untuk part yang sama. Instansiasinya masuk ke public.sow_sub_operation.';
COMMENT ON COLUMN public.sow_sub_operation_standard.operation_no IS
  'Referensi/urutan tampilan saja. TIDAK dipakai untuk mencocokkan - lihat komentar tabel.';
COMMENT ON COLUMN public.sow_sub_operation_standard.weight IS
  'Bobot relatif sub-task saat progress digulung ke operasi induk '
  '(recomputeOperationProgress: SUM(progress*weight)/SUM(weight)).';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan sebagai .sql aktif di migrations/api).
--
--   DROP TABLE IF EXISTS public.sow_sub_operation_standard;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260804d_sow_sub_operation_standard.sql';
-- ============================================================================================
