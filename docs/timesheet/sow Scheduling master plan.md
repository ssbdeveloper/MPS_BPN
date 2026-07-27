---
tags: [domain/sow]
type: plan
status: active
---

# MPS2 — SOW Scheduling: Master Refactor & Feature Plan

> **Status:** Perencanaan (belum dieksekusi). Dokumen ini adalah satu sumber
> kebenaran untuk refactor besar fitur SOW Scheduling + fitur baru verifikasi.
> **Scope varian:** Kerjakan `salvaging/` dulu sebagai referensi. `manufacturing/`
> menyusul setelah pola terbukti (jangan dua-duanya sekaligus).

---

## 0. Cara pakai dokumen ini (untuk AI agent)

1. **JANGAN eksekusi seluruh dokumen dalam satu PR.** Ini master plan berfase
   (lihat §7). Kerjakan **satu fase per PR**, dengan review gate di antaranya.
2. **Investigate-first.** Beberapa item ditandai `🔍 INVESTIGATE` — laporkan temuan
   ke user SEBELUM mendesain/ngoding bagian itu. Jangan mengarang skema/data yang
   belum ada.
3. **Patuhi Hard Invariants (§2) tanpa kecuali.** Kalau sebuah rencana bertabrakan
   dengan invariant, berhenti dan lapor.
4. Setiap fase punya **Acceptance Criteria (§8)**. Jangan tandai selesai sebelum
   semua kriteria fase itu terpenuhi.
5. Tabel/kolom/endpoint baru: **ikuti konvensi penamaan & pola yang sudah ada** di
   repo (cek dulu migrasi & model existing). Nama di dokumen ini adalah usulan,
   sesuaikan dengan gaya repo.

---

## 1. Goals

- Menjadikan penjadwalan SOW salvaging **lebih powerful sekaligus lebih mudah
  dimengerti**: melihat beban & sekuens **lintas hari dan lintas shift** dalam satu
  pandangan (gaya Gantt/MS Project, diadaptasi ke finite-capacity + kantong batch).
- Menangani operasi **cross-midnight** (shift melewati tengah malam) dengan benar,
  baik visual maupun akuntansi.
- Menambah lapisan **plan-vs-actual (verifikasi harian, ringan)**: setiap hari
  verifier menandai tiap operasi (sudah / belum / dilewati / nyangkut) sehingga
  terlihat order mana yang "mental" dari rencana dan sekarang ada di mana.
- Memperbaiki **bottleneck performa & robustness** yang sudah teridentifikasi.
- Menambahkan **role Verifier** ke sistem RBAC.

---

## 2. Hard Invariants (JANGAN dilanggar)

| # | Invariant |
|---|-----------|
| I1 | **Kantong batch (batch pocket).** `used = SUM(planned_hours WHERE batch_id IS NULL) + SUM(batch_capacity_hours)`. Kantong mereservasi kapasitasnya sendiri; op di dalam batch **tidak** menambah pemakaian slot per individu. Semua fitur baru di dokumen ini **tidak boleh** mengubah akuntansi ini. |
| I2 | **DnD (@dnd-kit) tetap ada** sebagai cara utama menjadwal / memindah / reorder queue / assign manpower. |
| I3 | **Plan ≠ Actual.** Verifikasi **tidak menimpa** schedule. Rencana asli tetap utuh sebagai pembanding; aktual dicatat di lapisan terpisah; deviasi = turunan (dihitung), bukan hasil edit rencana. Re-plan hanya lewat aksi sadar terpisah. |
| I4 | **Operasi cross-midnight dihitung sekali.** Satu operasi yang membentang lintas hari tidak boleh dihitung dobel di dua slot/hari untuk akuntansi kapasitas. |
| I5 | **Design system.** Ikuti CLAUDE.md (grid responsif, ConfirmationModal bukan `confirm()`, toast sonner, status token korporat). |
| I6 | **State lokal (tanpa store)** sesuai aturan repo. |

**Status token (referensi warna, sudah disepakati):**
`normal/free = emerald` (`#ECFDF5` / `#047857` / `#059669`),
`watch/near = amber` (`#FEF3C7` / `#B45309` / `#F59E0B`),
`critical/over = red`.

---

## 3. Current state (ringkasan dari analisis sebelumnya)

- **Data:** 3 kelompok fetch — reference (shifts/machines/manpower), activities
  (paginated 100/hal, panel kiri drag), board (`fetchSchedules(500)` +
  `fetchCapacity(all)` + `fetchOvertime(500)` + `fetchBatches`).
- **Mutasi:** setiap handler sukses memanggil `refresh()` global
  (`setRefreshKey(v=>v+1)`) → memicu **loadActivities(page 1) + loadBoard** sekaligus.
