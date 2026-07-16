---
type: design
status: draft
tags: [sap, staging, machine-hours, ops, ui]
updated: 2026-07-15
---

# Halaman Rekonsiliasi & Operasi SAP Staging

> Design doc — belum ada kode UI yang ditulis. Tujuan: satu tempat bagi operator
> non-teknis untuk melihat **mana jam kerja yang belum sampai ke SAP dan kenapa**,
> lalu menindaklanjutinya dengan aman. Dasar konsep: [[sap-staging-identity]],
> [[payroll-data-path]], [[order-no-spine]].

## 1. Masalah yang diselesaikan

Pipeline jam-mesin → SAP punya banyak titik "nyangkut" yang **tak terlihat** siapa pun
hari ini:

- Baris `mch_transaction` yang **layak SAP tapi belum ter-stage** (operator baru
  diperbaiki, cursor sudah lewat) — hanya ketahuan kalau seseorang ingat menjalankan
  `stage_machinehours.py --catchup` dari terminal.
- Baris **tidak layak** dan alasannya (operator kosong, jobid tak resolve, dll) —
  sekarang cuma bisa dilihat lewat query SQL manual.
- Bundel **FAILED** di antrian dengan pesan SAP teknis (mis. "Work center M5051BS4 does
  not exist in plant 5051") yang tak diterjemahkan ke bahasa yang bisa ditindak.

Semua operasi (stage, backfill operator, post) berjalan sebagai script Python di
`jobs/sap_staging/`. Operator lapangan tidak punya akses terminal, jadi kerja koreksi
tertahan di satu-dua orang teknis.

## 2. Model klasifikasi (jantung halaman)

Setiap baris `mch_transaction` masuk **tepat satu** bucket, dihitung dari provenance
([[sap-staging-identity]]) + gerbang kelayakan SAP:

| Bucket | Deteksi |
|---|---|
| **POSTED** | punya `sap_staging_source.posted_at` |
| **PENDING / POSTING** | punya provenance, bundel belum terkirim |
| **FAILED / SKIPPED** | punya provenance, bundel gagal/dilewati — tampilkan sebab |
| **Layak, belum di-stage** | lolos gerbang, tak punya provenance → target `--catchup` |
| **Tidak layak** | gagal gerbang — **wajib tampilkan alasannya** |

### Gerbang kelayakan (sumber kebenaran: `stage_sap_timesheet.py`)

Baris layak SAP bila SEMUA benar:
- `enddatetime IS NOT NULL AND enddatetime > startdatetime`
- `confirmation_number`, `order_no`, `operation_no` tidak kosong
- `sn_employee` tidak kosong  ← **penyumbang "nyangkut" terbesar**
- `statusid NOT IN (0, 3, 4)` (Off / No Job / Downtime — dikecualikan by design)
- bukan idle pendek (`statusid = 5` dengan durasi > 60 detik dikecualikan)

### Alasan "tidak layak" (enumerable → bisa ditampilkan per baris)

| Alasan | Perbaikan yang benar | Di mana |
|---|---|---|
| `sn_employee` kosong | daftarkan/koreksi kartu → backfill | `usernfc` + `backfill_operator.py` |
| order/operation/confirmation kosong | perbaiki jobid → ph3/sow | `ph3_order` / mapping jobid |
| `statusid` ∈ (0,3,4) | **bukan untuk diperbaiki** — memang dikecualikan | — |
| `enddatetime` NULL | tunggu, belum selesai | — |

## 3. Tiga fitur (profil risiko berbeda — jangan disatukan buta)

### Fitur 1 — Reconciliation view (baca saja) · risiko ~nol · **bangun duluan**

Tabel/kartu terklasifikasi + filter (bucket, tanggal, operator, work center) +
**"kenapa tidak layak"** per baris. Ini yang membuat kerja koreksi terlihat tanpa
menyentuh apa pun. Kemungkinan besar mengungkap bahwa mayoritas masalah = operator
kosong (sudah bisa diselesaikan `backfill_operator.py`).

Extend permukaan yang ADA — `MachineHoursValidationPage` + kolom
`mch_transaction.status_record` — jangan greenfield.

### Fitur 2 — Stage manual bertarget (seperti catchup) · risiko rendah

Stage ≠ post: stage hanya membangun antrian; posting ke SAP tetap langkah terpisah
yang tergerbang. Aturan mati: **jangan menulis ulang mesin bundling di Node** — dua
implementasi pasti melenceng dan salah satunya double-post. Satu mesin:
`stage_machinehours.py`.

Ganjalan batas container (nyata): service `api` = Node Alpine, **tidak bisa** jalankan
Python. Pola bersih:
1. API menulis baris "permintaan stage" (rentang tanggal) ke tabel antrian.
2. Worker Python ringan (image sama dgn `ews-*-job`/etl) mengonsumsi + menjalankan
   `stage_machinehours` bertarget.
3. Halaman mem-poll status.

### Fitur 3 — Perbaikan data supaya layak · risiko TINGGI · **paling dijaga**

Ini jebakannya. Tiga bahaya:
1. **ETL menimpa editan.** `mch_transaction` diisi ETL dari SQL Server. Edit baris masih
   terbuka → ditimpa ETL incremental. `--full-rebuild` menimpa semua. Edit tabel turunan
   = memperbaiki gejala.
2. **Ini aksi integritas payroll.** Mengubah `order_no`/`sn_employee` = menentukan jam
   siapa masuk order mana di SAP. Salah = orang salah dibayar.
3. **Kebanyakan "perbaikan" milik sumber lain** — operator → `usernfc`; job-link →
   `ph3_order`.

Kalau dibangun, **BUKAN editor tabel bebas**. Bangun sebagai perbaikan terpandu
per-alasan yang menargetkan sumber:
- "Operator kosong" → dropdown pilih dari `usernfc` → jalankan jalur backfill
  (aman-freeze, sudah ada di `backfill_operator.py`).
- Wajib audit (siapa/kapan/lama→baru); **hanya baris non-POSTED** (freeze trigger
  menegakkan); tolak edit identitas kalau sudah ter-post → arahkan ke storno SAP.

## 4. Arsitektur

- **Endpoint baca** (Express, aman): `GET /machine-hours-validation/reconciliation`
  — klasifikasi + alasan + agregat per bucket. Query berat → index di
  `mch_transaction (startdatetime) WHERE ...` (sudah ada dari migration provenance).
- **Ringkasan antrian**: `GET /dashboard/sap-timesheet-staging-summary` — hitungan per
  status (belum ada; dibutuhkan halaman SAP-log juga).
- **Antrian aksi** (Fitur 2/3): tabel `sap_ops_request` + worker Python. Bukan shell-out
  dari Node.

## 5. Urutan eksekusi

1. **Fitur 1** (read-only) — langsung berguna, nol risiko, memberi tahu apakah editing
   perlu sama sekali.
2. **Endpoint ringkasan** — dipakai bersama halaman SAP-log.
3. **Fitur 2** (stage worker) — kalau rekonsiliasi menunjukkan sering ada yang tertinggal.
4. **Fitur 3** — hanya perbaikan terpandu + audit, bukan editor tabel.

## 6. Terkait

- Script bedah backfill operator: `jobs/sap_staging/backfill_operator.py`
- Guard anti-double-post: [[sap-staging-identity]] (provenance, freeze trigger, poster guard)
- Halaman SAP-log (redesign terpisah, sedang dikerjakan) — konsumen pertama endpoint ringkasan.
