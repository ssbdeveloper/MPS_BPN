---
title: Sub-task: standard_hours jadi sumber bobot (weight turunan) + fix 42P18
date: 2026-08-06
tags: [domain/sow, domain/manufacturing, feature, bugfix]
---

# Sub-task: bobot dihitung dari standard_hours (bukan manual) + fix error 42P18

## Konteks

Di halaman Update Progress, tambah sub-task gagal dengan
`inconsistent types deduced for parameter $1`. Keputusan user (1a 2a 3a 4a):
bobot (`weight`) tidak lagi input manual — diganti `standard_hours` per sub-task,
dan bobot SELALU dihitung dari akumulasi jam per operasi.

## Temuan: root cause 42P18

`recomputeOperationProgress()` menjalankan:

```sql
UPDATE sow SET progress = $1, actual_progress = $1 WHERE idsow = $2
```

`sow.progress` = **integer**, `sow.actual_progress` = **numeric**. Satu param
`$1` di 2 kolom beda tipe → Postgres gagal infer → 42P18 → transaksi ROLLBACK.
Muncul "saat tambah sub-task" karena recompute baru jalan setelah ada ≥1 sub-task
aktif (total jam > 0). Semua mutasi sub-task (create/update/progress) gagal 500.

**Catatan penting**: cast `$1::numeric` TIDAK cukup — site lain tetap memaksa
infer ke integer dan param tunggal tak bisa dua tipe. Solusi: dua param terpisah
nilai sama (`progress = $1, actual_progress = $2`).

## Sumber jam operasi: `sow.planhours`

- `ph3_order.standard_value` = jam SAP MENTAH (text `'8.000 '`); `sow.planhours`
  = versi numeric hasil parse — persis contoh "8 jam" user (op10 PLASMA CUTTING).
- `sow_standard.std_hours` TIDAK dipakai (join fuzzy sudah dihapus 2026-08-04;
  0 baris cocok utk part subtask aktif). `va_hours` hanya porsi VA; `nnva_hours`
  kosong 100% di CIKUPA. `ms_project_task` = jadwal (bukan jam).
- Cap: `SUM(sub-task standard_hours aktif) ≤ planhours`, hanya saat planhours > 0
  (70% operasi planhours-nya kosong — cap 0 akan mematikan fitur).

## Perubahan

### DB — `database/migrations/api/20260806_sow_subtask_standard_hours.sql` (applied ke CIKUPA, ledger dicatat manual)

- `sow_sub_operation.standard_hours numeric(10,2) NOT NULL DEFAULT 1`
- `sow_sub_operation_standard.standard_hours numeric(10,2) NOT NULL DEFAULT 1`
- Backfill: `standard_hours = weight` untuk baris yang weight-nya ≠ 1 (rasio terjaga)
- `weight` diset = share jam: `round(standard_hours / SUM(standard_hours), 4)`
- CHECK non-negatif di kedua tabel
- Trigger `seed_sow_sub_operation_from_standard()`: salin `standard_hours` dari
  master (bukan weight) + hitung weight share jam inline (hasil semai = satu-satunya
  isi operasi saat trigger jalan, jadi share = rasio jam)

### Backend — `apps/api/controllers/sowController.js`

- `recomputeOperationProgress()`: roll-up pindah ke jam
  (`SUM(progress*standard_hours)/SUM(standard_hours)`) + fix 42P18 (2 param)
- Baru: `recomputeSubtaskWeights()` (weight = share jam per operasi aktif) dan
  `assertSubtaskHoursCap()` (cap planhours, error 400 berbahasa jelas, excludeId
  saat UPDATE agar baris sendiri tidak dihitung dua kali)
- `createSubtask` / `updateSubtask`: terima `standard_hours` (bukan `weight`;
  body lama `weight` diabaikan → default 1 jam, tanpa crash), validasi ≥ 0,
  0 = dikeluarkan dari roll-up; recompute weights + roll-up
- `importSubtasks` (Excel sub-task) + `importSubtaskStandards` (master):
  header `weight` → `standard_hours`; cap dicek per baris saat commit (rollback
  penuh bila overflow); catch pakai `err.statusCode || 500`
- `getSubtasks` / `getSubtaskStandards`: SELECT `standard_hours`

### Frontend

- `features/progress/helpers.js`: `computeRollup()` pakai `standard_hours`;
  `fmtWeight` diganti `fmtHours` + `fmtWeightPct` (persen)
- `features/progress/subtasks.jsx`: form input "Jam Standar" (0 = tak dihitung),
  bobot jadi read-only persen; baris sub-task tampil "X jam · Bobot Y%"; modal
  progress punya baris Jam + Bobot
- `pages/PE/SubTaskStandardPage.jsx`: badge weight → "N jam"
- Template Excel (samples/excel + apps/web/public/templates): header `weight` →
  `standard_hours`, README/PETUNJUK disesuaikan

## Verifikasi (CIKUPA, op 1198203 planhours 8.00, data throwaway ZZTEST)

28/28 test pass (controller asli + mock req/res):

- create A(3j) → weight 1.0; +B(5j) → 0.38/0.63; +D(0j) → weight 0 (excluded)
- cap: +C(1j) → 400 "Total jam sub-task (9.00) melebihi jam standar operasi (8.00)"
- update B 3→4 → weights 0.43/0.57/0; update A → 5 jam → 400 + rollback (A tetap 3)
- progress A=50 → roll-up 21, actual_progress 21 (42P18 gone)
- deactivate D → weights recompute; A jam 0 → weight 0, roll-up 0
- autoseed (sow baru part SB10718 / QC GENERAL ASSY): 4 sub-task, jam
  15/45/11/10 tersalin, weight 0.19/0.56/0.14/0.12 (share jam)
