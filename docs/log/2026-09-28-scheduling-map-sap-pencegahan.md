---
type: log
date: 2026-09-28
tags: [domain/msproject, domain/sap]
---

# Pencegahan scheduling map dan identitas sync MS Project

Eksekusi langkah A/B/C dan manifest recovery dry-run dari [[planning/2026-09-28-scheduling-map-sap-reliability]].
Lanjutan dari [[log/2026-09-28-scheduling-map-sap-investigasi]].
Konsep: [[concepts/msproject-sync-identitas-task]].
Manifest: [[planning/2026-09-28-manhaul-recovery-manifest]].

## Yang dilakukan

- **A. Commit `5b70eb6`, `SchedulingAreaPage`.**
  - Guard `!loading` yang sudah ada di working tree diadopsi, ditambah status reload netral.
    Hunk edit-reservasi milik user di file yang sama tidak ikut; staging memakai blob index
    terisolasi.
  - Enam tes Vitest mencakup:
    - skeleton saat load awal;
    - save → refresh tertunda tanpa warning palsu → data baru tampil;
    - warning terpotong dan retry sesudah selesai;
    - error nyata dan retry;
    - abort bukan error;
    - panel detail yang tetap terbuka.
  - Tes dibuktikan bisa gagal: tanpa guard, 3 tes merah.
  - Probe Chrome headless dengan fetch yang ditahan lulus di 768x1024 dan 960x600. Probe
    dihapus sesudahnya.
  - `gate --track-a`: lulus. Hasilnya 246 tes web dan build hijau, dengan 1 warning C13
    pre-existing.
- **B. Commit `b7d46f0`, `msProjectSyncIdentity.js` dan pemanggilnya di `syncProject`/`publishProject`.**
  - Validasi identitas satu-ke-satu dijalankan sebelum mutasi.
  - Kode error yang ditambahkan: `DUPLICATE_TASK_ID`, `DUPLICATE_LOCAL_TASK_UID`,
    `TASK_UPSERT_DEACTIVATE_CONFLICT`, `TASK_PROJECT_MISMATCH`, `TASK_IDENTITY_CONFLICT`.
    Kode `TASK_NOT_FOUND` dipakai ulang.
  - 16 tes node: 10 tes murni dan 6 tes transaksional di DB lab loopback
    `mps_rehearsal_5100`. Tes transaksional berjalan dalam transaksi luar yang di-ROLLBACK.
    Fingerprint DB lab identik sebelum dan sesudah.
  - Reproduksi: tanpa guard, sync duplikat **berhasil**, menimpa row dan menonaktifkan unit lain.
    Tanpa guard 5 tes merah.
  - Suite `services/msProject*.test.js`: 51 tes, 45 lulus, 6 skip. Yang di-skip adalah tes lab
    tanpa env; dengan env, 16/16 lulus.
  - Gate umum: lulus. Langkah web di-skip karena tidak ada perubahan `apps/web`.
- **C. Commit `1e43a62`, `ms_sync.bas` dan README.**
  - Preflight `MsDuplicateTaskIdReport` berjalan sebelum deactivate diff. Save ditolak dengan
    ID baris, UID, dan nama. Text10 tidak dihapus otomatis.
  - Gate umum: lulus.
  - **Runtime Microsoft Project tidak terverifikasi.** Otomasi COM gagal
    (`CO_E_SERVER_EXEC_FAILURE`). Pemeriksaan yang dilakukan hanya statis.
- **Recovery.** Tiga probe produksi dijalankan dengan `BEGIN READ ONLY` dan ROLLBACK, tanpa
  mencetak kredensial atau lock token. Hasilnya menjadi manifest.

## Temuan baru

- Row UNIT 1 pada rev 4 (`42854140`, UID 6403) kini bernama UNIT 11. 66 task anaknya pindah order
  dari 1000131891 ke 1000131383. UNIT 2-11 asli masih utuh di DB dengan local UID yang sama,
  tetapi nonaktif.
- Referensi yang menunjuk task nonaktif:
  - 70 mapping;
  - 87 reservasi bay;
  - 166 timesheet.
- Timesheet sudah tercatat pada order 1000131374-1000131380.
- Payload dan MPP historis belum diperiksa, jadi asal copy-paste masih dugaan kuat, bukan fakta.

## Status dan pending

- **Pencegahan: committed lokal** (3 commit). Belum di-push dan belum di-deploy.
- **Data produksi: BELUM pulih.** Tujuh ambiguitas dan sumber yang dibutuhkan tercantum di
  manifest.
- Pending:
  1. deploy guard backend dan VBA sebelum sync berikutnya pada project ini;
  2. uji preflight di Microsoft Project oleh planner;
  3. ambil MPP sumber;
  4. manifest per task disetujui owner;
  5. apply produksi di sesi terpisah.
- Catatan lingkungan: hook pre-commit tidak terpasang di `.git/hooks`, jadi gate dijalankan
  manual sebelum setiap commit.
