---
tags: [board, domain/vault]
updated: 2026-07-28
---

# 📌 Planning Board

> Satu papan untuk semua rencana. Aturan: setiap rencana adalah SATU dokumen dengan
> frontmatter `status:`. Papan ini hanya daftar link — sumber kebenaran ada di
> dokumennya. Selesai → pindahkan barisnya ke ✅ dan set `status: done`.

## 🏗️ Sedang dikerjakan (active)

- [[REFACTOR_PLAN]] — refactor besar DB/API/frontend. Phase 1 ✅ · Phase 2 berikutnya: A-R1 auth, A-R3 satu jalur SAP, D-R1 migration ledger
- [[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] — perombakan UI/UX scheduling manufaktur (desktop-only). **KODE SELESAI lokal (branch 2b, uncommitted)**: route bersarang `/sow-scheduling/{projects,map,area}` + `PageHeader` tunggal (fix back-button), design-system sweep, bay board fit-to-width, drag desktop + jalur klik. Build/lint hijau. **Pending: test owner → commit → push**. Follow-up: ekstrak Modal accessible bersama (ui/Modal.jsx = modal kamera, tak reusable)
- [[deployment/PLANT_CONFIG_VARIANT_DESIGN]] · [[deployment/PLANT_CONFIG_VARIANT_PLAN]] — sumber kebenaran per plant (identitas+varian+timezone) di tabel `plant_config`; frontend fetch varian dari `/config` (revisi F-R4). **Kode SELESAI 2026-07-27** (12 task, test/build/lint hijau, uncommitted). **Pending: rollout** (migrate+seed+deploy per plant) + commit. Jobs & aturan SAP (BLOCKED PRD D2/D3) = follow-up

## 👀 Menunggu review / keputusan

- 🎨 **[[design/sow-area-tablet/PLAN]] — arah visual tablet landscape: TAHAP 1 & 2 SUDAH MASUK APLIKASI 2026-09-21**
  ([[log/2026-09-21-sow-area-tablet-visual-direction]], [[log/2026-09-21-cors-localhost-3001-dan-area-tahap1]]):
  tab lane sebagai navigasi otoritatif, grid kartu area sebagai peta kerja, panel detail zona
  terdok ~29% di tablet landscape dan bottom sheet ≤900px. Overlap terbaca lewat jumlah (bukan
  warna saja); pencarian hanya meredupkan, okupansi tetap utuh. Mockup terukur di 7 ukuran
  (0 error JS / 0 teks terpotong / 0 target <44px / 0 kartu terpotong) — 7 bug ditemukan &
  diperbaiki, termasuk tab lane yang tidak berefek pada tablet dan satu klaim salah yang dicabut
  (artefak animasi di probe).
  **Implementasi:** Tahap 1 (`constants.js` grouping per project + 24 test) dan Tahap 2
  (`FloorMapOverview.jsx` + `AreaCard.jsx` + `floorLayout.css`: grid dua kolom, tab lane
  otoritatif, panel tiga mode) **selesai & terverifikasi** — 198 test web hijau, probe Chrome
  headless 45/45 lulus di 5 ukuran, `vite build` hijau; 4 cacat nyata ditemukan pengukuran &
  diperbaiki (PLAN §7.3).
  **Perbaikan UI terpotong (2026-09-21, keluhan user):** keluhan "UI masih berantakan dan banyak
  terpotong" **benar** walau probe saat itu sudah 34/34 lulus. `.lane-scroll` tak pernah dirender
  JSX sehingga `.lane-column` memotong 313–1148px isi tanpa jalan keluar, dan `.lane-stack` selalu
  dua baris `1fr 1fr` sehingga lane bertab hanya dapat ~49% tinggi lantai. Sesudah perbaikan: lane
  **100%** tinggi (1024/402), 0 isi terpotong, 0 teks dipangkas, kartu tidak lagi tertutup panel;
  probe dinaikkan ke 45 assertion dan **dibuktikan bisa GAGAL** (revert CSS → 40/45, pulih → 45/45,
  PLAN §7.5).
  **Tahap 3 selesai (2026-09-21):** blok Blasting/Painting vertikal — slot dikelompokkan
  Painting `PT1–PT3` lalu Blasting `BL1–BL2` lewat prefiks kode (`bpSlotGroups`, fungsi murni
  + 6 test), header kelompok sticky, pita warna project 3px di sisi kode bay. Probe naik ke
  **50 assertion** (208 test web hijau, build hijau); uji-merah membongkar lubang assertion
  `every()` pada array kosong — lulus padahal header hilang — kini diperketat cek jumlah.
  **Tahap 4 selesai (2026-09-21):** skala §5.2 dikunci lewat token CSS (`--t-code` 17 /
  `--t-title` 19 / `--t-pname` 14.5 / `--t-meta` 11.5 / `--t-btn` 15.5), menggantikan nilai
  Tailwind arbitrer yang tersebar di 3 berkas (terukur sebelumnya: 16/16/11.5/10/13–14).
  Target sentuh §5.1 ternyata sudah terpenuhi sejak perbaikan UI terpotong — 16 interaktif,
  0 di bawah 44px, diverifikasi bukan diasumsikan. Probe naik ke **62/62 di kelima ukuran**
  (font lebih besar tidak memotong apa pun); uji-merah menghasilkan 7 FAIL.
  **Bug user 2026-09-21 (AREA-02/AREA-12) diperbaiki:** tombol "Manage reservations"
  setinggi 361px. Akarnya bukan kedua area itu — `.detail-panel` memakai grid 4 baris tetap
  padahal banner overlap dirender kondisional, jadi tanpa banner footer jatuh ke baris `1fr`
  dan tombolnya melar; terukur di SEMUA area tanpa overlap (AREA-11 261px, AREA-18 281px).
  Panel kini kolom flex, tombol 44px di 18 area, assertion probe baru diuji-merah.
  **UI kini English** (konvensi repo memang English): Manage reservations, Close, No
  reservations, Empty, Whole area, Overlap N zone(s) × M reservations, N zones used,
  Clear filter. Probe 63/63 di 5 ukuran; suite 227 test hijau; build hijau.
  **Tahap 5 selesai (2026-09-21):** panel detail area/zona non-modal akhirnya TERSAMBUNG ke
  `SchedulingAreaPage` (prop `detailPanel` sebelumnya selalu kosong, jadi panel tidak pernah
  muncul di layar nyata). Klik kartu/sel zona/slot bay membuka panel berkonteks, peta tetap
  terbaca, daftar memuat SEMUA reservasi sel termasuk overlap, footer aksi tetap terlihat,
  "Kelola reservasi" meneruskan area+bay+zona ke alur tingkat 2 — drag-drop order lama utuh.
  Probe **56/56**, bayScheduling 69 test, build hijau. Dua bug nyata ditemukan pengukuran:
  bottom sheet 834 membengkak jadi 83.6% tinggi (lane sisa 14%) karena baris grid `auto` +
  `82vh` mengukur viewport bukan kontainer; dan `buildAreaReservations` tak di-re-export
  sehingga vitest lolos tapi `vite build` gagal. Uji-merah juga membongkar assertion NON-MODAL
  palsu: memindai elemen `position:absolute` tidak melihat scrim `::after` — diganti hit test.

- **[[timesheet/CONFIRMATION_NUMBER_PLAN]] — checkout atomik lokal 2026-09-22:** backfill
  historis sudah tercatat; writer `checkout`/`checkoutid` kini mengisi confirmation dan split
  OV/RG lintas beberapa shift dalam satu transaksi, dan overlap antar-job mode multiple tidak
  lagi memblokir Stop. Dua belas source terbuka Cikupa (`17238`, `90085`) sudah direpair dari
  check-in berikutnya dengan snapshot 12 row; code multi-shift dan guard presisi mikrodetik
  masih menunggu deploy. Enam operator multiple berikutnya (34 source) juga sudah ditutup;
  PH3/roster yang belum pasti kini menunda confirmation per source tanpa menggagalkan Stop.
  Snapshot repair kedua berisi 34 row. Balikpapan juga direpair langsung: 4 operator/21 source,
  backup 21 row, multiple open tersisa 0. Pembulatan duration family kini konservatif; 248 row historis aman sudah diperbaiki,
  sedangkan 6 family PENDING dan 1 component ambigu ditahan. Kode belum deploy. Implementasi permanen belum selesai:
  admin edit, parser suffix seluruh jalur SAP, family cap/lineage, freeze, dan repair historis.
  Hardening script manual selesai: guard timezone/plant, clock/overlap/multi-boundary
  fail-closed, recheck exposure, konservasi detik, manifest, dan `--through-today`.
  Pending keputusan D1–D7 + implementasi permanen/repair historis; prompt agent di §13.
  [[planning/confirmation-overtime-review]] · [[concepts/timesheet-confirmation-overtime]] ·
  [[planning/timesheet-confirmation-backfill-hardening]] · [[planning/timesheet-checkout-confirmation]] ·
  [[log/2026-09-21-confirmation-overtime-review]] ·
  [[log/2026-09-21-timesheet-confirmation-backfill-hardening]] ·
  [[log/2026-09-21-timesheet-checkout-confirmation]] ·
  [[log/2026-09-21-timesheet-multiple-checkout]] ·
  [[log/2026-09-21-timesheet-split-duration-repair]] ·
  [[log/2026-09-22-timesheet-multishift-checkout-repair]].

- 🎨 **[[planning/mps-dashboard-command-center]] — pilot F2 sistem visual, KODE SELESAI (uncommitted)**
  ([[log/2026-09-19-mps-dashboard-visual-pilot]], 2026-09-19). `DashboardPage` berubah dari
  "header + filter + 4 kartu + grid chart" jadi archetype command center: condition readout
  menggantikan 4 KPI card kembar, **exception panel jadi focal point tunggal** (overdue / pass rate
  validasi < 80% / workcenter lewat plan, urut severity lalu magnitude, tiap baris satu aksi), chart
  dikelompokkan dalam section berlabel. Derivasi exception dipisah ke `deriveExceptions.js` (murni,
  tanpa fetch). **Kontrak network tidak berubah — dibuktikan, bukan diklaim**: test mengunci 10
  request sekali masing-masing dalam urutan sama (urutan diverifikasi terhadap halaman *sebelum*
  redesign), dan diukur ulang di browser. Tombol "Reload" global sempat ditulis lalu dibatalkan
  karena akan memicu 10 request sekaligus; retry dipersempit ke KPI (terukur: +1 request, bukan +10).
  Gate hijau: 115/115 test, build, `deslop --staged`, `--track-a`, `lint-gate`, `mirror`, `diff --check`.
  Diukur di browser 768×1024 & 960×600: tanpa overflow horizontal, reduced-motion nol transform,
  focus ring nyata via Tab, empty & error state terverifikasi. **Temuan jujur:** tombol Back
  `PageHeader` 30px (< 44px, dipakai 13 halaman → [[planning/UI-DEBT]]); `KpiCard.jsx` jadi mati tapi
  tidak dihapus (STOP list); 4 error deslop warisan di chart; dua perubahan di luar scope
  (`PageContainer.jsx`, `schema_prod.sql`) **dikembalikan** setelah audit `git status`.
  **Pending: review owner → commit.** Kalau archetype diterima, F3 dst. memakainya sebagai rujukan.

- 🔴 **[[planning/mapping-operasi-sap-tahan-sync]]** — mapping operasi SAP hilang diam-diam saat sync MS Project. Terukur 2026-09-07: **40 mapping mati** di 15 order / 7 project, plus 121 task summary ber-`operation_no` yang tak pernah bisa dijadwalkan. Akar: mapping disimpan sebagai kolom di `ms_project_task`, baris milik file .mpp yang dinonaktifkan sync tanpa menyentuh `updated_at`. Usul: pindahkan ke tabel PPC ber-kunci `(order_no, operation_no)`, picker area baca daftar operasi dari `sow` (read-only — `sow` cermin ETL, lihat keputusan D4). Reservasi TETAP task-level (D2 tak diubah). ~~**Menyentuh 3 butir STOP list (apps/api, kontrak API, migrasi). Blocker: 4 keputusan owner di §8**~~ → **DIKERJAKAN 2026-09-05** (keputusan 1a 2a 3b 4a, lihat [[log/2026-09-05-mapping-operasi-tahan-sync]]): tabel `sow_operation_task_map` + backfill dua populasi (1.689 kunci) applied CKP & BPN; `listOrderTasks` baca sow + 3 status (verifikasi live order 1000131015 = 19 READY / 3 TASK_LOST / 92 NEEDS_MAPPING); map tulis tabel baru (kunci int, 400 utk non-integer); sync lapor orphaned_mappings; FE panel + map page render 3 status. Build/lint OK. **Pending: cek browser 768×1024/960×600 + UAT scheduler; docs/ & database/ belum ter-commit (blocker penyaringan push)** → **REVISI-2 2026-09-07 (1b 2a 3b, lihat [[log/2026-09-07-mapping-reservasi-summary]])**: reservasi boleh nempel di task mana pun (summary/leaf), jadwal ikut task; drop-ke-summary = dialog assign/buat-anak; layar operator = task ber-op+order; backfill follow-schedule applied CKP (1.787 mapping: op 70→FRAME ASSY READY 18/8–21/9; TASK_LOST order kasus 3→0).

- 🔴 **Kontrak agen + gate T0 dirombak** ([[log/2026-09-05-kontrak-agen-dan-gate-t0]], 2026-09-05) — audit menemukan T0 tidak pernah ditegakkan (hook tak terpasang, tak ada CI, `eslint .` gagal 105 error, gate memeriksa file utuh sehingga memblokir 65% file). Sudah diperbaiki: `deslop` jadi diff-aware, ratchet ESLint ([[planning/UI-DEBT]]), `mirror.mjs` mengunci duplikasi AGENTS.md, test masuk gate, hook terpasang, `gate.yml` dibuat. **Blocker owner: (1) `scripts/` (0 file ter-track, dihapus di `65e5afc`) dan `docs/` (4 dari ratusan) harus di-commit — tanpa itu gate tidak ada di clone lain dan CI gagal; perlu penyaringan sebelum push ke remote publik. (2) hapus `OperationsHubIcon.jsx` yang tak bisa di-parse? (3) duplikat travel card HTML.**

- 🎨 **[[SCHEDULING_VISUAL_LANGUAGE_2]]** — sistem visual v2 "shop drawing" + mockup 4 halaman (`/projects`, `/map`, `/area`, `/ms-project-admin`). Ditulis SENGAJA tanpa mengacu CLAUDE.md atas permintaan owner; §6 mendaftar 6 pertentangan dengan Corporate Color System yang butuh restu sebelum mulai. `/area` punya dua layout DISKRIT (desktop mengisi ruang · mobile ikon padat + lembar bawah), satu titik ganti. Keputusan terbesar: bay jadi lajur waktu, bukan ubin denah. **Blocker: D-1 (denah lantai masih dipakai?), D-2 (titik ganti + nasib tablet), D-3 (nasib visual Proyek A), D-4 (cakupan)**

- 🔴 **Proyek A sow-scheduling — 3 keputusan owner sebelum rilis** ([[SOW_SCHEDULING_UI_FOUNDATION_DESIGN]] §12, review akhir branch 2026-09-05):
  1. **Cek browser BELUM PERNAH dilakukan, satu pun task.** Font stack (perubahan global 4 halaman), dua segmented control yang diganti, transisi route, reduced-motion, dan permukaan berlapis hanya terverifikasi lewat pembacaan kode + test jsdom. ~30 menit menutup sebagian besar: (a) font di `/sow-scheduling` `/timesheet` `/dashboard` `/operations-hub` — cari kolom tabel membungkus / label tombol tak muat, revert `58b6e5a` kalau pecah; (b) menu→projects→back→map, amati arah transisi keluar + desync header 250ms + scroll terbawa; (c) devtools `prefers-reduced-motion` — gerak harus HILANG bukan cepat; (d) `/area` mode timeline, baca baris legenda.
  2. **`text-slate-500` di atas `bg-canvas` = 4,23:1, GAGAL AA.** Spec §3.3 hanya memeriksa tiga warna aksen, tidak netral — padahal `text-slate-500` adalah warna teks sekunder resmi CLAUDE.md. Instance nyata: `BayReservationTimeline.jsx:348-368` (caption + legenda) di `/area`, halaman yang justru wajib tablet-ready. **Cacat spec.** Pilihan: beri permukaan putih, naikkan ke `slate-600`, atau terima tertulis.
  3. **Scroll reset/restore (spec §5) tidak pernah diimplementasikan** dan tidak tercatat sebagai dibatalkan. Kontainer scroll ada DI LUAR `RouteTransition` sehingga `scrollTop` terbawa antar halaman. Putuskan: kerjakan atau catat sebagai dibatalkan.

- 🟠 **Proyek A — utang teknis untuk pembukaan Proyek B** (review akhir 2026-09-05, semuanya boleh merge apa adanya):
  - **Exit offset `RouteTransition` masih basi** — kelas bug yang SAMA dengan `initial` yang sudah diperbaiki, tapi hidup di `exit`. Anak yang keluar tak pernah di-render ulang, jadi `exit.x` selalu milik transisi yang MEMBUAT elemen itu. Exit pertama tak bergerak; sesudahnya selalu terbalik. Test tak bisa melihatnya (mock mengganti `AnimatePresence` dengan pass-through).
  - **Dua `StatusPill` berbeda hidup berdampingan** dengan API tak kompatibel: `components/ui/StatusPill.jsx` (baru) vs `features/progress/primitives.jsx:6` (lama). Melanggar CLAUDE.md §1.
  - **Duplikasi yang jadi alasan `StatusPill` dibuat masih ada** — `ReservationDetailModal.jsx:98,102`, `ReservationPanel.jsx:212,216`, `MapSapOperationPage.jsx:118`.
  - **API header/footer `Panel` mati** — tak ada pemanggil memakainya, sementara `MapSapOperationPage.jsx:795-803` menulis ulang markup header itu kelas-per-kelas.
  - **Elevation terbalik** — 4 dari 5 permukaan melanggar aturan `shadow-sm`/`shadow-card` yang ditulis branch ini sendiri.
  - **`tokens.test.jsx` menguji salinan, bukan artefaknya** — hex di-hardcode di file test, tak membaca `tailwind.config.js`.
  - **API primitif tidak konsisten** — hanya `Panel`/`Toolbar` menerima `className`, hanya `Toolbar` menerima `...rest`.
  - **Test tak pernah menyentuh** `OrderPanel`, `MapSapOperationPage`, `ProjectBrowserPage`, atau shell. Semua defect serius branch ini hidup di tempat yang tak terjangkau test. **Tutup celah ini dulu di Proyek B sebelum menambah primitif.**

- [[security/AUTH_RBAC_DESIGN]] — token auth + RBAC enforce. **Blocker: jawaban §7 (expiry, library, cutoff, CORS) + §5b (3 write shopfloor)**
- [[salvaging/SALVAGE_FLOW_DESIGN]] — alur salvaging end-to-end. **Blocker: jawaban §10 (rate labour, harga parts, checklist QC, approval quote, breakdown, RBAC)**
- [[prd/manufacturing-variant]] — PRD varian manufacturing (beda vs salvaging). **Blocker: jawaban §7 (D1–D11: plant/WERKS, ZCONF_TYPE, sumber jam standar insentif, dll.)**

## 🔜 Backlog (belum dimulai)

- 🟢 **Map SAP Operation: filter 4 status di level OPERASI — KODE SELESAI 2026-09-04, belum diuji browser** ([[log/2026-09-04-workcenter-repolusi-dan-filter-mapping-operasi]]): All / This project / Elsewhere / Unmapped, dari `mappedProjectsByOperation` (tanpa endpoint baru). `outline_number` tampil sebagai badge HANYA untuk operasi ter-mapping di project yang sedang dibuka (mencabut sebagian keputusan 2026-08-07). Filter reset ke `all` tiap ganti order. eslint bersih + build sukses. **BERIKUTNYA: klik-uji owner**
- 🟠 **Workcenter bucket C+D (448 baris prosa warisan `Notes`)** ([[log/2026-09-04-workcenter-repolusi-dan-filter-mapping-operasi]], 2026-09-04): backfill suffix `[n%]` sudah diulang 2026-09-04 (110 baris, cadangan penuh `ms_project_task_workcenter_backup_20260904`), tapi 341 baris summary + 107 baris teks bebas sengaja TIDAK disentuh. Daftar terdampak sudah diekspor: `docs/log/2026-09-04-workcenter-tak-dikenal.csv` (14 project). **Blocker: keputusan owner — kosongkan atau biarkan (PRD §5 Risiko butir 2: akan terbaca "data hilang" oleh planner)**

- 🟠 **Resource management MPS (web mengatur resource MS Project)** ([[prd/MSPROJECT_RESOURCE_MANAGEMENT_PLAN]], 2026-09-03): keputusan owner = cakupan **workcenter saja** · usulan resource dari MS Project lewat **DRAFT+approval** · `[200%]` dipertahankan sebagai jumlah orang · **`ResourceNames` TETAP dipakai** (revisi 2: yang diperbaiki cara membacanya — baca `t.Assignments(i).Resource.Name`, bukan string render; rencana `Text6` dibatalkan) · `people_required` (rencana, web) vs `assignment_units` (eksekusi, MSP) **tidak saling menimpa**, selisihnya ditampilkan sebagai badge. SUDAH: pembersihan suffix `[n%]` di DB CKP (290 baris, cadangan `ms_project_task_workcenter_backup_20260903`) + filter task tanpa `operation_no` di `listOrderTasks` (939 task hilang dari picker area — sesuai keputusan owner: hanya task ter-mapping yang dikerjakan). BERIKUTNYA: Fase 1 (serializer baca objek + hapus fallback `Notes`), lalu Fase 2 (halaman Resource Management)

- 🟠 **MS Project: propagasi hapus — UJI di MS Project** ([[log/2026-09-03-msproject-delete-propagation]]): task/assignment/link/resource yang dihapus di plan selama ini TIDAK pernah terhapus di Postgres — payload VBA tak pernah mengirim blok `deactivate` yang sebenarnya sudah didukung server (`applyExplicitDeactivate`). Kode sudah ditulis (`ms_serializer.bas` + `ms_sync.bas` + README), **belum di-compile/diuji di MS Project**. Checklist uji ada di akhir log. Tidak ada perubahan sisi server

- [[LEAD_TIME_BOTTLENECK_PLAN]] — re-implementasi analitik Lead Time (§16) + Bottleneck (§17) dari Power BI `UNIFY_5051` ke Postgres+Express. docx↔md terverifikasi (md kanonik). DB: 3 view/matview dari `mch_transaction` (WAJIB `end_effective`, koreksi statusid-2=Idle bukan productive, queue via window). Backend: endpoint machine-flow/order-flow/bottleneck. **Blocker: keputusan F (D-STATUS, D-STD, D-PF, D-MT, D-THRESH)**

- 🧹 **Pembenahan vault + pengelolaan .md** ([[VAULT_CLEANUP_PLAN]]) — audit 2026-07-24: 64/92 file nol wikilink, 4 folder (`_isolasi/ planning/ prd/ salvaging/`) tak disebut CLAUDE.md, klaim `docs/` di CLAUDE.md tak sinkron. Butuh keputusan owner: perkuat aturan wikilink di CLAUDE.md? lane brainstorm? nasib `_isolasi/` (deadline hapus 2026-09-01). Dikerjakan nanti
- [[operations/sap-staging-reconciliation-page]] — design draft. Fitur 1 (read-only) + edit terpandu SEBAGIAN SUDAH (tab Jam Operator di SAP-log). Sisa: `ops_worker` deploy (Fitur 2), pertimbangkan buang `sap_ops_request`
- 🔴 **SAP: baris unproductive ditolak "cost center"** — per 2026-07-16 unproductive IKUT di-stage (aturan kelayakan baru). Akan FAILED sampai master data cost center di SAP beres (perbaikan sisi user/SAP). Dashboard triase menampilkannya jelas
- 🔴 **SAP: mekanisme STORNO** — guard sekarang hanya *mendeteksi* konflik; pembatalan kiriman salah di SAP masih **manual**. Lihat [[concepts/sap-staging-identity]]
- **Deploy staging script + ETL ke server** — perubahan gerbang unproductive + bundling harian + `apply_overrides` masih lokal/branch 2b, belum di server produksi
- 🟠 **Preview SAP di halaman validasi machine-hours menyesatkan** — `buildSapPayload` (preview yang divalidasi user di `MachineHoursValidationPage`) memakai `first_startdatetime`/`last_enddatetime` = rentang interval UTUH (mis. 15→19 Juli), padahal jalur staging nyata (`stage_sap_timesheet.fetch_machine_hour_rows`) SUDAH memecah per hari. Akibatnya user memvalidasi angka yang BERBEDA dari yang benar-benar terkirim ke SAP. Bukan kosmetik — ini soal kepercayaan preview. Perbaikan: samakan preview ke agregasi per-hari (pola `generate_series` yang sama). Ditemukan 2026-07-20 saat diagnosis "jam mesin nambah di hari lampau"

- 🟠 **Machine-hours: fix agregasi lintas-hari + overcount SAP 17 Juli** (temuan 2026-07-20). DUA hal terpisah: (1) **Report/dashboard** membebankan durasi interval UTUH ke `DATE(startdatetime)` → hari lampau "bertambah". Fix di query `machineHoursValidationController.js` + dashboard operator-harian: split proporsial per hari (tiru `generate_series` di `stage_sap_timesheet.py`). JANGAN sentuh ETL/interval mentah/payload SAP. Juli productive: 55 baris / 13,9 jam salah-bebankan. (2) **Overcount SAP 17 Juli** — event OEE ~14:45 membuat ~10 interval "nyangkut" (blok Setting/Productive 0,4–4,96 jam) berjalan paralel dengan stream tick, SEMUA ter-POST ke SAP (blok terbesar 518505 = 4,96 jam Setting, staging_id 12753). ~11,75 jam blok ter-post, ~5,64 jam benar-benar dobel wall-clock. Terlokalisir 1 hari. Butuh keputusan STORNO/koreksi (lihat item STORNO di atas). Detektor blok: baris yang punya baris lain MULAI di dalam intervalnya. Detail: [[mch-productiondata-duplication]] (memory).
  - **UPDATE 2026-07-22** ([[log/2026-07-22-mch-stuck-blocks]]): mekanismenya ketemu = **baris "nyangkut"** (HMI putus → baris tak pernah ditutup state machine, lalu ditutup program dengan stempel `now()`; tanda tangan: `duration=0` + milidetik `enddatetime` ≠ .000, Juli 516 baris berkorelasi 100%). Detektor read-only sudah ada: `node scripts/detect_mch_stuck_blocks.js --days 7 [--strict]`. Terukur 15–22 Jul: 140 blok, 344 jam dobel wall-clock, **64 blok ter-stage (74,2 jam), 61 POSTED (61,4 jam terkirim)**. Koreksi asumsi: **bukan hanya M1/M2 yang bocor** — unproductive ikut di-stage sejak aturan 2026-07-15 (hanya statusid 0/3/4 dikecualikan); contoh `513614` Coffee Break **146 jam** → bundel 45617 POSTED 14,08 jam + 45451 **PENDING 12,10 jam (masih bisa dicegat sebelum posting)**. Bukan duplikasi sync — `etl_machine_conf.py` upsert `ON CONFLICT (proddataid)`, idempoten; `mch_productiondata` = stream status frekuensi-tinggi (tick tiap detik, tiling)
  - **✅ SELESAI 2026-07-22 — normalisasi 3 lapis** ([[log/2026-07-22-mch-normalisasi-lapis]] · konsep [[concepts/mch-interval-normalization]]): kolom `end_effective`=`LEAST(enddatetime, start baris berikutnya)` di `mch_transaction` (lapis 1a, backfill 489k), stager SAP baca `COALESCE(end_effective, enddatetime)` (lapis 1b), constraint `EXCLUDE ... DEFERRABLE` anti-overlap (lapis 2). ETL v3 `recompute_end_effective()` menjaga nilainya tiap run. **Dobel jam mesin ke SAP kini mustahil secara struktural untuk record BARU.** Pelajaran termahal: EXCLUDE constraint yang disentuh UPDATE batch WAJIB `DEFERRABLE` (kalau tidak gagal ACAK per tata letak baris). **SISA:** (a) report machine-hours + dashboard OEE masih baca `enddatetime` mentah; (b) STORNO untuk 61,4 jam yang telanjur POSTED — lapis ini mencegah yang baru, tidak menarik balik yang lama
  - **🔴 BUG TERPISAH diperbaiki 2026-07-22** (`ad5cff0`): ETL machine-hours MATI TOTAL ~7 jam (crash `"..." is not a valid hexadecimal digit`) karena 3 baris `operatorid` NFC korup + `guard AND cast` dalam satu kondisi JOIN (Postgres tak jamin urutan evaluasi). Fix: pisah konversi hex ke CTE `MATERIALIZED`. Aturan umum: guard-lalu-cast dalam satu ekspresi SQL TIDAK aman
- 🟡 **EWS roster: horizon 31-Jul itu NORMAL (bukan bug) + adoption_labour fallback longgar + TZ** (temuan 2026-07-20, DIKOREKSI):
  - **Job SEHAT, bukan mati** (running, RestartCount 0, jalan 18 & 19 Jul via interval). `rows_inserted: 0` di 18/19 Jul WAJAR: run 18-Jul frontier = 01-Agu (Sabtu), run 19-Jul frontier = 02-Agu (Minggu); `runs_day/night=false` utk Sabtu/Minggu → generate 0 (query SELECT membuktikan 0 di weekend, bukan conflict). Semua HARI KERJA ≥ 03-Agu generate 91 normal; run dengan frontier hari-kerja (03-Agu Senin) menaikkan horizon. **JANGAN restart/generate manual — tidak ada yang rusak.** (Sabtu di-OFF-kan 14-Jul 15:03, sebelumnya half-day → itu sebab Sabtu future = 0.)
  - **Fallback diam-diam:** untuk tanggal tanpa baris roster, `calculateAdoptionLabour` ([ewsCalculator.js:996-1008](../apps/api/services/ewsCalculator.js)) pindah ke `...FromLogs` (timesheet-only) TANPA error → operator absen tak terlihat → adoption_labour naik PALSU. Fallback SAH hanya utk tanggal pra-roster (< `min(business_date)` roster = 29-Jun) dan hari libur (workday OFF). Rencana: state eksplisit **`roster_missing`** utk **hari kerja dalam cakupan** yang tak punya roster; JANGAN buta-flip semua (weekend memang kosong sah).
  - 🔒 **ATURAN DIKUNCI:** `ews.shift_roster` historis **JANGAN pernah dihapus-lalu-regenerate**. Integritas anti-misatribusi grup hanya berlaku karena roster BEKU — `scheduled_shift` disimpan saat generate, bukan diturunkan ulang dari `operator_rotation_group` live. Hapus+regenerate baris lama → shift lama dihitung ulang dari grup SEKARANG → misatribusi historis adoption_labour. Godaan tinggi saat job mati. Regenerate hanya tanggal **≥ hari ini**. (Pindahkan ke `docs/concepts/ews-roster.md` saat dibuat.)
  - **TZ (#4) BELUM aman:** substrat mesin EWS punya **4 plantid** (`mch_machines` 1-4, `mch_transaction` 1/2/4) — bukan single-plant. Kalau plantid = 4 plant bernama (Cikupa WIB / Balikpapan WITA / Kuala Kencana WIT / Sebamban WITA), `AT TIME ZONE` global `Asia/Makassar` menggeser batas hari utk plant non-WITA → bug laten sekelas machine-hours. Konfirmasi peta plantid→geografi + apakah 91 operator roster lintas-plant.
- 🟠 **Snapshot historis: recompute SELURUH baris TIDAK aman** (temuan 2026-07-22). `apps/api/scripts/recompute_daily_snapshots.js` kini **menolak jalan** (guard runtime + header ⛔) — jangan dijalankan. Sebab: basis `'date'` tak bisa mereproduksi semua KPI: `adoption_machine` → **null** (`calculateAdoptionForMainSnapshot(bounds, grain)` → `getCachedAdoptionCalculation` baca `kpi_snapshot WHERE grain=$1`; tak ada cache `grain='date'`, jadi nilai nyata 99.8 tertimpa null), `uptime_tablet` → null (placeholder), dan `accuracy_*`/`ole` bergeser karena data tanggal lampau terus di-backfill (98.2→99.6, 99.7→99.9, 72.1→72.7). Satu perbaikan ditukar empat regresi. Pengganti yang dipakai sekarang: `scripts/patch_adoption_labour_snapshot.js` (bedah — ganti SATU elemen KPI, 7 lainnya byte-identical, kolom legacy + `calculated_at` tak tersentuh). Perbaikan sebenarnya butuh salah satu: merge per-KPI di jalur recompute, ATAU perbaiki calculator agar basis `'date'` reproduksi setia semua KPI. Konteks: snapshot 07-18 (id 24593) sudah dikoreksi `adoption_labour` 45.1 → `no_data` setelah cleanup roster Sabtu; `overall_score/status` sengaja DIBIARKAN (tak ada pembaca historis — menyentuhnya = duplikasi formula skoring di luar fungsi aslinya)
- 🔴 **URGENT — Aktifkan KPI `uptime_tablet` SEGERA** ([[EWS_PLAN]] §7.2): per 2026-07-13 kartunya **DIPALSUKAN kosmetik 100% di frontend** (`theme/ewsCosmetic.js`) atas keputusan owner. Angka di dashboard BUKAN data nyata sampai KPI asli hidup — pasang app heartbeat di armada tablet, hitung dari `ews.device_heartbeat_daily`, lalu HAPUS file kosmetiknya

- [[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]] — guard planhours (terverifikasi belum ada di kode)
- [[timesheet/Fitur Block Timesheet Tapping]] — spec block tapping (fitur yang sama, sisi user)
- [[MSPROJECT_PWA_LITE_PLAN]] — MS Project PWA lite
- [[MSPROJECT_COLLAB_HARDENING_PLAN]] — hardening kolaborasi/identitas MS Project VBA (lanjutan manufaktur). **4 keputusan DIKUNCI 2026-07-28**: identitas honor-system · web=kontrol lock saja · lock non-expiring · single-writer. Siap implementasi — Fase 1 identitas → 2 guard write-path/UX konflik → 3 visibilitas sinkron → 4 kebersihan (regen `schema_prod.sql`, bay signposting, dead code) → 5 check-in manufaktur single/multiple (paritas salvaging; kini placeholder) → 6 area→Select Job hardening (§6). **Auth-bound VBA DITUNDA** (plan owner). ⚠️ Temuan: alur area→Select Job baru setengah jalan + bug blasting `AREA-18`↔`BLASTING`
- Salvage Flow Fase 1 (backbone lifecycle) — menunggu design approved
- Rotasi password `@dmin*` — **user action**, masih di git history
- Restart daemon heartbeat — **user action**, mati sejak 2026-07-10
- 🧩 **Konsolidasi dokumen RBAC** — [[security/AUTH_RBAC_DESIGN]] · [[security/RBAC_BACKEND_ENFORCEMENT_PLAN]] · [[security/RBAC_BACKEND_GAPS]] · [[security/RBAC_ROLLOUT_PLAN]] tumpang tindih (muncul berulang di [[STATUS]]). Gabung jadi satu sumber — masalah konsolidasi, bukan status
- 🧩 **Konsolidasi [[timesheet/Fitur Block Timesheet Tapping]] → [[timesheet/PLANHOURS_GUARD_IMPLEMENTATION_PLAN]]** — dua dokumen, satu fitur (belum dibangun). PLANHOURS_GUARD = kanonik; Fitur Block sudah `parked`

## ✅ Done

- 2026-09-21 — **Attendance Heatmap EWS — indikator overtime (OV)** ([[planning/heatmap-ui-3-overtime]] · [[log/2026-09-21-heatmap-ui-3-overtime-spec]]): transaksi dengan `confirmationnumber` mengandung `OV` kini diagregasi per operator + `business_date` tanpa double-count terhadap `recorded_hours`. Month memakai titik violet, Week badge `OV`; warna status, D/N, half-day, selection, dan focus tetap terpisah. Payload menambah `overtime_hours`, `overtime_record_count`, `overtime_pending_count`, dan `has_roster`. **91** operator-hari OV tanpa roster (83 Sabtu) tampil read-only sebagai `— · OV`, bukan status OFF palsu; **7** pending-only tampil outline tanpa mengarang jam. September: **3.117 sel**, **1.264 bertanda OV**, **4.093,77 jam OV** dari **13.445,72 jam recorded** dalam payload. Existing 3.026 sel mempertahankan recorded total identik **12.836,64**; 91 sel baru menambah 609,08 jam aktivitas. Endpoint 3×: 0,626/0,667/0,601 s, 1.079.307 B (baseline 0,613/0,590/0,592 s, 1.027.132 B). API 79/79, web 158/158, build 3.240 modul, gate full-stack lulus; browser Month/Week × desktop/tablet/960×600 terverifikasi.
- 2026-09-20 — **Attendance Heatmap EWS — komposisi Week dan kegunaan tablet** ([[planning/heatmap-ui-2-komposisi]] · [[log/2026-09-20-heatmap-ui-2-komposisi]]): bidang kosong kanan Week terukur **656 px/55%** di desktop dan 352 px/40% di 960×600 diperbaiki dengan `table-fixed w-full`, kolom operator 176 px, dan tujuh tanggal membagi sisa lebar. Month tetap minimum 1.168 px + horizontal scroll. Today/selection/focus dipisahkan, pemisah minggu sejajar, No schedule memakai border dashed, teks ≥11 px, kontrol ≥44 px + `aria-pressed`, detail tablet jadi bottom sheet. Uji urutan drag→keyboard menemukan dan memperbaiki Enter/Space pertama yang tertelan flag pointer. Browser sesudah: Week table=scroller persis di 1.184/880/688 px (desktop/960/768). Screenshot before/after 12 file di `docs/design/heatmap-ui-2/`. Gate Track A lulus; 143/143 test; build sukses; staging pengguna tidak disentuh.
- 2026-09-07 — **RBAC Role sebagai Paket Akses di Manage Users** ([[planning/rbac-role-paket]] · [[log/2026-09-07-rbac-role-paket]]): role dinamis = paket akses (dibuat/diedit/di-clone dari UI, ditempel ke banyak user). Tabel `rbac.roles/role_permissions/user_roles` + seed 5 role sistem + backfill 33 user (migration `20260907_rbac_roles.sql`). Resolver: override per-user → max-level role DB → fallback matrix kode. Keputusan owner: **1a** (banyak role, gabungan tertinggi) **2a** (override per-user lapisan teratas) **3b** (role sistem jadi baris DB) **4a** (hapus diblokir saat dipakai) **5a** (di ManageUsersPage: tab Users | Roles). FE `features/rbac/*` + API `/auth/roles` & `/auth/users/:id/roles` (manifest +4). Commit `80a891d` `8702ee5`; revisi UI full-width + animasi `06c716e`; revisi v2 murni role-packages + key otomatis `fa943ee` `5393589`; revisi v3 drawer lebar + username-otomatis `58c9341` (2026-09-07). Gate lulus; 2 anomali dashboard di check_rbac_manifest tetap pra-ada.
- 2026-09-04 — [[SOW_SCHEDULING_UI_FOUNDATION_DESIGN]] — fondasi visual & motion SOW Scheduling, **Proyek A** dari dekomposisi A/B/C/D selesai (14 task, TDD; `apps/web` sebelumnya tanpa test runner, Task 1 memasang Vitest + Testing Library). Lanjutan [[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] (Fase 0–3). Keputusan owner 2026-09-04: transisi slide-berarah (bukan tile-expand — `layoutId` shared-layout morphing dicoba lalu **direvert**, tak kompatibel dengan `AnimatePresence mode="wait"` yang unmount halaman keluar sebelum halaman masuk ter-mount) · arah visual "layered + tepi status" · palet ditambah `--canvas` + tiga `--status-*` · blast radius **hanya `/sow-scheduling`**. Membalik sebagian keputusan "desktop-only" 2026-07-30: `/area` kini adaptif desktop+tablet. Memaksa revisi CLAUDE.md (aturan shadow + palet + status implementasi) — dicatat eksplisit di Task 14, bukan dibiarkan jadi pelanggaran diam-diam. **Density toggle TIDAK di-ship**: `DensityProvider`/`useDensity` ada dan teruji tapi tidak dipasang di header manapun — kontrol yang tidak mengubah apa-apa lebih buruk daripada tidak ada; menunggu Proyek B/C mengaitkan density ke rendering baris dulu. **Proyek B, C, dan D BELUM DIMULAI.** **Utang verifikasi:** tidak ada satupun task di rencana ini yang diverifikasi lewat browser sungguhan — font stack di keempat halaman `/sow-scheduling*`, penggantian segmented control, transisi rute, perilaku `prefers-reduced-motion`, dan visual berlapis (shadow-card di atas canvas) semuanya baru lulus test unit/lint/build, belum dilihat mata di browser. Ini tanggung jawab owner sebelum rilis.
- 2026-09-02 — **Auto staging TIMESHEET BPN** ([[log/2026-09-02-sap-stage-timesheet-worker]] · gap dicatat di [[log/2026-08-31-aws-staging-reset-1b-26plus]]): service `sap-stage-ts-worker` di docker-compose (cursor mode, `--loop 10` tiap 15 mnt) + 3 env anchor (`SAP_STAGE_INITIAL_FROM_TS` dkk). Commit `9b34504`. Hasil: backlog 28-08..02-09 bersih (belum=0), cursor TIMESHEET 5051 27-08 → 02-09 13:17, POSTED tetap 742. **Backfill 26-08 dibatalkan**: seluruh barisnya di-exclude reset-1b ("posted 26-08, jangan dikirim ulang", 1.266 exclusion) — bukan backlog. Investigasi: CKP tidak punya scheduler TIMESHEET (manual terakhir 22-08) — usul service sama, belum di-deploy
- 2026-09-02 — **SAP Log page — perbaikan performa query Fase 0–2 + review** ([[log/2026-09-02-sap-log-perf-fase0-1]] · plan [[sap/SAP_LOG_QUERY_PERF_PLAN]]): FDW `fetch_size=10000`+ANALYZE di BPN+CKP (base join rekonsiliasi 5,09 s → 0,65 s); cast tsnumber dibalik (index timesheet_transaction) + guard regex di WHERE (deterministik, Index Only Scan — penerimaan EXPLAIN lulus); list staging-log slim (42 KB → 18 KB) + endpoint detail `/:id`; summary push-down + cache 60 s + invalidate di 3 jalur tulis; index `(werks,status,id DESC)` di ssb_dw; DetailDrawer `key={row.id}` (anti stale data) + error inline "Coba lagi". Deploy 2b: `030901d` `c1360a0` `3ca20d1`. Verified prod: records 30d 1,75–2,5 s, detail 0,08 s, list 0,67 s
- 2026-07-24 — **Rekonsiliasi jam mesin → SAP: analisa CSV + tab drill-through** ([[log/2026-07-24-sap-reconciliation-drilldown]] · konsep [[concepts/sap-machine-hours-reconciliation]]): bedah kenapa UI POSTED ±1.698 j ≠ CSV ±1.094 j (produktif→order 1.101 j muncul di CSV, unproduktif→cost-center 596 j tidak; sisa = pembulatan SAP **tak bisa direplikasi**). Tab Rekonsiliasi ditulis ulang bahasa awam + breadcrumb 3 level (Ringkasan→Tanggal→Konfirmasi→Rekaman mesin), 2 endpoint baca baru (`sap-reconciliation-day/-record`), kolom `source_hrs` vs `sent_hrs` = alat pisah kandidat STORNO vs re-stage. 12753 di-STORNO→SKIPPED. **Belum di-commit/deploy.**
- 2026-07-23 — **Recompute `end_effective`: lingkup kandidat + guard-hole** ([[log/2026-07-23-mch-recompute-scope-guardhole]] · konsep [[concepts/mch-interval-normalization]]): cron tanpa `--from` tadinya scan ~493k baris tiap 5 mnt → lingkup dari `CANDIDATE_TABLE` (`70dfa06`, ~198 baris), filter `enddatetime IS NOT NULL` cegah baris open Jan menyeret jangkar. Guard-hole (`89a066e`): overlap foreground yang ekornya tak tergantikan stream TIDAK di-clamp (cegah kurang-kirim), ditandai `is_stuck AND overlap_seconds=0` untuk review — nol beda vs clamp polos di Juli. Plus recompute aman-urutan (`fa82a9a`), 2 file constraint ditahan `deferred/` (`9b0bea6`)
- 2026-07-22 — **KPI `uptime_hmi` jadi state HIDUP per device** ([[log/2026-07-22-ews-uptime-hmi-live]]): sumber pindah `ews.machine_heartbeat_daily` (rata-rata harian per mesin, reaksi ~0,03 poin/menit dan tak pernah pulih di hari sama) → `public.mch_machine_ping_log`, ambil ping TERAKHIR tiap **device HMI** (9 IP menaungi 36 mesin) → 1 box mati = −11,1 poin seketika, kembali 100% saat nyala. Uji vs prod: insiden 20-Jul terbaca 66,7% critical (lama: 86,32%). Issue jadi per device (14 issue → 3) + debounce 3 siklus. **Sisa: tabel breakdown `by_device` di halaman detail belum ada**
- 2026-07-16 — **SAP-log 2 tab + kelayakan unproductive + bundling harian + fresh start** ([[log/2026-07-16-sap-staging-dashboard-unproductive-daily-bundling]]): dashboard Jam Operator (heatmap+drill+edit job/operator), `status_record` redefinisi (unproductive tanpa confirmation), bundling per-hari (4.040→1.659 bundel, sub-menit 0), staging di-reset ID→1 (1.659 PENDING)
- 2026-07-14 — **Normalisasi NFC endianness** (colon-hex ↔ desimal little-endian): util `nfcId` FE/BE, lookup toleran, migration `20260714_usernfc_normalize_nfcid` (12 kartu + kartu ganda Bagus/Dika), `backfill_operator.py`
- 2026-07-14 — **SAP staging provenance + guard anti-double-post** ([[log/2026-07-14-sap-staging-provenance]]): `sap_staging_source` (backfill 156/156), unique index parsial (double-post mustahil di level DB), trigger pembekuan `mch_transaction`, guard konflik di poster
- 2026-07-12 — **EWS IL-last**: action_table pensiun; TTS pindah ke generator (otonom); correction queue → issue_log; manifest RBAC issue-log ditambal ([[EWS_PLAN]] §7.3)
- 2026-07-12 — **EWS Phase 6 drill-through** ([[EWS_PLAN]] §7.1): 6/6 kategori, semua teruji rekonsiliasi vs prod; halaman `/ews/issue/:issueKey` + 🔍 di Issue Log
- 2026-07-12 — **Device heartbeat**: app Android `apps/mobile` + endpoint + tabel + CI APK ([[EWS_PLAN]] §7.2 menunggu armada)
- 2026-07-12 — [[log/2026-07-12-ews-consolidation|Konsolidasi 7 dokumen EWS → EWS_PLAN]]
- 2026-07-11 — **D-R1 migration ledger** (`schema_migrations` + `database/migrate.js`) & **D-R2 schema kanonik** (`schema_prod.sql`, 7 dump drift dihapus)
- 2026-07-11 — [[log/2026-07-11-refactor-phase1|Refactor Phase 1]]: index bloat −443 MB, D-R3 constraints, S-R1 secrets, A-R4 rounding, F-R1 API base, drop machine_heartbeat
- 2026-07-11 — [[log/2026-07-11-md-cleanup|Audit & bersih-bersih dokumen .md]]: 28 dihapus, 20 diisolasi
- 2026-07-07 — [[REFACTOR_PLAN|Analisis refactor menyeluruh]] + verifikasi produksi (§8)
