---
type: log
date: 2026-07-14
tags: [manufacturing, variant, prd, timesheet]
---

# 2026-07-14 — PRD varian manufacturing (scan 3 lapisan → dokumen)

## Yang dikerjakan

Scan menyeluruh `apps/web`, `apps/api`, `jobs/` + dokumen tercatat untuk memetakan perbedaan
salvaging vs manufacturing, lalu menulis [[prd/manufacturing-variant]] (status: draft) —
PRD pertama di folder `prd/` (baris placeholder di [[00-INDEX]] diganti tabel).

## Temuan kunci (yang mengubah pemahaman)

1. **Manufacturing bukan greenfield** — Select Job + PPC scheduling manufacturing sudah
   fungsional (UAT: [[timesheet/MANUFACTURING_VERSION_UAT]]); yang placeholder adalah
   Main Menu (Check In hanya toast). Seluruh core flow lain masih single-version salvaging
   yang dipakai kedua varian.
2. **Backend & jobs sama sekali tidak variant-aware** — pembeda riil adalah env
   (`PLANT_SSB`, `TGT_TABLE`) + aturan bisnis hard-coded: `ZCONF_TYPE` (`32*`→RW, `*OT`→OV)
   di 3 tempat (API `postToSap` + 2 skrip staging), M1/M2, PERNR outsource, 4 literal
   `ph3_order` di controller.
3. **`serialnumber` = badge karyawan (→PERNR), bukan serial unit** — tidak ada field
   serial-unit di payload SAP.
4. **`qh3_order` = QA/inspection (~85 baris), bukan tabel manufacturing**; satu-satunya feed
   master order adalah Lambda → `ph3_order`.
5. Risiko terbesar varian manufacturing: **sumber jam standar insentif** — jalur payroll
   berdiri di `sow.planhours`/`sow_standard`, task manufacturing datang dari `ms_project_task`
   (belum ada padanan → keputusan D5 di PRD).

## Pending (user)

- Jawab keputusan terbuka PRD §7 (D1–D11) supaya status bisa naik ke `approved`.
  Paling blocking: D2 (plant/WERKS), D3 (ZCONF_TYPE), D5 (jam standar insentif).

## Konsep tersentuh

Tidak ada konsep yang berubah — PRD merujuk [[concepts/payroll-data-path]],
[[concepts/sap-staging-identity]], [[concepts/order-no-spine]] tanpa mengubah isinya.
