---
type: plan
status: implemented
tags: [domain/timesheet, domain/sap]
updated: 2026-10-01
---

# Check-in lintas workcenter dan checkout terpilih

## Tujuan dan status keputusan

Operator yang sama boleh memiliki timesheet produktif aktif dengan order dan operation sama apabila workcenter berbeda. Duplikat aktif pada workcenter yang sama tetap ditolak. Sesi ini hanya menulis planning dan prompt; belum mengubah aplikasi, database, atau menjalankan ETL.

Interpretasi sementara **jalur tutup fleksibel**: operator dapat memilih transaksi di workcenter A untuk ditutup sementara B tetap aktif, termasuk setelah pilihan workcenter pada sesi berubah. Checkout semua tetap tersedia melalui aksi yang jelas. Mode multiple mengizinkan paralel; mode single tetap menutup aktivitas sebelumnya. Ini asumsi planning, bukan konfirmasi pengguna atas detail checkout. Jika maksud pengguna adalah single per workcenter atau Finish job, revisi bagian ini sebelum implementasi perilaku tersebut.

Dasar: [[concepts/payroll-data-path]], [[planning/2026-09-25-timesheet-etl-duplicate-activity-handoff]], [[log/2026-09-27-timesheet-etl-lab-execution]]. Requirement baru merevisi grain duplikat dalam handoff 25 September, bukan menonaktifkan seluruh pemeriksaan overlap.

## Temuan source lokal, 1 Oktober 2026

| Lapisan | Bukti dan implikasi |
|---|---|
| Halaman | `apps/web/src/pages/TIMESHEET/TimesheetMainMenuPage.jsx` memilih varian manufacturing/salvaging. Kedua mainmenu mengirim `workcentercode` dari data karyawan, dan memanggil checkout semua sebelum POST pada mode single. |
| API create | `apps/api/controllers/timesheet_transactionController.js`, `exports.create`: pemeriksaan aktif memakai plant + serialnumber + normalized order + operation. Workcenter belum termasuk; respons konflik `409 DUPLICATE_ACTIVE_OPERATION`. |
| Constraint | `database/migrations/api/20260925_timesheet_unique_active_productive_op.sql`: unique index dengan grain yang sama, tanpa workcenter. Keberadaan/index definition di database live belum diperiksa. |
| ETL F2 | `jobs/sap_staging/run_timesheet_etl.py`, `validate_no_duplicate_activity_overlap`: grouping `(row_plant, serial, norm_order, norm_op)`. Overlap lintas workcenter dapat ditolak atau di-invalidasi tergantung mode quarantine. |
| Checkout | `PUT /timesheet/checkoutid/` memilih `tsnumber`; `/timesheet/checkout` memilih serialnumber dan menutup semua yang cocok. Keduanya memakai `timesheetConfirmationService.js`, termasuk lock, exposure guard, dan confirmation RG/OV/RW. |
| UI tutup | `TimesheetListPage.jsx` sudah Stop per `tsnumber`, Restart mengikuti mode; `LoginTimesheetPage.jsx` memiliki `stopAllByNfc`. Audit semua caller sebelum mengubah cakupan checkout. |
| Finish | Salvaging memanggil `/sow/finish/`; `sowController.js` mengubah status SOW berdasarkan order + operation dan menulis buffer OUT. Ini aksi berbeda dari checkout timesheet. |

## Kontrak target

