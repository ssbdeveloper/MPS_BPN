---
title: Filter "minggu ini + belum selesai" untuk pool order reservasi bay
date: 2026-08-05
tags: [domain/msproject, domain/bay-scheduling, feature]
---

# Filter pool order: jatuh tempo ≤ akhir minggu ini + semua yang belum selesai

Saat user mau **reservasi order ke area layout** (OrderPanel → tab *To schedule*), pool
sekarang hanya menampilkan order yang **harus dikerjakan paling lambat akhir minggu ini**
(termasuk yang jadwalnya sudah lewat / overdue, **tanpa batas bawah**). Order yang jadwal
task-nya masih mulai minggu depan ke atas tidak muncul lagi.

## Konteks & keputusan

Permintaan owner (5 Agu 2026): *"order yang harus dikerjakan minggu ini dan yang belum
selesai (tidak ada batas bawah)"* — sama dengan semangat filter timeline yang sempat
dibahas, tapi sasaran akhirnya **pool order**, bukan timeline.

Interpretasi yang dipakai:

- **"Belum selesai"** = status SAP `REL`/`LKD` di `ph3_order.order_description`
  (definisi `is_unfinished` yang sudah ada — TECO = selesai). Sinyal lain tidak tersedia:
  `actual_finish` di `ms_project_task` dan `sow` kosong 100% (realisasi tidak pernah
  di-sync dari MS Project).
- **"Harus dikerjakan minggu ini"** = ada ≥ 1 task aktif (non-summary, ber-`order_no`)
  dengan `coalesce(plan_finish, plan_start) ≤ akhir minggu ini`. Batas atas = Minggu
  minggu berjalan; **tanpa batas bawah** = task yang sudah lewat jadwalnya dari kapan
  pun tetap terhitung.
- Keputusan lama D6 ("in_window hanya mengannotasi, tidak memfilter") **tetap berlaku
  untuk `window_start`/`window_end`**; param baru `due_by` adalah filter sungguhan yang
  terpisah.

## Data grounding (DB Cikupa 100.80.101.53, plant 5100)

| Ukuran | Nilai |
|---|---|
| Task aktif non-summary | 1.975 (1.123 ber-`order_no`, 852 tidak) |
| Task jatuh tempo minggu ini (03–09 Agu) | 47 (30 ber-`order_no`) |
| Order dengan task MSP aktif | 16 |
| Order unfinished (REL/LKD) dengan task | 9 |
| **Order unfinished dengan task ≤ akhir minggu** | **3** |

3 order yang tersisa: `1000128374` (8 task minggu ini + 66 overdue), `1000128544`
(82 overdue), `1000130697` (1 overdue). 6 order REL lainnya baru mulai minggu depan
(10 Agu ke atas) → keluar dari pool. Tabel `sow` di CKP kosong semua kolom
tanggalnya → sumber jadwal definitif `ms_project_task`.

## Implementasi

### Backend — `apps/api/services/msProjectService.js` (`listSowOrders`)

- Param opsional baru **`due_by`** (YYYY-MM-DD, divalidasi `normalizeDateOnly`, 400
  `INVALID_DATE` kalau salah format). Tanpa param → perilaku identik dengan lama.
- CTE `msp` (materialized) mendapat kolom `due_by_tasks`:
  `bool_or(coalesce(t.plan_finish, t.plan_start)::date <= $N::date)`.
- HAVING baru (hanya saat `due_by` dikirim): `exists (select 1 from msp where
  msp.order_key = ltrim(s.order_no,'0') and msp.due_by_tasks)`.
- Kolom `due_by` (boolean) diekspos di baris, pola sama seperti `in_window`.

### Frontend

- `apps/web/src/features/bayScheduling/constants.js` — helper baru `weekEndText(dateText)`
  (Minggu minggu berjalan, aritmetika UTC-safe seperti `addDaysText`).
- `apps/web/src/features/bayScheduling/useSowOrders.js` — tab `perlu` (To schedule,
  default) selalu mengirim `due_by = weekEndText()`. Filter bergeser otomatis tiap
  minggu. Tab lain (No MSP task / Scheduled / Completed) tidak berubah. Tanpa perubahan UI.

## Verifikasi

- `node --check` backend: OK. ESLint FE (constants.js, useSowOrders.js): 0 error.
- Test langsung `listSowOrders` terhadap DB CKP via tunnel:
  - `due_by=2026-08-09&completion=unfinished&exclude_unknown=true` → **total 3**
    (1000130697, 1000128374, 1000128544) — persis prediksi data.
  - Tanpa `due_by` → 115 (perilaku lama utuh; `has_msp_task` tetap di-filter FE).
  - Tanpa param → 148 (jalur MapSapOperationPage tidak terpengaruh).
  - `due_by=garbage` → 400 `INVALID_DATE`.
- `weekEndText`: 6 kasus pass (Rabu→Minggu, Senin→Minggu, Minggu→dirinya, Sabtu→Minggu,
  lintas minggu, lintas tahun 2026-12-31→2027-01-03).
- `vite build` FE: OK (lihat hasil akhir di log sesi).

## Catatan

- Order dengan task tapi **tanpa tanggal plan** (mis. `1000127752`, 294 task) tidak
  masuk filter `due_by` — status jadwalnya memang tidak diketahui. Masih bisa dicari
  lewat tab lain / pencarian.
- `actual_finish` task kosong semua: kalau nanti MS Project mulai mengirim realisasi,
  sinyal "belum selesai" bisa dipertegas di tingkat task.
