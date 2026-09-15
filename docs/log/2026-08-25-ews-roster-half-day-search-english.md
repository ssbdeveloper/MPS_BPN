---
title: "EWS Roster: Half-Day, Search, Full English UI, Config Full-Width"
date: 2026-08-25
tags: [ews, roster, half-day, attendance, adoption]
---

# EWS Roster: Half-Day + Search + UI Modern (2026-08-25)

Keputusan user: (1) mekanisme hitungan operator **masuk setengah hari** — hanya
dituntut setengah jam standar shift; (2) **search** di tabel roster; (3) UI roster
& config **full English**; (4) halaman config **full width + modern**.

## Half-day (mekanisme)

- Kolom `ews.shift_roster.half_day boolean NOT NULL DEFAULT false` (per
  serialnumber + business_date).
- `ews.roster_effective` di-recreate dengan `eff_std` dibagi dua saat half_day:
  `CASE WHEN COALESCE(r.half_day,false) THEN std/2.0 ELSE std END`.
  Karena denominator adoption EWS (ewsCalculator `calculateAdoptionLabourFromRoster`)
  membaca `r.eff_std` dari view ini, half-day otomatis berlaku ke KPI adoption
  tanpa ubah kalkulator. Satu sumber kebenaran.
- Endpoint baru `PUT /ews/roster/half-day` `{serialnumber, business_date, half_day}`
  (RBAC `roster_operator` W). `getRoster` kini mengembalikan `half_day`.
- Migration: `database/migrations/api/20260825_ews_roster_half_day.sql`
  (ALTER + DROP VIEW IF EXISTS + CREATE VIEW — CREATE OR REPLACE tidak bisa
  menambah kolom di tengah urutan view). **Sudah di-apply ke BPN 5434 & CKP 5441**
  dengan ledger.

## FE

- `EwsRosterPage.jsx`: search box (nama/serialnumber, client-side), toggle
  **Half day** per baris (switch amber), kolom Hours `recorded / required h`
  (required sudah ter-halve via view), badge `N half day` di header tabel,
  stat tiles + semua string English (Scheduled/Present/Absent/In Progress/
  Excused), layout modern (header sticky blur, border slate-300, card rounded-2xl).
- `EwsRosterConfigPage.jsx`: full width (hapus max-w-4xl), grid 2 kolom
  `xl:grid-cols-2` untuk kartu, kartu gaya SectionCard (icon accent + header
  slate-50/60), semua string English termasuk DOW (Sunday..Saturday), toasts,
  footnote.

## Verifikasi (BPN, live)

- Test end-to-end: eff_std 8 → toggle half_day ON → eff_std 4 (getRoster
  `scheduled_standard_hours=4`, `half_day=true`) → OFF → eff_std 8. ALL OK.
- eslint 0, build OK, RBAC manifest BERSIH.

## Commit

- Javanian `D:\website\MPS2` → `30bad31` (5 file; `/database` di-ignore, migration
  tidak ikut ter-commit di repo ini).
- SSB `D:\website\MPS\MPS2` → `9e125e3` (6 file, termasuk migration).

## Delete generated rows (2026-08-25, lanjutan)

- `DELETE /ews/roster` `{business_date, shift?, serialnumber?}` di
  ewsRosterController (forward-only: tanggal < hari ini → 400 "Past dates are
  frozen"; 1 operator max 1 baris/tanggal — PK serialnumber+business_date).
  Filter shift DAY/NIGHT utk hapus sebagian (kasus "Sabtu pagi batal").
- FE EwsRosterPage: tombol Delete (merah) di header, disabled utk tanggal lewat,
  modal konfirmasi "Delete roster rows" + pilihan shift (All/DAY/NIGHT), toast
  rows_deleted. RBAC `roster_operator` W + manifest BERSIH.
- Test live BPN: past date 400, hapus NIGHT saja → DAY tersisa, hapus semua → 0
  sisa. Commit: Javanian `4aab9d1`, SSB `0322256`.
