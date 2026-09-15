---
title: Workcenter tercemar lagi pasca-backfill; usulan filter mapped/unmapped di level operasi
date: 2026-09-04
tags: [domain/msproject, domain/sow, fe, db]
---

# Dua temuan: repolusi workcenter (terukur) + filter mapping level operasi (baru)

Permintaan owner 2026-09-04:
1. Saat klik `order_no` di Map SAP Operation, perlu filter penanda operasi **sudah
   di-mapping atau belum**; info outline level boleh ditampilkan.
2. Bersihkan kolom workcenter — saat melihat project task, workcenter masih tercampur.

## 1. Workcenter — SUDAH ada rencananya, dan repolusi sudah terukur

Bukan masalah baru. Sudah tercatat di
[[prd/MSPROJECT_RESOURCE_MANAGEMENT_PLAN]] dan
[[log/2026-08-07-msproject-workcenter-resource-names]].

**Diukur ulang 2026-09-04** pada DB yang sama dengan tempat backfill 2026-09-03
dijalankan (dikonfirmasi: `ms_project_task_workcenter_backup_20260903` ada, tepat
290 baris — sesuai PRD). Read-only.

| Bucket | Baris | Nilai unik | Keterangan |
|---|---:|---:|---|
| A. valid & bersih | 1.993 | 5 | `C5100BPP/FAB/FIT/MPR/QIM` |
| B. valid + suffix `[n%]` | **110** | 11 | **repolusi pasca-backfill** |
| C. summary — nama fase | 341 | 110 | warisan fallback `Notes` |
| D. non-summary — teks bebas | 107 | 48 | warisan fallback `Notes` |
| **Total tercemar** | **558** | | **21,9% dari 2.551 baris terisi** |

Master `workcenter` plant 5100 = 5 kode saja.

**Kesimpulan: repolusi ini tepat seperti yang diramalkan PRD** (§4 Fase 1 butir 5):

> "Perlu diulang setelah langkah 1-4 rilis, karena Save dari file lama masih bisa
> mencemari lagi sampai VBA baru terpasang."

Fase 1 **kodenya selesai 2026-09-03 tapi belum dirilis ke planner**. Selama VBA lama
masih terpasang di mesin planner, setiap Save menulis balik `C5100FAB[200%]`.

### Rekomendasi (BUKAN keputusan baru — menjalankan rencana yang ada)

- **Jangan jalankan ulang backfill sekarang.** Itu membersihkan 110 baris yang akan
  kotor lagi pada Save berikutnya. Biaya nyata, manfaat nol.
- **Aksi yang benar: rilis Fase 1 VBA ke semua mesin planner**, baru backfill diulang.
  Urutan ini eksplisit di PRD §5 Risiko butir 1.
- Bucket C+D (448 baris prosa `Notes`) memang **sengaja dibiarkan** untuk review manual
  (PRD §4 Fase 1 butir 5). Menghapusnya sekarang akan terlihat seperti "data hilang"
  bagi planner (PRD §5 Risiko butir 2) — perlu daftar task terdampak + catatan rilis
  lebih dulu.

### Yang bisa dikerjakan sekarang tanpa menunggu rilis VBA

Perbaikan **tampilan**, bukan data: kolom Workcenter di Portfolio Gantt
(`ProjectScheduleGantt.jsx` → `TaskMetaCells`, baris 236) menampilkan
`task.workcenter` mentah. Bisa dibuat hanya menampilkan nilai yang dikenal master dan
menandai sisanya sebagai "tak dikenal" — tanpa menyentuh data. Ini menjawab keluhan
"tercampur" tanpa melanggar urutan rilis di atas.

## 2. Filter mapped/unmapped di level operasi — permintaan baru

`MapSapOperationPage.jsx` sudah punya `MAPPED_FILTERS` (All/Mapped/Unmapped) tapi
**hanya di level order** (daftar `SowOrderCard`). Setelah order dipilih,
`OperationList` merender SEMUA operasi tanpa filter.

