---
title: Operations Hub KPI cards — TECO/active/total orders, machine 1+2, validation today
date: 2026-08-19
tags: [operations-hub, dashboard, kpi, timesheet-validation, ph3-order]
---

# Operations Hub KPI cards — hitungan baru (keputusan user 1a 2b 3a 4a)

## Latar belakang (temuan DB BPN, tunnel 5434)

- `sow.systemstatus` di BPN TIDAK PERNAH berisi `TECO`/`CLSD` (isinya string gabungan
  SAP seperti `REL PCNF PRC CSER...` atau kosong — 2.926 order kosong) → filter lama
  `NOT IN ('TECO','CLSD')` tidak memfilter apa pun, **active_orders == total == 4.363**.
- Status SAP yang valid cuma di `ph3_order.order_description` (REL/PREL/TECO):
  total 3.674 order, aktif (tanpa baris TECO) 2.448, TECO 1.226 (56 order campur
  REL+TECO dihitung TECO). `active + teco = total` bersih.
- `processcontroldata` di BPN KOSONG (0 baris) → validation_pending lama selalu 0.
  Sumber validasi yang benar = `timesheet_transaction` (semantik sama dgn halaman
  TimesheetValidation: `validation_date IS NULL AND state_flag NOT IN ('3','5')`).
- `mch_statustypes`: statusid 1 = Productive, 2 = Idle. Keputusan user 2b:
  machine productive = **statusid IN (1,2)** (Productive + Idle).
- API dev connect ke BPN (`DB_PORT=5434` di `.env`), `TIMEZONE=Asia/Makassar`.

## Perubahan backend (`apps/api/controllers/dashboardController.js`, getOperationsHub)

- CTE `sow_kpi` → `ph3_kpi` (per-order `bool_or(order_description='TECO')`):
  `total_orders`/`active_orders` (NOT has_teco)/`teco_orders` (has_teco).
- `sow_avg` CTE kecil untuk `avg_progress` (tetap dari sow).
- `validation_kpi` → `timesheet_transaction` HARI INI
  (`(longdate_checkin AT TIME ZONE '${TZ}')::date = CURRENT_DATE`),
  pending = `validation_date IS NULL AND state_flag NOT IN ('3','5')`.
- machine_productive_pct + machine_trend (7 hari): `statusid = 1` → `statusid IN (1,2)`,
  support_loss = `NOT IN (1,2)`.
- Payload kpi: `overdue_orders` dihapus → `total_orders` + `teco_orders` ditambah.

## Perubahan FE (`apps/web/src/pages/OperationsHubPage.jsx`)

- `emptyHubData.kpi`: `overdue_orders` → `total_orders` + `teco_orders`.
- summaryCards: Active Orders (`2.448` + "of 3.674 total orders" + progress bar),
  TECO Orders (icon CheckCircle2, emerald, progress bar), Machine Productive
  (suffix %), Validation Pending ("of N records today" + progress bar).
- `StatCard` didesain ulang: gradient top bar accent, icon rounded-xl scale on hover,
  hover lift + shadow, progress bar (barPct, `hub-bar` transition), count-up animation
  via hook `useCountUp` (rAF ease-out cubic 900ms, hormati prefers-reduced-motion,
  aman StrictMode — setState hanya dalam callback rAF, bukan body effect).
- Teks "Avg progress ... overdue" → "... teco". Insight validation: "records hari ini".

## Hasil verifikasi live (controller langsung, BPN)

status 200: total_orders 3.674 · active 2.448 · teco 1.226 · avg_progress 1 ·
validation_pending 249 / total 343 (TZ Makassar) · machine_productive_pct 23.5
(machine_date 2026-08-19) · machine_trend 7 baris. ESLint 0 error, `npm run build` OK.

## Catatan

- Machine % berubah makna: status 1 saja → 21.0%, status 1+2 → 23.5% (hari ini).
- Cache endpoint 30 detik (OPERATIONS_HUB_TTL_MS) — angka tidak realtime penuh.
- `processcontroldata` tetap dipakai di tempat lain (ValidationRateChart?) — hanya
  KPI hub yang pindah ke timesheet_transaction.
