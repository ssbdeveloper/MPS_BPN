-- Penanda subcont per operasi SOW: operasi dikerjakan vendor eksternal, jamnya TIDAK
-- dihitung sebagai beban (outstanding) workshop internal.
-- Plan: docs/MFG_PLAN_AREA_PLAN.md (§4 Fase 6, §5 keputusan D4, temuan R4 & anomali A-01/A-11).
--
-- KENAPA TABEL TERPISAH DAN TANPA FK KE sow(idsow):
--   `saveSowOrderRevision` (apps/api/controllers/sowController.js) menjalankan
--   DELETE FROM sow WHERE order_no ... lalu INSERT ulang seluruh operasi memakai whitelist
--   33 kolom EDITABLE_SOW_COLUMNS (sowController.js:27-61). Artinya:
--     1. Kolom baru apa pun di tabel `sow` DIJAMIN HILANG pada Create Revision berikutnya —
--        ini bukan dugaan, itu anomali A-01 yang sudah memakan `people_required` (fitur 30 Juli).
--     2. `idsow` adalah identitas baris yang MATI setiap revisi (baris dihapus lalu dibuat lagi
--        dengan id baru). FK ke sow(idsow) akan ikut ter-CASCADE / gagal, dan penanda subcont
--        lenyap justru pada aksi yang paling sering dipakai PPC.
--   Karena itu penanda hidup di tabelnya sendiri, ber-key LOGIS (order_no, operation_no) —
--   kunci bisnis yang bertahan lintas revisi — dan SENGAJA TIDAK punya foreign key ke `sow`.
--   Konsekuensi yang diterima: integritas referensial dijaga di lapisan API (POST menolak 404
--   bila operasi tidak ada di `sow`), bukan oleh database.
--
-- KENAPA KUNCI DINORMALISASI ltrim(order_no, '0'):
--   `order_no` bertipe text dan nomor order SAP muncul dengan/ tanpa leading zero tergantung
--   sumbernya. SELURUH kodebase sudah mencocokkan order dengan cara itu — lihat
--   msProjectService.js baris 1249, 1286, 1353, 1578, 1798, 2171, 2259 (getSowOrderOperations,
--   listBaySchedules, dst) yang semuanya memakai `ltrim(order_no,'0') = ltrim($1,'0')`.
--   Kalau index unik di sini memakai order_no mentah, dua ejaan nomor yang sama ('12345' dan
--   '0012345') bisa dua-duanya jadi tanda AKTIF, dan predikat eksklusi (yang ber-ltrim) akan
--   menganggapnya satu — jadi UNIQUE-nya tidak menjaga apa pun. Index-nya karena itu
--   ekspresional. ltrim(text,text) IMMUTABLE (diverifikasi di prod: provolatile = 'i'),
--   jadi sah dipakai sebagai kunci index.
--   Catatan data per 2026-08-03: 0 dari 7.344 baris `sow` dan 0 dari 7.338 baris `ph3_order`
--   benar-benar punya leading zero, jadi normalisasi ini bersifat DEFENSIF + konsisten dengan
--   konvensi kodebase, bukan menambal data kotor yang sudah ada.
--
-- KENAPA TIDAK MENUMPANG KOLOM sow.workcenter (R4 / D4 — jangan "disederhanakan" nanti):
--   `sow.workcenter` itu CERMIN ETL SAP, bukan field milik PPC. Di prod isinya identik dengan
--   `ph3_order.work_center` untuk 7.338 dari 7.338 baris (0 beda). ETL
--   jobs/etl/etl_sync_v2.py:504-513 menimpanya TANPA SYARAT:
--       ON CONFLICT (order_no, operation_no) DO UPDATE SET
--           workcenter = EXCLUDED.workcenter,   -- tanpa guard, beda dari `status` yang
--           planhours  = EXCLUDED.planhours,    -- dilindungi COALESCE di sowController.js:2503
--   Menandai subcont dengan menulis 'C5100SUB' ke sana = penanda hilang diam-diam pada sinkron
--   SAP berikutnya: tanpa error, tanpa log. Tambahan (A-11): `ms_project_task.workcenter` teks
--   bebas dengan 79 nilai distinct termasuk 'flat tray' dan 'cek', dan filter job operator
--   memakai kesetaraan string persis — kolom itu tidak layak jadi pembawa makna baru.
--   Workcenter C5100SUB juga tidak pernah dibuat: `public.workcenter` hanya 5 baris.
--   `original_workcenter` di bawah hanya SALINAN untuk audit/pelaporan — bukan pemindahan.
--
-- URUTAN DEPLOY — WAJIB DDL DULU, BARU KODE:
--   Migrasi ini HARUS sudah diterapkan SEBELUM kode Fase 6 di-deploy. Predikat eksklusi
--   `NOT EXISTS (SELECT 1 FROM public.sow_subcont_mark ...)` ditanam ke banyak agregasi
--   (sowScheduleController, msProjectService.listSowOrders, dashboardController,
--   mpsDashboardController, mpsDashboardSocket, timesheet_transactionController). Kalau kode
--   naik duluan, SEMUA dashboard itu 500 dengan `relation "sow_subcont_mark" does not exist`,
--   bukan degradasi halus. Rollback pun berurutan terbalik: turunkan kode dulu, baru DROP TABLE.
--   CATATAN OPERASIONAL: ledger `public.schema_migrations` di prod hanya berisi 3 baris padahal
--   >65 file migrasi sudah nyata diterapkan — migrasi selama ini dijalankan manual lewat psql,
--   bukan lewat `node database/migrate.js`. Jangan asumsikan runner otomatis akan memasangnya.
--
-- Runner (database/migrate.js) UP-ONLY & membungkus transaksi sendiri —
-- JANGAN tulis BEGIN/COMMIT di sini, dan JANGAN pakai CREATE INDEX CONCURRENTLY.
-- Idempotent: aman dijalankan ulang.