Data mapping per operasi sudah tersedia di `mappedProjectsByOperation`
(`[{ project_id, project_name, current }]`), jadi filter ini tidak butuh endpoint baru.

**Usulan status filter** (3 keadaan, bukan 2 — karena `current` sudah dibedakan di
`OperationCard`):

| Filter | Arti |
|---|---|
| All | semua operasi order ini |
| In this project | `mappedProjects.some(r => r.current)` — sudah punya rumah di project yang sedang dibuka |
| Mapped elsewhere | ter-mapping, tapi tidak di project ini (badge amber yang sudah ada) |
| Unmapped | belum di-mapping ke project mana pun |

**Outline level:** keputusan 2026-08-07 (komentar `MapSapOperationPage.jsx` baris
290-292) sengaja MENYEMBUNYIKAN nomor outline di `OperationCard` dengan alasan "angka
2.1.3 tidak memberi tahu planner apa pun". Owner 2026-09-04 menyatakan
"info outline level boleh" — **izin, bukan kewajiban**. Usul: tampilkan
`outline_number` hanya untuk operasi yang ter-mapping di project yang sedang dibuka
(di situ angkanya punya konteks), bukan di semua kartu.

## Yang DIKERJAKAN 2026-09-04

### Backfill suffix `[n%]` — dijalankan atas keputusan owner

Owner memilih menjalankan backfill sekarang meski rilis VBA Fase 1 belum dikonfirmasi.
Peringatan repolusi sudah disampaikan dan diterima.

- Target diverifikasi lebih dulu: `ptssb` @5432, primary (bukan replica),
  `plant_config` = **5100 Cikupa / manufacturing** — DB yang sama dengan backfill 09-03.
- Cadangan **penuh** (bukan hanya baris yang diubah): `ms_project_task_workcenter_backup_20260904`,
  2.551 baris.
- Hanya suffix units yang dibuang (`\s*\[[0-9.,]+%\]\s*`), **tidak** memecah pada koma —
  sesuai PRD §4 Fase 1 butir 5.
- Satu transaksi, dengan verifikasi sebelum commit: sisa ber-suffix harus 0 DAN jumlah
  baris ber-workcenter tidak boleh berubah. Kalau salah satu gagal → rollback.

Hasil: **110 baris diperbarui**, valid & bersih naik **1.993 → 2.103**, total ber-workcenter
tetap 2.551.

Revert kalau perlu:

```sql
update ms_project_task t set workcenter = b.workcenter_lama
from ms_project_task_workcenter_backup_20260904 b where b.task_id = t.task_id;
```

### Bucket C + D (448 baris) — TIDAK disentuh

Daftar task terdampak diekspor sesuai syarat PRD §5 Risiko butir 2:
`docs/log/2026-09-04-workcenter-tak-dikenal.csv` (448 baris, 14 project).
Menunggu keputusan owner — menghapusnya akan terbaca sebagai "data hilang" oleh planner.

### Filter 4 status — SELESAI

`MapSapOperationPage.jsx`:
- `OPERATION_FILTERS` + `operationMappingState()` — satu operasi = satu status
  (`current` | `elsewhere` | `unmapped`).
- Chip filter 4 kolom di header panel operasi, mengikuti pola visual `MAPPED_FILTERS`.
- `OperationList` menerima prop `filter`; ada pesan "No operations match this filter."
  supaya hasil kosong tidak terbaca sebagai gagal fetch.
- Filter di-reset ke `all` tiap ganti order — filter order sebelumnya bisa menyembunyikan
  seluruh isi order berikutnya.
- `outline_number` dibawa di `mappedProjectsByOperation`, ditampilkan sebagai badge hijau
  **hanya** untuk operasi yang ter-mapping di project yang sedang dibuka.

Verifikasi: `npx eslint` bersih, `npm run build` sukses (45s). **Belum diuji manual di
browser** — perlu klik-uji oleh owner.
