---
tags: [board]
updated: 2026-07-20
---

# 📌 Planning Board

> Satu papan untuk semua rencana. Aturan: setiap rencana adalah SATU dokumen dengan
> frontmatter `status:`. Papan ini hanya daftar link — sumber kebenaran ada di
> dokumennya. Selesai → pindahkan barisnya ke ✅ dan set `status: done`.

## 🏗️ Sedang dikerjakan (executing)

- [[REFACTOR_PLAN]] — refactor besar DB/API/frontend. Phase 1 ✅ · Phase 2 berikutnya: A-R1 auth, A-R3 satu jalur SAP, D-R1 migration ledger

## 👀 Menunggu review / keputusan

- [[security/AUTH_RBAC_DESIGN]] — token auth + RBAC enforce. **Blocker: jawaban §7 (expiry, library, cutoff, CORS) + §5b (3 write shopfloor)**
- [[salvaging/SALVAGE_FLOW_DESIGN]] — alur salvaging end-to-end. **Blocker: jawaban §10 (rate labour, harga parts, checklist QC, approval quote, breakdown, RBAC)**
- [[prd/manufacturing-variant]] — PRD varian manufacturing (beda vs salvaging). **Blocker: jawaban §7 (D1–D11: plant/WERKS, ZCONF_TYPE, sumber jam standar insentif, dll.)**

## 🔜 Backlog (belum dimulai)

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
- Salvage Flow Fase 1 (backbone lifecycle) — menunggu design approved
- Rotasi password `@dmin*` — **user action**, masih di git history
- Restart daemon heartbeat — **user action**, mati sejak 2026-07-10

## ✅ Done

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