- **Batch pocket:** `ScheduleModal` mode batch → pilih/create kantong → schedule
  di-assign `batch_id`; `DropZone` mengelompokkan jadi `BatchBox`.
- **Domain fields yang tersedia:** `production_order`, `operation_no`,
  `planned_queue_no`, `planned_hours`, `batch_capacity_hours`, `batch_id`,
  `schedule_date`, machine, shift (3 shift), manpower, capacity per slot, overtime.

**Bottleneck utama (bukti di analisis):** refresh global (P1), search tanpa debounce
(P2), CTE scan seluruh tabel (P3), board refetch wholesale (P4), node board tak
di-memo (P5); cap keras 500 memotong data diam-diam (D1); hanya 2 shift dirender
`shifts.slice(0,2)` (U2).

---

## 4. Glossary (domain)

- **Kantong batch / batch pocket:** reservasi kapasitas pada machine+shift+date
  (`batch_capacity_hours` = maks jam per operasi di dalamnya).
- **Mental / menyimpang:** eksekusi aktual berbeda dari rencana (urutan atau mesin).
- **Nyangkut:** operasi tertahan karena mesin berikutnya dipakai order lain.
- **Verifier:** user yang tiap hari mengecek & menandai status aktual operasi.
- **Routing order:** rangkaian operasi berurutan sebuah order (proses 1→N di mesin
  tertentu), direpresentasikan oleh `production_order + operation_no + planned_queue_no`.

---

## 5. Perubahan data model

> `🔍 INVESTIGATE` dulu: dump skema `sow_schedule`, `sow_overtime_request`,
> tabel batch, dan tabel order/operation yang ada. Konfirmasi nama & tipe sebelum
> membuat migrasi. Nama di bawah adalah **usulan**.

### 5.1 Lapisan AKTUAL — status eksekusi per operasi (BARU, untuk Fitur C)

> **⚠️ REVISI dari temuan F0 — baca sebelum implementasi.**
> Ternyata sudah ada DUA view yang menurunkan "aktual" dari data eksekusi nyata:
> - `vw_sow_plan_vs_actual_hours` — jam aktual dari `timesheet_transaction`
>   (planned_status, variance_hours, overtime_status).
> - `vw_sow_planned_queue_vs_actual_queue` — urutan/mesin aktual dari
>   `buffer_transaction` (comparison_status = ON_PLAN / EARLY / LATE /
>   MACHINE_CHANGED / PLANNED_NOT_YET_ACTUAL / UNPLANNED_ACTUAL).
>
> **Konsekuensi desain (KEPUTUSAN: lapisan manual MELENGKAPI view, bukan duplikasi):**
> - **Auto-derived (dari view, JANGAN disimpan/diinput manual):** "sudah dikerjakan",
>   deviasi mesin, deviasi urutan, "order sekarang di mana". Ini fakta dari lantai
>   produksi — biarkan data yang bicara. Menduplikasinya = dua sumber kebenaran yang
>   bisa bertentangan.
> - **Manual (yang view TIDAK bisa tahu):** `dilewati` (skipped) dan `nyangkut`
>   (blocked + alasan) + kemampuan **override** bila verifier melihat view keliru.

Grain: **satu baris per operasi** (`production_order` + `operation_no`), dibuat
hanya saat verifier menandai skipped/blocked/override (sparse — bukan satu baris
untuk semua op). **Tidak** menyentuh tabel rencana.

**Proposed table: `sow_operation_status`** (fokus input manual saja)

| Kolom | Tipe | Catatan |
|-------|------|---------|
| `id` | PK | |
| `production_order` | (match existing) | |
| `operation_no` | (match existing) | |
| `manual_flag` | enum | `dilewati` \| `nyangkut` (hanya yang butuh manusia; "sudah/belum" berasal dari view). |
| `blocked_reason` | nullable text | wajib bila `nyangkut`. |
| `blocked_by_machine_id` | nullable FK | mesin yang ditunggu (kepakai order lain). |
| `blocked_by_order` | nullable | order yang memakai mesin itu (opsional). |
| `override_note` | nullable text | bila verifier meng-override kesimpulan view. |
| `status_date` | date | tanggal status ini berlaku. |
| `updated_by` | FK user | verifier. |
| `updated_at` | timestamptz | |

Unique: (`production_order`, `operation_no`, **`machine_code`**, `status_date`) — grain
per mesin fisik, lihat KEPUTUSAN grain di bawah. Index: (`production_order`),
(`manual_flag`), (`status_date`).

