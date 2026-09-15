---
type: concept
tags: [ews, roster, adoption-labour, override, shift-lock, inactive-operator, snapshot, domain/ews]
updated: 2026-07-22
---

# Lapisan Override Roster EWS: shift-lock, operator nonaktif, dan `roster_effective`

`ews.shift_roster` **beku** (lihat [[concepts/ews-roster]] — jangan pernah hapus-lalu-regenerate).
Tapi kenyataan berubah setelah baris dibuat: operator dipindah shift, atau operator resign.
Jawabannya bukan menulis ulang baris beku, melainkan **lapisan override yang diterapkan saat
BACA** lewat satu VIEW. Tabel dasar tak pernah dimutasi oleh override.

```
ews.shift_roster (beku, PK serialnumber+business_date)
      │
      ├── LEFT JOIN ews.operator_shift_lock      → override SHIFT  (DAY/NIGHT, N minggu)
      └── LEFT JOIN public.usernfc.inactive_from → filter POPULASI (resign, date-aware)
      ▼
ews.roster_effective   ← SATU-SATUNYA yang dibaca konsumen
```

## 1. Aturan inti (hafalkan dua ini)

**Shift efektif** — lock menang, dan `std` **dihitung ulang** dari shift terkunci (bukan std beku):
```
eff_shift = COALESCE(lock.locked_shift, scheduled_shift)
eff_std   = COALESCE(operator_shift[locked_shift].standard_hours, scheduled_standard_hours)
```

**Operator ikut dihitung pada suatu tanggal** — date-aware, bukan boolean:
```
inactive_from IS NULL OR business_date < inactive_from
```
`inactive_from` = **hari PERTAMA operator TIDAK dihitung** (= tanggal efektif resign).
Contoh: resign efektif 2026-07-15 → `inactive_from='2026-07-15'`; adoption 07-01…07-14 tetap
menghitung dia (`bd < 15`), 07-15 ke atas tidak.

> **Kenapa DATE, bukan `is_active BOOLEAN`.** Boolean itu *timeless*: begitu di-`false`, SEMUA
> tanggal lampau ikut kehilangan operator itu → adoption historis yang sudah benar jadi rusak.
> DATE membuat tiap tanggal dinilai pada garis waktunya sendiri dan **invarian selamanya**
> (`10 < 15` tak pernah berubah). Ini penerapan prinsip freeze yang sama dengan `shift_roster`.
> Konsekuensi lanjutan: `roster_workday_rule` MASIH boolean timeless — lihat jebakan §6.

## 2. Model data

| Objek | Peran | Catatan |
|---|---|---|
| `ews.operator_shift_lock` | Kunci operator ke DAY/NIGHT selama N minggu | `id` identity PK; FK `locked_shift → operator_shift(shift_code)`; `cancelled_at` soft-cancel; **EXCLUDE gist** `(serialnumber =, daterange(effective_from, lock_end,'[)') &&) WHERE cancelled_at IS NULL` — anti-overlap. Index GiST-nya sekaligus melayani containment di read-path (tak ada index tambahan) |
| `public.usernfc.inactive_from` | `date NULL`; NULL = aktif | Index parsial `WHERE inactive_from IS NOT NULL`. Ditaruh di `usernfc` karena operator **tak bisa dihapus** (FK `timesheet_transaction.serialnumber → usernfc.snssb` + histori SAP/ETL) |
| `ews.roster_effective` | VIEW (bukan materialized) yang menerapkan keduanya | Kolom: `serialnumber, business_date, status, source, updated_by, eff_shift, eff_std, shift_locked` |

**Anti fan-out (kenapa LEFT JOIN aman):** `operator_shift_lock` punya EXCLUDE anti-overlap → ≤1 lock
aktif per (operator, tanggal). `usernfc.snssb` **UNIQUE** (terverifikasi 231/231 distinct, 0 duplikat)
→ ≤1 baris usernfc per serialnumber. Terbukti: `count(roster_effective) == count(shift_roster)`.

