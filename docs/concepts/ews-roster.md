---
type: concept
tags: [ews, roster, adoption-labour, shift, domain/ews]
updated: 2026-07-22
---

# EWS Roster: rotasi 2-kru, materialisasi beku, dan cara `adoption_labour` memakainya

Roster EWS menjawab satu pertanyaan: **siapa dijadwalkan shift apa pada tanggal berapa** —
denominator untuk `adoption_labour` (operator terjadwal vs yang benar-benar input timesheet).
Logika inti: `apps/api/services/rosterGenerator.js`.

## Model data (5 tabel `ews.*`)

| Tabel | Peran | PK / kunci |
|---|---|---|
| `operator_shift` | Definisi shift: DAY 08–17 (8h), NIGHT 20–04 (7h, lintas tengah malam) | `shift_code` |
| `roster_workday_rule` | Per hari (dow 0–6): `runs_day`, `runs_night` | **PK `day_of_week`** — unik, tak ada duplikat (JOIN generate tak menggandakan) |
| `rotation_config` | Mesin rotasi: `anchor_week_start`, `anchor_group_a_shift`, `rotation_period_weeks`, `week_start_dow` | 1 baris aktif; **tak ada `valid_until`/`effective_to`** |
| `operator_rotation_group` | Operator → kru A/B | `serialnumber` (`DO UPDATE`, **tanpa histori**) |
| `shift_roster` | Output ter-materialize: (serialnumber, business_date) → `scheduled_shift`, `scheduled_standard_hours`, `status`, `source` | **PK (serialnumber, business_date)** |

> Di ATAS lima tabel ini ada **lapisan override saat baca** — shift-lock (`ews.operator_shift_lock`)
> dan operator nonaktif (`usernfc.inactive_from`), keduanya diterapkan oleh VIEW
> `ews.roster_effective`. Tabel dasar tak pernah dimutasi oleh override.
> Detail lengkap: [[concepts/ews-roster-override]].

## Cara rotasi (`GENERATE_SQL`)

Dua kru (A/B) **selalu shift berlawanan**, bertukar DAY↔NIGHT tiap `rotation_period_weeks` di
batas minggu. `parity = (minggu_sejak_anchor / period) % 2`; parity 0 = A pada
`anchor_group_a_shift`, parity 1 = tertukar. Baris hanya lahir untuk hari yang diizinkan
`workday_rule` (DAY butuh `runs_day`, NIGHT butuh `runs_night`) — inilah sebab weekend
menghasilkan 0 baris, bukan bug.

**Config live (2026-07-20):** anchor 2026-06-28 (Minggu), A=DAY, **period=1 (flip mingguan)**,
minggu mulai Minggu. Mon–Fri ON; Sabtu & Minggu OFF. Kru A=46, B=45. Contoh: minggu 19-Jul
(parity 3%2=1) → A=NIGHT, B=DAY.

**Sifat penting:**
- Kedua kru bekerja **setiap hari kerja** (satu DAY, satu NIGHT); istirahat hanya akhir pekan.
- Model **hardcode 2 kru + 2 shift** (DAY/NIGHT) — tak ada kru ke-3 / pola rolling day-off.
- Cuti individu **tidak** di sini — via update `status` manual (LEAVE/SICK/PERMIT/OFF) di baris.

## Materialisasi: forward-only & BEKU

`INSERT … ON CONFLICT (serialnumber, business_date) DO NOTHING`. Job `ews-roster-job` (compose,
`restart: unless-stopped`, interval 24h) mengisi maju `EWS_ROSTER_FORWARD_DAYS=14`. **Tak pernah
menimpa baris yang sudah ada** (termasuk edit manual foreman). `scheduled_shift` jadi **fakta
historis beku** — diturunkan dari `rotation_group` **saat generate**, bukan dibaca ulang dari
grup live. (Horizon yang tampak "mentok" di Jumat itu normal: frontier +14 yang jatuh di
Sabtu/Minggu menghasilkan 0 baris; run dengan frontier hari-kerja menaikkannya lagi.)

## Cara `adoption_labour` memakainya

