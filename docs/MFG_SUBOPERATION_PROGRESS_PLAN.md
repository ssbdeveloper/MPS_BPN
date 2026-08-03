---
type: plan
status: active
tags: [domain/sow, domain/msproject]
updated: 2026-07-31
---

# Sub-operation / child-task untuk progress fisik (manufaktur)

> Di bawah tiap operasi SAP (`operation_short_text` / `operation_no`), user menambah **child task** dan
> meng-update **progress fisik** granular; progress child **roll-up** ke operasi. **SAP tetap terima
> level operasi** (child tak pernah ke SAP). Berbasis investigasi 4-arah + draft desain (workflow
> `mfg-suboperation-understand`, 2026-07-31). Fitur progress existing: `ProgressModal` di
> `OrderListPage.jsx` (`/sow-orders`, RBAC:sow_management).

## Keputusan arsitektur (rekomendasi, dipakai)

**Simpan sub-task di TABEL WEB-ONLY baru di-anchor ke `sow.idsow`** — BUKAN child `ms_project_task`,
BUKAN anchor langsung ke `ph3_order`. Meniru persis pola **Area/Bay** (`ms_project_bay_schedule`):
web-authoritative, sengaja DI LUAR `ms_project_task`, round-trip MSP, dan SAP.

**Kenapa bukan child `ms_project_task` (Fase 1):** serializer VBA meng-emit SETIAP task dari outline
LIVE (bukan Text12) → child web pasti ter-export ke `.mpp` & round-trip → rebutan authorship web↔MSP;
`mapSowOrderToProjectTasks` mencocokkan by `operation_no` → child bisa tertimpa jadi "operasi";
`actual_progress` di `ms_project_task` tak punya write-path & akan mengikat input ke siklus checkout/lock.
(Proyeksi read-only ke MSP = Fase 4 opsional, di-gate.)

## Model data (2 tabel baru, `public`)

**`sow_sub_operation`** (definisi child + snapshot progress terakhir):
`id bigserial PK` · `operation_id int NOT NULL → FK sow(idsow) ON DELETE CASCADE` · `order_no varchar(100)`
· `title text NOT NULL` · `sort_order int DEFAULT 0` · `weight numeric(6,2) DEFAULT 1` (bobot roll-up;
default 1 = rata-rata sederhana) · `progress smallint DEFAULT 0 CHECK(0..100)` (persen, **satuan sama**
dgn `sow.progress`) · `status text DEFAULT 'NOT_STARTED' CHECK(NOT_STARTED|IN_PROGRESS|ON_HOLD|DONE)` ·
`is_active bool DEFAULT true` (soft-delete) · `msp_task_id uuid NULL` (hook Fase 4) · `created_by/at`,
`updated_by/at`. Index: `(operation_id)`, `(order_no)`.

**`sow_sub_operation_progress_history`** (append-only, near-copy `progress_update_history`):
`id bigserial PK` · `sub_operation_id bigint NOT NULL → FK sow_sub_operation(id) ON DELETE CASCADE` ·
`operation_id int` (denorm) · `order_no varchar(100)` · `progress smallint CHECK(0..100)` (koreksi turun
DIIZINKAN) · `issue_description text` · `image_path varchar(500)` (reuse `uploads/progress/{order}/{op}/{sub}/{ts}.jpg`)
· `created_at`, `created_by`. Index: `(sub_operation_id)`, `(created_at DESC)`.

`sow` (existing) TIDAK ubah kolom — hanya **semantik** `sow.progress` jadi turunan saat operasi punya
≥1 sub-task aktif. Sub-task **tak punya** `operation_no`/`codenumber`/baris `timesheet` → satu-satunya
jembatan ke SAP tetap operasi induk.

## Roll-up (satuan persen 0-100)

- **Sub-task → operasi:** `sow.progress = round( Σ(sub.progress·sub.weight) / Σ(sub.weight) )` atas
  `is_active=true`. Weight default 1 → rata-rata sederhana (weighted = superset, nol beban kasus umum).
- **Operasi → order:** `round( Σ(sow.progress·planhours) / Σ(planhours) )` — satu rumus kanonik.
- **Write-back di controller** (bukan trigger — hindari benturan dgn ETL `sync_sow` yang upsert `sow`):
  tiap mutasi sub-task, recompute & `UPDATE sow.progress` (+ mirror `sow.actual_progress` agar FastAPI
  `/sow/get-actual` yg dibaca MSP ikut). Reader (`vw_sow_orders`) tak berubah.
