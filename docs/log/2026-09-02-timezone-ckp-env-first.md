---
title: "Timezone CKP: plant_config WITA → env-first (Asia/Jakarta)"
type: log
date: 2026-09-02
tags: [domain/ops, domain/timesheet, timezone]
---

# Timezone CKP — env-first + koreksi plant_config (2026-09-02)

Commit `7eecff8` (branch 2b). DB: UPDATE plant_config CKP.

## Masalah
Dua sumber kebenaran timezone CKP tidak sinkron:
- `plant_config` CKP (id=1): `Asia/Makassar` (salah — Cikupa = WIB). Ter-seed dari
  seed_plant_config.js yang membaca env TIMEZONE/default Makassar.
- `.env` server CKP: `TIMEZONE=Asia/Jakarta` (benar) — dipakai stager Python.

`resolveTimezone()` SEMULA plant_config-dulu → API CKP jalan WITA (batas hari + tampilan
geser +1 jam) sementara payload staging sudah WIB. Belum merusak data SAP, tapi kalau
stager di-unifikasi ke plant_config (niat PLANT_CONFIG_VARIANT_DESIGN.md), seluruh payload
CKP bergeser +1 jam tanpa suara.

## Perbaikan
1. `apps/api/config/timezone.js`: prioritas dibalik → **env `TIMEZONE` dulu →
   plant_config (fallback) → default**. Env-first = fleksibel per deployment; plant_config
   yang salah/stale tidak lagi meng-override .env diam-diam.
2. `apps/api/config/plantConfig.js`: komentar revisi (kolom timezone tetap di-seed benar
   untuk fallback + konsumen DB).
3. DB CKP: `UPDATE plant_config SET timezone='Asia/Jakarta' WHERE id=1`
   (updated_by='fix-tz-env-first'). Dependensi dicek: FE tidak pakai timezone; query API
   via resolveTimezone; nilai lama memang salah → tidak ada laporan benar yang bergantung.
4. Design doc PLANT_CONFIG_VARIANT_DESIGN.md diberi catatan revisi (berlaku untuk kolom
   timezone SAJA; identitas+varian tetap row-first).

## Deploy & verifikasi (BPN + CKP, api container)
- BPN: pull 7eecff8, build api → `resolve → Asia/Makassar` (tidak berubah — benar).
- CKP: pull 7eecff8, build api → `resolve → Asia/Jakarta` (WITA → WIB ✓).
- Container env TIMEZONE: BPN Asia/Makassar, CKP Asia/Jakarta (dari .env host via compose).
- Unit: plantConfig.test.js 4/4 lulus; verifikasi manual env-first + fallback OK.
- `sap-stage-ts-worker` TIDAK dinyalakan di CKP (service baru terdefinisi di compose hasil
  pull, tetapi tidak di-`up` — keputusan deploy worker CKP tetap menunggu owner).

## Catatan
- Pelajaran: seed_plant_config.js meng-seed timezone dari env caller — kalau seed CKP
  dijalankan tanpa `TIMEZONE=Asia/Jakarta`, barisnya salah lagi. Seed utk plant non-Makassar
  wajib set env TIMEZONE dulu.
