---
type: log
date: 2026-07-22
tags: [ews, roster, adoption-labour, inactive-operator, snapshot, prod-change]
---

# 2026-07-22 — Penanda operator nonaktif, cleanup Sabtu, koreksi snapshot 07-18

Sesi ini menambahkan **lapisan operator nonaktif** ke roster EWS, lalu memakainya untuk
menuntaskan dua hutang lama: baris Sabtu stale dan snapshot beku yang salah.
Konsep permanen → [[concepts/ews-roster-override]]; note roster utama di-update
([[concepts/ews-roster]] jebakan #2 kini berstatus DIEKSEKUSI).

## Keputusan

1. **`inactive_from DATE NULL`, bukan `is_active BOOLEAN`.** Boolean timeless akan mencabut
   operator dari SEMUA tanggal lampau begitu di-flip → merusak adoption historis yang sudah benar.
   DATE membuat tiap tanggal dinilai pada garis waktunya sendiri. Semantik: `inactive_from` = hari
   pertama TIDAK dihitung; ikut dihitung bila `inactive_from IS NULL OR business_date < inactive_from`.
2. **Kolom di `usernfc`**, bukan tabel periode terpisah — cukup untuk kasus "resign sekali, tak
   bisa dihapus" (FK `timesheet_transaction → usernfc.snssb`). Naikkan ke tabel periode hanya
   kalau rehire jadi kebutuhan nyata.
3. **Filter dipusatkan di VIEW `roster_effective`** (Opsi A), bukan disalin ke tiap konsumen —
   satu tempat menutup adoption + `getRoster` + dispatcher sekaligus.
4. **UI penyetel `inactive_from` DITUNDA** — set via SQL manual dulu.
5. **`overall_score`/`overall_status` tidak dihitung ulang** saat patch snapshot: tak ada pembaca
   historis, dan menghitungnya di luar fungsi skoring aslinya = dual-source-of-truth.
6. **`<select>`, bukan datalist**, untuk picker operator: `<option value={serial}>Nama</option>`
   membuat nilai terkirim mustahil berupa nama (nama tidak unik, serial unik).

## Dieksekusi ke PROD (`ptssb`)

| Aksi | Hasil terverifikasi |
|---|---|
| Migrasi `20260722_usernfc_inactive_from.sql` | kolom + index parsial |
| Migrasi `20260722_ews_roster_effective_inactive.sql` | VIEW menyaring inactive, date-aware |
| Backfill ledger 2 migrasi `20260720` | lihat "kejutan" di bawah |
| Cleanup Sabtu ≥14-Jul | **91 baris** `SCHEDULED→OFF` (07-18=46, 07-25=45), guard `source IS DISTINCT FROM 'manual'` |
| Patch snapshot 07-18 (id 24593) | `adoption_labour` 45,1/critical → `null`/`no_data`; 7 KPI lain byte-identical |

Bukti no-op migrasi: digest md5 seluruh `roster_effective` **identik** sebelum/sesudah #1+#2
(`162fb1a6…`, 2639 baris), adoption hari ini tetap 86 SCHEDULED / 642,00 std / DAY 40 / NIGHT 46.
EXPLAIN ANALYZE 2,98 → 4,16 ms; index tanggal `shift_roster` tetap dipakai (tambahannya cuma hash
join tabel 231 baris). Setelah patch: detektor stale mengembalikan **0 tanggal**.

## Tiga kejutan yang mengubah rencana

1. **Ledger migrasi melenceng.** `schema_migrations` berhenti di `20260719`, padahal objek dari
   dua migrasi `20260720` sudah ada di DB — teraplikasi di luar `migrate.js`. Bahayanya konkret:
   run `migrate.js` berikutnya akan menganggap `20260720_ews_roster_effective_view.sql` pending
   lalu `CREATE OR REPLACE` **view LAMA** → membalik filter inactive secara diam-diam. Sudah
   di-backfill (`ON CONFLICT DO NOTHING`). **Disiplin: selalu lewat `migrate.js`.**
2. **Detektor stale-workday over-flag tanpa cutoff.** `roster_workday_rule` boolean timeless →
   "Sabtu OFF" berlaku surut, sehingga 07-11 (Sabtu kerja setengah hari yang SAH) ikut tertandai
   bersama 07-18. Guard `>= cutoff` wajib; tanpa itu recompute akan menghapus histori nyata.
3. **Recompute seluruh baris snapshot TIDAK aman.** Ditemukan lewat preview read-only sebelum
   menulis: basis `'date'` menjadikan `adoption_machine` → null (baca cache `WHERE grain=$1`, tak
   ada `grain='date'`) dan `uptime_tablet` → null; `accuracy_*`/`ole` bergeser karena data lampau
   terus di-backfill. Di 07-18: satu perbaikan ditukar **empat regresi**. → Ganti pendekatan ke
   patch bedah satu elemen KPI; `recompute_daily_snapshots.js` diberi guard runtime (menolak jalan).

## Pending

- **Deploy kode JS** (api + frontend + `ews-roster-job`) — VIEW sudah aktif di DB, tapi generator,
  `getConfig`, dan UI belum. Saat ini tak menimbulkan inkonsistensi karena belum ada operator nonaktif.
- **Set `inactive_from`** untuk operator yang benar-benar resign (SQL manual).
- **Snapshot 07-25** belum bisa dipatch — masih masa depan; baru bisa setelah 26-Jul.
- **Backlog:** perbaiki jalur recompute (merge per-KPI) atau buat basis `'date'` reproduksi setia
  semua KPI — lihat [[PLANNING]].

**Menyentuh:** [[concepts/ews-roster-override]] (baru) · [[concepts/ews-roster]] · [[PLANNING]] ·
[[planning/ews-roster-feature]]
