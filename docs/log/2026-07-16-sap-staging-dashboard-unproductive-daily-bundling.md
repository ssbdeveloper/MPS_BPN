---
type: log
date: 2026-07-16
tags: [sap, staging, machine-hours, dashboard, ews, payroll, domain/sap]
---

# SAP-log redesign, kelayakan unproductive, bundling harian, fresh start staging

Sesi lanjutan setelah normalisasi NFC (sudah di-commit & deploy terpisah). Menjalankan
[[operations/sap-staging-reconciliation-page]] sebagian + beberapa keputusan payroll baru.
Menyentuh pemahaman di [[concepts/sap-staging-identity]] dan [[concepts/payroll-data-path]].

## Yang dikerjakan

### 1. Halaman SAP-log dirombak (`SapLogPage.jsx`) — 2 tab
- **Status Kirim SAP**: stat cards + triase kegagalan per-sebab (bahasa manusia via
  `sapErrorClassifier.js`, 9 pola) + detail drawer. Tombol aksi disederhanakan jadi hanya
  "Kirim ulang gagal" (PENDING di-post server otomatis).
- **Jam Operator** (`components/sap/MachineHoursMatrix.jsx`): heatmap operator×hari (biru
  sekuensial), garis hijau = porsi terkirim SAP, klik sel → drawer segmentasi
  (terkirim/layak/tak-layak) + daftar record. Edit job (picker `ph3_order`) & operator
  (picker `usernfc`) per record.

### 2. Endpoint dashboard baru
`sap-timesheet-staging-summary`, `machine-hours-matrix`, `machine-hours-records`,
`ph3-jobs`, `operators`, `machine-hours-override`, `sap-ops/enqueue|requests`.

### 3. Lapisan koreksi manual — `mch_transaction_override`
Edit job/operator disimpan di tabel milik MPS2, diterapkan ulang ETL (`apply_overrides`
di `etl_mch_transaction_v3.py`) setelah tiap derivasi → **tahan `--full-rebuild`**.
`mch_productiondata` sengaja TIDAK dipakai untuk edit: dia cermin SQL Server yang
di-upsert `etl_machine_conf` tiap sync (editnya kesapu).

### 4. KEPUTUSAN: unproductive TIDAK butuh confirmation_number (owner)
Aturan lama "keempat field (order+operasi+operator+confirmation) wajib untuk SEMUA" salah
untuk unproductive (LSTAR/activity type — dibukukan ke cost center, bukan order).
Aturan baru (satu sumber kebenaran, 3 tempat konsisten):
- **productive (M1/M2)**: order+operasi+operator+confirmation.
- **unproductive (punya activity type)**: cukup operator.
- Diterapkan ke: kolom `status_record` (redefinisi, migration 20260715), gerbang
  `stage_sap_timesheet.py`, dan dashboard (`eligible = status_record`).
- Efek: ~1.700 record unproductive jadi layak (akan FAILED "cost center" di SAP sampai
  master data beres — backlog). Juga MEMPERBAIKI EWS accuracy_machine (unproductive
  dengan operator tak lagi salah dihitung incomplete).
- Statusid map diverifikasi dari `mch_statustypes`: **0=Off, 3=Downtime, 4=No Job** (label
  lama di kode sempat tertukar). Off/Downtime/NoJob dikeluarkan dari heatmap & drill.

### 5. KEPUTUSAN: bundling PER HARI, bukan per jam (owner)
Per jam melahirkan pecahan sub-menit di batas jam (1.297 bundel / 5,11 jam) yang ditolak
SAP (< 1 menit) dan terbuang. Per hari (per operator/mesin/order/operasi/status): fragmen
MENYATU ke total harian. Waktu konfirmasi di-anchor ke aktivitas pertama hari itu
(`source_min_start`) + total durasi — sama filosofi sintetis yang SUDAH diterima SAP
(1.191 bundel sukses pakai anchor awal-jam). Filter `total_seconds >= 60` dipertahankan
sebagai jaring untuk sub-menit sejati. Hasil: 4.040 → **1.659 bundel**, sub-menit **0**,
jam utuh (792 jam).

### 6. Fresh start staging (owner sudah STORNO semua di SAP)
- 3 migration di-apply (override, sap_ops_request, status_record redefinisi).
- `mch_transaction` di-`--full-rebuild --from 2026-07-01` (owner, di server) — sekaligus
  isi operator historis pasca-migrasi NFC (operator-kosong 201→63 jam).
- `TRUNCATE log_timesheet_sap` (1.191 SUCCESS basi pasca-STORNO — kalau tidak, guard
  burned-ztimesheetid memblokir ID 1–N).
- `rebuild_machinehours.py --full-reset` → antrian **1.659 bundel harian, ID 1–1659**,
  semua PENDING, provenance bersih.

## Pending / berikutnya
- Post productive dulu: `post_sap_staging.py --productive-only` (unproductive gagal cost
  center sampai master data SAP beres).
- `ops_worker.py` + tabel `sap_ops_request` = infra tombol retry; **belum di-deploy**.
  Dipertimbangkan dibuang kalau auto-poster server bisa sekalian retry FAILED.
- `apply_overrides` di ETL kini no-op (belum ada override); jadi aktif saat user mulai
  mengedit job/operator dari dashboard.
- Divergensi kecil: idle-promotable-tanpa-order tampil `layak` di dashboard tapi tersaring
  di staging (langka).