1. Identitas duplikat aktif produktif: `(plant, serialnumber, normalized_order_no, operation_no, normalized_workcentercode)`. Operator memakai identitas NFC `serialnumber`, bukan nama tampilan atau akun HTTP.
2. Pertahankan normalisasi order, predikat produktif, pengecualian soft-delete, dan aktif `longdate_checkout IS NULL`. Anomali `date_checkout` terisi sementara `longdate_checkout` NULL tetap dianggap aktif oleh guard check-in.
3. Usulan normalisasi workcenter: trim; NULL/kosong/whitespace menjadi satu nilai kosong untuk data legacy. Jangan memakai NULL mentah sebagai kolom unik karena bisa meloloskan duplikat. Jangan mengubah kapitalisasi tanpa memeriksa master workcenter. Definisi identik di SQL, JavaScript, dan Python. Validasi input baru harus mengikuti master yang benar; workcenter invalid tidak menjadi cara melewati guard.
4. API tetap mengembalikan `409 DUPLICATE_ACTIVE_OPERATION` untuk kunci yang sama. Pesan menjelaskan workcenter yang bentrok. Unique index menjadi pengaman request serentak; SELECT sebelum INSERT saja tidak cukup. Penolakan duplikat harus me-rollback efek samping, termasuk penutupan meal break.
5. F2 menggunakan grain baru untuk target dan companion lintas checkout window. Overlap workcenter berbeda sah; overlap workcenter sama tetap ditolak. Interval half-open yang bersentuhan tetap sah. Jangan mengubah pembagi F3 untuk menyembunyikan konflik.
6. Tutup satu transaksi menggunakan `tsnumber` yang dipilih, tidak mencari hanya berdasarkan order + operation atau workcenter sesi terakhir. Tampilkan workcenter code, identitas TS, dan status pada daftar agar dua baris bisa dibedakan. Stop A tidak menutup B atau operator lain; confirmation split tetap boleh menghasilkan keluarga segmen milik A.
7. Checkout semua hanya dipakai pada aksi Stop All yang jelas dan alur single existing. Jangan diam-diam mengubah kontrak endpoint lama menjadi scoped. Jika perlu aksi tutup sekumpulan transaksi per workcenter, spesifikasikan endpoint/payload dan atomisitas sebagai tambahan yang perlu persetujuan; bukan prasyarat untuk Stop per TS.
8. Pada alur checkout lalu create, kegagalan checkout selain kondisi no-active yang memang diizinkan harus menghentikan create dan menampilkan error. Kegagalan POST setelah checkout sukses masih merupakan risiko alur dua request; jangan mengklaim atomik. Perombakan menjadi satu endpoint atomik memerlukan spec terpisah jika dipilih.

## Cakupan, dampak, dan batas

- Implementasi adalah perubahan bisnis lintas frontend, API, database, dan ETL; bukan Track A UI-only. Menyentuh area STOP `apps/api/**`, `database/migrations/**`, `jobs/**` memerlukan otorisasi implementasi sesuai CLAUDE.md. Permintaan saat ini hanya menghasilkan planning/prompt.
- Cakupan UI: dua varian mainmenu, daftar timesheet, serta audit alur login/unproductive/restart. Edit hanya file yang terbukti perlu. Konfirmasi metadata reservasi manufacturing tetap tersimpan.
- Cakupan backend: guard create, mapping konflik index, checkout service hanya bila dibutuhkan. Gunakan migration baru, jangan menulis ulang migration yang pernah dipakai.
- Cakupan ETL: revisi grain duplikat F2, audit propagasi workcenter ke companion, dan regression hingga SAP-ready di lab. Buktikan jam operator tetap konservatif dan workcenter tidak tertukar. Aturan allocation dan confirmation dipertahankan.
- Di luar cakupan: redesign halaman, perubahan Finish SOW/buffer, perubahan master operation, recovery historis, unfreeze, rebuild staging, publish/SAP posting, perubahan payroll math, deployment, dependency baru, `.env`, dan reset data.
- Semua pemeriksaan sesi ini berbasis source dan dokumen lokal. Status produksi, constraint live, data master, serta hasil runtime belum diverifikasi.

## Urutan kerja dan commit

