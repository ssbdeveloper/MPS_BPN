---
type: plan
status: planning
tags: [domain/msproject, domain/sap]
---

# Manifest recovery MANHAUL 11 unit (dry-run, read-only)

Project `fd136156-dd1a-450d-a370-2e18c353cfd0`, "NEW OPP R2 - MPS - 11x MANHAUL 51 SEAT UG - CJ", plant 5100.
Dasar: [[planning/2026-09-28-scheduling-map-sap-reliability]] §4 dan [[concepts/msproject-sync-identitas-task]].
Bukti sesi: [[log/2026-09-28-scheduling-map-sap-pencegahan]].

**Status: data produksi BELUM pulih.** Dokumen ini hanya manifest diagnosis. Semua query dijalankan
dengan `BEGIN READ ONLY` lalu `ROLLBACK` pada 2026-09-28 sekitar 06:51 UTC. Tidak ada write, sync,
publish, atau restore.

## Ringkasan terukur

| Hal | Nilai |
|---|---|
| Revisi sekarang / published | 9 / 1 |
| Task di DB / aktif / nonaktif | 1.010 / 156 / 854 |
| Snapshot rev 1-4 | 967, 967, 977, 977 task |
| Snapshot rev 5-9 | 156 task (tetap) |
| Audit rev 5 (2026-09-27 15:32 UTC) | created 18, updated 993, **deactivated 839** |
| Audit rev 6-9 | updated 1.011 per revisi, deactivated 0 |
| Task rev 4 yang kini nonaktif | 839 (0 hilang dari DB, local UID tidak berubah) |
| Lock aktif | tidak ada (FORCE_CHECKIN 2026-09-28 01:34 UTC) |

## Identitas UNIT: revisi 4 vs sekarang

Pada revisi 4 ada 11 summary unit di bawah `2 MANUFACTURING`. Sekarang hanya satu unit yang aktif.

| Rev 4 outline / nama | task_id (8 awal) | UID | Sekarang | Order task anak sekarang |
|---|---|---|---|---|
| 2.1 UNIT 1 | 42854140 | 6403 | **aktif, bernama "UNIT 11", outline 2.11** | lihat catatan A |
| 2.2 UNIT 2 | 6f203eb9 | 6485 | nonaktif | 1000131374 |
| 2.3 UNIT 3 | f9df0731 | 6567 | nonaktif | 1000131375 |
| 2.4 UNIT 4 | f6e8af92 | 6649 | nonaktif | 1000131376 |
| 2.5 UNIT 5 | 92958494 | 6731 | nonaktif | 1000131377 |
| 2.6 UNIT 6 | 50a4ea0a | 6813 | nonaktif | 1000131378 |
| 2.7 UNIT 7 | d4a832ad | 6897 | nonaktif | 1000131379 |
| 2.8 UNIT 8 | e6d80b71 | 6979 | nonaktif | 1000131380 |
| 2.9 UNIT 9 | 6b847055 | 7066 | nonaktif | 1000131381 |
| 2.10 UNIT 10 | add63aaa | 7148 | nonaktif | 1000131382 |
| 2.11 UNIT 11 | f259407a | 7230 | nonaktif | 1000131383 |

Ada juga `2.1 BATCH 1` (UID 6895) yang nonaktif dan tidak ada di snapshot rev 4 sebagai unit.

Catatan A:
- 66 task non-summary aktif yang pada rev 4 berorder **1000131891** (UNIT 1) kini berorder
  **1000131383** (order UNIT 11 di rev 4).
- Per order sekarang, 1000131383 punya 68 task aktif. Order 1000131891 tinggal 1 task aktif
  dan 23 nonaktif. Order 1000131374-1000131382 masing-masing punya 68 nonaktif dan 1-2 aktif.
- Pola ini konsisten dengan baris UNIT 11 di file planner yang memegang task_id UNIT 1 (Text10),
  sehingga row UNIT 1 ditimpa atribut UNIT 11. Hal ini **belum dibuktikan dari payload atau MPP
  asli**. Server tidak menyimpan payload sync mentah, dan file MPP belum diperiksa.

## Referensi ke task nonaktif project ini

