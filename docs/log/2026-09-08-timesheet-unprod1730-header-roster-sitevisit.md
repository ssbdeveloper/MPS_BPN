# 2026-09-08 — Unprod 1730, Header Bay/Area di Select Job, SITE_VISIT di EWS Roster

## Ringkasan
Tiga permintaan kecil dari user (semua disetujui inline):
1. Tombol unproductive baru **1730 ADMINISTRATION REPORTING** di menu `/unproductive`.
2. Info **bay/area + workcenter** di header halaman Manufacturing Job Selection (`/select-job`)
   tampil PERMANEN (sebelumnya hanya saat panel Filter dibuka).
3. Status baru **SITE_VISIT** di EWS roster (perhitungan = excused, setara PERMIT).

## Keputusan owner
- 1a: sisipkan 1730 sebelum 1680 OTHERS (OTHERS tetap penutup). Icon: FileText.
- 2a: header `/select-job` manufacturing — chip Area (kode area + rentang bay,
  `AREA-08 · A6-A9`) di kiri; chip Workcenter (session operator) di kanan.
  Chip duplikat di dalam panel Filter dihapus.
- 3a: SITE_VISIT = excused (tidak dianggap absent / tidak kena issue adoption).

## Perubahan kode (branch 2b)
- `apps/web/src/pages/TIMESHEET/UnproductiveMenuPage.jsx` — entri 1730 + icon FileText.
- `apps/web/src/pages/TIMESHEET/manufacturing/SelectJobPage.jsx` — header 3 zona
  (Back+Area | title | Workcenter+gear+refresh), chip dua-baris label atas nilai bawah,
  tooltip; chip lama di filter dibuang (anti duplikat).
- `apps/web/src/pages/EwsRosterPage.jsx` — STATUS_OPTIONS/EXCUSED/EXCUSED_STYLE
  +SITE_VISIT (warna teal-200).
- `apps/web/src/pages/EwsDetailPage.jsx` — set excused AdoptionLabourBreakdown
  +SITE_VISIT (+ komentar).
- `apps/api/controllers/ewsRosterController.js` — VALID_STATUS +SITE_VISIT.
- `apps/api/services/ewsCalculator.js` — hitung stat excused +SITE_VISIT (+ komentar).
- `apps/api/services/ewsIssueGenerator.js` — EXCUSED_STATUSES +SITE_VISIT (+ komentar).

## Migrasi DB (20260908_ews_roster_site_visit.sql — applied CKP & BPN + ledger)
- `ALTER TABLE ews.shift_roster DROP/ADD CONSTRAINT shift_roster_status_check`
  nilai +`SITE_VISIT`. Nama constraint terverifikasi live di kedua plant sebelum ALTER.
- Uji positif: INSERT status SITE_VISIT diterima (rollback, tidak ada data tersentuh).

## Verifikasi
- `node --check` 3 file API: OK. ESLint 4 file FE: 0 error (1 warning lama,
  exhaustive-deps loadJobs di SelectJobPage — pra-ubah). `npm run build`: sukses.
- Constraint terverifikasi via pg_constraint di CKP (5441) & BPN (5434);
  schema_migrations tercatat 1 baris per plant.