1. **Inventaris dan spec final.** Baca CLAUDE.md, standar yang relevan, dan dokumen dasar. Catat git status termasuk index yang sudah berisi pekerjaan lain. Telusuri semua caller create/checkout/checkoutid/checkout-unprod dan Finish. Verifikasi master workcenter, predikat index, migration ledger, serta mekanisme discovery migration pada target lab. Tulis kontrak checkout final dan daftar file pasti; tangani otorisasi STOP sesuai instruksi manusia yang tersedia.
2. **Constraint + API + regression sebagai satu perubahan perilaku yang konsisten.** Target `timesheet_transactionController.js`, migration baru di `database/migrations/api/`, dan `database/tests/timesheet/test_timesheet_tapin_duplicate_gate.js`. Tambahkan workcenter pada guard/index, pertahankan conflict mapping. Preflight read-only mendeteksi duplikat pada grain baru termasuk nilai kosong. Jangan memperbaiki data otomatis. Uji transisi migration dan request serentak pada PostgreSQL nyata.
3. **ETL + regression.** Target `jobs/sap_staging/run_timesheet_etl.py` dan test F2/F4/F5 terkait di `database/tests/timesheet/`. Selaraskan grouping, pesan konflik, companion, dan fixtures. Uji hasil alokasi/SAP-ready dengan dua workcenter untuk operator/order/operation sama. Perbarui dokumen kontrak lama agar tidak bertentangan. Commit terpisah; jangan deploy langkah 2 tanpa kesiapan langkah 3.
4. **Alur UI dan checkout.** Target `apps/web/src/pages/TIMESHEET/{manufacturing,salvaging}/TimesheetMainMenuPage.jsx`, `TimesheetListPage.jsx`, serta test terkait. `LoginTimesheetPage.jsx`, `UnproductiveMenuPage.jsx`, service/controller checkout hanya diubah bila audit membuktikan kebutuhan. Prioritaskan reuse Stop per TS. Tangani HTTP error dan disable submit selama pending; jangan memperluas menjadi refactor lintas halaman.
5. **Verifikasi dan handoff.** Jalankan matrix di bawah; catat command, exit code, hasil dan keterbatasan. Update log, planning board, dan konsep terkait. Siapkan runbook rollout terkoordinasi API/DB/ETL/UI serta rollback. Tidak menjalankan deployment atau SQL produksi dari tugas ini.

### Migration dan rollback

- Baca definisi index/ledger aktual; dokumen lab sebelumnya mencatat index pernah ada tanpa ledger. Jangan menganggap filename migration berarti sudah terpasang.
- Pilih cara penggantian index berdasarkan ukuran tabel dan kemampuan runner. Untuk produksi, tulis langkah preflight, maintenance/write coordination, pemeriksaan index valid, dan stop conditions; jangan memberi klaim zero downtime tanpa bukti.
- Semua writer harus tetap terlindungi selama perubahan. Penggantian non-concurrent dapat atomik tetapi memblokir write; concurrent memerlukan urutan build/verify/drop yang kompatibel runner dan kondisi index lama.
- Rollback ke unique key lama **bisa gagal** sesudah ada dua workcenter aktif pada order/operation yang sama. Runbook harus menghentikan perubahan jika data tidak kompatibel; jangan hapus atau checkout data otomatis untuk memaksakan rollback.

## Matrix penerimaan