-- --------------------------------------------------------------------------------------------
-- 1. Tabel penanda
-- --------------------------------------------------------------------------------------------

-- Tipe kunci sengaja dicocokkan dengan sumbernya: sow.order_no = text (nullable di sow, tapi
-- WAJIB di sini — tanda tanpa order tidak punya arti), sow.operation_no = integer NOT NULL.
CREATE TABLE IF NOT EXISTS public.sow_subcont_mark (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no            text        NOT NULL,
  operation_no        integer     NOT NULL,
  original_workcenter text,
  note                text,
  marked_by           text,
  marked_at           timestamptz NOT NULL DEFAULT now(),
  unmarked_by         text,
  unmarked_at         timestamptz
);

-- --------------------------------------------------------------------------------------------
-- 2. Index
-- --------------------------------------------------------------------------------------------

-- Satu tanda AKTIF per operasi. Partial (unmarked_at IS NULL) supaya riwayat tandai → batal →
-- tandai lagi tetap boleh menumpuk baris historis, tapi hanya satu yang aktif pada satu waktu.
-- Kunci dinormalisasi ltrim(...,'0') — lihat alasan di header.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_subcont_mark_active
  ON public.sow_subcont_mark (ltrim(order_no, '0'), operation_no)
  WHERE unmarked_at IS NULL;

-- Lookup per-order (mis. GET /sow/subcont-marks?order_no=..., dan hitungan subcont_ops di
-- listSowOrders). Bentuknya sama dengan kolom terdepan index unik di atas, jadi sebagian besar
-- rencana query bisa dilayani keduanya; index ini disimpan terpisah agar niatnya eksplisit dan
-- tetap ada kalau definisi index unik berubah.
CREATE INDEX IF NOT EXISTS idx_sow_subcont_mark_order
  ON public.sow_subcont_mark (ltrim(order_no, '0'))
  WHERE unmarked_at IS NULL;

-- --------------------------------------------------------------------------------------------
-- 3. Dokumentasi
-- --------------------------------------------------------------------------------------------

COMMENT ON TABLE public.sow_subcont_mark IS
  'Penanda operasi SOW dikerjakan subcont (D4): jadwal start/finish TETAP ada, tapi jamnya '
  'dikeluarkan dari agregasi beban internal lewat predikat NOT EXISTS ber-ltrim. '
  'Tabel TERPISAH dari sow dan TANPA FK ke sow(idsow) secara sengaja: saveSowOrderRevision '
  'melakukan DELETE+INSERT dengan whitelist 33 kolom EDITABLE_SOW_COLUMNS '
  '(sowController.js:27-61), jadi kolom baru apa pun di sow dijamin hilang saat Create Revision '
  '(anomali A-01, docs/MFG_PLAN_AREA_PLAN.md) dan idsow berganti tiap revisi. '
  'Kunci logis = (ltrim(order_no,''0''), operation_no), bertahan lintas revisi.';

COMMENT ON COLUMN public.sow_subcont_mark.order_no IS
  'Nomor order SAP apa adanya saat ditandai. Pencocokan SELALU lewat ltrim(order_no,''0'') — '
  'konsisten dengan seluruh kodebase (getSowOrderOperations, listBaySchedules, dll).';

COMMENT ON COLUMN public.sow_subcont_mark.original_workcenter IS
  'Salinan sow.workcenter saat penandaan, untuk audit & pelaporan jam subcont per workcenter '
  'asal. HANYA salinan: sow.workcenter TIDAK PERNAH diubah (ETL etl_sync_v2.py:504-513 '
  'menimpanya tanpa syarat, jadi menaruh penanda di sana akan hilang diam-diam).';

COMMENT ON COLUMN public.sow_subcont_mark.unmarked_at IS
  'Soft-unmark: NULL = tanda AKTIF (dipakai predikat eksklusi & index parsial). Baris tidak '
  'pernah dihapus supaya riwayat siapa menandai/membatalkan tetap ada.';

COMMENT ON COLUMN public.sow_subcont_mark.marked_by IS
  'Aktor dari header sesi x-user-name / x-user-id, BUKAN dari body request.';

-- ============================================================================================
-- ROLLBACK (MANUAL — runner up-only; JANGAN simpan blok ini sebagai .sql hidup di migrations/api/).
-- Turunkan KODE Fase 6 lebih dulu; selama kode masih memakai predikat eksklusi, DROP TABLE
-- membuat seluruh dashboard yang terdaftar di header ini 500.
-- Data penandaan (siapa menandai apa, kapan) TIDAK bisa dikembalikan setelah DROP.
--
--   DROP INDEX IF EXISTS public.idx_sow_subcont_mark_order;
--   DROP INDEX IF EXISTS public.uq_sow_subcont_mark_active;
--   DROP TABLE IF EXISTS public.sow_subcont_mark;
--   DELETE FROM public.schema_migrations
--     WHERE filename = '20260803b_sow_subcont_mark.sql';
-- ============================================================================================
