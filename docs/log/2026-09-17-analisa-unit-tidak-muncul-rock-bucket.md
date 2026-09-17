# Analisa: UNIT tidak muncul — "MPS - PO - Rock Bucket 11.6m3 PC2000"

Status: ANALISA + PERBAIKAN C & B2 SUDAH DITERAPKAN (2026-09-17).
Opsi A (bersihkan 22 baris drift) masih menunggu keputusan owner — lihat bagian akhir.
Sumber data: DB prod via Tailscale 100.80.101.53:5433, read-only.
project_id = 4277611b-34de-4a4c-bf20-51eedd1e4d79, revision_no 25, status ACTIVE.

## Kesimpulan singkat

UNIT-nya TIDAK hilang dari database, dan pohon di `/sow-scheduling/map` TIDAK salah
render. Yang terjadi: **semua operasi order UNIT 1 (1000132018) dipetakan ke task
milik subtree UNIT 2 (2.2.x)**. Jadi di layar mana pun yang menurunkan "UNIT" dari
posisi task di WBS, order UNIT 1 tampil sebagai "UNIT 2 - UPDATED" — dan bucket
UNIT 1 tidak pernah terbentuk karena nol task di subtree 2.1.x yang punya mapping.

Ini **bug data hasil salah mapping oleh user**, diperparah **tidak adanya guard di
backend**. Bukan bug rendering.

## Yang sudah diverifikasi (bukan dugaan)

1. UNIT ada dan aktif di DB:
   - 2.1 "UNIT 1 - UPDATED", is_active=true, order_no 1000132018
   - 2.2 "UNIT 2 - UPDATED", is_active=true, order_no 1000132024
   Ada juga 2 task nonaktif: "UNIT 1 TES" dan "UNIT 2" (is_active=false).

2. Endpoint pohon `listProjectTasks` mengembalikan 141 task aktif, 2 di antaranya
   UNIT. `buildTaskTree` (MapSapOperationPage.jsx:65) dijalankan atas payload asli:
   roots = [1 PRELIMINARIES, 2 MANUFACTURING], dan children MANUFACTURING = persis
   [2.1 UNIT 1 - UPDATED, 2.2 UNIT 2 - UPDATED]. **Pohon map benar.**
   0 orphan, parent semua UNIT = task "2 MANUFACTURING" yang aktif.

3. Isi `sow_operation_task_map` untuk project ini: **30 baris, SEMUA menunjuk task
   di subtree 2.2.x (UNIT 2). Nol baris menunjuk subtree 2.1.x (UNIT 1).**

   order_key 1000132018 -> op 20 ke task 2.2.1.1, op 120 ke task 2.2.2.1
   (dua-duanya task milik order 1000132024 alias UNIT 2)

   Padahal subtree UNIT 1 punya 24 task aktif yang siap dipetakan.

4. Akibatnya di layar yang menampilkan unit_name (mis. SelectJobPage / bay schedule),
   `listBayScheduleTasks` mengembalikan 11 baris untuk kedua order ini dan
   **SEMUANYA ber-unit_name "UNIT 2 - UPDATED"**, termasuk baris order 1000132018.
   unit_name NULL = 0. Jadi gejalanya bukan "kosong" melainkan "salah unit" —
   UNIT 1 tidak pernah muncul sebagai bucket sendiri.

5. Rantai parent dibuktikan: task yang dipakai reservasi order 1000132018 adalah
   "FAB GENERAL ASSY" outline 2.2.2.1 -> parent 2.2.2 FABRICATION -> parent 2.2
   "UNIT 2 - UPDATED". Resolver unit bekerja benar; inputnya yang salah.

6. Reservasi bay ikut terkontaminasi: 9 baris `ms_project_bay_schedule` dengan
   `s.order_no` = 1000132018 menunjuk task yang `t.order_no`-nya 1000132024.
   Di seluruh DB pola mismatch ini ada 9 kombinasi (jadi bukan cuma project ini):
   1000129233->1000128545 (4), P26-35139->1000131623 (4), 1000130697->NULL (4),
   P26-35140->P26-35142 (3), 1000129974->1000128579 (3), dan beberapa ->NULL.

