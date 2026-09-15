# EWS Roster: Heatmap Bulanan + Kelola Bawahan Foreman (PLAN)

Tanggal: 2026-08-25
Status: **MENUNGGU KONFIRMASI KEPUTUSAN — belum coding**

## 1. Ringkasan permintaan user

1. **Roster page jadi heatmap 1 bulan** — filter cuma bulan + tahun; semua hari
   dalam bulan tampil sekaligus; klik kotak → panel edit status/half-day; bisa
   pilih banyak kotak sekaligus (mis. 7 hari OFF) yang user-friendly.
2. **Page baru kelola bawahan foreman** — akses: administrator, supervisor,
   foreman. NFC user di-drag & drop ke foreman (mis. AAN BAGUS KURNIAWAN →
   TAKBIR). Login sebagai TAKBIR → roster cuma menampilkan bawahannya; ada opsi
   lihat semua NFC user (operator).

## 2. Temuan investigasi (BPN live, 2026-08-25)

| Fakta | Nilai |
|---|---|
| Foreman (usernfc.roles LIKE '%FOREMAN%') | **7 orang**: AHMAT(20129), ARIF EFENDI(21115), BABA RIZAL(42794), HADHI KUSUMA(22192), LUKMAN FAOZI(15869), SARI GUNAWAN(18495), YANA SURYANA(20627) |
| TAKBIR HARIYADI | **ADA** di usernfc (snssb **20626**) tapi roles KOSONG (bukan FOREMAN) |
| AAN BAGUS KURNIAWAN | ADA (snssb 19473, roles kosong — operator) |
| Web auth roles | `users` table (username, name, role/roles). TAKBIR **tidak punya akun web** |
| RBAC FE | roles: administrator/supervisor/foreman/warehouse/user; `roster_operator` FULL_ACCESS utk supervisor & foreman (roster page sudah kebuka utk mereka) |
| Volume data | Sep 2026 = 1.001 baris (baru 14–18 Sep di-generate); sebulan penuh ±2.000 baris → SATU fetch OK |
| Struktur roster | 1 operator = 1 baris/tanggal (PK serialnumber+business_date); status, half_day, eff_std (view) |

## 3. Desain yang diusulkan

### 3a. Heatmap bulanan (`EwsRosterPage` redesign)

- **Filter**: `input type="month"` (bulan + tahun) — ganti date picker. Navigasi ‹ › bulan.
- **Layout heatmap**: operator = BARIS (sticky kolom pertama), tanggal = KOLOM
  (sticky header). 91 operator × 31 kolom, sel ~22-26px, horizontal scroll di layar kecil.
- **Warna sel** (perlu keputusan — opsi 2):
  - **Opsi A (intensitas jam)**: warna = rasio recorded/required (adoption):
    kosong(abu) / <50%(merah muda) / 50-99%(kuning) / ≥100%(hijau). Status
    excused (OFF/LEAVE/SICK/PERMIT) = warna status tersendiri (biru/ungu/indigo).
  - **Opsi B (warna status saja)**: PRESENT=hijau, ABSENT=merah, IN_PROGRESS=kuning,
    excused=biru/ungu, OFF=abu — seperti badge sekarang, tanpa intensitas.
- **Shift**: strip kecil DAY (amber) / NIGHT (indigo) di pojok sel / border.
- **Half-day**: tanda `½` kecil di sel.
- **Klik sel** → panel samping (kanan): detail operator+tanggal, dropdown status,
  toggle half-day, shift, jam recorded/required.
- **Bulk select**: klik = select satu; **drag (geser) = select range** (pola
  Google Calendar); toolbar "N selected" → apply status ATAU half-day ke semua
  selected → endpoint bulk baru.
- **Scope**: toggle "My team / All operators". Foreman default My team.
- Backend baru: `GET /ews/roster/month?month=YYYY-MM&scope=team|all` (semua baris
  sebulan + recorded hours + attendance), `PUT /ews/roster/bulk` (daftar
  serialnumber × daftar tanggal → status/half_day), `GET /ews/roster/team`
  (anggota foreman utk scope).

### 3b. Kelola bawahan foreman (`EwsForemanTeamPage` baru)

- **Route**: `/ews/foreman-team` (menu hub EWS), feature RBAC baru `roster_foreman_team`.
- **Sumber foreman**: usernfc roles FOREMAN (7 orang) — **TAKBIR perlu ditambah
  role FOREMAN di usernfc** (data change, konfirmasi user).
- **Tabel baru**: `ews.foreman_team`:
  `foreman_serialnumber text, member_serialnumber text UNIQUE, created_by, created_at`
  → 1 operator = 1 foreman; pindah = REPLACE (move). UNIQUE(member_serialnumber)
  mencegah 2 foreman punya operator sama.
- **UI**: 2 panel — kiri daftar foreman (card + count), kanan daftar SEMUA NFC
  user (searchable, drag & drop ke card foreman; drag keluar = hapus dari tim;
  reassign langsung pindah).
- **Scope akses** (perlu keputusan): admin/supervisor = kelola SEMUA foreman;
  **foreman = kelola timnya sendiri saja** (lihat + tambah/hapus anggotanya).
- **Scoping roster**: foreman login → backend perlu tahu snssb foreman tsb.
  Solusi: `ALTER TABLE users ADD COLUMN snssb` — akun web TAKBIR dibuat dengan
  snssb=20626; `GET /ews/roster/month&scope=team` baca `x-user-name` → users.snssb
  → filter member foreman_team. **Akun web TAKBIR perlu dibuat** (via manage
  users / seed) — konfirmasi.

## 4. Titik keputusan (konfirmasi 1a/2a/3a...)

1. **Warna heatmap**: A (intensitas jam/adoption) atau B (warna status saja)?
2. **Foreman identity**: pakai usernfc roles FOREMAN (7 orang) + TAKBIR HARIYADI
   (20626) ditambah role FOREMAN? Atau daftar foreman bebas pilih dari semua NFC user?
3. **Akun web foreman**: buat user TAKBIR (role foreman, snssb 20626) biar bisa
   login & lihat timnya — oke? (manage_users)
4. **Akses foreman-team**: foreman kelola timnya sendiri saja (admin/supervisor
   semua) — oke?
5. **1 operator = 1 foreman** (pindah = move) — oke?
6. **Bulk select**: drag-select + apply status/half-day — oke? (plus tombol
   "Clear selection" & "Select all team")
7. **Scope toggle**: default My team utk foreman, All utk admin/supervisor — oke?

## 5. File yang kena (perkiraan)

- Backend: `ewsRosterController.js` (+month, +bulk, +team), `routes/ews.js`,
  `rbac/manifest.js` (+roster_foreman_team), migration `20260825_ews_foreman_team.sql`
  (+users.snssb)
- FE: `EwsRosterPage.jsx` (redesign heatmap), `EwsForemanTeamPage.jsx` (baru),
  `router/index.jsx`, `rbac/featureRegistry.js`, `rbac/permissionMatrix.js`,
  `config/hubSidebarItems.js`
- Deploy: migration dual-DB (BPN+CKP), build api+frontend

## 6. Urutan kerja

1. Konfirmasi keputusan → 2. Migration + backend (month/bulk/team) → 3. FE heatmap
   → 4. FE foreman-team → 5. Data setup (TAKBIR role + akun web) → 6. Verifikasi
   live → 7. Port SSB + commit.
