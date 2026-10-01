---
type: log
date: 2026-10-01
tags: [domain/timesheet, domain/database, domain/staging]
---

# Implementasi Check-in dan Check-out Lintas Workcenter

Implementasi perubahan timesheet sesuai spesifikasi `docs/planning/2026-10-01-timesheet-workcenter-checkin-checkout.md`:
1. **Grain Identitas Unik & Kontrak Whitespace Seragam**:
   - SQL: `btrim(COALESCE(workcentercode, ''), E' \t\r\n\x0B\f\u00a0\ufeff')`
   - JS: `normalizeWorkcenterCode` (regex `^[\u0020\u0009\u000D\u000A\u000B\u000C\u00A0\uFEFF]+|...+$`)
   - Python: `normalize_workcenter_code` (`str(val).strip("\u0020\u0009\u000d\u000a\u000b\u000c\u00a0\ufeff")`)
   - Mempertahankan casing, normalisasi seragam terhadap ASCII whitespace, tab, newline, carriage return, vertical tab (`\x0B`), form feed, NBSP (`\u00a0`), dan BOM (`\ufeff`). Divalidasi oleh `test_workcenter_normalization_parity.js` (21 kasus, identik di SQL, index live, JS, dan Python).
2. **Database Migration & Hardening (Transaksional Atomik)**:
   - `database/migrations/api/20261001_timesheet_unique_active_productive_op_wc.sql`: Forward DDL awal.
   - `database/migrations/api/20261001b_timesheet_harden_unique_index.sql`: Hardening transaksional awal.
   - `database/migrations/api/20261001c_timesheet_wc_index_exact_contract.sql`: Koreksi transaksional yang mendeteksi dan mengganti definisi index berhuruf `v` dengan kontrak eksak `\x0B`, memverifikasi katalog sebelum men-drop legacy index.
   - `database/migrations/rollback/20261001_timesheet_unique_active_productive_op_wc_rollback.sql`: Preflight guard menolak rollback bila ada duplikat aktif lintas workcenter, membersihkan 3 baris ledger.
   - Release manifest `timesheet-20261001` di `database/migrate.js` menerapkan seluruh file rilis dalam **SATU transaksi atomik** (`applyManifestSelected`), terbukti me-ROLLBACK secara utuh tanpa meninggalkan parsial DDL atau ledger saat terjadi kegagalan di tengah.
   - Terverifikasi pada DB lab Cikupa (`mps_timesheet_ckp_test`), Balikpapan (`mps_timesheet_bpn_test`), dan manifest test DB.
3. **API Controller**:
   - `apps/api/controllers/timesheet_transactionController.js`: Memperbarui `activeCheck` dan penanganan catch error `23505` untuk `idx_timesheet_active_productive_op_wc` dengan kontrak whitespace unified. Rollback meal break `0000` tetap terlindungi.
4. **ETL F2 Cleansing & Companion**:
   - `jobs/sap_staging/run_timesheet_etl.py`: Validator `validate_no_duplicate_activity_overlap` mengelompokkan record berdasarkan workcentercode ter-strip. Overlap beda workcenter diizinkan; workcenter sama ditolak `DUPLICATE_ACTIVITY_OVERLAP`. Validasi companion lintas window otomatis selaras.
5. **Frontend UI**:
   - `apps/web/src/pages/TIMESHEET/TimesheetListPage.jsx`: Menampilkan `#tsnumber` pada kolom Order, `workcentercode` + `workcenterdescription` pada kolom Workcenter, serta lock state `stoppingId` & `restartingId` untuk mencegah aksi berulang.
   - `apps/web/src/pages/TIMESHEET/manufacturing/TimesheetMainMenuPage.jsx` & `salvaging/TimesheetMainMenuPage.jsx`: State `isSubmitting` mengunci tombol check-in/start selama request berjalan. Penanganan respon checkout mode single berhenti jika status bukan 200/404 no-active.
   - `TimesheetListPage.test.jsx` (5 test) dan `TimesheetMainMenuPages.test.jsx` (5 test x 2 varian): dua baris aktif beda WC, Stop A setelah WC sesi berubah, double-click Stop/check-in saat pending, checkout gagal, keyboard, mode multiple/single (non-404 menghentikan create, 404 lanjut), dan 409 `DUPLICATE_ACTIVE_OPERATION`. Menggantikan `TimesheetWorkcenterUI.test.jsx` (dihapus). Viewport tidak diuji di jsdom; lihat browser di poin 7.
6. **Runbook**:
   - `docs/deployment/runbook-timesheet-cross-workcenter-rollout.md`: kontrak whitespace final `\x0B` (peringatan `E'\v'` = huruf `v`), freeze/unfreeze writer berdasarkan service compose nyata (`api`, `sap-stage-worker`; `sap-stage-ts-worker` legacy harus tetap mati), bukti freeze lewat `pg_stat_activity` dan snapshot, urutan freeze -> preflight -> backup -> checkout kode -> migration satu transaksi -> API/frontend -> ETL -> verifikasi, batasan rollback data historis. Hal yang tidak bisa dibuktikan dari repo ditandai BELUM DIVERIFIKASI.
7. **Verifikasi Komprehensif**:
   - `database/tests/timesheet/test_workcenter_normalization_parity.js`: 21 kasus boundary (termasuk `vMILLv` dan kontrol negatif EM SPACE/ZWSP/NEL) identik di Postgres SQL, JavaScript controller, dan Python ETL.
   - `database/tests/timesheet/test_migration_exact_contract_scenarios.js`: 12/12 skenario lulus di kedua lab DB (CKP & BPN) mencakup idempotensi, fail-closed invalid/wrong table/foreign def, preflight duplicate abort, dan rollback rejection.
   - `database/migrate.test.js`: 36/36 tests lulus, mencakup bukti eksekusi satu-transaksi atomik manifest dan penolakan no-transaction files.
   - `database/tests/timesheet/test_timesheet_tapin_duplicate_gate.js`: 13/13 scenarios lulus (race concurrency beda workcenter [200, 200] sukses, workcenter sama ditolak 409).
   - `jobs/sap_staging/test_stage_mode.py`: 10/10 tests lulus.
   - `database/tests/timesheet/test_etl_f2_cleansing.py`: 24/24 tests lulus.
   - `npm --prefix apps/api test`: 187/187 tests lulus (0 fail).
   - `npm --prefix apps/web test`: 40/40 test files, 281/281 unit/integration tests lulus (0 fail).
   - `node scripts/gate.mjs`: LULUS PENUH (context mirror, deslop design contract 0 error, eslint ratchet 0 error, 281 tests, vite production build).
   - Browser Chromium via CDP terhadap `vite preview` (build `apps/web/dist`), viewport 768x1024 dan 960x600, varian manufacturing dan salvaging: tidak ada overflow horizontal; dua baris aktif (WC berbeda) tampil dengan badge `#tsnumber`; Stop per TS mengirim `{ tsnumber: 101 }` dan menampilkan toast sukses tanpa mengubah baris lain. **Keterbatasan**: respons API di-mock di halaman (`window.fetch`), bukan API/DB nyata; alur 409, error checkout, mode single, dan Stop All hanya diuji di vitest.