**LEFT JOIN, bukan INNER** — operator tanpa baris `usernfc` tetap muncul (`inactive_from IS NULL`
bernilai true saat tak ada match). Prinsip fallback yang sama dipakai di semua tier.

## 3. Di mana filter dipasang (dan kenapa dipusatkan)

Filter inactive **hanya ada di VIEW**, bukan disalin ke tiap konsumen. Satu tempat → mustahil
terlewat, dan konsisten dengan cara shift-lock dipasang.

| Konsumen | File | Efek |
|---|---|---|
| Denominator `adoption_labour` | `services/ewsCalculator.js` (`calculateAdoptionLabourFromRoster`) | Operator nonaktif keluar denominator untuk `bd >= inactive_from` |
| Roster harian foreman | `controllers/ewsRosterController.getRoster` | Tersembunyi pada tanggal ≥ `inactive_from`, tetap tampil sebelum itu |
| Dispatcher `EXISTS` | `services/ewsCalculator.js` | Menentukan jalur roster vs fallback logs |

**Penting:** VIEW hidup di DB, jadi mengganti definisinya **langsung berlaku pada app yang sedang
berjalan** — query app cuma menulis `FROM ews.roster_effective`. Tak perlu redeploy untuk efek VIEW.

## 4. Generator: cegah di sumbernya

`services/rosterGenerator.js` CTE `op_date` menyaring date-aware:
```sql
FROM gshift g
CROSS JOIN ews.operator_rotation_group org
LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb),'') = org.serialnumber
WHERE u.inactive_from IS NULL OR g.bd < u.inactive_from
```
Tak ada baris BARU untuk tanggal ≥ `inactive_from`. Baris beku sebelum itu tak tersentuh
(`ON CONFLICT DO NOTHING` tetap). Dua lapis: generator mencegah baris baru, VIEW menyembunyikan
baris masa depan yang terlanjur ter-generate sebelum resign.

## 5. Aturan arsitektural: POPULASI vs RESOLUSI NAMA

`usernfc` dipakai untuk dua hal yang **beda perlakuan**. Melanggar ini = merusak histori.

| Kategori | Contoh | Perlakuan terhadap `inactive_from` |
|---|---|---|
| **Populasi / denominator** | `roster_effective`, generator, dropdown assign & lock | **WAJIB date-aware** (atau per-hari-ini untuk picker) |
| **Resolusi nama / atribut** | nama di daftar lock & roster, picker dashboard, `employee_category` untuk SAP (`stage_*.py`), `full_name` di ETL mesin, tools, timesheet history | **JANGAN PERNAH difilter** |

Alasan: timesheet & record mesin milik operator resign tetap harus ter-label namanya dan tetap
bisa di-posting ke SAP. Memfilter jalur resolusi nama membuat nama hilang (`NULL`) di data lama.

**Perilaku UI** (`EwsRosterConfigPage`):
- Dropdown **assign** ← `getConfig.operators` (di-filter backend: aktif per hari ini).
- Dropdown **lock** ← `group_members` di-filter di client dengan batas hari yang sama.
- Daftar grup A/B **tetap menampilkan** operator nonaktif + badge `Nonaktif <tgl>` (coret) atau
  `Resign <tgl>` (amber) bila tanggalnya masih di depan.
- Operator dengan `inactive_from` **masa depan masih bisa dipilih** — dia masih bekerja hari ini.
- Kunci tulis selalu `serialnumber`; nama hanya untuk memilih (`<option value={serial}>Nama</option>`
  → nilai yang terkirim mustahil berupa nama; nama tidak unik, serial unik).

## 6. Snapshot beku ikut jadi stale (jebakan paling mahal)

`ews.kpi_snapshot grain='today'` ditulis **sekali** saat hari itu menjadi "today", lalu **tak pernah
dihitung ulang** — job hanya menghitung `today` + rolling window. Jadi setiap koreksi terhadap masa
lalu (set `inactive_from`, atau perbaikan `shift_roster`) meninggalkan snapshot lama yang salah.

