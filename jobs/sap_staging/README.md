# SAP Staging Jobs

Menyiapkan payload timesheet & jam mesin ke `sap_timesheet_staging`, lalu mengirimkannya ke SAP.
Semua script membaca `.env` dari root repo `MPS2/.env`.

> **Ini jalur payroll.** Kesalahan di sini = jam kerja hilang, dobel, atau salah pemilik.
> Baca bagian **[Pengaman](#pengaman-jangan-dilucuti)** dan **[Batas Berbahaya](#-batas-berbahaya)**
> sebelum mengubah apa pun. Latar belakang: `docs/concepts/sap-staging-identity.md`.

---

## Alur

```
mch_transaction ──(gerbang kelayakan)──> bundling per JAM ──> sap_timesheet_staging (PENDING)
                                              │                        │
                                              └──> sap_staging_source   └──> post_sap_staging.py ──> SAP
                                                   (provenance/segmen)          │
                                                                                └──> POSTED / FAILED / SKIPPED
```

---

## Aturan Kelayakan (mch_transaction → staging)

Sebuah baris hanya di-stage bila **semua** benar:

| Syarat | Kenapa |
|---|---|
| `startdatetime`, `enddatetime` ada & `end > start` | durasi valid |
| `order_no` terisi | SAP butuh AUFNR |
| `operation_no` terisi | SAP butuh VORNR |
| `confirmation_number` terisi | SAP butuh RUECK |
| **`sn_employee` terisi** | tanpa ini PERNR kosong → **jam kerja tanpa pemilik** |
| `statusid` **bukan** 0, 3, 4 | Off / Downtime / No Job — bukan kerja pada order |
| bila `statusid` = 5 → durasi **≤ 60 detik** | Unidentified singkat = celah antar aktivitas; yang panjang tidak dikirim |

> ⚠️ **JANGAN pakai kolom `status_record` sebagai gerbang.** Definisinya punya pintu belakang
> (`statusid IN (0,3,4) OR (...)`), sehingga baris **tanpa operator tetap lolos**.
> `status_record` = kelengkapan data untuk KPI `accuracy_machine`, **bukan** kelayakan SAP.

### Peta `statusid` (diverifikasi dari data — 3 & 4 mudah tertukar!)

| id | Deskripsi | id | Deskripsi | id | Deskripsi |
|---|---|---|---|---|---|
| 0 | Off ❌ | 6 | Load (M2) | 13 | Daily PM |
| 1 | Productive (M1) | 7 | Setting (M2) | 14 | Tool Preparation |
| 2 | Idle | 8 | Measure (M2) | 15 | Labour Necessity |
| **3** | **Downtime** ❌ | 9 | Unload (M2) | 16–21 | Jig/Waiting/Wait… |
| **4** | **No Job** ❌ | 11 | Breakdown | | |
| 5 | Unidentified (≤60 dtk saja) | 12 | Coffee Break / Lunch | | |

❌ = tidak masuk staging.

---

## Bentuk Payload

| Jenis | Syarat | ZCONF_TYPE | RUECK | AUFNR/VORNR | LSTAR | ZBARCODEID |
|---|---|---|---|---|---|---|
| **Produktif M1** | `status_activitytype = M1` | `M1` | terisi | terisi | — | **`VA`** |
| **Produktif M2** | `status_activitytype = M2` | `M2` | terisi | terisi | — | teks status (`Setting`, `Measure`, `Load`, `Unload`) |
| **Idle → M2** | `statusid=2` **∧** `previoustatusid=1` **∧** durasi **≤300 dtk** | `M2` | terisi | terisi | — | **`Idle`** |
| **Unproductive** | selain di atas | *(kosong)* | *(kosong)* | **kosong** | activity type | *(kosong)* |

**Idle pendek setelah produksi = micro-stop**, bukan waktu terbuang → diperlakukan sebagai setup (M2).

⚠️ AUFNR/VORNR dikosongkan **di KUNCI bundling juga**, bukan cuma di payload. Kalau hanya di
payload, dua bundel yang cuma beda order akan menghasilkan **payload kembar** dan SAP menerima keduanya.

**Waktu yang dikirim ke SAP bersifat sintetis:** `ISDD/ISDZ` = awal jam bucket, `IEDD/IEDZ` = awal
jam + total durasi. Yang akurat adalah **durasi**, bukan jendela waktunya. Bucket jam yang mengurung
fiksi ini agar tak pernah meleset > 1 jam — **jangan hilangkan bucket jam**.

---

## Bundling

Satu baris staging = satu bundel **(jam × operator × order × operasi × mesin × jenis aktivitas)**.
Baris `mch_transaction` yang melintasi jam **dipotong per jam** (event 09:40→11:20 → 3 segmen).

`source_key = md5(werks | bucket_start | employee | rueck | aufnr | vornr | flgat | plnfl |
vornr_b | vornr_r | zconf_type | arbpl | lstar | zbarcodeid)`

> 🚨 **Mengubah komposisi md5 ini = SELURUH riwayat berganti kunci.** Lihat [Pengaman](#pengaman-jangan-dilucuti).

---

## Tabel

| Tabel | Isi |
|---|---|
| `sap_timesheet_staging` | Antrian payload. `ztimesheetid` = `id::text` (GENERATED). `is_productive` = `zconf_type IN (M1,M2)` (GENERATED) |
| **`sap_staging_source`** | **Provenance**: bundel ini dari record sumber mana (segmen: `source_row_id` + `bucket_start` + detik). Jangkar semua pengaman |
| **`sap_source_change_blocked`** | Log percobaan mengubah record yang sudah terkirim ke SAP (ditolak trigger pembekuan) |
| `sap_stage_cursor` | Posisi terakhir staging job |
| `sap_staging_eligibility_audit` | Audit kenapa source row belum layak |
| `log_timesheet_sap` | Audit tiap kiriman ke SAP (dipakai guard "ZTIMESHEETID terbakar") |

---

## Script

| Script | Fungsi |
|---|---|
| `stage_machinehours.py` | Job rutin jam mesin (cursor) + **catch-up** |
| `stage_timesheet_transaction.py` | Job rutin timesheet operator (cursor) |
| `stage_sap_timesheet.py` | Mesin bundling + tool manual (init-db, stage ad-hoc). Berisi SQL bundling — **inti dari semua aturan di atas** |
| **`rebuild_machinehours.py`** | **Bangun ulang antrian** setelah bentuk payload/aturan berubah |
| `post_sap_staging.py` | Kirim payload ke SAP (paralel, ber-guard) |
| `sap_staging_common.py` | Helper: koneksi, DDL, insert staging + provenance, builder payload, cursor |
| `seed_sap_staging_manual.py` | Seed payload manual untuk testing |

---

## Perintah

### Staging rutin
```bash
cd jobs/sap_staging
python stage_machinehours.py                 # jam terakhir + catch-up otomatis (14 hari)
python stage_machinehours.py --dry-run
python stage_machinehours.py --from-ts 2026-07-01T08:00:00 --to-ts 2026-07-01T09:00:00
```

### Catch-up — record yang diperbaiki user
```bash
python stage_machinehours.py --catchup                    # sapu yang tertinggal
python stage_machinehours.py --catchup --catchup-days 20
```
Mencari record **layak** yang **belum punya provenance** — mustahil melewatkan apa pun.
Terjadi bila: (a) dulu ditolak gerbang (mis. `sn_employee` kosong) lalu diperbaiki user, sementara
cursor sudah lewat; (b) bundelnya dihapus trigger invalidasi karena datanya berubah.

**Lantai otomatis:** catch-up tidak boleh menyentuh tanggal sebelum bucket paling awal di antrian.
Tanpa lantai ini, dia akan menemukan data lama yang **sudah terkirim ke SAP tanpa provenance** dan
mengirimnya lagi. Override `--catchup-since` **hanya** kalau kamu paham konsekuensinya.

### Rebuild — setelah aturan/bentuk payload berubah
```bash
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-15 --dry-run
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-15
```
Hapus baris **BELUM terkirim**, stage ulang dengan aturan terbaru. **Baris POSTED + provenance-nya
tidak pernah disentuh** — itulah ingatan yang mencegah double-post.

`--full-reset` menghapus **SELURUH** antrian + reset ID ke 1. **Hanya sah bila SEMUA baris POSTED
sudah di-STORNO di SAP.**

### Posting
```bash
# produktif dulu (unproductive masih ditolak SAP — lihat Masalah Terbuka)
python post_sap_staging.py --productive-only --limit 1200 --workers 5

python post_sap_staging.py --unproductive-only --limit 200   # setelah SAP diperbaiki
python post_sap_staging.py --retry-failed --limit 200
python post_sap_staging.py --ids 123
```

| Flag | Guna |
|---|---|
| `--workers N` | Kiriman paralel. **Paralel ANTAR-ORDER, serial DI DALAM order** (SAP mengunci order). Mulai 4–5 |
| `--productive-only` / `--unproductive-only` | Filter `is_productive` |
| `--max-retries` (3) | Retry **kegagalan jaringan** & **kunci order**, bukan penolakan bisnis |
| `--retry-backoff` (2.0) | Jeda dasar antar retry (naik linear) |
| `--delay-ms` (100) | Throttle per worker — naikkan kalau CPI memutus koneksi |

**Kinerja:** 13,2 dtk/baris → **1,7 dtk/baris** setelah (a) koneksi DB dipakai ulang per thread —
dulu koneksi baru **tiap baris, dua kali** (2,6 dtk/koneksi lewat tunnel Tailscale), dan (b) paralel
per-order. **Jalankan di server, bukan dari laptop** — koneksi DB di server ~5 ms, bukan 2.622 ms.

---

## Pengaman (jangan dilucuti)

### Jebakan yang mendasari semuanya

`ZTIMESHEETID = sap_timesheet_staging.id::text` — **nomor baris, bukan turunan data sumber.**
SAP memang menolak ZTIMESHEETID ganda, **tapi itu tidak melindungi kita**: begitu `source_key`
berubah — karena **kode** (resep md5 diubah, `PLANT_SSB` diganti) atau karena **data** (order_no
salah diperbaiki) — lahir baris staging **baru** → `id` baru → ZTIMESHEETID baru → **SAP
menerimanya sebagai kiriman baru** → jam masuk **dua kali**.

**Jangkar yang benar = SEGMEN `(proddataid, bucket_start)`** — tidak berubah walau resep md5,
format, atau plant diubah. Bukan `proddataid` saja: bundling memotong record per jam, jadi satu
proddataid **sah** muncul di beberapa bundel (contoh nyata: 501272 berjalan 16:45–20:48 → 5 segmen).

### Empat lapis

| # | Pengaman | Letak |
|---|---|---|
| 1 | **Unique index parsial** `WHERE posted_at IS NOT NULL` — satu segmen **mustahil** ter-POST dua kali. Database yang menolak, bukan disiplin manusia | `sap_staging_source` |
| 2 | **Guard poster** — sebelum kirim: segmen sudah ter-POST? `source_key` **sama** → skip (re-run). **Beda** → **KONFLIK** → `SKIPPED` + "butuh storno di SAP" | `post_sap_staging.py` |
| 3 | **Trigger pembekuan** — field kunci record yang **sudah terkirim** tidak bisa diubah; percobaan dicatat ke `sap_source_change_blocked`. ETL tidak putus (update lain tetap lolos) | `mch_transaction` |
| 4 | **Trigger invalidasi** — record sumber berubah & bundelnya masih PENDING → bundel usang **dihapus** → catch-up men-stage ulang | `mch_transaction` |
| + | **Guard ZTIMESHEETID terbakar** — cek `log_timesheet_sap`: ID ini pernah SUCCESS di SAP? → `SKIPPED` | `post_sap_staging.py` |

### Lingkaran perbaikan data

```
EWS accuracy_machine menunjuk record tak lengkap
   → user memperbaiki mch_transaction
   → trigger invalidasi hapus bundel PENDING usang
   → catch-up men-stage ulang dengan data baru
   → poster mengirim
```

---

## ⚠️ Batas Berbahaya

1. **JANGAN ubah komposisi md5 `source_key`** tanpa rencana. Semua riwayat berganti kunci →
   dianggap baru → dikirim ulang ke SAP. (Guard segmen akan menangkapnya, tapi jangan uji nasib.)
2. **JANGAN reset sequence `id`** tanpa storno semua POSTED di SAP dulu. ZTIMESHEETID yang pernah
   diterima SAP akan terpakai ulang → penolakan duplikat pada baris yang sah.
3. **JANGAN rebuild/catch-up tanggal di luar rentang yang dikelola.** Data lama (mis. Juni) sudah
   terkirim ke SAP **tanpa provenance** — men-stage-nya lagi = jam masuk dua kali.
4. **JANGAN pertahankan `status_record` sebagai gerbang** (lihat atas).
5. **Jangan tulis tanda persen (`%`) di komentar SQL** yang dieksekusi psycopg2 — dibaca sebagai
   placeholder format, seluruh query gagal.

---

## Masalah Terbuka

- **Unproductive ditolak SAP**: *"Enter activity type only in conjunction with cost center"*.
  Payload **tidak punya field KOSTL**, dan `cost_center` di `mch_transaction` hanya terisi ~14%.
  Perbaikan ada **di sisi SAP** (kemungkinan menurunkan KOSTL dari work center/ARBPL).
  Sementara itu: kirim dengan `--productive-only`.
- **Tidak ada STORNO**: guard hanya **mendeteksi** konflik; pembatalan kiriman salah di SAP masih manual.

---

## Membaca Error SAP

| Pesan | Arti | Aksi |
|---|---|---|
| `Order X is already being processed by SAPCI` | Kunci order sementara — dua kiriman untuk order sama bersamaan | Otomatis di-retry. Kalau sering: turunkan `--workers` |
| `User status TECO is active` | Order sudah *technically complete* — tidak bisa menerima konfirmasi | Keputusan bisnis: buka TECO di SAP, atau relakan |
| `Enter activity type only in conjunction with cost center` | Baris unproductive (LSTAR tanpa KOSTL) | Tunggu perbaikan sisi SAP |
| `SSL: UNEXPECTED_EOF` / `read operation timed out` | **Jaringan**, bukan penolakan SAP. Request mungkin sampai, mungkin tidak | Retry **aman** (ID sama → SAP tolak duplikat, tidak dobel) |

---

## Audit Cepat

```sql
-- Bundel ini dari record mana saja?
SELECT source_row_id, seconds FROM sap_staging_source WHERE staging_id = 163449;

-- Record ini sudah pernah ke SAP?
SELECT t.id, t.status, t.posted_at FROM sap_staging_source s
JOIN sap_timesheet_staging t ON t.id = s.staging_id
WHERE s.source_row_id = '501523';

-- Perubahan data yang DITOLAK karena sudah terkirim ke SAP
SELECT * FROM sap_source_change_blocked ORDER BY blocked_at DESC LIMIT 20;

-- Kondisi antrian
SELECT status, is_productive, count(*) FROM sap_timesheet_staging GROUP BY 1,2 ORDER BY 1,2;
```

---

## Env

```text
DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD     # source (mch_transaction, timesheet)
PLANT_SSB TIMEZONE TGT_TABLE
SAP_INBOUND_URL SAP_INBOUND_USERNAME SAP_INBOUND_PASSWORD

SAP_STAGING_DB_HOST SAP_STAGING_DB_PORT ...     # opsional: staging DB terpisah
SAP_STAGE_INITIAL_FROM_TS SAP_STAGE_CURSOR_OVERLAP_MINUTES SAP_STAGE_SAFETY_DELAY_MINUTES
```