## Kenapa bisa terjadi (akar masalah di kode)

`mapSowOperationToTask` (msProjectService.js ~2112) memvalidasi:
- target task ada & aktif di project itu — ya
- target belum dipegang operasi lain (TARGET_TASK_OCCUPIED) — ya
- order belum dipetakan ke project lain (ORDER_MAPPED_ELSEWHERE) — ya

KOREKSI (terbukti dari audit log, menggantikan dugaan awal saya):
guard TARGET_TASK_OCCUPIED **sudah ada dan SUDAH MENYALA**. Yang terjadi adalah
guard itu di-override manusia lewat takeover/Replace. Buktinya field `replaced`
di audit detail tidak null:

  12:55 reza.prasetyo  task 7bc9ec46  order 1000132024 op 230
        replaced: {order_no: 1000132018, operation_no: 20}
  12:58 reza.prasetyo  task 7bc9ec46  order 1000132018 op 20
        replaced: {order_no: 1000132024, operation_no: 230}

Task yang sama (2.2.1.1 LASER CUTTING, milik UNIT 2) ditimpa bolak-balik dalam
3 menit oleh orang yang sama. Sistem sudah bertanya "task ini sudah dipakai,
timpa?" — dan dijawab "ya", dua kali, berlawanan arah.

Jadi ini BUKAN guard yang hilang. Ini guard yang bertanya dengan pertanyaan yang
salah: dialog Replace hanya menyebut order+op yang akan ditimpa, tidak pernah
menyebut UNIT. Bagi planner, "timpa op 230 order 1000132024" terbaca seperti
detail teknis, bukan "kamu sedang menaruh operasi UNIT 1 ke dalam rumah UNIT 2".

Validasi subtree-unit memang belum ada, dan itu tetap layak ditambah — tapi
bukan itu akar masalahnya.

Catatan: UI juga tidak membantu — kartu order di panel kiri hanya menampilkan
order_no + part_name, dan part_name kedua order ini IDENTIK
("BUCKET:ROCK KOMATSU PC2000-11,11.6 M3", part_number SB10115AC sama, 48 ops sama).
Tidak ada penanda unit sama sekali, jadi planner praktis tidak punya cara
membedakan UNIT 1 dan UNIT 2 saat drag-and-drop.

## Opsi perbaikan (minta keputusan owner dulu)

A. Perbaiki DATA saja: remap 2 operasi order 1000132018 (op 20, op 120) ke task
   subtree 2.1.x, plus koreksi 9 reservasi bay yang menunjuk task salah unit.
   Cepat, tapi tidak mencegah terulang.

B. Tambah GUARD di `mapSowOperationToTask`: tolak (atau minta konfirmasi eksplisit)
   kalau task tujuan punya ancestor unit yang order_no-nya berbeda dengan order yang
   sedang dipetakan. Kode error baru mis. UNIT_ORDER_MISMATCH.

C. Tambah kolom UNIT di UI map: tampilkan unit target di baris pohon dan/atau unit
   asal di kartu order, supaya dua order berpart-number sama bisa dibedakan.

Rekomendasi: B + C (cegah terulang & bikin terlihat), lalu A untuk membersihkan
data yang sudah terlanjur. A sendirian akan berulang.

## YANG SUDAH DIKERJAKAN (2026-09-17, disetujui owner)

### C — UNIT dibuat terlihat
- `listProjectTasks` kini mengembalikan `unit_name` + `unit_order_no` per task,
  diturunkan via LATERAL recursive: summary terdekat ke atas yang namanya
  mengandung "unit". Diukur di prod: 141 task, 119 punya unit, 834 ms.
- Kolom **Unit** ditambahkan di header + baris pohon map page.
- Peringatan **beda unit** (banner amber) muncul di ReplaceDialog DAN
  SummaryTargetDialog.