**Deteksi:** `apps/api/scripts/detect_stale_snapshots.sql`
- (A) snapshot yang masih menghitung operator resign pada `bd >= inactive_from`.
- (B) snapshot yang menghitung `SCHEDULED` pada hari yang kini OFF — **wajib pakai `:cutoff`**,
  karena `roster_workday_rule` boolean timeless akan over-flag Sabtu pra-kebijakan.
  Terbukti: tanpa cutoff, 07-11 (Sabtu kerja sah) ikut tertandai bersama 07-18 (benar-benar stale).

**Koreksi:** `apps/api/scripts/patch_adoption_labour_snapshot.js --date <YYYY-MM-DD> [--dry-run]`
Mengganti **hanya elemen `adoption_labour`** di `detail_json`, mengambil elemen pengganti dari
calculator asli (tak ada formula yang diduplikasi). Backup baris otomatis, abort bila ≠1 elemen
berubah, dan tak menyentuh kolom lain sama sekali.

> ⛔ **`recompute_daily_snapshots.js` TIDAK aman** untuk tanggal lampau dan sekarang menolak jalan.
> Menulis ulang seluruh baris tak bisa mereproduksi semua KPI di basis `'date'`:
> `adoption_machine` → null (`getCachedAdoptionCalculation` membaca cache `WHERE grain=$1`; tak ada
> `grain='date'`), `uptime_tablet` → null (placeholder), dan `accuracy_*`/`ole` bergeser karena data
> lampau terus di-backfill. Terukur di 07-18: satu perbaikan ditukar empat regresi.

`overall_score`/`overall_status` sengaja **tidak** dihitung ulang saat patch: tak ada pembaca
historis (getTrend tak mengirimnya; frontend merender overall hanya dari summary hari ini), dan
menghitungnya di luar fungsi skoring aslinya = dual-source-of-truth.

## 7. Urutan operasi yang benar (salah urut = angka tetap salah)

Recompute hanya **membaca ulang** kalkulasi live. Jadi semua koreksi data harus lebih dulu:

1. Migrasi kolom → 2. Migrasi VIEW → 3. Koreksi data (`shift_roster` dan/atau set `inactive_from`)
→ 4. `detect_stale_snapshots.sql` → 5. patch `--dry-run` → 6. patch.

## 8. Status implementasi (2026-07-22)

**Sudah di prod (DB):** `20260720_ews_operator_shift_lock.sql`, `20260720_ews_roster_effective_view.sql`,
`20260722_usernfc_inactive_from.sql`, `20260722_ews_roster_effective_inactive.sql` — keempatnya kini
tercatat di `public.schema_migrations` (dua yang 20260720 sempat teraplikasi TANPA entri ledger;
bahaya: `migrate.js` akan menganggapnya pending lalu `CREATE OR REPLACE` view LAMA dan membalik
filter inactive — sudah di-backfill).

**Sudah dieksekusi:** cleanup Sabtu ≥14 Jul (91 baris `SCHEDULED→OFF`, `source='manual'`,
`updated_by='ews-roster-cleanup'`); patch snapshot 07-18 (`adoption_labour` 45.1 → `no_data`).

**Belum:** belum ada operator ber-`inactive_from` (filter masih no-op — terbukti: digest VIEW
identik sebelum/sesudah migrasi). **UI penyetel `inactive_from` belum dibuat** — set via SQL manual.
Kode JS menunggu deploy.

**Terhubung:** [[concepts/ews-roster]] · [[planning/ews-roster-feature]] · [[PLANNING]] ·
`apps/api/services/rosterGenerator.js` · `apps/api/services/ewsCalculator.js` ·
`apps/api/controllers/ewsRosterController.js` · `apps/web/src/pages/EwsRosterConfigPage.jsx`
