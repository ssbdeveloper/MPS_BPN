---
title: Forensik CKP — jam sudah masuk SAP lewat jalur langsung (post-to-sap)
date: 2026-09-14
tags: [sap-staging, ckp, timesheet, posting, forensik, multi-plant]
---

# Forensik CKP sebelum menyalakan `sap-stage-ts-worker` (read-only, 2026-09-14)

Pertanyaan: kalau worker staging TIMESHEET dinyalakan di CKP (5100), apakah ada risiko jam
dobel? Cursor `sap_stage_cursor (TIMESHEET, 5100)` beku di **2026-08-22**, `.env` CKP tanpa
`SAP_STAGE_INITIAL_FROM_TS` (default compose 2026-08-26 hanya dipakai kalau cursor hilang).

## Hasil

1. **Kontrol positif kunci join (wajib sebelum percaya hasil negatif)**:
   `staging.id::text = log_timesheet_sap.ztimesheetid` → **1.671/1.671** baris staging 5100
   berstatus POSTED ada di log → kunci VALID.
2. CKP memang **tidak** memakai pipeline staging untuk hari-hari terakhir: staging 5100 hanya
   1.975 baris (id 1000039300…1000073803, berhenti ~02 Sep).
3. Tapi **jam CKP SUDAH masuk SAP** lewat jalur lain: `log_timesheet_sap` 15.545 baris
   (created 31 Agu–14 Sep), semuanya `plant_code=5100`; **12.550 di antaranya** ber-`ztimesheetid`
   = **1.000.000.000 + tsnumber** (mis. 1000087078 ↔ tsnumber 87078) dan tidak ada di staging
   AWS mana pun. Cocok **12.546/12.550** dengan `timesheet_transaction` CKP
   (tanggal + jam checkin + pernr sama), respons `SUCCESS : Confirmation of order … saved`.
   Per hari log ≈ timesheet: 03 Sep 1.191 vs 1.189; 09 Sep 1.483 vs 1.481; 12 Sep 1.002 vs 989;
   14 Sep 115 vs 920 (hari berjalan).
4. Penulisnya: **`POST /timesheet/post-to-sap`** (`apps/api/controllers/timesheet_transactionController.js`,
   dipanggil halaman `TIMESHEET/TimesheetValidationPage.jsx`). `ZTIMESHEETID` =
   `ID_TIMESHEET` (env, = `1`) + tsnumber zero-pad 9 digit → persis band id yang muncul di log.
   Jalur ini **masih aktif** (log terakhir hari ini).
5. `sap_staging_exclusion` CKP = **0 baris** → tidak ada pengaman "jangan kirim ulang".

## Kesimpulan

Menyalakan `sap-stage-ts-worker` CKP dengan cursor 22 Agu = meng-stage ulang ±12.200 tsnumber
yang **sudah dikonfirmasi SAP** → risiko jam dobel kalau diposting. Jadi: **jangan nyalakan**
sebelum ada cutover dari jalur langsung ke pipeline.

## Kalau CKP mau pindah ke pipeline (rencana keputusan #7: 5100 kirim TIMESHEET)

1. Tetapkan tanggal cutover = setelah jam terakhir yang dikonfirmasi jalur langsung.
2. Set `SAP_STAGE_INITIAL_FROM_TS` = cutover **dan** set `sap_stage_cursor (TIMESHEET,5100)` = cutover.
3. Sabuk pengaman: isi `sap_staging_exclusion` plant `5100` untuk tsnumber yang sudah terkirim
   (bentuk SQL di bawah) — tahan kalau cursor/backfill mundur.
4. Pensiunkan tombol/jalur `post-to-sap` di CKP (kalau tidak, dua jalur tetap jalan).
5. Nyalakan `sap-stage-ts-worker` CKP + pantau 48 jam; verifikasi tidak ada tsnumber yang
   muncul di dua jalur (bandingkan `log_timesheet_sap` vs staging POSTED CKP).

