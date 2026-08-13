---
title: "Fix false-positive 'Unknown order' — pakai order_known dari backend"
date: 2026-08-13
tags: [bay-scheduling, D7, unknown-order, bugfix]
---

# Fix false-positive "Unknown order" (D7 follow-up)

## Masalah

Reservasi ORDER yang SAH tapi task-nya belum ber-`sow_id` (mis. order
1000128544, task area BLASTING/PRIMER/FINISH PAINTING, HANDLING, INSPECTION)
muncul dengan badge **"Unknown order"** padahal order ada di `ph3_order` (83
baris, REL) dan `sow` (83 baris, part_name 83/83 terisi).

## Akar masalah

- Backend `listBaySchedules` sudah mengirim kolom `order_known` (EXISTS check
  ke `sow`/`ph3_order` pakai `ltrim(order_no,'0')`, sejak commit da49833,
  ter-deploy di prod) — untuk 6 reservasi 1000128544 semua `True`.
- FE (ReservationDetailModal, BayAreaDetail, BayReservationTimeline) masih
  pakai heuristic LAMA: `isJob && order_no && !part_name && !customer`.
  `part_name`/`customer` di-resolve backend lewat
  `LEFT JOIN sow ON so.idsow = t.sow_id` — task area tidak punya sow_id →
  join kosong → part_name/customer NULL → salah-positif.
- **Root cause KEDUA (ketahuan saat verifikasi dev browser 2026-08-13)**:
  `dedupeByGroup` di constants.js membangun ulang entri reservasi dan HANYA
  menyalin field yang ada di `RESERVATION_FIELDS`. `order_known` (dan
  `is_subcont`) ditambahkan backend belakangan → tidak ada di daftar →
  KEBUANG saat dedupe → komponen menerima object tanpa `order_known` →
  `isUnknownOrder` jatuh ke heuristic lama → badge tetap muncul. Ini juga
  penyebab badge subcont (Fase 6/D4) tidak pernah tampil.

## Perbaikan

1. `apps/web/src/features/bayScheduling/constants.js` — konsolidasi
   `isUnknownOrder(schedule, knownOrderKeys)` (fungsi D7 Set-based lama yang
   dead-export digabung) dengan urutan sumber kebenaran:

   1. `order_known` dari backend (boolean) — paling akurat.
   2. Set `knownOrderKeys` dari pemanggil (desain D7 awal, untuk backend lama).
   3. Heuristic part_name/customer — fallback terakhir, hanya backend lama tanpa
      kedua sumber di atas.

2. `RESERVATION_FIELDS` + `order_known`, `is_subcont` (commit 797d839).

Tiga komponen di atas kini import dari constants.js (hapus fungsi lokal
duplikat). Signature lama `(schedule, knownOrderKeys)` dipertahankan — tidak
ada pemanggil yang rusak.

## Verifikasi

- DB live (CKP): 6 reservasi 1000128544 → `order_known=True`, part/customer
  NULL (bukti salah-positif heuristic lama).
- API prod `GET /ms-project/bay-schedules`: field `order_known` ada (sudah
  deploy), 1000128544 → `True`.
- Unit test `isUnknownOrder` (esbuild bundle + node): 8/8 PASS (order sah,
  yatim beneran, backend lama dgn/tanpa part_name, non-job, tanpa order_no,
  Set knownOrderKeys).
- Verifikasi dev browser (localhost:5173, backend lokal 3001): AREA-18
  (Blasting & Prime), map date 2026-08-13 — sebelum fix dedupe: 6+ badge
  "UNKNOWN ORDER"; sesudah: 0 badge, 6 reservasi 1000128544 tampil normal.
- `npx eslint` 4 file + `npm run build` (vite) lolos.

## File

- `apps/web/src/features/bayScheduling/constants.js`
- `apps/web/src/features/bayScheduling/ReservationDetailModal.jsx`
- `apps/web/src/features/bayScheduling/BayAreaDetail.jsx`
- `apps/web/src/pages/PPC/manufacturing/BayReservationTimeline.jsx`
