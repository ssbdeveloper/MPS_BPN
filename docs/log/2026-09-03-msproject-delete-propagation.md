---
title: "MS Project: hapus di plan tidak pernah sampai ke Postgres"
type: log
date: 2026-09-03
tags: [domain/msproject]
---

# MS Project — propagasi hapus (blok `deactivate`)

## Keluhan
Save to Server hanya membuat/meng-update. Task yang dihapus di MS Project tetap hidup
di Postgres.

## Diagnosis (bukan bug server)
Server SUDAH punya mekanismenya; klien yang tidak pernah memakainya.

1. `Ms_SaveToServer` → `PUT /projects/<id>/sync` dengan `MsBuildProjectPayload(False)`
   ([ms_sync.bas](../../tools/msproject-v2/ms_sync.bas)).
2. Payload hanya memuat `project`, `project_resources`, `tasks`, `assignments`,
   `dependencies` — **tanpa** blok `deactivate` ([ms_serializer.bas](../../tools/msproject-v2/ms_serializer.bas)).
3. `normalizeProjectPayload` (`dashboard`→`msProjectService.js:380`) men-default
   `deactivate` ke `{}`.
4. `syncProject` memanggil `applyExplicitDeactivate(...)` (`msProjectService.js:4617`),
   tapi isinya kosong → nol baris dinonaktifkan.
5. `upsertTasks` (`msProjectService.js:587`) murni insert/update untuk baris yang ADA di
   payload; tidak ada rekonsiliasi "baris DB yang tidak ada di payload". **Disengaja** —
   payload parsial tidak boleh menghapus data.

Berlaku sama untuk assignment, dependency, dan resource — bukan hanya task.

## Perbaikan (klien menghitung diff, bukan server merekonsiliasi)
`Ms_SaveToServer` kini memanggil `MsBuildDeactivateJson()` sebelum merakit payload:
`GET /projects/:id/package` (hanya baris aktif) dibandingkan dengan isi plan, selisihnya
dikirim sebagai `deactivate: { task_ids, assignment_ids, dependency_ids, resource_ids }`.
Ada konfirmasi user berisi jumlah per jenis sebelum save berjalan.

Kenapa bukan flag `full_snapshot` + rekonsiliasi di server:
- `MsTasksJsonArray` melewati task bernama kosong → akan terbaca "dihapus".
- `updateProjectTask` (edit dari web, `msProjectService.js:4389`) **tidak menaikkan
  `revision_no` dan tidak butuh lock**, jadi guard revisi tidak melihat perubahan web saat
  plan ter-checkout. Daftar eksplisit membuat penghapusan selalu keputusan yang tercatat.

## Detail yang menentukan benar/salahnya
- **Keempat daftar wajib satu payload.** `applyExplicitDeactivate` memproses assignment →
  dependency → task → resource dalam satu transaksi; `task_ids` sendirian ditolak
  `409 TASK_DEACTIVATE_BLOCKED`.
- **Assignment dicocokkan dua jaring**: `assignment_id` DAN pasangan `(task_id|resource_id)`.
  Jalur fallback import (`ResourceNames`, saat `Assignments.Add` gagal) memasang resource
  tanpa menulis `assignment_id` — tanpa jaring kedua, assignment hidup terbaca "dihapus".
- **`project_resources` di package TIDAK difilter `is_active`** (statusnya di field
  `project_resource_is_active`), berbeda dari tasks/assignments/dependencies yang sudah
  `and is_active = true`. Tanpa saringan, resource non-aktif terhitung "dihapus" tiap save.
- **Dependency tidak punya id di sisi MS Project** → dicocokkan dengan kunci yang sama
  dengan server: `(pred, succ, type, lag)`. Efek samping yang benar: mengubah lag/type
  memunculkan "dependency dihapus" + link baru, dan itu justru memperbaiki penumpukan
  baris aktif ganda yang selama ini terjadi diam-diam.
- **Rem pengaman**: plan tanpa satu pun task/resource ber-ID server sementara server penuh
  isi → save dibatalkan (kemungkinan file salah / `Text10`/`Text9` terhapus).
- **Gagal ambil package = save gagal**, bukan lewati diam-diam.

Semua penghapusan **soft** (`is_active = false`); snapshot revisi & audit utuh.

## File tersentuh
- `tools/msproject-v2/ms_serializer.bas` — `MsBuildDeactivateJson`, `MsCollectPlanIds`,
  `MsDependencyMatchKey`, helper `MsPkg*`; `MsBuildProjectPayload` dapat argumen opsional
  `deactivateJson`.
- `tools/msproject-v2/ms_sync.bas` — diff + konfirmasi di `Ms_SaveToServer`.
- `tools/msproject-v2/README.md` — bagian "Propagasi hapus".
- Tidak ada perubahan sisi server.

## BELUM diuji
Kode VBA belum di-compile/dijalankan di MS Project (tidak bisa diuji dari lingkungan ini).
Uji wajib sebelum dibagikan ke planner: hapus 1 task tanpa assignment · hapus 1 task yang
punya assignment + link (pastikan tidak 409) · lepas 1 resource dari task · hapus 1 link ·
ubah lag sebuah link · buang 1 resource dari Resource Sheet · save tanpa penghapusan
(tidak boleh ada dialog konfirmasi).
