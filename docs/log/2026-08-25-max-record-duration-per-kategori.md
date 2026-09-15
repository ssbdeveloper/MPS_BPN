---
title: "Max Record Duration per Kategori (VA/NNVA/NVA) di SAP Staging"
date: 2026-08-25
tags: [sap-staging, config-rules, mch, timesheet, va, nnva, nva]
---

# Max Record Duration per Kategori (VA/NNVA/NVA)

Keputusan user (konfirmasi 1a-4a): `max_record_minutes` di Configuration Rules
dipecah jadi 3 rules per kategori record — **VA**, **NNVA**, **NVA** — berlaku
untuk bundle SAP dari **kedua** sumber (`mch_transaction` dan
`timesheet_transaction`).

## Klasifikasi kategori (verified live BPN 2026-08-25)

| Kategori | MCH (`status_activitytype`) | TIMESHEET (`activitytype`) |
|---|---|---|
| VA (produktif) | `M1` | kosong (kerja order) |
| NNVA (produktif) | `M2` (termasuk idle pendek yang dipromosikan: statusid 2 + prev 1 + ≤300 dtk) | — tidak ada (timesheet tidak punya NNVA) |
| NVA (unproduktif) | kode numerik (1520 Coffee, 1670 Idle, 1590 Wait Handling, dst) | kode numerik 1510–1680 (semua `is_unproductive=True` di `ews.activity_type_ref`) |

Tidak ada NNVA di timesheet: semua activitytype non-kosong di timesheet = NVA
(`ews.activity_type_ref` menandai 17 kode 1510–1680 semuanya unproductive).

## Struktur rules (plant_config.sap_rules JSONB)

```json
{
  "break_windows": [ { "start": "12:00", "end": "13:00", "days": [1,2,3,4,5,6,0] }, ... ],
  "max_record_minutes": { "va": 90, "nnva": 90, "nva": 90 }
}
```

- Angka lama (`max_record_minutes: 90`) tetap diterima → dipetakan sama ke
  ketiga kategori (backward compatible, tidak perlu reset DB).
- Default semua = 90 menit.

## File yang diubah

- `apps/api/controllers/configRulesController.js` — `normalizeMaxRecordMinutes`
  (object per kategori ATAU legacy angka), DEFAULT_RULES jadi object.
- `apps/web/src/pages/ConfigurationRulesPage.jsx` — state `maxRules`, UI kartu
  Max Record Duration: grup **Productive** (VA + NNVA) dan **Unproductive**
  (NVA), tiap baris input menit; `normalizeMaxRecord` untuk load.
- `jobs/sap_staging/sap_staging_common.py` — `normalize_max_record_minutes`
  + `MAX_RECORD_CATEGORIES`/`MAX_RECORD_DEFAULT_MINUTES`; load_sap_rules dan
  load_sap_rules_default mengembalikan object.
- `jobs/sap_staging/stage_sap_timesheet.py` — cap per kategori di CTE
  `source_rows`: `CASE status_activitytype M1 → va, M2 ATAU idle-promotable →
  nnva, else nva`, `LEAST(end_effective, start + cap_kategori)`; 3 param baru.
- `jobs/sap_staging/stage_timesheet_transaction.py` — cap per kategori di CTE
  `effective`: `CASE activitytype kosong → va, else nva` (2 param baru).

## Verifikasi (semua pass)

- `python -m py_compile` 3 file Python; `node --check` controller; eslint 0.
- Unit test controller 4/4: legacy angka → 3 kategori sama; object per key;
  nilai invalid → default 90; missing → default 90.
- `npm run build` (vite) sukses.
- Dry-run lawan BPN: MCH 2026-08-24 → 321 bundle; TIMESHEET → 603 rows.
- Simulasi cap beda (VA=60, NNVA=45, NVA=30) di data BPN ≥ 2026-08-20:
  - MCH: va max 134.783s → 3.600s; nnva 8.096s → 2.700s; nva 6.676s → 1.800s.
  - TIMESHEET: va 20.397s → 3.600s; nva 87.180s → 1.800s; nnva 0 baris (sesuai
    realita data).

## Catatan

- Tidak ada migrasi DB baru: nilai legacy di `plant_config.sap_rules`
  (angka 90) dinormalisasi otomatis oleh controller & load_sap_rules. Save
  berikutnya dari halaman /config-rules menyimpan format object.
- Deploy: restart container worker sap-stage (mount jobs/sap_staging) + deploy
  apps/api + apps/web.
