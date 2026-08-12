---
title: "Bay Scheduling — Edit Reservasi"
date: 2026-08-12
tags: [log, ms-project, bay-scheduling, frontend]
---

# Bay Scheduling — Fitur Edit Reservasi

> Tanggal: 2026-08-12. Tambah tombol **Edit** di modal detail reservasi bay → panel
> reservasi terbuka dalam mode EDIT dengan semua isian ter-seed dari data reservasi,
> submit lewat `PUT /ms-project/bay-schedules/group/:id` (backend SUDAH ada sejak
> sebelumnya — tinggal UI-nya yang belum memakainya).

## Yang berubah (UI only — backend tidak disentuh)

| File | Perubahan |
|---|---|
| `apps/web/src/features/bayScheduling/ReservationDetailModal.jsx` | Tombol **Edit** (biru) di footer, di samping Close. Disabled + tooltip utk baris legacy tanpa `schedule_group_id` (endpoint update butuh group id). |
| `apps/web/src/features/bayScheduling/ReservationPanel.jsx` | Prop `edit` (detail hasil `dedupeByGroup`). Mode EDIT: seed bayCount/bay pertama/tanggal/notes/purpose/bookingType/task terpilih/headcount dari detail; `datesDirty=true` (tanggal reservasi = sumber kebenaran, tidak ditimpa prefill MSP); select booking type di-disable (backend update tidak menerima `booking_type`); occupants fetch kirim `exclude_group_id` (diri sendiri tidak dihitung penghuni); payload menyertakan `schedule_group_id` + `notes` selalu (boleh kosong → hapus catatan). |
| `apps/web/src/pages/PPC/manufacturing/SchedulingAreaPage.jsx` | `handleEditReservation` — area dibangun dari DETAIL (bukan area terpilih peta) supaya edit bisa dibuka dari view Timeline; `handleSubmitReservation` branch: ada `payload.schedule_group_id` → `updateBayScheduleGroup`, toast "Reservation updated". |

## Detail penting

- **Backend update grup** (`msProjectService.updateBayScheduleGroup`) menerima:
  `area_code/area_name/bay_codes/start_date/end_date/notes/purpose/tasks` (opsional,
  yang tidak dikirim tidak berubah). Task kosong → 400 "cancel the group instead".
  Audit `BAY_SCHEDULE_UPDATE`. Overlap dihitung ulang → warning `BAY_OVERLAP`
  (dikecualikan grup sendiri). RBAC sudah ada (`PUT /ms-project/bay-schedules/group/:id`).
- **Fallback task list di mode EDIT**: kalau `fetchOrderTasks` gagal (reservasi order
  yatim), daftar task diambil dari `detail.tasks` → tanggal/bay/catatan tetap bisa
  diubah; headcount baseline di-seed dari detail juga, jadi tidak ada write-back
  headcount yang menimpa. Kalau fetch sukses, baseline ditimpa nilai segar DB.
- **Task yang di-uncheck saat edit** = dihapus dari reservasi oleh server (sync ke
  payload). Tidak boleh 0 task (blokir + pesan, konsisten dgn 400 backend).
- **Bay**: seed dari `edit.bay_codes[0]` + count = panjang array (round-trip utk
  booking kontigu dalam satu zona). Area tak dikenal FE → fallback objek area minimal
  dari `area_code/area_name/bay_codes` (panel tetap terbuka, "Number of bays" terbatas).

## Verifikasi

- `npx eslint` 3 file: 0 error 0 warning.
- `npm run build` (vite): sukses.
- **End-to-end ke backend PROD via tunnel** (`https://127.0.0.1:8443/api`, self-signed
  → `curl -k`): create non-job `ZZTEST-hermes-<ts>` (bay `A1C` — deployed pakai suffix
  zona, `A1` ditolak `INVALID_BAY_CODE`) → `PUT group/:id` (geser tanggal 12–14 → 13–15,
  notes berubah) → GET verify (baris baru ketemu) → DELETE group (cleanup) → 0 baris
  aktif tersisa; sweep `ZZTEST` = 0. Payload update persis seperti yang dikirim panel.