> **Tampilan gabungan Fitur C = view aktual (auto) + overlay `sow_operation_status`
> (manual).** Sediakan satu view/query gabungan (mis. `vw_sow_operation_actual`) yang
> menggabungkan keduanya jadi satu status efektif per op untuk dikonsumsi UI.
>
> **KEPUTUSAN aturan preseden (untuk F2 — override menang, tapi jejak asli disimpan):**
> - Status efektif = **manual override bila ada, jika tidak fallback ke kesimpulan
>   view.** Verifier (lihat lapangan) menang atas tebakan otomatis.
> - **JANGAN timpa/hapus** kesimpulan asli view. View gabungan harus tetap
>   mengekspos KEDUANYA: `effective_status` (yang ditampilkan) + `view_status` (asli,
>   untuk audit) + `overridden_by`/`override_note`/`overridden_at`.
> - Alasan: (a) verifikasi tak berarti kalau layar mengabaikan koreksi manusia;
>   (b) menyimpan nilai asli memungkinkan audit ("seberapa sering & kenapa
>   di-override") — konsisten dengan prinsip I3 (jangan hapus info, catat selisih).
> - Implementasi: bukan `COALESCE` polos (yang membuang salah satu); pilih efektif
>   via preseden TAPI tetap SELECT kedua kolom.
>
> **KEPUTUSAN grain (F2 — per MESIN FISIK / `machine_code`).**
> **⚠️ KOREKSI dari keputusan "per workcenter" sebelumnya — investigasi membuktikan
> workcenter itu sumbu yang salah.** Temuan: kolom `workcenternew` (mis. `M5051CP3`)
> dan `workcenteror`/OT (mis. `M55CP3OT`) itu **mesin fisik yang SAMA** (`machineid`
> = TNK03) — normal vs OT cuma atribut waktu, bukan unit kerja. Yang tampak
> "multi-workcenter" (op 370 = 6) sebenarnya 3 mesin fisik × 2 konteks normal/OT,
> dan itu pun fragmen `UNPLANNED_ACTUAL` tanpa plan. Data global: planned op yang
> menyentuh >1 mesin fisik ≈ nol (1 kasus); `machine_code` = `machineid` 100% andal
> (0 unmapped, 0 selisih di 32.345 baris).
>
> Maka:
> - Grain kanonik = **(production_order, operation_no, machine_code, status_date)** —
>   per (operasi, mesin fisik, hari). Ini meng-collapse normal/OT (keduanya
>   `machine_code` sama) **dan** tetap menjaga dimensi mesin (bermakna untuk lapisan
>   aktual yang sering multi-mesin: 1.602 grup).
> - `sow_operation_status` & `sow_verification_log`: kolom `machine_code` (bukan
>   `workcenter`); UNIQUE `(production_order, operation_no, machine_code, status_date)`.
> - **WAJIB — view ikut pindah grain:** `vw_sow_operation_actual` **di-agregasi** ke
>   (order, op, machine_code, hari) → normal+OT dijumlah jadi **satu baris per mesin
>   fisik**. Jangan tinggalkan view di grain workcenter lama, atau satu override akan
>   nempel ke 2 baris (normal+OT) dan agregasi dobel lagi. Grain tabel & grain view
>   harus sama.
> - Guard eksistensi & controller: kirim/simpan `machine_code` (= `machineid`), bukan
>   `workcenter`.
> - **Implikasi F3:** roll-up tinggal satu tingkat (mesin fisik → operation) bila UI
>   mau ringkasan per-op. Karena planned op ~selalu 1 mesin fisik, kebanyakan op cuma
>   punya 1 baris mesin — tampilan sederhana. Aturan worst-case (§ badge "n/m") baru
>   relevan pada op langka yang aktualnya lintas mesin.

### 5.2 Log verifikasi harian (BARU — audit trail, append-only)

Untuk menjawab "tiap hari verifikasi": jejak siapa memverifikasi apa & kapan.

**Proposed table: `sow_verification_log`**

| Kolom | Tipe | Catatan |
|-------|------|---------|
| `id` | PK | |
| `verification_date` | date | hari verifikasi |
| `production_order` | | |
| `operation_no` | | |
| `status_before` | enum | snapshot |
| `status_after` | enum | |
| `deviation_flags` | jsonb/text[] | mis. `["sequence","machine","skipped"]` (turunan saat verifikasi) |
| `verified_by` | FK user | |
| `verified_at` | timestamptz | |
| `note` | nullable text | |

Index: (`verification_date`), (`production_order`).

### 5.3 Deviasi = TURUNAN (jangan disimpan sebagai sumber kebenaran)

Hitung on-the-fly (view/query), bukan kolom yang diedit manual:

- `machine_deviation` = `actual_machine_id` ≠ mesin terjadwal di `sow_schedule`.
- `sequence_deviation` = urutan penyelesaian aktual ≠ `planned_queue_no`.
- `skipped` = `status = 'dilewati'`.
- `blocked` = `status = 'nyangkut'`.

**"Order sekarang di mana" = model FRONTIER + HUTANG (bukan satu titik).**
> **KEPUTUSAN domain:** op yang `dilewati` (dilompati karena mesin kepakai) itu
> **hutang** — tetap wajib dikerjakan belakangan, bukan dibuang. Maka "order di mana"
> punya DUA komponen, keduanya harus ditampilkan:
> - **Frontier aktif** = op maju yang sedang/berikutnya dikerjakan (op `belum`
>   pertama setelah op `sudah` terakhir, boleh melewati op `dilewati`).
> - **Hutang** = daftar op `dilewati` yang belum lunas (belum punya record `sudah`
>   di tanggal manapun). Ini yang membuat order "menyimpang" dan HARUS nonjol —
>   frontier yang maju TIDAK boleh menyembunyikan hutang. Order dengan hutang tak
>   boleh tampil hijau walau frontier-nya maju.
> - **Pelunasan hutang:** op hutang lunas otomatis saat kelak berstatus `sudah` di
>   tanggal lain (verifier menandai `sudah` biasa — tanpa flag khusus). Frontier scan
>   lintas-hari: `dilewati` + ada `sudah` belakangan → lunas; `dilewati` tanpa `sudah`
>   → masih hutang.
> - Warna order (worst-case): ada hutang/`nyangkut` → merah; loncat-urutan implisit
>   saja (`behind_frontier` masih `belum`) → amber; frontier maju tanpa masalah → hijau.

**View `v_sow_order_progress` (F3a — bangun SEBELUM UI F3b).**
> **⚠️ KOREKSI dari investigasi F3a — dua asumsi awal §5.3 salah di data nyata:**
> - **Urutan kanonik = `operation_no`, BUKAN `planned_queue_no`.** `planned_queue_no`
>   99,9% NULL (29/30.275) dan yang terisi bertabrakan (op 110 & 120 sama-sama queue=1)
>   karena itu posisi antrian per-mesin, bukan urutan routing order. `operation_no`
>   (2 null di 30k) = urutan routing sebenarnya.
> - **Frontier ≠ "op belum pertama setelah sudah terakhir"** — definisi ketat itu
>   menghasilkan NULL untuk order yang **loncat** (op belakang selesai, op depan
>   tertinggal), dan loncat itu UMUM (inti juggling salvaging). Model refined:
>   - `frontier_op` = op undone (`belum`/`nyangkut`) **TERENDAH** by `operation_no` =
>     "menurut routing order seharusnya di sini". `dilewati` di-skip ke hutang.
>   - `highest_done_op` = sejauh mana order sudah loncat.
>   - `debt_ops` = `dilewati` belum lunas. `blocked_ops` = `nyangkut`.
>   - `behind_frontier_ops` = op undone dengan `operation_no < highest_done_op` =
>     **skip implisit yang belum ditandai verifier** (order loncat maju tanpa ada yang
>     menandai op tertinggal sebagai `dilewati`). Ini memunculkan hutang tersembunyi
>     → nilai utama untuk verifier.
> - Status kolaps per (order, op) pakai **effective_status** (override menang) lintas
>   tanggal: `sudah` bila effective='sudah' di tanggal MANA PUN (hutang lunas otomatis).

Scan urutan op sebuah order lintas tanggal (urut `operation_no`), tentukan frontier +
hutang + behind_frontier per order. Read-only, turunan, patuh I3. Karena aturan
frontier ini **definisi inti** fitur, `v_sow_order_progress` diverifikasi terhadap
order nyata dulu, terpisah dari UI.

### 5.4 Cross-midnight (KONDISIONAL — untuk Fitur B timeline akurat)

> **✅ RESOLVED oleh F0 — timestamp SUDAH ADA, F5 frontend-only.**
> - `sow_schedule`: `planned_start_datetime` / `planned_end_datetime` (timestamptz),
>   terisi 40/41 baris (1 legacy null).
> - `shift_definition`: flag eksplisit `crosses_midnight` + `start_time`/`end_time`.
> - `sow_overtime_request`: `overtime_start_datetime`/`overtime_end_datetime` NOT NULL.
> - `sow_schedule_batch`: `batch_start_datetime`/`batch_end_datetime` (nullable).
>
> **Tidak perlu migrasi timestamp.** Dua hal yang tetap harus dikerjakan di F5:
> - (a) FE saat ini belum mengambil kolom datetime — `fetchSchedules` harus
>   mengembalikan `planned_start/end_datetime` agar timeline bisa render.
> - (b) **Fallback** untuk 1 baris legacy null + batch rows datetime null: turunkan
>   dari shift window (`crosses_midnight` + `start_time`/`end_time`), atau backfill.

### 5.5 RBAC — role & permission (BARU, untuk Fitur D)

Tambah ke **permission matrix terpusat** (lihat RBAC framework yang sudah dibangun):

- Role baru: `verifier`.
- Fitur `sow_scheduling`: verifier = `read_only` (boleh lihat board/timeline, tidak
  boleh create/move/delete schedule).
- Fitur baru `sow_verification`: verifier = `full_access`; supervisor/planner sesuai
  kebutuhan; role lain `no_access` atau `read_only`.
- Tegakkan di **dua lapis**: route guard + action guard (`can('sow_verification','write')`).
- **Backend wajib memvalidasi** endpoint verifikasi (frontend RBAC hanya UX).

---

## 6. Feature specs

### A. Performa & Robustness (fondasi — kerjakan lebih dulu)

Tujuan: matikan sumber lambat & data-hilang-diam-diam sebelum menumpuk fitur baru.

- **A1.** Ganti `refresh()` global → invalidation bertarget: pisah `refreshBoard()`
  vs `refreshActivities()`; tiap handler panggil yang minimal. (P1, P4, U1)
  - Untuk mutasi yang **mengubah kapasitas** → **targeted refetch**, JANGAN optimistic
    (agar akuntansi batch tidak divergen dari server, jaga I1). Optimistic hanya untuk
    aksi non-kapasitas.
- **A2.** Debounce search 300ms; pertahankan page & scroll position. (P2, U1)
- **A3.** `React.memo` untuk `MachineCard`/`DropZone`/`OvertimeRow` + callback stabil. (P5)
- **A4.** State **loading / empty / error + retry** (skeleton board & activity). (U6)
- **A5. KOREKTNES — angkat dari "nanti":**
  - **U2:** render **semua shift** (hapus `shifts.slice(0,2)`), termasuk shift ke-3.
  - **D1:** cap 500 (`SCHEDULE_LIMIT`) — **beri peringatan visibel** bila data
    terpotong; rencanakan paginate board per mesin.
- **A6.** Backend index — **menyusut (F0):** mayoritas index sudah ada
  (`idx_sow_schedule_sow`, `_machine_shift`, `_window`, overtime `_sow`/`_status`).
  Cukup tambah **2 index kecil**: `schedule_date` tunggal & `batch_id`. Low-priority
  (data masih kecil), boleh sekalian di F1.
- **A7.** ~~date-scope CTE~~ **DIBATALKAN (F0):** CTE `schedule_totals` **bukan bug**
  — sengaja lifetime (`remaining_hours = planhours − scheduled(lifetime) −
  approved_overtime(lifetime)`). Date-scoping akan menyebabkan **double-scheduling**.
  Biaya nyata bukan di CTE ini (sow_schedule=41 baris) melainkan scan tabel `sow`
  (~79.867 baris) + LATERAL join per keystroke → **sudah ditangani A2 (debounce)**.
  Tidak ada perubahan pada CTE.

### B. Timeline MULTI-HARI (cross-midnight)

Tujuan: melihat beban & sekuens lintas hari & lintas shift sekilas.

- **B1.** View timeline: **mesin = swimlane (baris)**, waktu mengalir horizontal
  melintasi beberapa hari. Toggle antara "papan kapasitas" (existing) ↔ "timeline".
- **B2.** Rentang default & navigasi: usulkan (mis. 3 hari / 1 minggu) + scroll/paging
  waktu. Jaga keterbacaan — blok jangan terlalu tipis saat banyak hari (usulkan skala:
  per jam vs blok shift, mungkin adaptif).
- **B3.** **Cross-midnight:** operasi/overtime yang membentang lintas hari digambar
  sebagai **satu blok kontinu** melewati batas hari; batas shift & batas hari terlihat
  jelas (garis pemisah) tanpa memotong blok. Akuntansi tetap sekali (I4).
- **B4.** **Kantong batch di timeline:** satu kantong = satu container berisi beberapa
  op + kapasitasnya (cerminkan `BatchBox`, jaga I1).
- **B5.** **Overtime** digambar sebagai ekor setelah shift (termasuk bila ia sendiri
  cross-midnight).
- **B6.** **DnD di timeline:** reschedule antar slot/hari, reorder queue
  (`planned_queue_no`), drag manpower ke overtime — konsisten dengan board.
- **B7.** **Insight sekilas (tanpa klik):** slot over-capacity, mesin idle,
  overlap/konflik, jumlah unscheduled, batch penuh vs longgar, blok cross-midnight.
  Encoding + legenda pakai status token.

### C. Verifikasi harian plan-vs-actual (RINGAN)

> **⚠️ KEPUTUSAN SUMBER STATUS (dari investigasi TECO+FINISH — mengoreksi asumsi awal
> "sudah dari timesheet"):**
> - **Op selesai final = ada op TECO di order (`ph3_order.order_description='TECO'`).**
>   TECO administrasi = per order (walau data per-op, update borongan SAP CPI). Aturan:
>   `EXISTS ≥1 op TECO dalam order → seluruh order selesai → LENYAP dari halaman
>   verifikasi`. No debat. (Distribusi: 685 full / 54 mixed / 2456 none dari 3195.)
> - **"Sudah" per-op (order belum-TECO) = `sow.status='FINISH'`**, BUKAN jam timesheet.
>   FINISH = konfirmasi sadar lapangan. (Cakupan saat ini tipis ~27% karena operator/
>   foreman sering lupa — akan bertambah; verifier ikut mengisi via F3c.) Timesheet =
>   catatan kerja on-going (durasi, mesin siap pindah), BUKAN penentu status.
> - **Pindahkan "sudah"=FINISH ke BASE VIEW** (`vw_sow_operation_actual`), bukan hanya
>   `v_sow_order_progress` — agar kartu & ladder tak kontradiksi (satu sumber). Ini
>   mengubah perilaku base → **gate EXCEPT 0/0 TIDAK berlaku lagi**; ganti gate =
>   verifikasi frontier terhadap referensi order-uji yang diperiksa manual.
> - **TECO-mixed (54, ~1.7%) = sinyal kesalahan kirim SAP CPI** → backlog EWS terpisah
>   (alert integritas), BUKAN F3. Order mixed tetap dianggap selesai (ada TECO) = lenyap.
>
> **PERAN VERIFIER (ditetapkan):** foreman & operator = yang HARUS finish (jalur utama,
> sudah jalan + buffer out). **Verifier = JARING PENGAMAN** — nangkep finish yang
> kelupaan + nandai yang hanya dia tahu (mental/nyangkut), karena dia yang memindahkan
> order antar mesin. Foreman (PC, summary per order) & operator (tablet, per mesin) =
> halaman terpisah, di luar F3.

Tujuan: tiap hari, verifier menandai status aktual tiap operasi; sistem menandai yang
mental & menunjukkan posisi order.

- **C1.** Status per operasi: **sudah / belum / dilewati / nyangkut** (§5.1). Ringan —
  tanpa jam mulai-selesai aktual (bukan MES penuh).
- **C2.** `nyangkut` wajib bisa merekam **alasan** (`blocked_reason`) + opsional
  mesin/order yang ditunggu — ini insight kunci salvaging.
- **C3.** **Alur harian verifier (minim klik):** buka daftar order aktif hari ini →
  lihat *planned next step* vs *posisi aktual* → set status per op (satu tap) →
  submit → sistem menandai deviasi & menulis `sow_verification_log`.
- **C4.** **Tampilan variance:** order sesuai rencana vs mental, pakai status token
  (`emerald` = sesuai, `amber` = menyimpang ringan/urutan beda, `red` = nyangkut/telat).
- **C5.** **"Order ini sekarang di mana"** = turunan (§5.3), ditampilkan per order.
- **C6.** **Integrasi ke timeline (Fitur B):** overlay/penanda posisi aktual di atas
  blok rencana (mis. blok rencana + marker aktual, atau warna status per op).
  *Konsep dulu; render penuh boleh menyusul.*
- **C7.** Deviasi **tidak menimpa** rencana (I3). Sediakan aksi terpisah
  **"re-plan dari operasi ini"** (opsional, fase akhir) untuk memperbarui rencana
  secara sadar.
- **C8. Kontrak mark (F3b — MENGIKAT, cegah bug status_date kambuh):**
  > **⚠️ KOREKSI (gate FINISH): op-set frontier = `sow` routing penuh, BUKAN base
  > timesheet.** `vw_sow_operation_actual` grain-nya = op ber-aktivitas saja (subset).
  > Saat "sudah"=FINISH (dari `sow`, independen aktivitas), base jadi subset bolong →
  > frontier melompati op routing tanpa aktivitas (terbukti: 1000123166 frontier 300
  > vs benar 30, 3/4 order salah). Maka:
  > - `v_sow_order_progress` + ladder `order-operations` dihitung di atas **`sow`**
  >   (semua op per order, 1 baris/op, punya `status`). `ever_sudah`=(`sow.status='FINISH'`);
  >   overlay manual join per (order, op); exclude TECO.
  > - `vw_sow_operation_actual` TETAP untuk jam/deviasi/ladder-display — LEFT JOIN dari
  >   `sow` (bukan sumber op-set).
  - **Display ≠ target mark.** Kartu menampilkan `frontier_machine` untuk dibaca,
    TAPI saat menandai, payload memakai **baris konkret** (`machine_code` + `schedule_date`).
  - **Op ghost (di `sow` routing, TANPA baris base) SEKARANG PERLU fallback pure-manual.**
    (Dulu dinyatakan "tak perlu" saat op-set=base & ghost=0; setelah op-set=`sow`, op
    tanpa aktivitas bisa jadi frontier/behind & harus bisa ditandai.) Mark op ghost:
    machine dari `sow.workcenter`/machineid, `status_date`=tanggal verifikasi (baris
    manual murni). **Guard F2 butuh cabang kedua:** kalau op ada di `sow` routing tapi
    belum ada baris aktivitas → izinkan mark (validasi ke `sow` master, terkontrol —
    bukan bebas). Jangan sampai guard menolak op ghost diam-diam.
  - `verification_date` (audit, current_date) DIPISAH dari `status_date`.
  - **Di luar scope F3b:** op yang tak ada di `sow` routing sama sekali.
  - **Chip alasan `nyangkut` (F3b):** mesin dipakai order lain / tunggu material /
    tunggu tools / mesin rusak / tunggu QC / tunggu drawing / lainnya (single-select
    + opsi ketik manual). Mudah ditambah (array FE).
- **C9. Tombol FINISH verifier — DITUNDA (bukan F3b).**
  > **KEPUTUSAN (A): verifikasi dasar jalan dulu; SEMUA aksi berefek-fisik dikelompokkan
  > jadi fase terpisah "F-FISIK" yang dipikir matang bersama** — karena finish, unfinish,
  > dan rework sama-sama menyentuh `sow.status` + `buffer_transaction`, dan tidak boleh
  > dicicil setengah-setengah.
  >
  > **F3b (sekarang) = verifikasi dasar AMAN saja:** read posisi (frontier/hutang/behind)
  > + tandai mental (dilewati/nyangkut) via overlay. TIDAK ada finish/unfinish/rework.
  > Verifier hari pertama: lihat order di mana + tandai yang mental. Sudah berguna, aman.
  >
  > **F-FISIK (fase besar terpisah, setelah F3b) — semua menyentuh buffer, rancang bersama:**
  > 1. **Idempotensi finish (BUG existing, benerin duluan):** endpoint finish tak punya
  >    `AND status<>'FINISH'` → double-tap operator = buffer-out ganda. Kena SEMUA pemakai.
  > 2. **Atribusi finish:** tak ada kolom "siapa finish" (hanya machine_id). Perlu
  >    `finished_by` atau via `sow_verification_log` — agar finish-verifier (jaring
  >    pengaman) terbedakan dari operator (metrik kelalaian).
  > 3. **Finish verifier** (jaring pengaman, tablet) — panggil endpoint finish yang SAMA
  >    (jaga buffer out konsisten) + konfirmasi keras (finish irreversible).
  > 4. **Unfinish-koreksi** (salah-pencet) — hanya ADMIN/SUPERVISOR. Investigasi dulu:
  >    balik buffer (hapus vs 'in' penyeimbang) + race condition (mesin sudah dipakai
  >    order lain sejak finish → tolak/peringatkan) + idempotensi.
  > 5. **REWORK** (alur produksi harian, ⚠️ RISIKO AUDIT) — lihat C10.
  >
  > Finish verifier TIDAK dinyalakan sampai unfinish siap (sesuai keputusan "unfinish
  > wajib dari awal" — verifier tak boleh bisa finish tanpa bisa dibatalkan).

- **C10. REWORK (fitur terpisah, prioritas tinggi setelah F3b — RISIKO AUDIT AKTIF):**
  > Op yang sudah FINISH bisa DITOLAK di mesin berikutnya (kurang prosedur/cacat) →
  > barang harus BALIK ke proses sebelumnya untuk dikerjakan ulang. **Kejadian TIAP HARI.**
  > **Saat ini TIDAK ADA catatan sama sekali** → lolos audit, jadi temuan, risiko SP.
  > Ini bukan enhancement opsional — ini lubang fungsional berisiko yang sudah berjalan.
  >
  > Rework ≠ unfinish-koreksi. Rework = kejadian NYATA (barang beneran gerak balik),
  > bukan pembatalan input. Maka:
  > - Buffer: barang keluar (buffer-out tetap valid, beneran terjadi) LALU masuk lagi
  >   ke proses sebelumnya (buffer-in baru). Dua-duanya tercatat — JANGAN hapus buffer-out.
  > - Butuh input: PILIH op tujuan balik (tak selalu op tepat sebelumnya) + alasan tolak.
  > - Jejak sejarah utuh: op di-rework berapa kali, ditolak di mana, balik ke mana
  >   (metrik kualitas — prinsip I3: catat kejadian, jangan hapus).
  > - Aktor: operator/supervisor. RBAC menyusul.
  > Investigasi semantik buffer + alur balik dulu sebelum bangun. Fase sendiri.

### D. RBAC — role Verifier

- **D1.** Tambah role `verifier` + entri permission (§5.5) ke matrix terpusat.
- **D2.** Route guard: verifier `no_access` ke halaman tanpa izin; `read_only` di
  scheduling; `full_access` di verifikasi.
- **D3.** Action guard: sembunyikan/disable tombol write scheduling untuk verifier.
- **D4.** Backend middleware memvalidasi endpoint verifikasi write.

---

## 7. Rencana eksekusi berfase

> Satu fase = satu PR = satu review gate. Jangan gabung.

| Fase | Isi | Sifat | Prasyarat |
|------|-----|-------|-----------|
| **F0 — Investigasi** | Jalankan semua `🔍 INVESTIGATE` (§5.4 cross-midnight, §5.1 apakah lapisan aktual sudah ada, §A7 CTE). **Lapor temuan, jangan ngoding.** | Read-only | — |
| **F1 — Perf & korektnes** | A1–A6 (invalidation bertarget, debounce, memo, loading/error, semua shift, surface cap-500, index). **Nol perubahan perilaku batch.** | FE + index | F0 |
| **F2 — Data model verifikasi** | Migrasi §5.1 `sow_operation_status` + §5.2 `sow_verification_log` + view §5.3. Endpoint CRUD status + validasi backend. | Backend | F0 |
| **F3 — Fitur C (verifikasi UI)** | Alur harian verifier C1–C5, variance view, "order di mana". | FE | F2 |
| **F4 — RBAC verifier** | Fitur D (role, guard 2 lapis, middleware). | FE + BE | RBAC framework existing |
| **F5 — Timeline multi-hari** | Fitur B1–B7 (+ backend timestamp bila F0 menyatakan perlu). Referensi Timeline Fase-3 analisis. | FE (± BE) | F0, F1 |
| **F6 — Integrasi & polish** | C6 overlay aktual di timeline; C7 re-plan sadar; konsistensi token & responsif akhir. | FE | F3, F5 |

**Urutan yang disarankan:** F0 → F1 → F2 → F3 → F4 → F5 → F6.
(F5 timeline sengaja setelah verifikasi jalan, agar overlay aktual bisa langsung
diintegrasikan; tapi F5 bisa didahulukan bila prioritasnya visual.)

---

## 8. Acceptance criteria

**F0**
- Laporan tertulis: representasi cross-midnight saat ini; ada/tidaknya lapisan aktual;
  status `schedule_totals` (bug vs lifetime). Rekomendasi backend bila diperlukan.

**F1**
- Setelah drop/mutasi, panel kiri **tidak** reset ke page-1 & scroll tetap.
- Mutasi non-kapasitas tidak memicu board+activities refetch sekaligus.
- **Semua shift** (termasuk ke-3) tampil.
- Bila hasil > cap 500 → ada indikasi terpotong (bukan hilang diam-diam).
- Index terpasang; **akuntansi batch (I1) identik** sebelum/sesudah.
- Board punya state loading/empty/error + retry.

**F2**
- Tabel & view terbuat sesuai konvensi repo; migrasi reversible.
- Endpoint status: create/update tervalidasi di backend; menulis `sow_verification_log`.
- **Tidak ada** kolom/endpoint yang menimpa tabel rencana (I3).

**F3**
- Verifier bisa set status 4-state per op dalam alur ≤ beberapa tap/op.
- `nyangkut` menyimpan alasan.
- Order yang mental tertandai otomatis (deviasi turunan), token warna benar.
- "Order sekarang di mana" akurat terhadap status aktual.

**F4**
- Verifier: scheduling read-only (tombol write hilang/disable), verifikasi full.
- Route `no_access` benar-benar terblokir (bukan sekadar disembunyikan).
- Endpoint verifikasi ditolak backend untuk role tanpa izin.

**F5**
- Timeline menampilkan beban lintas hari & lintas shift.
- Operasi cross-midnight = **satu blok kontinu**, batas hari/shift jelas, **tidak**
  dihitung dobel (I4).
- DnD berfungsi di timeline; batch digambar sebagai container (I1).
- Insight §B7 terbaca sekilas dengan legenda.

**F6**
- Posisi aktual tervisual di timeline di atas rencana.
- Re-plan hanya via aksi sadar terpisah; rencana asli tetap sebagai baseline.

---

## 9. Open questions (putuskan bila muncul saat eksekusi)

1. Rentang default timeline: 3 hari atau 1 minggu? (default sementara: 3 hari)
2. Skala waktu timeline: per jam vs blok shift vs adaptif? (usulkan di F5)
3. Perlukah status ke-5 `dikerjakan` (in-progress)? (default: tidak, cukup 4)
4. Retensi `sow_verification_log`: simpan berapa lama? (default: semua)
5. Re-plan (C7): apakah membuat versi rencana baru atau edit in-place dengan audit?
   (default: edit in-place + log, putuskan di F6)

---

*Catatan: kerjakan bertahap, patuhi Hard Invariants, dan berhenti di setiap review
gate. Kantong batch dijaga persis di seluruh fase: kantong mereservasi
`batch_capacity_hours`, op dikelompokkan di `BatchBox`, akuntansi =
`SUM(unbatched) + SUM(batch_capacity)`.*