- **Precedence:** ada ≥1 sub-task aktif → `sow.progress` = turunan (input langsung operasi di-lock UI);
  0 sub-task → jalur input langsung lama tetap (backward-compatible).
- **Anti-regresi:** dilepas di level operasi (nilai turunan tak masuk akal dikunci); di level sub-task
  koreksi turun diizinkan (peringatan UI, bukan blokir).

## SAP safety (6 titik jaga — terverifikasi)

1. Sub-task TAK PERNAH menulis `timesheet_transaction.operation_no` / `mch_transaction.operation_no`
   (dua kolom itu satu-satunya yang jadi `VORNR`). 2. CHECK `source_system IN ('TIMESHEET','MCH_HOURS')`
   DIBIARKAN utuh — tak ada source_system ketiga. 3. Sub-task tak punya `operation_no`/`VORNR`. 4. Tak
   masuk `GROUP BY` bundling machine-hours. 5. Target write-back (`sow.progress`) tak dibaca stage/post SAP.
   6. Jaring sekunder `ph3_order` (BLOCKED bila tak match) tetap ada. → payload `(AUFNR, VORNR)` tak tersentuh.

## UI (perluas fitur existing)

Perluas **`ProgressModal` di `OrderListPage.jsx`** → komponen baru `SubOperationPanel` + `SubTaskModal`
(EKSTRAK dari ProgressModal — Component-First, jangan duplikasi). Bar progress operasi jadi **read-only
= roll-up** (indikator "n sub-task"); operasi tanpa sub-task pertahankan input langsung lama. Per sub-task:
Add/Edit/Nonaktif + Update progress (angka 1-100 + issue + 1 foto, near-copy `addProgressUpdate`) +
riwayat. Ikut Corporate Color + state Loading/Empty/Error standar. Ekstrak `ProgressBar`/`SubTaskRow`/`StatusPill`.

## Fase

- **Fase 1 — Migrasi:** 2 tabel + index + FK CASCADE ke `sow(idsow)`; regen `schema_prod.sql`. (build ini)
- **Fase 2 — Backend Express:** CRUD sub-task + POST progress (foto→disk, issue) + GET list/history +
  recompute roll-up ke `sow.progress`. Endpoint di `/sow` (`/sow/:idsow/subtasks`, `/sow/subtasks/:id/progress`).
  rbacGuard existing. (build ini)
- **Fase 3 — Frontend:** `SubOperationPanel`+`SubTaskModal` di OrderListPage; bar operasi turunan;
  ekstrak presentasional. (build ini)
- **Fase 4 — OPSIONAL (tunda, gated):** proyeksi sub-task ke package MSP sbg child read-only outline+1
  (inject di package builder + skip di serializer via marker Text6='SUBTASK', simetris Text4/5). Hanya
  bila planner butuh sub-task di `.mpp`; web tetap source-of-truth.

## Ditandai untuk owner (TIDAK diblok, tapi perlu tahu)

- **Bug roll-up dashboard (Fase 0, TERPISAH):** `mv_order_plan_vs_actual.weighted_progress` salah pakai
  `FILTER(progress=1)` (flag biner) → praktis ~0 sekarang; `OrderProgressDashboardPage` kali `progress*100`
  (asumsi 0-1). **Fitur ini menulis `sow.progress` persen 0-100 (konsisten `vw_sow_orders`/OrderListPage)**,
  jadi OrderListPage benar. Perbaikan MV+dashboard **mengubah angka live** → butuh ACC owner, kukerjakan terpisah.
- **Siapa input:** default PE (`/sow-orders`, RBAC:sow_management, seperti sekarang). Bisa diperluas ke shop-floor nanti.
- **Bobot sub-task:** default 1 (rata-rata). Bila perlu bobot jam/qty per sub-task → tambah nanti.
- **Anchor butuh `sow` terisi:** DB Cikupa sudah punya 5.835 baris `sow` (5100) pasca-cleanup → anchor ada.

## Status build (2026-07-31 — Fase 1-3 SELESAI, pending migrasi + test + commit)

