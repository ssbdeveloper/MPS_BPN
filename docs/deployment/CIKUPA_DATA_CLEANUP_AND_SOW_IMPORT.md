---
type: plan
status: planning
tags: [domain/sow, domain/sap]
updated: 2026-07-31
---

# Cikupa (5100): bersih-bersih residu Balikpapan + pola upload SOW standar

> DB Cikupa (`100.80.101.53`, tunnel `127.0.0.1:5441`, `ptssb`, `plant_config` = 5100 manufacturing)
> ternyata **clone dari DB Balikpapan** — hampir semua tabel penuh residu plant **5051** (beku sejak
> feed Cikupa mulai 2026-07-28). Perlu dibersihkan jadi 5100-only, workcenter disesuaikan, lalu SOW
> standar Cikupa diupload massal. Semua write ke DB ini = **butuh konfirmasi eksplisit + backup dulu**.

## 1. Peta residu (diverifikasi 2026-07-31, read-only)

| Tabel | Kolom plant | Residu 5051 | Data 5100 (nyata) | Catatan |
|---|---|---:|---:|---|
| `timesheet_transaction` | `plant` | **86.882** | 2 | copy beku timesheet Balikpapan |
| `sow` | *(tak ada)* | ~68.613 (wc `M5051*`) + 3.656 blank | 3.835 (wc `C5100*`) | klasifikasi via order-plant, bukan tebak workcenter |
| `ph3_order` | `plant_code` | **52.145** | 5.835 (feed live) | 5051 beku 11 Apr–3 Jun; 5100 mulai 28 Jul |
| `sow_standard` | `source_plant` | 5153=185, 5071=178, 5051=57, blank=233 | **0** | belum ada template 5100 |
| `workcenter` (master) | `plant` | 72 (mesin `M5051*`) + 42 blank | **0** | Cikupa people-group belum ada → "sesuaikan" |
| `log_timesheet_sap` | `plant_code` | 156 | 0 | |
| `qh3_order` / `production_operations` | plant | 0 | 0 | kosong — aman |
| `components` | — | 29 (?) | ? | cek asal |

**Aman dinyatakan:** DB Balikpapan LIVE ada di host lain (`100.86.231.55`, tunnel 5434). Residu di sini =
salinan beku; menghapusnya **tidak** menyentuh data live Balikpapan. Tetap **backup dulu**.

## 2. Rencana bersih-bersih (BUTUH konfirmasi + backup — belum dieksekusi)

0. **`pg_dump` backup** DB Cikupa dulu (ke `backups/`), simpan sebelum apa pun.
1. Tabel ber-kolom plant → `DELETE ... WHERE <plantcol> <> '5100'` (atau IS NULL sesuai aturan):
   `timesheet_transaction`, `ph3_order`, `sow_standard`, `workcenter`, `log_timesheet_sap`.
2. `sow` (tak ada kolom plant) → klasifikasi **presisi via order**: hapus baris yang `order_no`-nya milik
   order plant 5051 di `ph3_order` (atau bukan order 5100). JANGAN andalkan prefix workcenter (blank ambigu).
3. Jalankan dalam **satu transaksi**, urut sesuai FK (mis. `processcontroldata`/`processcontroldata_item`
   → `timesheet_transaction`; cek FK sebelum eksekusi). Verifikasi count sebelum COMMIT.
4. Pertimbangkan tabel domain lain yang mungkin ber-residu (consumable, mch_*, sap_*) — putuskan lingkup.

**Fork lingkup (tanya owner):** (a) *surgical* — hapus non-5100 per tabel (di atas); atau (b) *reset* —
TRUNCATE tabel transaksional (timesheet/sow/ph3/sow_standard/log) lalu biarkan feed + upload isi ulang
5100-only (paling bersih, paling destruktif).

## 3. Workcenter "sesuaikan" — tambah 5 grup Cikupa

Master `workcenter` belum punya baris 5100. Dari sheet **`workcenter`** file TRIAL:

| workcenter | deskripsi | peran |
|---|---|---|
| `C5100MPR` | Material Preparation | grup orang |
| `C5100QIM` | QC | grup orang |
| `C5100BPP` | Blasting Painting | grup orang |
| `C5100FAB` | Fabrication | grup orang |
| `C5100FIT` | Fitting | grup orang |

Setelah residu 5051 dihapus, INSERT 5 baris ini (plant 5100) ke master — jadi acuan validasi upload &
filter Select Job manufaktur. (Catat: master lama `M5051*` = mesin/salvaging; Cikupa = grup orang.)

## 4. Pola upload SOW standar massal (jawaban desain)

File TRIAL = data **`sow_standard`** (template operasi per komponen): kolom `part_number, operation_no,
operation_text, workcenter, std_hours, source_plant, remark`. 3 sheet = 3 komponen; sheet ke-4 = master workcenter.

**Pola yang direkomendasikan:**
1. **Format: satu sheet flat ternormalisasi** (bukan 1-sheet-per-komponen). Baris dibedakan `part_number`.
   `source_plant` **tidak** perlu kolom — di-set otomatis ke plant aktif (5100) saat import (di TRIAL sheet 2 blank → sumber error).
2. **Import lewat UI SOW Management, bukan SQL mentah:** pilih file → server parse → **validasi** →
   **preview** (yang akan di-insert/update + daftar error) → konfirmasi → commit. Idempotent & auditable.
3. **Validasi wajib** sebelum commit: `workcenter` harus ada di master 5100 (→ langkah 3 dulu); `operation_no`
   unik per komponen & angka; `std_hours` numerik ≥ 0 (bulatkan — TRIAL ada `46.4000000006` & blank);
   field wajib tak kosong; `source_plant` dipaksa 5100.
4. **Upsert idempotent** kunci `(source_plant, part/component, operation_no)` → re-upload update, tak dobel.
5. Kalau `part_number` belum ada di `components` → buat atau tolak (tergantung tata kelola master komponen).

**Kenapa begini:** validasi+preview mencegah data kotor (file TRIAL saja sudah blank source_plant + float-noise +
blank std_hours — import mentah meracuni master); upsert idempotent aman di-ulang; UI bisa dipakai non-dev.
Ini pada dasarnya menambah fitur "Import Excel → sow_standard" di SOW Management (dekat SowCreatePage/templates).

## 5. Status eksekusi (2026-07-31 — SELESAI, surgical)

Backup: `backups/cikupa_5100_pre-cleanup-5051_20260731_115815.sql` (56 MB, 6 tabel). Dieksekusi satu transaksi
(preview ROLLBACK dulu → COMMIT). Owner konfirmasi eksplisit. Hasil terverifikasi:

| Tabel | Dihapus | Sisa 5100 |
|---|---:|---:|
| `timesheet_transaction` | 86.882 | 2 |
| `sow` (via plant-order) | 70.280 | 5.835 |
| `ph3_order` | 52.145 | 5.835 |
| `sow_standard` + `sow_template_lines` | 653 + 85 | 0 |
| `log_timesheet_sap` | 156 | 0 |
| `workcenter` | 114 | 5 (baru) |

Workcenter master 5100 (idrow 158-162, identity GENERATED ALWAYS → jangan suplai idrow):
`workcenternew`=`C5100{MPR,QIM,BPP,FAB,FIT}`, `workcenterot`=`C50{...}OT` (pola owner: C5100MPR→C50MPROT),
`groupname` 3-huruf, `categoryhours`='Man Hour'. Cocok dengan pasangan yang muncul di `ph3_order.work_center`.

**Residu 5051 yang BELUM disentuh** (di luar lingkup surgical yang disepakati — putuskan bila perlu):
`consumable_stock`, `sap_stage_cursor`/`sap_staging_eligibility_audit`/`sap_timesheet_staging`,
`mch_machines`/`mch_transaction` (plantid), dan **`usernfc`** (operator NFC — tak ada kolom plant; kemungkinan
masih user Balikpapan → perlu di-scope/ganti dengan operator Cikupa untuk timesheet manufaktur).

**Berikutnya:** bangun fitur Import Excel → `sow_standard` (§4) — workcenter master 5100 kini siap jadi acuan validasi.
