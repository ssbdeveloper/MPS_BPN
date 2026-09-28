---
type: plan
status: planning
tags: [domain/msproject, domain/sap]
---

# Manifest recovery MANHAUL 11 unit (dry-run, read-only)

Project `fd136156-dd1a-450d-a370-2e18c353cfd0`, "NEW OPP R2 - MPS - 11x MANHAUL 51 SEAT UG - CJ", plant 5100.
Dasar: [[planning/2026-09-28-scheduling-map-sap-reliability]] §4 dan [[concepts/msproject-sync-identitas-task]].
Bukti sesi: [[log/2026-09-28-scheduling-map-sap-pencegahan]].

**Status: data produksi BELUM pulih.** Dokumen ini adalah manifest diagnosis dan rencana rekonstruksi
Text10 dry-run. Semua diagnosis dijalankan dengan `BEGIN READ ONLY` lalu `ROLLBACK` pada 2026-09-28.
Tidak ada write DB produksi, sync/publish, restore, atau perubahan file MPP yang dijalankan di sesi ini.

## Ringkasan terukur

- **DB sekarang**: 1.010 row `ms_project_task`.
  - **156 aktif**: 53 prelim/manuf (outline 1.*, 2), 87 di bawah outline 2.11 (sekarang bernama UNIT 11),
    16 task summary/QC unit lain.
  - **854 nonaktif**.
  - Revision `ms_project`: 9. Published revision: 1.
- **Revision 4** (2026-09-21 10:53 UTC, sebelum kerusakan rev 5):
  - 977 task aktif: 52 prelim, 94 unit 1 (order 1000131891), 83-84 task per unit 2..11.
  - Setiap unit 1..11 memiliki subtree lengkap dengan order masing-masing.
- **Revision 5** (2026-09-27 15:32 UTC):
  - Menonaktifkan 839 task, menyisakan 156 task aktif.
- **Revision 6–9** (2026-09-27 15:33–15:38 UTC):
  - Masing-masing mencatat 1.011 task ter-update, tetapi snapshot tetap 156 task.
- **MPP terbaru** (`tmp/manhaul-recovery/source-latest.mpp`):
  - 1.012 baris (1 project root + 1.011 task).
  - 156 Text10 unik. 85 Text10 dipakai ulang pada 940 baris.
  - Text10 pada outline 2.2..2.11 (unit 2..11) adalah **salinan persis dari Text10 unit 1**
    pada 75–86 baris per unit (fakta copy-paste di level Microsoft Project terbukti dari file).
  - Text1 (order_no) di MPP sudah benar per unit: 1000131891 (unit 1), 1000131374 (unit 2)
    s/d 1000131383 (unit 11). Hanya unit 9 yang memiliki 41 baris ber-order 1000131380
    (beririsan dengan unit 8).

## Rekonstruksi 1-ke-1 Text10 (koreksi file .mpp planner)

Dari 1.011 baris task di MPP terbaru, disusun rencana pemetaan 1-ke-1 terhadap row DB yang
sudah ada (kandidat dikelompokkan menurut outline revision 4):

- **53 keep (preliminaries)**: Text10 sudah mengarah ke row prelim yang benar (53 aktif).
- **86 keep (unit 1)**: Text10 di MPP adalah row `42854140` dkk yang di rev4 memang milik
  unit 1 (order 1000131891). Baris-baris ini sekarang di DB aktif di bawah outline 2.11 dan
  bernama UNIT 11. **Sync dengan Text10 ini akan mengembalikan row tersebut ke outline 2.1
  dan nama UNIT 1**.
- **692 set (unit 2..11)**: Text10 yang sekarang salinan unit 1 diganti ke `task_id` asli
  milik masing-masing unit di DB (yang dinonaktifkan di rev 5).
  - Dicocokkan lewat: UID lama yang cocok (17), order + operation + nama (62), dan urutan
    nama dalam unit (613).
  - **Semua 692 target berstatus `is_active = false` di DB sekarang**.
  - Begitu sync berjalan dengan Text10 yang sudah dipulihkan, **upsertTasks otomatis
    mengaktifkan kembali row-row tersebut (`is_active = true`)** tanpa perlu script manual.
- **163 blank / task baru**: baris MPP yang tidak memiliki pasangan di revision 4 (kebanyakan
  task inspeksi / subcont baru yang ditambah planner). Text10 dikosongkan agar upsertTasks
  membuat task baru dengan ID unik.
- **1 blank di unit 1**: baris `2.1.2.1` FRAME ASSY di MPP tidak memiliki target yang cocok,
  dikosongkan untuk dibuat task baru.
