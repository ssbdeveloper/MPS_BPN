---
type: design
status: active
tags: [sap, staging, machine-hours, ops, ui, domain/sap]
updated: 2026-07-30
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

---

## 7. Fase Lanjutan — Visibilitas `proddataid` & Insight per-aktivitas (A+B+C)

> Ditambahkan 2026-07-30. Melanjutkan tab **Rekonsiliasi** (`ReconciliationPanel.jsx`, sudah
> jalan: drill Ringkasan→Tanggal→Konfirmasi). Kebutuhan: user bisa (1) menelusuri **dari**
> sebuah `proddataid` ke bundel + hasil POST SAP-nya, (2) melihat **event apa saja** yang
> membentuk satu konfirmasi lengkap dengan `proddataid` + jenis status mesinnya, dan (3)
> melihat **berapa jam per aktivitas** yang masuk SAP (mis. "Idle di-post 12,5 jam") sebagai
> permukaan analisa — bukan sekadar triase antrian.
>
> Prinsip: **data sudah lengkap** (linkage `sap_staging_source.source_row_id = proddataid →
> staging_id` ada; `proddataid`/`status_description` sudah di-SELECT endpoint level-3 tapi
> tak dirender; breakdown per-aktivitas bisa dihitung dari `sap_timesheet_staging` yang sudah
> ter-key `zbarcodeid`/`lstar`). Jadi ini **UI + 2 query**, BUKAN skema/ETL baru.

### A. Reverse-lookup `proddataid` → bundel + status + respons SAP

**Backend** — `apps/api/controllers/dashboardController.js`, `getSapTimesheetStagingLog`
(search block ~baris 381–397): tambah satu klausa OR agar teks pencarian juga cocok ke
`proddataid` lewat tabel provenance:

```sql
OR id IN (SELECT staging_id FROM public.sap_staging_source WHERE source_row_id ILIKE $${idx})
```

`source_row_id` menyimpan `proddataid` sebagai teks; subquery ter-scope by `staging_id` jadi
otomatis hanya bundel yang benar. Konsisten dengan pola `ILIKE %search%` kolom lain.

**Frontend** — `apps/web/src/pages/SapLogPage.jsx` (input search ~baris 422): tambah
`proddataid` ke placeholder. Tab "SAP Posting" + `DetailDrawer` (status + `sap_response` +
payload) yang sudah ada langsung jadi jalur lookup — user tempel `proddataid` → bundel muncul
→ klik → lihat status & respons SAP. Tak ada UI baru.

> Batasan yang sengaja tak dikerjakan sekarang (catat sebagai nice-to-have): cross-link dari
> `DetailDrawer` langsung ke view komposisi level-3 Rekonsiliasi.

### B. Surface kolom tersembunyi di view komposisi (murah)

Endpoint `getSapReconciliationRecord` (baris ~1562) **sudah** SELECT `m.proddataid` dan
`m.status_description`; UI-nya membuang. **Frontend saja** — `ReconciliationPanel.jsx`, tabel
"Rekaman mesin pembentuk konfirmasi" (level-3, ~baris 417–452): tambah 2 kolom **ID rekaman**
(`m.proddataid`, mono) dan **Status** (`m.status_description`, pill). Update `colSpan` empty-state
5→7. Tak ada perubahan backend.

### C. Grouping per operator di drill tanggal (insight "per orang hari ini apa aja")

> **Revisi 2026-07-30 (feedback owner):** rollup **global per-aktivitas** (semua orang di-agregat)
> SALAH grain — aktivitas tiap orang jadi terpencar. Yang benar: **di drill tanggal (level-2),
> konfirmasi dikelompokkan PER OPERATOR**, sehingga "hari ini si A ngapain aja (Idle/Setting/order,
> masing-masing berapa jam, mana yang sudah masuk SAP)" terbaca utuh dalam satu blok.

**Backend** — TIDAK ada perubahan. Endpoint `getSapReconciliationDay` (baris ~1509) sudah
mengembalikan tiap konfirmasi dengan `pernr`, `full_name`, `lstar`, `zbarcodeid`, `is_productive`,
`status`, `sent_hrs`, `source_hrs`. Cukup dikelompokkan di frontend.

**Frontend** — `ReconciliationPanel.jsx`:
- Helper `groupByOperator(bundles)` (level modul): Map per `pernr` → `{ items, source_hrs,
  posted_hrs (Σ sent_hrs WHERE status POSTED), belum_hrs }`, urut jam-mesin desc.
- Level-2 (drill tanggal) di-render ulang: satu `<table>`, **satu `<tbody>` per operator**
  (kolom tetap sejajar). Kepala grup = nama + `pernr` + total **jam mesin** & **masuk SAP** hari
  itu + hitung aktivitas; baris di bawahnya = tiap aktivitas (tujuan/`zbarcodeid`, jam mesin,
  terkirim, status), ter-indent, tetap klik → drill level-3.
- Kolom "Operator" lama dihapus (jadi kepala grup). "Masuk SAP" pakai emerald (konsisten
  StepCard hijau panel ini).
- **Accordion, default TERTUTUP semua** (`openOps` Set, `toggleOp`, reset saat ganti tanggal):
  kepala grup = tombol (chevron, `aria-expanded`, Enter/Space); aktivitas hanya render saat
  grup dibuka. Ringkasan per orang (jam mesin/masuk SAP/N aktivitas) tetap terlihat saat tertutup.

### Sumber jam (konfirmasi owner 2026-07-30)

