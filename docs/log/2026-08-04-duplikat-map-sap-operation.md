---
title: Duplikat task dari Map SAP Operation — order 1000127752
date: 2026-08-04
tags: [domain/msproject, domain/sow]
---

# Duplikat task MS Project dari Map SAP Operation

Dilaporkan owner: saat membooking order **1000127752** ke area, daftar operasi muncul berkali-kali.
Dugaan owner (Map SAP Operation) **terbukti benar**. Terkait [[MFG_PLAN_AREA_PLAN]].

## Temuan

`public.sow` **bersih** — 294 baris, 294 `operation_no` unik, dijaga
`uq_sow_order_operation UNIQUE (order_no, operation_no)`. Aturan owner memang ditegakkan **di sow**.

Duplikasi ada di `ms_project_task`: **1.176 baris aktif untuk 294 operasi — tepat 4 salinan tiap
operasi**, tersebar di 3 project:

| Project | Baris | Operasi unik | Dibuat |
|---|---|---|---|
| `contoh project` | **588** | 294 | 16:08:50 **dan** 16:09:24 (dua run, jarak 34 detik) |
| `Project_Rizka_31.07` | 294 | 294 | 16:09:43 |
| `Test` | 294 | 294 | 16:11:57 |

Jadi ada **dua masalah berbeda** yang gejalanya sama:

1. **Duplikat DI DALAM satu project** — `contoh project` dipetakan dua kali. Ini bug.
2. **Duplikat LINTAS project** — order yang sama dipetakan ke 3 project. Bukan pelanggaran
   integritas, tapi picker reservasi tidak menyaring per project sehingga tiap operasi tampil
   sekali per project tanpa cara membedakannya.

Order lain yang kena masalah #1: `1000128374` (14 baris duplikat).

## Akar masalah

`mapSowOrderToProjectTasks` (`apps/api/services/msProjectService.js`) mengambil daftar operasi SOW,
lalu untuk tiap operasi mencari task placeholder yang masih tersedia di project target. Kalau
placeholder habis, ia **meng-INSERT task baru**.

Ia tidak pernah memeriksa apakah `(project_id, order_no, operation_no)` sudah pernah dipetakan, dan
tabelnya **tidak punya constraint apa pun** untuk itu — satu-satunya UNIQUE adalah
`(project_id, task_id)` dan PK `task_id`, keduanya tidak menghalangi baris kedua.

Akibatnya menjalankan ulang mapping = menggandakan seluruh set operasi, tanpa error, tanpa
peringatan.

## Yang dikerjakan

### 1. Perbaikan data (prod Cikupa)

308 baris duplikat di dalam project yang sama di-set `is_active = false` — **bukan DELETE**:
`ms_project_dependency` menunjuk 27 di antaranya, dan seluruh query aplikasi sudah memfilter
`is_active`. Reversibel, tanpa risiko FK.

Baris yang dipertahankan dipilih berurutan: yang dipakai reservasi bay dulu, lalu `created_at`
terlama. Diverifikasi sebelum eksekusi: **0 duplikat yang jadi parent, 0 yang dipakai reservasi bay**.

Setelah: 0 duplikat aktif di dalam project mana pun.

### 2. Pengaman database

Migrasi `20260804_ms_project_task_unique_order_op.sql` — partial unique index
`(project_id, ltrim(order_no,'0'), operation_no)` untuk baris aktif non-summary. Sudah diterapkan
dan diuji: INSERT duplikat kini ditolak `23505`.

### 3. Perbaikan kode — mapping jadi idempoten

`mapSowOrderToProjectTasks` sekarang memuat pemetaan yang SUDAH ADA lebih dulu dan memakainya ulang.
Run kedua hanya menyegarkan nilai, tidak menambah baris. Task yang sudah memegang operasi order ini
juga dikeluarkan dari kolam placeholder — kalau tidak, run kedua akan menimpa operasi yang benar
dengan operasi tetangganya. Respons menambah `reused` / `reused_count`.

### 4. Peringatan lintas project

Respons mapping menambah `also_mapped_in` (daftar project lain yang memuat order itu), dan
`listOrderTasks` menambah `project_name` + `duplicate_across_projects` supaya picker reservasi bisa
melabeli asal task.

## Yang masih perlu keputusan owner

**11 project di prod, semuanya berstatus ACTIVE, dan sebagian besar jelas eksperimen:**
`contoh project`, `Test`, `Test Yoig`, `PROJEC TESTING Y`, `Test MPS Project1`,
`MPS 2 Trial - RPW - 20260731`, `project pangeran`, `Project_Rizka_31.07`.

Selama project uji coba dibiarkan ACTIVE, `listOrderTasks` tetap mengembalikan operasi yang sama
sekali per project — sekarang berlabel, tapi tetap ramai. Pilihan:

1. **Nonaktifkan project uji coba** (butuh kolom/status arsip — `ms_project.status` sudah ada,
   tinggal disepakati nilai mana yang berarti "jangan tampilkan").
2. **Saring `listOrderTasks` per project** — butuh scheduler memilih project dulu sebelum memilih
   task. Mengubah alur reservasi.
3. Biarkan, andalkan label baru.

Rekomendasi: opsi 1. Ini masalah kebersihan data, bukan kekurangan fitur — dan constraint teknis
apa pun yang memaksa "satu order satu project" berisiko salah, karena satu order memang bisa sah
muncul di beberapa file project.

## Catatan

`uq_sow_order_operation` di `sow` **ada di prod tapi tidak ada di satu pun file migrasi repo**
(sudah dicatat sebagai anomali A-06 di [[MFG_PLAN_AREA_PLAN]] dan
[[2026-08-04-rekonsiliasi-ledger-migrasi]]). Aturan unik andalan owner karenanya tidak
terdokumentasi di kode — layak dibuatkan migrasi retroaktif agar tidak hilang saat setup lingkungan
baru.
