---
tags: [decision-log]
date: 2026-07-12
topic: EWS Phase 6 drill-through — selesai 6/6 kategori
---

# 2026-07-12 — EWS Phase 6: drill-through issue → culprit records

## Dikerjakan
- `services/ewsIssueDrill.js` (registry builder per kategori) + `GET /ews/issue/:issueKey/records`
- Halaman `/ews/issue/:issueKey` (`EwsIssueDrillPage.jsx`) + tombol 🔍 per row Issue Log
- 6 builder, SEMUA diuji rekonsiliasi terhadap issue nyata di prod:
  accuracy_labour (6=6, 3=3) · accuracy_machine (24=24, 175=175 + pagination) ·
  adoption_labour (4.81≈4.79) · adoption_machine (34.5≈34.3) · oee (7.18≈7.19) ·
  ole (2.22=2.22 persis)

## Keputusan & pelajaran
1. **Window tidak disimpan di issue_log** — derive dari business_date (rumus getBizBounds;
   window mulai 00:00, EWS_DAY_START_HOUR hanya memilih tanggal). Tanpa migration.
2. **Uji rekonsiliasi menangkap bug nyata**: drill adoption_labour v1 hanya menjumlah
   timesheet (1.89) vs recorded 4.79 — selisih = kredit jam mesin
   (`applyMachineHoursToAdoptionLabour`). Final: tabel dua-sumber TIMESHEET + MESIN(kredit)
   dengan interval-merge overlap persis kalkulator. *Aturan "predikat wajib reuse kalkulasi"
   terbukti bukan formalitas.*
3. adoption_labour TIDAK memakai bounds generik — scan [bd, bd+2) + derivasi business_date
   per baris (ekor shift malam). Cutoff logs literal 07:00 vs mesin EWS_DAY_START_HOUR —
   diikuti apa adanya (drill mencerminkan kalkulasi, tidak mengoreksi diam-diam).
4. Prefilter sargable di CTE mesin: 5.1s → 1.5s (idx_mch_transaction_sap_window).
5. uptime_* sengaja tanpa drill (menunggu KPI hidup) — halaman menampilkan empty-state anggun.

## Deploy note
Rebuild `api` + `frontend` saat deploy berikutnya. Tidak ada migration baru.

## Berikutnya
[[EWS_PLAN]] §7.2 uptime_tablet (tunggu armada) · §7.3 IL-last retire action_table
(sekarang drill sudah terbukti — prasyaratnya terpenuhi).