- import dry-run 2 create; commit → weight 0.4/0.6; overflow 10j → 400 +
  rollback penuh (tidak ada baris tertinggal)
- `standard_hours` negatif → 400; body legacy `weight` → 201 (diabaikan)
- ESLint 0, `vite build` SUCCESS, `check_rbac_manifest` BERSIH

## Catatan

- `database/schema/schema_prod.sql` SUDAH stale sebelum sesi ini (tidak memuat
  tabel `sow_sub_operation_standard`/trigger autoseed dari 20260804) — migrasi +
  DB live adalah sumber kebenaran; regenerasi schema_prod ditunda.
- BPN (5434) TIDAK punya fitur sub-task (72 migrasi, tanpa tabel standard) — DB
  aplikasi = CIKUPA (tunnel 5441).
- 12 migrasi lain (20260503–20260714) sengaja TIDAK di-apply ke CIKUPA (jalur
  staging/BPN) — ledger CIKUPA 66 entri + migrasi ini.

## Hotfix (sore ini): sub-task macet skeleton loading di `npm run dev`

**Gejala**: halaman Update Progress / Order List menampilkan skeleton "memuat
sub-task…" selamanya — padahal request `/api/sow/operations/:id/subtasks` kelar
200 `[]` (diverifikasi via browser + curl + performance entries).

**Root cause — StrictMode + anti-pattern mountedRef**:
`main.jsx` memakai `<StrictMode>`. Di dev, React menjalankan effect dua kali:
mount → cleanup (simulasi unmount) → mount ulang. Pola lama di
`ProgressUpdatePage.jsx` & `OrderListPage.jsx`:

```js
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);  // body KOSONG
```

Cleanup StrictMode menyetel `mountedRef.current = false`, lalu remount TIDAK
pernah menyetel ulang `true` (body effect kosong) → `loadSubtasks` sukses tapi
`if (!mountedRef.current) return;` meng-skip `setSubState` → loading tetap true.
Produksi tanpa StrictMode → tidak kelihatan; hanya `npm run dev` yang kena.

**Fix** (StrictMode-safe, pola yang sama dengan `useDashboardWebSocket.js`):

```js
useEffect(() => {
  mountedRef.current = true;
  return () => { mountedRef.current = false; };
}, []);
```

Diterapkan di `ProgressUpdatePage.jsx` dan `OrderListPage.jsx`. Verifikasi
browser: operasi tampil "tanpa sub-task", expand → EmptyState "Belum ada
sub-task" + tombol "Tambah Sub-task". ESLint 0, `vite build` SUCCESS.

## Fitur: "Tambah dari Standar" (add sub-task dari master standard)

**Di mana standar sub-task hidup**: `sow_sub_operation_standard` — kunci
**(part_number, operation_text)** + title; dikelola via menu SOW Management
(SubTaskStandardPage, import Excel), dipakai autoseed trigger utk order SAP
BARU. Operasi existing tidak punya jalur manual → fitur ini menambahkan jalur
manual dari UI.

### Backend
- `GET /sow/subtask-standards` — tambah filter `operation_text` (exact match
  ternormalisasi, selain `part_number`/`q`).
- **Baru** `POST /sow/operations/:idsow/subtasks/batch` (`createSubtasksBatch`):
  body `{ items: [{ title, standard_hours?, sort_order? }] }` — transaksi
  atomik; cap planhours dicek SEKALI untuk total jam batch; judul yang sudah
  jadi sub-task AKTIF dilewati (`skipped`); weights + roll-up dihitung ulang
  sekali; response `{ created, skipped, created_count, skipped_count }`.
- RBAC manifest: `POST /sow/operations/:id/subtasks/batch` = `sow_management` W.

### Frontend
- **Baru** `SubTaskFromStandardModal` (features/progress/subtasks.jsx): tombol
  "Dari Standar" di header panel sub-task (nonaktif bila op tanpa part/text);
  modal menampilkan standar yang cocok (part_number + operation_text), standar
  yang judulnya sudah jadi sub-task tidak ditampilkan, centang → POST batch,
  footer menampilkan "N terpilih · X jam".
- `SubOperationPanel` menerima prop `partNumber`/`operationText`; dikirim dari
  `ProgressUpdatePage.jsx` dan `OrderListPage.jsx` (keduanya dapat `SELECT *`
  sow → part_number + operation_text tersedia).

### Bugfix bonus: NORM regex spasi-ganda tidak pernah jalan
`const NORM = (col) => \`upper(regexp_replace(btrim(${col}), '\s+', ' ', 'g'))\``
— source JS memakai SATU backslash, dan JS menganggap `\s` escape tak dikenal
→ string menjadi `'s+'` → regex mencocokkan huruf "s" literal, bukan spasi.
Normalisasi spasi-ganda (91 baris sow.operation_text di prod) SELALU gagal.
Fix: dua backslash `'\\s+'` di source. Berdampak ke semua pencocokan berbasis
NORM (getSubtaskStandards, importSubtaskStandards, batch dedupe).

### Verifikasi (CIKUPA, data throwaway)
12/12 test PASS: filter standar 4 baris; normalisasi spasi-ganda → 4 (setelah
fix NORM); batch create 2 (weight 0.6/0.4); dedupe 1 created + 1 skipped
(weight 0.43/0.29/0.29); cap overflow → 400 + rollback; validasi empty /
negatif / blank title → 400. ESLint 0, `vite build` SUCCESS,
`check_rbac_manifest` BERSIH. Browser: modal render (judul, subtitle part · op,
checkbox + jam, footer total).
