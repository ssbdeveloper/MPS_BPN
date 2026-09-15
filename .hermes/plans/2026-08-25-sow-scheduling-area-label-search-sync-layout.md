# SOW Scheduling Area (manufacturing): Label Area, Search Filter, Sync Tanggal, Layout (PLAN)

Tanggal: 2026-08-25
Status: **MENUNGGU KONFIRMASI KEPUTUSAN — belum coding**

## 1. Ringkasan permintaan user

1. Label "AREA 1, AREA 2, …" → **cakupan area** (mis. AREA 1 → "A38-A35").
2. **Search project / order_no** → peta terfilter ke Area yang memuat reservasi order tsb.
3. **Tanggal reservasi SELALU sinkron dengan tanggal schedule di ms_project_task**.
4. Layout area: **lebar statik per container** supaya Order_no + Project name kebaca;
   tumpukan reservasi **maks 3, lebih → expand**; **tinggi max** (tanpa ruang kosong).

## 2. Temuan investigasi

| Fakta | Nilai |
|---|---|
| Definisi area | `config/manufacturingAreas.js` — AREA-01..18, tiap area punya `bays[]` (mis. AREA-01 = ['A38','A37','A36','A35']) → **label cakupan = bays[0]–bays[last]** ("A38-A35") |
| AREA-18 | 'Blasting & Prime', bays ['PT1','PT2','PT3','BL1','BL2'] |
| Search yang ada | `OrderPanel` punya `orderSearch` (hidup satu komponen dengan peta lantai) — sekarang cuma filter panel pool, BELUM filter peta |
| Tabel reservasi | `ms_project_bay_schedule` (2.025 baris): order_no, project_id, **task_id**, area_code, bay_codes, start_date, end_date, status, booking_type |
| **BUKTI SYNC (BPN, kritis!)** | 1.787 reservasi ber-task_id dengan plan dates; **1.758 (98%) TIDAK cocok** dengan `ms_project_task.plan_start/plan_finish` — contoh: reservasi 18 Aug–16 Nov vs task plan 19–20 Aug. Booking selama ini pakai tanggal manual (default today+7), bukan plan dates task |
| Rendering peta | `FloorMapOverview.jsx` (level overview): blok area menampilkan areaName + count bay/reservasi; klik → detail area (level 2) |

## 3. Desain yang diusulkan

### 3a. Label area → cakupan bay
- Label utama blok area = **`bays[0]–bays[last]`** (AREA-01 → "A38-A35", AREA-10 (1 bay) → "A1", AREA-18 → "PT1-BL2").
- Tooltip tetap `areaName` lengkap ("Area 1" / "Blasting & Prime").
- Implementasi: helper `areaRangeLabel(area)` di `constants.js`/manufacturingAreas — SATU sumber, dipakai FloorMapOverview + BayAreaDetail.

### 3b. Search project/order_no → filter area
- Reuse `orderSearch` yang sudah ada: saat ada search → peta hanya menampilkan **Area yang punya reservasi untuk order hasil search** (reservasi di area tsb di-highlight/dim).
- Area lain: disembunyikan (opsi A) atau dim 30% (opsi B). Area dengan reservasi order tsb diberi badge count.
- Order yang di-search belum punya reservasi → empty state "No reservations for this order" + tombol clear.
- Data: dari `useBaySchedules` (reservasi sudah punya order_no) — filter murni FE, tanpa backend baru.

### 3c. Sync tanggal reservasi ↔ ms_project_task (PERLU KEPUTUSAN)
Fakta: 98% reservasi ber-task tidak cocok plan dates. Opsi:
- **A (rekomendasi): Auto-sync forward-only** — reservasi dengan `task_id` dan `status <> CANCELLED` yang `start_date >= hari ini` diselaraskan ke `plan_start/plan_finish` task (script 1x utk data lama + otomatis saat `GET /ms-project/bay-schedules` / endpoint sync baru). Task tanpa plan dates → tidak disentuh. Aman: tidak mengubah riwayat.
- **B: Sync SEMUA** (termasuk masa lalu) — mengubah riwayat, berisiko ke laporan.
- **C: Display-only** — peta menampilkan tanggal dari task schedule (join), data reservasi tidak diubah; plus default booking = plan dates.
- Bonus semua opsi: saat **booking baru**, default tanggal = `plan_start/plan_finish` task yang dipilih (bukan today+7).

### 3d. Layout area (lebar statik + 3 tumpuk + tinggi max)
- Container area: **lebar statik** (mis. `min-w-[240px]`, tidak flex-squeeze) → Order_no + Project name tampil utuh (truncate). Map pakai horizontal scroll kalau melebihi viewport.
- Tumpukan reservasi per area: **maks 3 baris**; lebih → tombol "+N more" → expand (daftar penuh, bisa collapse).
- Tinggi: container peta `flex-1` + `max-h` = sisa viewport (mis. `calc(100vh - header)`) → tidak ada ruang kosong vertikal; area mengisi penuh.
- Card reservasi: tampilkan **Order_no (bold) + Project name (1 baris truncate)** + range tanggal.

## 4. Titik keputusan (konfirmasi 1a/2a/3a...)

1. **Label AREA-18**: (a) "PT1-BL2" (konsisten) atau (b) tetap "Blasting & Prime"?
2. **Search filter**: (a) area tanpa reservasi order di-HIDE total, atau (b) DIM + area relevan di-highlight?
3. **Sync tanggal** (PENTING): (a) auto-sync forward-only (future, 1.7rb baris data lama ikut disesuaikan sekali + terus sync), (b) sync semua termasuk riwayat, atau (c) tampilan ikut task schedule tanpa ubah data + default booking plan dates?
4. **Default booking**: isi otomatis tanggal dari plan dates task (saat pilih task berjadwal) — oke?
5. **Stack card**: 3 baris max + "+N more" expand — oke? (bukan 3 reservasi, tapi 3 baris visual)
6. **Lebar statik**: `min-w-[240px]` per area (scroll horizontal kalau sempit) — oke?

## 5. File yang kena (perkiraan)

- FE: `features/bayScheduling/constants.js` (+helper range label), `FloorMapOverview.jsx` (label+filter+layout), `SchedulingAreaPage.jsx` (search→filter state, height), `BayAreaDetail.jsx` (label), `ReservationPanel.jsx` (default dates), `OrderPanel.jsx` (badge count)
- Backend (jika 3a/3b): `msProjectService.js` (listBaySchedules join task plan dates / endpoint sync), migration/script sync 1x
- Deploy: build api+frontend (jika backend kena)

## 6. Urutan kerja

1. Konfirmasi keputusan → 2. Helper label + FE layout (3a, 3d) → 3. Search filter (3b) →
   4. Sync tanggal (3c sesuai pilihan) → 5. Verifikasi live BPN → 6. Port SSB + commit.