| Kasus | Hasil wajib |
|---|---|
| Operator/order/operation sama; WC A lalu B, mode multiple | Dua TS aktif dengan ID berbeda; A tetap terbuka. |
| Operator/order/operation/WC sama | Request kedua 409; hanya satu TS aktif. |
| Dua request serentak, WC sama | Tepat satu sukses dan satu konflik; tidak ada efek samping dari request gagal. |
| Dua request serentak, WC berbeda | Keduanya sukses; constraint tidak menolak salah satu. |
| Order leading zero, operation ekuivalen, WC whitespace | Normalisasi konsisten; variasi format tidak melewati guard. |
| Legacy WC NULL/kosong/whitespace | Tidak membuka celah duplikat; kebijakan invalid input baru terdokumentasi. |
| Same key setelah checkout / state_flag 5 | Re-check-in sesuai predikat existing; histori tidak diubah. |
| date_checkout terisi, longdate_checkout NULL | Tetap ditolak sebagai duplikat aktif pada WC sama. |
| Stop A setelah sesi memilih B | Hanya A tertutup; B tetap aktif; waktu dan confirmation A benar. |
| Stop ulang / stale UI / request tutup serentak | Tidak menggandakan segmen atau mengubah waktu checkout yang sudah tersimpan. |
| Stop All / single / Restart | Cakupan sesuai kontrak; error checkout tidak diteruskan sebagai sukses. |
| Meal break / unproductive / subcont / frozen | Guard existing dipertahankan; penolakan tidak meninggalkan write parsial. |
| F2 overlap WC berbeda dan sama, termasuk companion | Berbeda lolos; sama ditolak/di-invalidasi sesuai mode; adjacency sah. |
| F3/F4 untuk paralel dua WC | Jam operator tidak terhitung ganda; lineage dan ARBPL masing-masing benar. |
| UI kedua varian, 768x1024 dan sekitar 960x600 | Workcenter dapat dibedakan; loading/error/empty, keyboard, dan pending submit berfungsi. |

Jalankan test tap-in PostgreSQL lab, test service confirmation, regression ETL terkait, `npm --prefix apps/web run test`, serta build melalui gate. Sebelum setiap commit stage hanya pekerjaan sendiri dan jalankan `node scripts/gate.mjs` (bukan `--track-a` untuk perubahan bisnis ini). Jangan mengklaim gate yang membaca staged changes milik pekerjaan lain sebagai verifikasi scope tugas. Jika index pengguna tidak dapat diisolasi tanpa mengubah pekerjaannya, siapkan diff dan laporkan commit/gate scope belum tuntas. Jangan reset/stash/unstage milik pengguna. Jangan menjalankan integration tests sebelum target koneksi terbukti lab dan tidak mengarah ke FDW produksi.

## Prompt siap salin untuk agent

```text
Kerjakan revisi timesheet-mainmenu di D:\MPS2 berdasarkan:
docs/planning/2026-10-01-timesheet-workcenter-checkin-checkout.md

Tujuan: operator yang sama dapat check-in produktif untuk order_no dan
operation_no sama bila workcentercode berbeda. Workcenter sama tetap dicegah
sebagai duplikat aktif. Selaraskan API, unique index DB, dan validator overlap
ETL F2. Jangan berhenti pada frontend atau guard API saja.

Baca CLAUDE.md terutama 3-7 dan standar terkait sebelum mengubah kode. Periksa
git status: ada pekerjaan pengguna/agent lain, termasuk yang sudah staged.
Jangan reset, stash, unstage, atau commit pekerjaan itu.

Mulai dengan memverifikasi temuan source dalam plan dan memfinalkan kontrak
checkout. Asumsi plan: mode multiple boleh paralel lintas workcenter; Stop per
tsnumber menutup transaksi yang dipilih tanpa memengaruhi workcenter lain;
Stop All dan mode single mempertahankan cakupan existing. Finish SOW/buffer
bukan checkout. Jika arahan manusia berbeda, perbarui spec sebelum implementasi.

Prompt ini adalah instruksi implementasi lokal ketika dikirim oleh pemilik.
Periksa otorisasi yang menyertainya untuk area STOP API/migration/jobs; jangan
menganggap dokumen planning saja sebagai persetujuan semua area tersebut.
Jika belum tercakup, selesaikan investigasi/spec konkret lalu minta persetujuan
scope yang kurang satu kali. Jangan meminta ulang persetujuan yang sudah ada.

Implementasikan bertahap mengikuti plan. Pertahankan normalisasi yang konsisten,
guard concurrency di DB, rollback side effect, confirmation RG/OV/RW, freeze,
subcont, meal break, metadata reservasi, serta alokasi jam yang ada. Migration
harus baru dan melalui ledger; audit kondisi index lama. Validasi semua jalur
tutup/restart/error; jangan mengubah semua checkout menjadi per workcenter.

Jalankan matrix penerimaan pada lab terisolasi, termasuk request serentak,
companion lintas window, kedua varian UI dan checkout satu dari dua workcenter.
Verifikasi tujuan koneksi sebelum test database; jangan mencetak secrets.
Jangan mutate production, publish/post SAP, mengubah histori, atau unfreeze.

Update docs/log, docs/PLANNING.md, dan konsep/kontrak terkait. Gate harus berjalan
pada staged diff yang benar sebelum scoped commit; tanpa --no-verify atau
melemahkan baseline. Laporkan file yang berubah, command dan hasil nyata,
acceptance yang belum terverifikasi, serta runbook migration/rollout/rollback.
Jangan mengklaim deployed atau selesai end-to-end jika baru lolos test lokal.
```