Dispatcher `calculateAdoptionLabour` (ewsCalculator.js): jika ADA baris roster untuk business_date
→ `calculateAdoptionLabourFromRoster` (attendance-based: started/present/absent, denominator =
Σ expected/std kru `SCHEDULED` yang shift-nya sudah mulai; LEAVE/SICK/PERMIT/OFF dikecualikan).
Jika **tak ada** baris → fallback `calculateAdoptionLabourFromLogs` (timesheet-only, operator
tak-log tak terlihat).

Sejak 2026-07-20 ketiga pembaca (denominator adoption, `getRoster`, dispatcher `EXISTS`) membaca
**`ews.roster_effective`**, bukan `shift_roster` langsung — jadi shift terkunci dan operator
nonaktif otomatis ikut terhitung/terbuang. `eff_shift`/`eff_std` di-alias ke nama lama
(`scheduled_shift`/`scheduled_standard_hours`) supaya bentuk response API tak berubah.

## Jebakan yang sudah terbukti

1. 🔒 **JANGAN hapus-lalu-regenerate `shift_roster` historis.** Integritas anti-misatribusi grup
   HANYA berlaku karena roster beku. Hapus baris lama → regenerate memakai `rotation_group`
   SEKARANG → shift historis salah-atribusi ke grup yang salah. **Regenerate hanya tanggal ≥ hari ini.**
2. **`adoption_labour` mengunci ke KEBERADAAN baris roster, bukan `workday_rule` live** (roster
   CTE tak join `workday_rule`). Ubah aturan hari kerja **tidak retroaktif** — baris lama bertahan
   dan tetap dihitung. Terukur: Sabtu di-OFF-kan 14-Jul, tapi baris stale half-day tetap dinilai.
   Koreksi rule-compliant = set `status='OFF'` di baris itu, BUKAN hapus+regenerate (lihat #1).
   **SUDAH DIEKSEKUSI 2026-07-22:** 91 baris Sabtu ≥14-Jul (07-18=46, 07-25=45) di-flip
   `SCHEDULED→OFF` (`source='manual'`, `updated_by='ews-roster-cleanup'`); snapshot beku 07-18
   ikut dikoreksi (`adoption_labour` 45,1 → `no_data`). Cutoff 14-Jul WAJIB: Sabtu sebelum itu
   (mis. 07-11) memang hari kerja setengah hari — `roster_workday_rule` boolean timeless akan
   salah menandainya. Prosedur & tooling: [[concepts/ews-roster-override]] §6-§7.
3. **Fallback ke logs diam-diam longgar:** tanggal tanpa roster → pindah ke timesheet-only tanpa
   error → operator absen tak terlihat → angka naik palsu. Sah HANYA untuk tanggal pra-roster
   (< 29-Jun) & hari libur; untuk hari kerja-dalam-cakupan yang kosong seharusnya state eksplisit
   `roster_missing`.
4. **TZ satu global `Asia/Makassar`** (`config/timezone.js`, tanpa hook per-plant). Substrat mesin
   EWS punya **4 plantid** — jika lintas WIB/WIT, batas business_date (rollover 07:00) & penutupan
   shift NIGHT (04:00) geser (bug laten sekelas machine-hours). Perlu konfirmasi peta plantid→geografi
   + apakah 91 operator lintas-plant.

## Permukaan konfigurasi (UI vs DB)

UI `/ews/roster/config`: toggle `workday_rule`, assign grup A/B, trigger generate, **shift-lock**
(kunci DAY/NIGHT N minggu) + preview komposisi 7 hari. **Anchor, period rotasi, dan jam shift =
read-only di UI, hanya via SQL** — begitu juga `usernfc.inactive_from` (penyetelnya belum dibuat).
Foreman tak bisa memperbaiki pola rotasi tanpa developer — risiko operasional.

**Terhubung:** [[concepts/ews-roster-override]] · [[concepts/payroll-data-path]] · [[PLANNING]] · `apps/api/services/rosterGenerator.js` · `apps/api/services/ewsCalculator.js` (dispatcher :996, roster path :678, fallback :553)
