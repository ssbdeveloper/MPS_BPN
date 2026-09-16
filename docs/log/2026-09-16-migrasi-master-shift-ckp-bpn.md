---
title: "Migrasi master shift tunggal: CKP selesai, BPN ditahan karena data master tidak konsisten"
date: 2026-09-16
tags: [ews, roster, shift-definition, migration, ckp, bpn]
---

# Migrasi master shift tunggal (20260916 + 20260916b)

Konteks: keputusan user **1b, 2a, 3a** — `public.shift_definition` jadi satu master untuk
roster, heatmap, dan adoption; standard hours diedit dari EWS Roster Config; halaman heatmap
dipecah jadi komponen. Kode sudah di-commit (`f278c9b`, `4892e3a`).

## CKP — SELESAI

Akses: `100.80.101.53:5433` (tunnel lama `127.0.0.1:5441`). Backup pra-perubahan:
`apps/api/_backup_CKP_2026-09-16T02-36-43-874Z.json` (definisi view lama + isi
`shift_definition` + daftar kolom `shift_roster`).

Cara jalan: migration A lalu B dalam SATU transaksi, langsung disusul entri ledger
`public.schema_migrations`, verifikasi di dalam transaksi, baru COMMIT.

Hasil verifikasi sesudah commit:

- ledger: `20260916_ews_roster_shift_hours_overrides.sql`, `20260916b_shift_definition_single_master.sql`;
- mapping: SHIFT-1 → DAY (8h), SHIFT-2 → NIGHT (7h), tanpa kunci ganda;
- resolusi hari ini: DAY 07:25–16:30 8h; NIGHT 16:30–00:30 7h (lewat tengah malam);
- `getConfig` → 2 shift + 2 override tanggal + 151 operator; `getRoster` hari ini 139 baris;
  `getRosterMonth` September 2.708 baris (87 ms);
- `getShiftImpact` → 1.763 baris future, 0 berbeda (snapshot sudah sama dengan master);
- `ews.operator_shift` TIDAK disentuh (masih 08:00–17:00 / 20:00–04:00) sehingga kode lama
  yang masih ter-deploy tetap jalan; perubahan perilaku baru terjadi setelah kode di-deploy.

## BPN — DITAHAN (data master tidak konsisten)

Akses: `100.86.231.55:5433` (sama dengan tunnel `127.0.0.1:5434` dari `.env.production`;
ledger 85, roster 6.279 baris). **Belum ada perubahan apa pun di BPN.**

Master `shift_definition` BPN:

| id | shift | jam | kapasitas | tanggal |
|---|---|---|---|---|
| 1 | SHIFT-1 | 07:00–16:00 | 8h | base (diubah 2026-07-07 10:09) |
| 3 | SHIFT-1 | 07:00–10:00 | 3h | 2026-05-14 |
| 5 | SHIFT-1 | 08:00–17:00 | 8h | 2026-07-07 |
| 2 | SHIFT-2 | 16:00–23:00 | 7h | base (diubah 2026-07-07 10:09) |
| 4 | SHIFT-2 | 20:00–23:00 | 3h | 2026-05-14 |
| 6 | SHIFT-2 | 20:00–04:00 | 8h, `crosses_midnight = false` | 2026-07-07 |

Masalahnya: aturan resolusi yang dipakai bersama (dan sudah dipakai Scheduling) menganggap
baris ber-`effective_date` hanya berlaku **pada tanggal itu sendiri**. Jadi untuk 2026-09-16
BPN akan resolve ke baris base: **DAY 07:00–16:00 dan NIGHT 16:00–23:00 (tidak lewat tengah
malam)** — padahal:

- `ews.operator_shift` BPN: DAY 08:00–17:00 (8h), NIGHT 20:00–04:00 (7h);
- snapshot roster BPN: DAY 8h (3.232 baris), NIGHT 7h (3.047 baris);
- baris 2026-07-07 justru kembar dengan `operator_shift` → kuat dugaan itu **versi baru
  mulai 7 Juli**, bukan jadwal sehari.

Kalau migrasi dijalankan apa adanya di BPN, roster/heatmap/adoption BPN akan memakai jam yang
salah (night berakhir 23:00, tidak pernah lewat tengah malam) untuk 6.279 baris + 910 baris
future, dan `public.sow_schedule` (142 baris) juga membaca master yang sama.

## BPN — SELESAI (keputusan 1d lalu 1a)

Akses: `100.86.231.55:5433` (DB yang sama dengan tunnel `127.0.0.1:5434` di `.env.production`;
ledger sebelum 85, roster 6.279 baris). Backup pra-perubahan:
`backups/migrations-2026-09-16/_backup_BPN_2026-09-16T02-40-48-892Z.json`.

Urutan dalam SATU transaksi: perbaikan data (1d + 1a) → migrasi A → migrasi B → entri ledger →
verifikasi → COMMIT.

**1d — perbaikan baris yang jelas salah.** `SHIFT-2 @2026-07-07` jamnya 20:00–04:00 tetapi
`crosses_midnight = false` → diubah jadi `true` (1 baris). Guard: kalau bukan tepat 1 baris,
transaksi dibatalkan.

**1a — baris base disamakan dengan realitas operasional BPN.** `id=1 SHIFT-1` 07:00–16:00 →
**08:00–17:00** (8h) dan `id=2 SHIFT-2` 16:00–23:00 → **20:00–04:00** (7h,
`crosses_midnight = true`). Guard parity: nilai base baru harus sama dengan `ews.operator_shift`
yang selama ini dipakai roster, kalau tidak transaksi dibatalkan. Hasil parity:

```
DAY   08:00-17:00  8h x=false   (base == operator_shift)
NIGHT 20:00-04:00  7h x=true    (base == operator_shift)
```

Hasil sesudah commit:

- mapping: SHIFT-1 → DAY, SHIFT-2 → NIGHT, tanpa kunci ganda;
- resolusi hari ini: DAY 08:00–17:00 8h; NIGHT 20:00–04:00 7h lewat tengah malam;
- `getConfig` → 2 shift, 4 baris override (2026-05-14 dan 2026-07-07), 231 operator;
- `getRoster`/`getRosterMonth` → hari ini 91 baris, September 1.911 baris;
- `getShiftImpact` → 910 baris future, **0 berbeda** → tidak perlu resync;
- snapshot roster tidak berubah: DAY 8h (3.232 baris), NIGHT 7h (3.047 baris);
- `public.sow_schedule` tetap menunjuk id 1 (76 baris) dan id 2 (39 baris) — id tidak berubah,
  hanya jamnya yang kini 08:00–17:00 / 20:00–04:00 (ini bagian dari 1a yang disetujui);
- `ews.operator_shift` TIDAK disentuh, sehingga kode lama yang masih ter-deploy tetap jalan.

Catatan kecil yang belum diubah: baris riwayat `SHIFT-2 @2026-07-07` masih berkapasitas 8h
(default_capacity_hours 8, standard_hours ikut terisi 8) padahal `operator_shift` night 7h.
Baris itu hanya berlaku pada 2026-07-07 (tanggal lampau). Kalau nanti board SOW perlu
merencanakan ulang tanggal itu, kapasitasnya sebaiknya disamakan ke 7h.

## Langkah berikutnya

Kode (`f278c9b`) belum di-deploy. Migrasi di kedua DB sudah aman dijalankan lebih dulu karena
tidak mengubah perilaku sampai kode baru terpasang (kode lama membaca `ews.operator_shift`).
Sisa: push + pull di kedua server, lalu build/restart `api` dan `web`.