Asal-usul: [[log/2026-10-01-timesheet-workcenter-planning]], implementasi tercatat di [[log/2026-10-01-timesheet-workcenter-implementation]].

## Status Verifikasi & Hasil Nyata (1 Oktober 2026)
- **Database Index & Migration Hardening**:
  - DDL forward terpasang di lab Cikupa dan Balikpapan melalui manifest `timesheet-20261001` mencakup `20261001_timesheet_unique_active_productive_op_wc.sql` dan `20261001b_timesheet_harden_unique_index.sql`.
  - Verifikasi otomatis status index: `indisunique = true`, `indisvalid = true`, `indisready = true`, dan index lama hanya di-drop setelah index baru terbukti valid.
  - Koreksi 2 Oktober 2026: `20261001` dan `20261001b` menulis `E'... \v ...'`. Di PostgreSQL, `E'\v'` adalah huruf `v` (bukan vertical tab), sehingga index ikut membuang huruf `v` di ujung workcentercode. `20261001c_timesheet_wc_index_exact_contract.sql` membangun ulang index dengan kontrak final `btrim(COALESCE(workcentercode, ''), E' \t\r\n\x0B\f\u00A0\uFEFF')` dan abort pada definisi asing. Manifest kini diterapkan dalam satu transaksi.
  - Skrip rollback `20261001_timesheet_unique_active_productive_op_wc_rollback.sql` memverifikasi ketiadaan transaksi aktif paralel sebelum re-create index lama.
- **Backend API**: POST /timesheet mengizinkan operator/order/op sama pada workcenter berbeda (200 OK), dan menolak workcenter sama (409 DUPLICATE_ACTIVE_OPERATION). Concurrency race terbukti: same workcenter -> [200, 409], diff workcenter -> [200, 200].
- **ETL F2 Cleansing & Companion**: Validator `validate_no_duplicate_activity_overlap` mengelompokkan record berdasarkan workcentercode dan kontrak whitespace yang sama (`WC_STRIP_CHARS`). Overlap beda workcenter lolos; overlap workcenter sama ditolak.
- **Frontend UI & Responsiveness**:
  - Kolom Order menampilkan `#tsnumber`, kolom Workcenter menampilkan code + description, dan state submitting/stopping mencegah aksi ganda / double-click.
  - Mode single menghentikan create bila checkout gagal selain 404 no-active.
  - Verifikasi viewport 768x1024 dan 960x600 lolos.
  - Navigasi keyboard (Tab + Enter pada Stop button) terverifikasi.
- **Runbook**: Runbook rilis & rollback terdokumentasi di `docs/deployment/runbook-timesheet-cross-workcenter-rollout.md`.
- **Test Matrix**:
  - `database/migrate.test.js`: 32 passed.
  - `database/tests/timesheet/test_migration_hardening_scenarios.js`: 6 passed.
  - `database/tests/timesheet/test_timesheet_tapin_duplicate_gate.js`: 13 passed.
  - `jobs/sap_staging/test_stage_mode.py`: 10 passed.
  - `database/tests/timesheet/test_etl_f2_cleansing.py`: 24 passed.
  - `npm --prefix apps/api test`: 187 passed.
  - `npm --prefix apps/web test`: 276 passed (39 files).
  - `npm --prefix apps/web run build`: vite build sukses.