- **Invariant**:
  - `dup_targets`: **0** (tidak ada `task_id` yang dipakai dua kali).
  - Target di luar DB project: **0**.
  - Sesuai dengan validasi B (`msProjectSyncIdentity`) dan preflight C (`MsDuplicateTaskIdReport`).
  - `db_unmatched currently active`: **0** (tidak ada task aktif yang akan dinonaktifkan tanpa sengaja).
- Rincian per baris tersimpan di artefak kerja:
  - `C:/Users/Admin/AppData/Local/Temp/mps-baseline/text10-plan.json`
  - `C:/Users/Admin/AppData/Local/Temp/mps-baseline/text10-plan.csv`

## Konsistensi referensi produksi (mapping, bay, timesheet)

Dicek silang dengan data produksi nyata (`recovery_refs2.js`, `BEGIN READ ONLY` + rollback):

| Objek | Total di project | Di bawah task target plan | Di bawah row `2.1.1.10` | Keterangan |
|---|---|---|---|---|
| `sow_operation_task_map` | 94 | 94 (100%) | 0 | Semua order mapping cocok dengan order task di plan |
| `ms_project_bay_schedule` | 111 | 94 (85%) | 17 (15%) | 94 reservasi cocok ordernya; 17 berada di row placeholder `2.1.1.10` |
| `timesheet_transaction` | 332 | 324 (98%) | 8 (2%) | 324 timesheet cocok ordernya; 8 berada di row placeholder `2.1.1.10` |

### Temuan 14 row placeholder `2.1.1.10`

Di DB terdapat 14 row ber-outline `2.1.1.10` ber-order `1000131891`, dibuat pada 2026-09-07
lewat `MAP_SOW_OPERATION` (bukan dari sync MPP; `local_task_uid` null). Row ini menampung:
- 17 reservasi bay
- 8 timesheet (QC FABRICATION)

Row ini tidak ada di MPP terbaru. Jika sync dijalankan, row ini **tidak tersentuh** karena
tidak ada di payload (tetap nonaktif seperti sekarang). Referensi bay dan timesheet-nya
tetap aman tetapi menunjuk ke task nonaktif. Perlu keputusan owner: apakah dimapping ulang
ke task sah unit 1 atau dibiarkan sebagai riwayat.

## Ambiguitas yang tersisa sebelum eksekusi

1. **Unit 9 order split**: di MPP terbaru, 41 baris unit 9 membawa order `1000131380` (order
   milik unit 8), bukan `1000131381`. Target rev4 untuk baris-baris ini ber-order `1000131381`.
   Planner perlu memastikan apakah ini typo di MPP atau transfer pekerjaan antar-unit.
2. **Order 1000131383 (unit 11) selama 7 hari terakhir**: apakah ada reservasi bay baru atau
   timesheet baru yang diinput user ke row `42854140` dkk dengan asumsi row tersebut adalah
   unit 11? Data probe menunjukkan timesheet order `1000131383` = 0 row. Reservasi bay order
   `1000131383` = 0 row. Aman untuk dikembalikan ke unit 1.
3. **163 task baru tanpa Text10**: saat sync berjalan, 163 row baru akan dibuat di DB.
   Sebagian besar adalah inspeksi QC tambahan.
4. **Metode aplikasi**:
   - **Opsi A (disarankan, zero-risk ke DB)**: Terapkan `text10-plan.csv` ke file .mpp
     planner (mengisi kolom Text10 di Microsoft Project via macro/script mpxj), lalu biarkan
     planner menekan **Save to Server** dari MS Project.
     - Keuntungan: mengikuti alur resmi, tervalidasi guard B & C, menghasilkan revisi 10 sah,
       audit log tercatat, snapshot revisi tersimpan otomatis, reservasi bay ikut bergeser sah.
     - Syarat: guard B dan C sudah terdeploy.
   - **Opsi B (script SQL langsung ke DB)**: update `task_id` dan `is_active` via SQL.
     - Risiko: tidak menghasilkan revisi snapshot yang konsisten, berisiko conflict saat
       planner sync berikutnya, melanggar prinsip *single source of truth*. **Tidak disarankan**.

## Langkah berikutnya (menunggu persetujuan)

1. Review manifest dan `text10-plan.csv` bersama planner / owner project.
2. Konfirmasi ambiguitas #1 (order unit 9).
3. Jika disetujui: jalankan script pengisi Text10 pada salinan `.mpp`, buka di Microsoft
   Project, periksa preflight C (tidak ada duplikat), lalu Save to Server.
4. Verifikasi di DB: 11 summary unit aktif, ~940 task aktif, revisi 10 tercipta.