```sql
-- sabuk pengaman (jalankan di AWS; idempotent). source_row_id = TSNUMBER (bukan ztimesheetid),
-- karena fetch stager membandingkan source_row_id dengan timesheet_transaction.tsnumber::text.
-- ztimesheetid = ID_TIMESHEET('1') + tsnumber zero-pad 9 digit -> ambil substring dari posisi 2.
INSERT INTO public.sap_staging_exclusion (source_system, plant, source_row_id, excluded_by, note)
SELECT 'TIMESHEET','5100', ltrim(substring(l.ztimesheetid, 2), '0'),
       'cutover', 'sudah dikonfirmasi SAP via post-to-sap'
FROM public.log_timesheet_sap l
WHERE l.plant_code='5100' AND l.created_at >= '<cutover>' AND l.ztimesheetid ~ '^1[0-9]{9}$'
ON CONFLICT (source_system, plant, source_row_id) DO NOTHING;
```

Cek sampel: `1000087078` → substring(2) = `000087078` → ltrim → `87078` = tsnumber baris
timesheet yang sama (terverifikasi pada contoh forensik di atas).

## Eksekusi cutover (dijalankan 2026-09-14 malam; cutover efektif 15 Sep)

Keputusan owner: **tombol `post-to-sap` dipensiunkan di UI (default mati, tidak bisa diubah),
cutover 15 September 2026.**

1. **Exclusion sabuk pengaman** (AWS, idempotent): **12.277 baris** `(TIMESHEET, 5100, tsnumber)`
   dari log jalur langsung (`ztimesheetid ~ '^1[0-9]{9}$'`, id staging/legacy dikecualikan,
   tsnumber harus ada di `timesheet_transaction` CKP) → `excluded_by='cutover-20260915'`.
   Hasil: exclusion plant 5100 = 12.277 (5051 tetap 33 MCH + 1.266 TIMESHEET).
2. **Cursor** `sap_stage_cursor (TIMESHEET, 5100)`: `2026-08-22` → **`2026-09-15 00:00:00`**
   (dengan overlap 30 menit → mulai dari 14 Sep 23:30, jam malam yang sudah ter-exclude).
3. **`.env` CKP**: `SAP_STAGE_INITIAL_FROM_TS=2026-09-15T00:00:00` (sebelumnya tidak ada →
   fallback compose 2026-08-26). Baris ditambah di akhir file (owner tetap `tag`, tidak berubah).
4. **FE**: `apps/web/src/pages/TIMESHEET/TimesheetValidationPage.jsx` — toggle "SAP"
   (state + `localStorage['validation_postToSap']`) diganti status mati permanen (`SAP off`);
   `postToSapEnabled` jadi konstanta `false` sehingga alur validasi selalu memakai cabang
   "Validated (SAP off)" dan tidak pernah memanggil `POST /timesheet/post-to-sap`.
   ESLint bersih untuk perubahan ini (1 error `goBack` unused = PRA-ADA di HEAD) + `npm run build` sukses.

### Sisa langkah (owner)

- Deploy FE + `dashboardController.js` (pull + rebuild container) di CKP → tombol pensiun berlaku
  di server. Kalau ada posting langsung yang masih terjadi SETELAH ini, ulangi langkah 1
  (murah & idempotent) tepat sebelum `sap-stage-ts-worker` CKP dinyalakan.
- Nyalakan CKP: `docker compose up -d sap-ops-worker sap-stage-ts-worker` (MCH tidak perlu).
  Pantau 48 jam: `docker logs sap-stage-ts-worker --tail 50`, cursor naik dari 15 Sep,
  dan tidak ada tsnumber yang muncul dua jalur (staging POSTED vs `log_timesheet_sap`).
- Halaman Machine Hours (`MACHINE_H/MachineHoursValidationPage.jsx`) **masih punya toggle
  serupa** — belum dipensiunkan (menunggu keputusan owner; BPN memakai MCH lewat pipeline).
