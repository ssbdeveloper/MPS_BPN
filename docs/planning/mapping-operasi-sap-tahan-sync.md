---
type: plan
status: active
tags: [domain/msproject, domain/sow]
---

# Mapping operasi SAP yang tahan sync MS Project

> Revisi 2026-09-05 (verifikasi DB + keputusan owner) — spec ini SETUJU diimplementasi.
> Keputusan §8 dijawab owner 2026-09-05 (1a 2a 3b 4a); temuan verifikasi di bawah
> mengoreksi angka & cakupan backfill spec asli. Status: `planning` → `active`.
> Dasar: [[concepts/order-no-spine]], [[MFG_PLAN_AREA_PLAN]] (D2, D4),
> [[log/2026-09-04-workcenter-repolusi-dan-filter-mapping-operasi]].
>
> **Revisi 2026-09-07 (keputusan owner 1b 2a 3b — follow-up "jadwal tidak keambil")**:
> Reservasi & jadwal boleh nempel di task MS Project MANA PUN — leaf ATAU summary — yang
> penting start/finish diambil dari task itu (summary = rollup anak-anaknya). Sebagian D2
> dicabut: summary bukan lagi target terlarang (assign op ke summary diizinkan; pool "Ada
> jadwal" & layar operator ikut). Layar operator hanya menampilkan reservasi task yang
> punya `order_no` + `operation_no`. Backfill `20260907_..._follow_schedule.sql` memindahkan
> mapping yang task-nya mati/orphan ke carrier aktif ber-uid (file nyata) — lihat
> [[log/2026-09-07-mapping-reservasi-summary]].

## 1. Masalah

Operasi SAP yang sudah dipetakan ke task MS Project bisa **hilang diam-diam** dari picker
reservasi di `/sow-scheduling/area`. Tidak ada error, tidak ada penanda, tidak ada jejak di
`updated_at`. Scheduler membuka panel reservasi dan operasinya sekadar tidak ada.

Kasus yang memicu spec ini — order `1000131015`, operasi `0070`:

| Waktu | Kejadian |
|---|---|
| 13 Agu 11:46 | Impor .mpp. Node summary `FRAME ASSY` (2.1.2.1) membawa `operation_no = '0070'` dari file |
| 13 Agu 18:33:56 | Operasi `70` dipetakan lewat `/sow-scheduling/map` ke task daun `FAB FRAME ASSY` (2.1.2.1.7). Benar: leaf, aktif, `sow_id = 1200294`. Tercatat di `ms_project_audit_log` sebagai `MAP_SOW_OPERATION` |
| 3–4 Sep | Tiga siklus CHECKOUT → edit di MS Project → UPLOAD → SYNC. Cabang 2.1.2.1 direstrukturisasi jadi sub-tree baru (FLOOR / RIGHT SIDE / LEFT SIDE / FRONT FRAME ASSEMBLY) |
| Sekarang | `FAB FRAME ASSY` → `is_active = false`. Tidak satu pun leaf baru membawa `operation_no`. Yang tersisa membawa `0070` hanyalah node summary dari impor |

**Kenapa tidak muncul (3 syarat yang harus lolos sekaligus):** picker lama (`listOrderTasks`)
hanya menampilkan task dengan `is_active = true` **dan** `is_summary = false` **dan**
`operation_no` tidak kosong. Pada kasus ini: `FRAME ASSY` gugur karena summary; `FAB FRAME
ASSY` gugur karena mati oleh sync; leaf baru gugur karena tidak membawa `operation_no`.
Bukan filter tanggal — `listOrderTasks` tidak punya kondisi tanggal.

### Skala (diukur 2026-09-07, diverifikasi ulang 2026-09-05 — read-only)

| Metrik | Spec asli | Verifikasi ulang | Catatan |
|---|---:|---:|---|
| Mapping mati (`sow_id` terisi & `is_active=false`) | 40 | **40** | 27 kunci (order,op) unik — ada duplikat mati |
| Order terdampak | 15 | **15** | |
| Project terdampak | 7 | **7** | |
| Task summary ber-`operation_no` | 121 | **147** | data bergerak sejak ukur pertama |
| Mapping by-op aktif tanpa `sow_id` (populasi B) | tidak diukur | **1.236** | lihat §2 — temuan utama revisi |
| Task mati by-op yang op-nya cocok sow | tidak diukur | **21** | TASK_LOST tersembunyi |

Sebagai pembanding: `sow` berisi 14.133 baris operasi di 292 order.

## 2. Akar masalah

> **Mapping disimpan sebagai kolom di atas baris yang dimiliki dan ditimpa MS Project.**

`order_no`, `operation_no`, dan `sow_id` adalah kolom pada `ms_project_task`. Baris itu milik
file .mpp. `syncProject` menonaktifkan task yang tidak ada lagi di file
(`applyExplicitDeactivate`, `msProjectService.js:1059-1064`) **tanpa menyentuh `updated_at`**
— perubahan nyaris tidak bisa dilacak.

**Revisi: ada DUA populasi mapping, spec asli hanya menghitung satu.**

| Populasi | Asal | Bentuk | Jumlah (2026-09-05) |
|---|---|---|---|
| A — `sow_id` terisi | aksi `/map` (mapSowOperationToTask) | task ber-sow_id | 428 aktif + 40 mati |
| B — by-`operation_no` | impor .mpp membawa op (mis. `'0010'`, `'0170'`) | task aktif ber-op, sow_id NULL, op cocok sow | 1.236 aktif + 21 mati |

Populasi B tampil di picker hari ini dan headcount-nya bisa di-write-back (lewat int cast),
jadi secara fungsi ia mapping — tapi tanpa `sow_id`, kehilangannya tidak pernah terhitung
oleh metrik lama. Backfill wajib mencakup keduanya.

Bukti mapping berperilaku sebagai entitas ber-kunci `(order_no, operation_no)`:

```sql
CREATE UNIQUE INDEX uq_ms_project_task_order_op
  ON ms_project_task (ltrim(order_no,'0'), operation_no)
  WHERE is_active AND NOT is_summary AND order_no IS NOT NULL AND operation_no IS NOT NULL
```

Index parsial ini GLOBAL (tanpa `project_id` — komentar lama "index unik hanya per-project"
di baris 1704 **basi**, diperbaiki saat implementasi). Begitu `is_active` berubah jadi false,
barisnya keluar dari index dan mapping-nya lenyap tanpa melanggar apa pun. Catatan: index
membandingkan `operation_no` **mentah** (`'0070'` ≠ `'70'`), jadi duplikat tekstual bisa
hidup berdampingan — alasan §4.4 wajib.

## 3. Yang TIDAK diubah — eksplisit di luar cakupan

1. **Reservasi tetap task-level.** Keputusan **D2** ([[MFG_PLAN_AREA_PLAN]] §R0) dipertahankan.
   `ms_project_bay_schedule` tetap memakai FK `(project_id, task_id)`. Operasi tanpa task aktif
   **tidak** menjadi bisa direservasi — ia hanya menjadi **terlihat** beserta alasannya.
2. **Tidak ada data PPC yang ditulis ke `sow`.** `sow` adalah cermin ETL SAP dan ditimpa tanpa
   guard setiap siklus. Menaruh jadwal atau penanda di sana mengulang kesalahan yang sudah
   ditolak **D4**. `sow` hanya **dibaca**. `people_required` (write-back headcount) tidak
   diubah — kolom itu bukan payload ETL.
3. **Tidak menyentuh workcenter** (repolusi `[n%]` punya rencana sendiri).
4. **Tidak mengubah importer .mpp.** 147 baris summary ber-`operation_no` dibiarkan (keputusan
   §8.4); halaman mapping yang menandainya.
5. **Tidak ada perubahan UI di luar dua halaman** yang disebut §5 (panel reservasi + map page).

## 4. Desain

### 4.1 Pemilik data dipisah tegas

| Data | Pemilik | Tempat | Boleh ditulis PPC? |
|---|---|---|---|
| Daftar operasi | SAP (ETL) | `sow` | Tidak |
| Jadwal (`plan_start` / `plan_finish`) | MS Project | `ms_project_task` | Tidak (sync yang menulis) |
| **Mapping operasi → task** | **PPC** | **tabel baru** | Ya |

### 4.2 Tabel baru

```sql
create table sow_operation_task_map (
  order_key      text not null,          -- ltrim(order_no,'0'), dinormalisasi saat tulis
  operation_key  integer not null,       -- lihat §4.4
  project_id     uuid not null,
  task_id        uuid not null,
  sow_id         integer,                -- idsow saat dipetakan, untuk telusur
  mapped_by      text,
  mapped_at      timestamptz not null default now(),
  primary key (order_key, operation_key)
);
create index idx_sow_operation_task_map_task on sow_operation_task_map (task_id);
```

Kunci primer `(order_key, operation_key)` **global 1:1** menggantikan peran
`uq_ms_project_task_order_op`, tapi **tidak bergantung pada `is_active`** — sync tidak bisa
menghapusnya. `task_id` sengaja **tanpa FK**: baris mapping harus tetap hidup saat task-nya
dinonaktifkan — justru itulah keadaan yang perlu dilaporkan.

Kolom `order_no`/`operation_no`/`sow_id` di `ms_project_task` **tetap ada dan tetap
di-stempel** oleh aksi map (nama task & jam tetap disinkron ke MSP) — tapi bukan lagi sumber
kebenaran mapping; tabel ini yang dipakai picker. Kolom task yang tertimpa sync (op dikosongkan
karena leaf baru tak membawa op) tidak lagi menghancurkan mapping.

### 4.3 Picker area membaca dari `sow`

`listOrderTasks` ganti sumber: semua operasi order dari `sow`, LEFT JOIN mapping, LEFT JOIN
task aktif. Setiap baris punya `mapping_status`:

| Status | Kondisi | Perilaku di UI |
|---|---|---|
| `READY` | mapping ada, task aktif & non-summary | Tanggal ter-prefill, bisa dicentang, bisa direservasi |
| `TASK_LOST` | mapping ada, task-nya tidak aktif lagi | Tampil dengan peringatan "task sumber jadwal hilang pada sync", tautan pemetaan ulang |
| `NEEDS_MAPPING` | tidak ada mapping | **Di balik filter**, tidak bisa dicentang, tautan ke `/sow-scheduling/map` |

`TASK_LOST` adalah keadaan yang hari ini tidak terwakili sama sekali — dan itulah bug-nya.

**Definisi READY (revisi, konsisten dengan angka):** baris mapping ADA **dan** task yang
ditunjuk aktif & non-summary. Dengan backfill dua populasi (§6), angka pada order kasus:
19 `READY` + 3 `TASK_LOST` + 92 `NEEDS_MAPPING` = 114. Backfill hanya dari `sow_id` (spec
asli §6.1) akan menghasilkan **4 baris** (1 READY + 3 TASK_LOST) — regresi dari 19 hari ini.
Angka 19 READY di spec asli hanya mungkin karena 18 dari 19 task aktif ber-op tidak punya
`sow_id` — kontradiksi §6.1 vs §7 spec asli, dikoreksi di sini.

**Kenapa `NEEDS_MAPPING` di balik filter:** 92 dari 114 baris tidak bisa dicentang.
Bawaan = `READY` + `TASK_LOST` (22 baris); `NEEDS_MAPPING` di balik filter dengan penghitung
terlihat ("92 belum dipetakan", bisa diklik).

### 4.4 Normalisasi `operation_no` — ranjau yang ditutup lebih dulu

Tipe berbeda: `sow.operation_no` integer; `ms_project_task.operation_no` text. `operation_key`
bertipe **integer**, mengikuti `sow` sebagai sisi otoritatif. Konversi lewat satu helper
tunggal; nilai yang tidak bisa dikonversi ditolak saat mapping dengan pesan eksplisit
(`400 INVALID_PAYLOAD`), bukan disimpan apa adanya. Data saat ini: 0 task aktif ber-op
non-integer — penolakan tidak memblokir data lama. Unit test: `'0070'`, `'70'`, `70`,
`'70.0'`, `''`, `'OP70'`.

## 5. Blast radius

| File | Perubahan | Tier |
|---|---|---|
| `database/migrations/api/20260905_sow_operation_task_map.sql` | Tabel baru + backfill dua populasi (§6) | T1 — **disetujui** |
| `apps/api/services/msProjectService.js` | `listOrderTasks` ganti sumber; `mapSowOperationToTask` tulis ke tabel baru; `syncProject` laporkan mapping yatim; komentar basi baris 1704 dibetulkan | T1 — **disetujui** |
| Kontrak respons `GET /sow-orders/:order_no/tasks` | Baris = operasi `sow` + `mapping_status`; kolom task lama tetap ada utk READY; baris unmapped ber-`project_id` null | T1 — **disetujui** |
| `apps/web/src/features/bayScheduling/ReservationPanel.jsx` | Render tiga status; centang hanya `READY`; toggle + penghitung unmapped | T2 |
| `apps/web/src/pages/PPC/manufacturing/MapSapOperationPage.jsx` | Tandai operasi `TASK_LOST`; guard `project_id` null di penanda lintas project | T2 |

Konsumen lain `fetchOrderTasks`: `MapSapOperationPage.jsx:624` + `ReservationPanel.jsx:429`
— keduanya sudah masuk scope di atas. Kontrak `PUT /projects/:id/tasks/map-operation`
TIDAK berubah bentuk (respons tetap `{ task, moved_from, replaced }`), hanya sumber
"existing" yang pindah ke tabel mapping. Tidak ada route baru → RBAC manifest tidak berubah
(`check_rbac_manifest.js` harus tetap BERSIH).

## 6. Migrasi data

1. Backfill `sow_operation_task_map` dari SEMUA leaf (aktif & mati) yang op-nya cocok ke sow
   — populasi A (sow_id: 428 aktif + 40 mati) DAN populasi B (by-op: 1.236 aktif + 21 mati).
   ≈1.689 kunci unik (order, op) per 2026-09-05. Task mati justru yang perlu muncul sebagai
   `TASK_LOST`, bukan dibuang.
2. Aturan pilih saat duplikat (order, op): `DISTINCT ON` — task AKTIF menang, lalu yang
   ber-`sow_id` (provenance aksi /map), lalu `created_at` terbaru. 27 grup duplikat (semua
   berisi tepat 1 task aktif, sisanya mati).
3. Summary (`is_summary`) tidak pernah ikut; `operation_no` non-numeric dilewati dan
   dilaporkan sebagai daftar (0 baris saat ini).
4. `uq_ms_project_task_order_op` **dibiarkan** selama masa transisi; dihapus di migrasi
   terpisah setelah jalur baru terbukti di produksi.
5. 1.691 baris `ms_project_bay_schedule` aktif tidak disentuh (5 di antaranya `task_id is
   null`, warisan order-level pra-Fase 1 — di luar cakupan).
6. Berlaku ke CKP (data nyata) dan BPN (ms_project_task kosong di BPN → 0 baris; tabel tetap
   dibuat agar skema sinkron). Pencatatan ledger manual per skill (jangan `migrate.js`
   wholesale).

## 7. Verifikasi

- [ ] Order `1000131015`: respons `GET /sow-orders/1000131015/tasks` = 114 baris;
      19 `READY` + 3 `TASK_LOST` (`70`, `80`, `150`) + 92 `NEEDS_MAPPING`.
- [ ] Tampilan bawaan panel reservasi = 22 baris (READY + TASK_LOST); toggle unmapped
      menampilkan 114; operasi `70/80/150` berstatus `TASK_LOST` + tidak bisa dicentang.
- [ ] Setelah `0070` dipetakan ulang ke leaf aktif: `READY`, tanggal ter-prefill dari
      `plan_start`/`plan_finish` task itu.
- [ ] Uji regresi sync: mapping bertahan saat task-nya dihapus dari .mpp (baris mapping tidak
      ikut mati; status jadi `TASK_LOST`). Hari ini operasinya lenyap tanpa jejak.
- [ ] `syncProject` mengembalikan daftar mapping yatim di responsnya (baru: field
      `orphaned_mappings` di summary).
- [ ] Operasi `NEEDS_MAPPING` / `TASK_LOST` tidak bisa dicentang — D2 tidak bocor.
- [ ] Unit test normalisasi `operation_no` (helper baru).
- [ ] `npm --prefix apps/web run lint` + build lulus; `node scripts/gate.mjs` lulus dengan
      diff ter-stage; `node apps/api/scripts/check_rbac_manifest.js` BERSIH.
- [ ] Diuji pada 768×1024 dan ±960×600.

## 8. Keputusan owner (dijawab 2026-09-05 — hasil: 1a 2a 3b 4a)

1. **Pindahkan mapping ke tabel milik PPC?** → **YA (1a)**. Alternatifnya berarti menerima
   bahwa setiap restrukturisasi MS Project bisa membunuh mapping tanpa jejak.
2. **`NEEDS_MAPPING` di balik filter?** → **YA (2a)** — bawaan 22 baris + penghitung 92 yang
   bisa diklik. (Pilihan lain sah: tampilkan 114 sekaligus.)
3. **40(+21) mapping mati: remap manual atau ditandai & dibiarkan?** → **DITANDAI & DIBIARKAN
   (3b)** — pemetaan ulang butuh keputusan per kasus tentang leaf mana yang benar; bukan
   keputusan skrip. Semuanya muncul `TASK_LOST` pasca-migrasi.
4. **Task summary ber-`operation_no` (147):** → **DIBIARKAN (4a)** — hanya ditandai di halaman
   mapping; importer .mpp tidak diubah (di luar cakupan).