| Sumber | Jumlah | Catatan |
|---|---|---|
| `sow_operation_task_map` | 70 | 7 per order untuk 1000131374 s.d. 1000131383 |
| `sow_operation_task_map` pada task aktif | 24 | order 1000131891 |
| `ms_project_bay_schedule` (task nonaktif) | 87 | CONFIRMED + RESERVED, rentang 2026-09-04 s.d. 2026-10-01, order 1000131374-1000131383 dan 1000131891 |
| `ms_project_bay_schedule` (task aktif, order 1000131891) | 24 | tanggal 2026-11-08 s.d. 2026-11-26. **Tanggal ini perlu dicek**: bisa jadi sudah digeser oleh sync ke jadwal UNIT 11 |
| `timesheet_transaction.ms_task_id` ke task nonaktif | 166 | |
| timesheet per order (baris) | 1000131374: 52, 1000131375: 53, 1000131376: 27, 1000131377: 20, 1000131378: 5, 1000131379: 1, 1000131380: 1, 1000131891: 241 | shop floor sudah bekerja di unit yang task-nya kini nonaktif |
| assignment aktif / dependency aktif | 0 / 0 | dependency historis (semua status): 1.120 |
| Tabrakan order+operasi nonaktif vs aktif lain | 0 | aktivasi ulang tidak langsung melanggar `uq_ms_project_task_order_op`, kecuali pada order 1000131383 (lihat ambiguitas 2) |

## Ambiguitas (unresolved) dan sumber yang dibutuhkan

1. **Row `42854140` (UNIT 1 di rev 4, "UNIT 11" sekarang).**
   - Belum diketahui apakah UNIT 11 di file planner merupakan salinan baris UNIT 1 atau hasil
     rename yang disengaja.
   - Sumber: file MPP planner *sebelum* save 2026-09-27 15:32 UTC, atau file `.mpp` server yang
     di-upload pada rev 4 (2026-09-21 03:53 UTC) bila masih ada di storage atau backup. Juga
     diperlukan MPP terbaru beserta nilai Text10/UniqueID per baris.
2. **Order 1000131383.**
   - 68 task aktif (dulu anak UNIT 1) dan 68 task nonaktif (anak UNIT 11 asli, `f259407a`) sama-sama
     berorder ini.
   - Bila UNIT 11 asli diaktifkan tanpa mengembalikan order UNIT 1 ke 1000131891, indeks unik
     order+operasi akan bentrok atau task menjadi ganda.
   - Harus diputuskan per task oleh planner.
3. **Reservasi 24 baris order 1000131891 pada task aktif.** Tanggal November perlu dibandingkan
   dengan audit `BAY_SCHEDULE_*` dan jadwal UNIT 1 yang benar. Sync memanggil
   `syncBayScheduleDates`, jadi tanggal bisa sudah mengikuti task yang tertimpa.
4. **Mapping 24 baris order 1000131891 pada task aktif.** Task sudah berorder 1000131383, tetapi
   mapping masih memakai order_key 1000131891 (drift). Ini perlu dicocokkan dengan hasil
   `mapping_drift` di audit rev 5.
5. **Perubahan sah sesudah rev 4.**
   - Contoh: rename material 1.4.x ("Unit 1 s.d. 5", "Unit 6 s.d. 11") dan Bullbar yang pindah
     1.4.9 → 1.4.10.
   - Perubahan ini tampak disengaja dan **tidak boleh** ditimpa oleh restore rev 4.
6. **BATCH 1 (UID 6895)** belum diketahui apakah struktur lama atau baru.
7. **14 task tanpa local UID** perlu dicocokkan secara manual.

## Langkah pemulihan yang diusulkan (belum disetujui, belum dijalankan)

1. Deploy guard backend (commit `b7d46f0`) dan VBA (`1e43a62`) sebelum ada sync lagi pada project
   ini.
2. Ambil MPP sumber (poin 1 di atas). Backup file dan DB project (task, map, bay schedule,
   revision).
3. Susun manifest per task. Isinya: task_id, UID, nama/outline/parent/order sebelum dan sesudah,
   aktif sebelum dan sesudah, alasan pencocokan (UID + Text10 file, bukan nama), serta
   referensinya. Kasus ambigu diberi status unresolved.
4. Minta persetujuan owner per kelompok: row 42854140, anak-anak UNIT 1, UNIT 2-11 asli,
   reservasi, dan mapping.
5. Terapkan dalam satu transaksi dengan dry-run, before-image, dan verifikasi. Setelah itu
   perbaiki file planner: Text10 salinan dikosongkan hanya atas keputusan planner.
6. Kriteria selesai: API/UI menampilkan 11 unit yang benar, dan dua sync berikutnya tidak
   mengurangi unit atau memindahkan identitas.

Query yang dipakai ada di skrip probe read-only lokal (tidak di-commit karena membaca `.env`):
`recovery_manifest.js`, `recovery_manifest2.js`, `recovery_manifest3.js` di `%LOCALAPPDATA%/Temp/mps-baseline/`.