`mulai`/`selesai` di level-3 = kolom **`mch_transaction`** (`m.startdatetime`, `m.enddatetime`;
`selesai` = `COALESCE(end_effective, enddatetime)`) — BUKAN jam staging. Jam staging
(`total_seconds`) hanya untuk "Jam terpakai"/"Terkirim" (artefak bundling SAP). Opsi terbuka:
paksa `selesai` = `enddatetime` mentah bila ingin jam mesin apa-adanya (clamp cukup via flag).

### D. Tabel Excel + filter + aksi stage ketinggalan (iterasi 2, keputusan owner 2026-07-30)

Keputusan: **grup per operator (accordion) dipertahankan**, tapi baris aktivitas jadi **tabel
Excel** berkolom; **Type = Produktif/Non-produktif**; aksi "belum" = **reuse `stage_catchup`**.

- **Kolom level-2** (drop label `tujuanText`, nilai saja): `Order` (`aufnr`) · `Op` (`vornr`) ·
  `Operation text` · `Aktivitas` (`zbarcodeid` fallback `lstar` — VA/Setting/Idle) · `Type`
  (Produktif/Non-produktif dari `is_productive`) · `Mesin` (`machineid`) · `Jam mesin`
  (`source_hrs`) · `Terkirim` (`sent_hrs`) · `Status`.
- **Kenapa order+op sama bisa pecah**: bundle key = hari+operator+order+op+**zconf_type
  (M1/M2)+machineid+lstar+zbarcodeid** (`stage_sap_timesheet.py` GROUP BY). VA (M1) vs Setting
  (M2) dua-duanya `is_productive` → dulu terlihat kembar; kolom **Aktivitas** + **Mesin**
  membuat pemisahannya jelas. Item dalam grup di-sort per order+op (produktif dulu) agar berdampingan.
- **Backend**: `getSapReconciliationDay` tambah subquery `operation_text`
  (`COALESCE(NULLIF(max(operation_short_text),''), NULLIF(max(operation_description),''))`),
  `machineid` (`max(m.machineid)`) dan `machinename` (`max(m.machinename)`) via join
  `sap_staging_source ⨝ mch_transaction` yang sudah ada. Kolom **Mesin** = kode + nama.
- **Scroll restore**: `getScrollParent` + `panelRef`/`savedScroll`; posisi scroll disimpan saat
  drill (`openRecord`) dan dikembalikan via `useLayoutEffect` saat `rec→null` (balik ke daftar hari).
- **Rapi visual**: panel `max-w-4xl`→`max-w-6xl`, tabel hari `min-w-[1040px]` (scroll saat sempit,
  tak nabrak). Badge pill diganti: Status = `StatusDot` (titik warna + teks AA, lebar seragam),
  Type/Aktivitas = teks berwarna tanpa background nempel.

### E. Iterasi 3 (keputusan/temuan owner 2026-07-30)

- **"order+op+aktivitas+mesin sama tapi 2 grup"** — TERBUKTI dari data (DIMAS, 28 Jul, order
  129625/op0130, Measure): satu bundel **normal** (`is_correction=false`, pagi) + satu **KOREKSI**
  (`is_correction=true`, sore, setelah hari/order sudah POSTED). Bukan duplikat — dua confirmation
  SAP berbeda. **Fix**: endpoint `getSapReconciliationDay` tambah `st.is_correction`; UI tampilkan
  badge **`corr`** (amber) di kolom Activity + badge **correction** di header level-3.
- **Durasi → menit** (`fmtDur`): desimal jam (0.0/0.1 membingungkan) diganti "6m/14m/1h 14m/2h".
  Dipakai di seluruh panel (funnel, per-date, per-aktivitas, level-3).
- **Full English + buang label berlebih**: semua teks Indonesia → English; `dayLabel` locale
  `en-GB`; paragraf penjelasan verbose (subtitle header, intro level-2, footer level-3) dihapus.
- **Nama mesin**: kolom Machine = `machineid` + `machinename` (mis. `M5051CL2 DT 3000 1`) —
  `mch_transaction.machinename` via join yang sudah ada.
- Smoke-test SQL day-endpoint (operation_text/machineid/machinename/is_correction) **lolos** ke DB prod.
- **Filter** `Semua / Masuk SAP / Belum` (`FilterToggle`, client-side atas `dayData.bundles`
  sebelum `groupByOperator`; reset ke `all` saat ganti tanggal).
- **Aksi "Stage yang ketinggalan"** (level-1): `POST /dashboard/sap-ops/enqueue {action:'stage_catchup'}`
  (endpoint + worker SUDAH ada) → poll `GET /dashboard/sap-ops/requests` (chip `OpsStatus`:
  Antri/Proses/Selesai/Gagal, poll 4 dtk saat QUEUED/RUNNING). **Node hanya menitip permintaan**;
  bundling tetap di `stage_machinehours.py --catchup` (normal + KOREKSI). 409 = sudah ada job →
  cukup lanjut poll. Hari yang sudah tutup jadi bundel KOREKSI → post manual dari tab "Corrections".
- **Batas sadar**: staging per-`proddataid` TIDAK dibuat (design §3 larang bundling baru di Node);
  daftar record "ketinggalan" yang eksplisit (endpoint anti-join) = follow-up bila perlu.

### Urutan & verifikasi

1. B (frontend, nol risiko) → 2. C (frontend-only, grouping per operator) → 3. A (backend + placeholder)
   → 4. D (backend `operation_text` + frontend kolom/filter/aksi stage).
2. Verifikasi: `npm run lint` + `npm run build` di `apps/web/`; endpoint di-smoke via
   `node server.js` (butuh tunnel DB aktif). Tanpa migrasi — tak menyentuh skema.