- Drop ke daun KOSONG — dulu langsung memetakan tanpa dialog apa pun, dan justru
  inilah jalur yang dipakai saat UNIT 1 mendarat di subtree UNIT 2 — kini ditahan
  dengan konfirmasi "Map anyway" HANYA bila unitnya berbeda. Drop yang unitnya
  cocok tetap tanpa dialog (kerja normal tidak jadi lebih lambat).
- Perbandingan order dinormalkan terhadap nol di depan ('0001000132018' ==
  '1000132018'); tanpa ini SETIAP drop akan dianggap beda unit dan planner akan
  belajar mengabaikan peringatannya — persis kegagalan yang sedang diperbaiki.

Replay terhadap data prod: kedua mis-mapping nyata (order 1000132018 op 20 →
2.2.1.1 dan op 120 → 2.2.2.1) DITAHAN; kontrol drop yang benar ke 2.1.1.1 lolos
tanpa gangguan, termasuk varian zero-padded.

### B2 — sync VBA tidak lagi bisu
`upsertTasks` menimpa `order_no`/`operation_no` task dari isi file .mpp
(Task.Text1/Text2) tanpa melihat `sow_operation_task_map`. `orphaned_mappings`
hanya melaporkan task yang DINONAKTIFKAN, bukan yang identitasnya BERUBAH —
itulah titik buta yang membuat drift menumpuk tanpa peringatan.

Sekarang identitas task ber-mapping di-snapshot SEBELUM upsert, dibandingkan
sesudahnya, dan selisihnya dilaporkan sebagai `mapping_drift` di sync summary
(bersebelahan dengan `orphaned_mappings`). Sifatnya **melaporkan, tidak menolak** —
sesuai keputusan owner.

Angka drift saat ini di prod (perlu dibaca hati-hati):
- **22** baris = order_key mapping ≠ order_no task
- **62** baris = order ATAU operation_no berbeda (detektor menangkap yang ini)
- 2134 baris mapping total, 2120 task unik → ada 14 task dengan mapping ganda

### Opsi B versi penuh — SENGAJA TIDAK DIKERJAKAN
Guard penolak `UNIT_ORDER_MISMATCH` di `mapSowOperationToTask` tidak ditambahkan.
Alasannya terbukti dari audit: guard `TARGET_TASK_OCCUPIED` SUDAH ADA dan SUDAH
MENYALA — user tetap menekan "Replace" dua kali berlawanan arah dalam 3 menit.
Menambah guard yang bisa di-override ke orang yang sudah terbukti meng-klik-lewat
dialog hanya menambah gesekan tanpa menambah keselamatan. Lagi pula belum
terbukti mapping lintas-unit SELALU salah (rework/operasi pinjaman mungkin sah);
memblokir hal yang kadang sah justru melahirkan kebiasaan takeover paksa.

## Sisa pekerjaan — BUTUH KEPUTUSAN OWNER

A. Bersihkan data drift. Pertanyaan yang belum dijawab:
   1. Cakupannya 6 baris di project ini saja, atau 22/62 baris se-DB?
   2. Untuk tiap baris drift: mapping ikut dipindah ke task yang benar, atau
      mapping dilepas supaya planner memetakan ulang secara sadar?
   Catatan: setelah C aktif, remap manual jauh lebih aman karena unit sudah
   terlihat dan salah-unit akan memicu konfirmasi.

B3. `order_no` masih ditulis dua pihak (file .mpp lewat sync, dan web lewat
   mapping) tanpa wasit. Sengaja belum diputuskan — datanya belum cukup.
   Biarkan `mapping_drift` berjalan beberapa minggu dulu; kalau laporannya tetap
   ramai, baru tentukan siapa sumber kebenaran.


## Temuan sampingan (di luar scope, tapi perlu dicatat)

`listSowOrders` untuk satu order memakan 33–39 detik per panggilan saat diukur
langsung ke DB prod. Panel order kiri di map page memanggil ini dengan debounce
250ms setiap ketikan. Ini kandidat kuat keluhan "map page berat/lemot".