Dibangun via workflow ultracode (migrasi → backend → frontend → verifikasi). **Build + lint + `node --check` hijau** (dikonfirmasi independen). Uncommitted (branch 2b).
- **Fase 1:** `database/migrations/api/20260731_sow_sub_operation.sql` (2 tabel, FK CASCADE, idempotent, **belum dijalankan**) + `schema_prod.sql` disinkron.
- **Fase 2:** `apps/api/{controllers/sowController.js,routes/sow.js}` — 5 endpoint (`/sow/operations/:idsow/subtasks` GET/POST, `/sow/subtasks/:id` PUT, `/sow/subtasks/:id/progress` POST, `/sow/subtasks/:id/progress-history` GET) + `recomputeOperationProgress` (controller-side, transaksional, mirror `actual_progress`). Foto reuse pola `addProgressUpdate`. `addProgressUpdate` lama byte-identical (tak tersentuh).
- **Fase 3:** `OrderListPage.jsx` — `ProgressUpdatePanel` (diekstrak dari ProgressModal, dipakai operasi & sub-task, no-dup), `SubOperationPanel`/`SubTaskFormModal`/`SubTaskProgressModal`/`SubTaskRow`/`StatusPill`/`ProgressBar`/`ModalShell`. Operasi ≥1 sub-task → bar read-only rollup; 0 sub-task → jalur input langsung lama utuh. `ui/Modal.jsx` tetap tak cocok (modal kamera) → `ModalShell` lokal.

**Perilaku yang perlu ditahu (bukan bug):**
- Menambah sub-task PERTAMA ke operasi yang punya progress manual (mis. 50%) → operasi turun ke 0 sampai sub-task diisi (sub-task jadi otoritatif). Opsi: seed sub-task pertama dgn progress operasi lama (belum dilakukan — keputusan owner).
- Sub-task tak punya anti-regresi (koreksi turun boleh); status hanya via PUT.

## Halaman Update Progress foreman (2026-07-31)

Owner koreksi: **di manufaktur operator TIDAK finish** (beda salvaging) → **`actual_progress` memang bersumber
dari foreman** → mirror `sow.progress`→`sow.actual_progress` DIPERTAHANKAN (benar).

Dibangun halaman foreman khusus:
- **Ekstrak** komponen progress dari OrderListPage ke modul bersama `apps/web/src/features/progress/`
  (`helpers.js`, `primitives.jsx`, `ProgressUpdatePanel.jsx`, `subtasks.jsx`, barrel) — no-dup; OrderListPage
  di-refactor mengimpor dari sini, perilaku tetap.
- **`apps/web/src/pages/ProgressUpdatePage.jsx`** — pilih order (search) → operasi → panel sub-task
  (add/update progress + foto/issue). Framing estimasi subjektif foreman.
- **Route `/progress-update`** guard **PIN** (`ProtectedRoute`, seperti `/timesheet-validation`) — **guard perlu
  konfirmasi owner** (bisa diganti RBAC `sow_management`). Tile di Operations Hub.
- Build + lint hijau. Backend tak diubah (reuse endpoint).

**Bug lama ditemukan (TERPISAH, belum disentuh):** OrderListPage render `op.operationtext` (tanpa underscore)
padahal kolom `operation_text` → kolom Deskripsi tampil "—". Halaman baru sudah defensif (`operation_text ||
operationtext`). Fix OrderListPage = follow-up (verifikasi dulu nama field balikan API).

## Importer Excel sub-task (2026-07-31)

Template: `samples/excel/sub_task_upload_template.xlsx` (sheet `sub_task`: order_no, operation_no, title,
weight, sort_order, status, progress + petunjuk). Upsert key = `(order_no, operation_no, title)`.

- **Backend** `POST /sow/subtasks/import` (multipart, **ExcelJS** — sudah dep apps/api, tak nambah dep):
  `commit=false` = dry-run (klasifikasi create/update/reject per baris, tanpa tulis); `commit=true` =
  transaksi upsert + `recomputeOperationProgress` tiap operasi terdampak. Response `{preview[], summary}`.
  Cocokkan operasi via ltrim leading-zero. `sowController.importSubtasks` + `routes/sow.js` (multer memoryStorage).
- **Frontend** `features/progress/SubTaskImport.jsx` (tombol **Upload Excel** di PageHeader ProgressUpdatePage):
  pilih file → POST dry-run → **modal preview** (Total/Dibuat/Diupdate/Ditolak + daftar ditolak+alasan) → "Proses"
  → commit → toast + refresh. Native fetch+FormData (Critical Rule #4).
- Build + lint hijau. Sub-task tetap progress-only (nol jalur SAP).
- Catatan: preview↔commit tak atomik (re-parse; **commit yang otoritatif**) — inheren two-phase, wajar.

**Juga dibuat:** `samples/excel/MSPROJECT_MANUFACTURING_UAT_CHECKLIST.xlsx` — versi Excel UAT MS Project
(sheet Persiapan/Positive/Negative/Bug/Lampiran, kolom Lulus? dropdown). Kedua Excel disalin ke Downloads owner.
