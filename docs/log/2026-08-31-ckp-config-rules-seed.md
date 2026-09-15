title: CKP config-rules kosong — seed katalog master + mirror max_record_minutes BPN
date: 2026-08-31
tags: [ckp, config-rules, mch-statustypes, activity-type-ref, plant-config]
---

# DB Cikupa (5100): config-rules kosong → di-seed + mirror BPN

Keluhan user: tab timesheet unprod max record duration di config-rules kosong
untuk DB CKP.

## Root cause (verified 2026-08-31)

- `ews.activity_type_ref` (katalog 17 kode unprod timesheet): BPN 17 baris,
  **CKP 0 baris**. Migration `20260704_create_ews_activity_type_ref.sql`
  TERCATAT di schema_migrations CKP (applied 2026-08-04) tapi seed-nya tidak
  pernah masuk — pitfall yang sama dengan roster CKP 2026-08-25: entri ledger
  ≠ data masuk.
- `mch_statustypes` (22 status mesin): BPN 22 baris, **CKP 0 baris** — tidak
  ada migration seed untuk tabel ini (hanya CREATE di legacy bpnschema.sql).
- `plant_config.sap_rules.max_record_minutes` CKP = `150` (angka legacy),
  BPN = `{va:300, nnva:150, nva:150}`.
- Karena katalog kosong, halaman config-rules tidak punya daftar jenis aktivitas
  → tab MCH & timesheet tampil kosong.

## Eksekusi (CKP 5441, commit eksplisit — keputusan user: mirror BPN)

1. Seed `ews.activity_type_ref` 17 kode (isi = migration resmi 20260704,
   ON CONFLICT DO UPDATE) → 17 baris.
2. Seed `mch_statustypes` 22 baris (sumber: BPN live, ON CONFLICT DO UPDATE)
   → 22 baris.
3. `UPDATE plant_config SET sap_rules = sap_rules || {"max_record_minutes":
   {va:300, nnva:150, nva:150}}` — **break_windows CKP (5 window) TIDAK
   disentuh** (beda jadwal dari BPN 4 window). updated_by `hermes-mirror-bpn`.

TIDAK menambah entri schema_migrations palsu (migrate.js bisa coba apply file
yang tidak ada → hindari; data fix dicatat di docs/log ini saja).

## Verifikasi

- CKP: mch_statustypes 22, activity_type_ref 17, plant_config 5100
  break_windows 5 (utuh) + max_record_minutes {va:300, nnva:150, nva:150}.
- Setelah ini halaman config-rules CKP menampilkan: MCH 22 statusid + Timesheet
  17 kode, semua terisi nilai ekspansi legacy (statusid 2/10 = 150 via
  STATUS_CATEGORY_OVERRIDES; productive 300; numerik 150). Per-jenis masih bisa
  disimpan manual via UI (keputusan 6a).
