---
title: "Panel select tasks: info reservasi bay per task"
date: 2026-08-13
tags: [bay-scheduling, reservation-panel, task, UX]
---

# Panel select tasks — status reservasi bay per task

## Fitur

Di ReservationPanel (mode ORDER), tiap baris task di daftar "Select tasks"
kini menampilkan status reservasi bay:

- Task yang SUDAH punya reservasi (di area/bay mana pun, periode mana pun):
  `MapPin` hijau + `Area · bays · tanggal` (contoh: `Blasting & Prime ·
  PT1, PT2, PT3, BL1, BL2 · 27 Jul – 20 Aug`).
- Task yang BELUM: `MapPin` abu + `No area reservation`.
- Task dengan >2 reservasi: 2 baris pertama + `+N more reservations`.

Posisi: sejajar di bawah baris plan dates (kolom kiri yang sama), tidak
menambah scroll horizontal.

## Implementasi

- `ReservationPanelBody`: fetch `fetchBaySchedules({ order_no, limit: 5000 })`
  (SEMUA tanggal, bukan window peta) → map `task_id -> rows[]` di state
  `taskReservations`. Gagal fetch = diam (info opsional).
- `TaskRow` terima prop `reservations` (fallback `EMPTY_TASK_RESERVATIONS`
  agar referensi stabil & memo efektif).
- Helper lokal `reservationLabel(row)`: `area · bays · tglAwal – tglAkhir`.

## Catatan

- Mapping per `task_id` (reservasi satu task = satu baris jadwal). Task dengan
  nama mirip tapi task_id beda tidak ikut terhitung — benar.
- Mode EDIT: reservasi yang sedang diedit ikut tampil (informasi posisi
  sekarang sebelum diganti).
- Commit: 507c39f.
