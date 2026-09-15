---
title: "Resource management MPS: web sebagai pengatur resource MS Project"
type: plan
status: planning
date: 2026-09-03
tags: [domain/msproject]
---

# Resource management MPS — web mengatur resource MS Project

Keputusan owner 2026-09-03: (1) cakupan = **workcenter saja**, (2) planner **boleh mengusulkan**
resource dari MS Project tapi harus di-approve di web, (3) angka `[200%]` **bermakna 2 orang dan
dipertahankan**, (4) **workcenter tetap diketik bebas** oleh planner — mereka sudah hafal kode
standarnya, jadi jangan dipaksa memilih dari dropdown.

> Revisi 1 (2026-09-03 sore): keputusan (4) datang setelah draf pertama. Rencana awal
> "workcenter = pilih resource dari daftar" **dibatalkan**.
>
> Revisi 2 (2026-09-03 malam, atas pertanyaan owner "kenapa tidak pakai ResourceNames saja,
> kan kolom bawaan?"): rencana revisi 1 (pindah ke `Task.Text6`) **juga dibatalkan**.
> ResourceNames TETAP dipakai; yang diperbaiki adalah **cara membacanya** — lihat bagian 2.

## 1. Mekanisme MS Project yang bikin `C5100FAB[200%]`

`Task.ResourceNames` **bukan kolom data** — itu string tampilan yang dirender MS Project dari
daftar assignment task tersebut. Formatnya `Nama[units%]`, digabung koma kalau lebih dari satu
resource, dan suffix `[n%]` hanya muncul saat units bukan 100%.

Units sendiri jarang diketik manual. MS Project menurunkannya dari relasi
`Work = Duration x Units`: begitu sebuah task punya assignment lalu `Work` di-set lebih besar
dari `Duration`, Units otomatis naik. Import kita melakukan persis itu — set `ResourceNames`
dulu (lahir assignment 100%), lalu `t.Duration` dan `t.Work`
([ms_import.bas](../../tools/msproject-v2/ms_import.bas)). Jam kerja 2x durasi menghasilkan 200%.

Rantai kotornya:

1. Import: `t.ResourceNames = <workcenter>` — keputusan 2026-08-07, workcenter dititipkan ke
   kolom Resource Names supaya planner bisa melihat/mengeditnya.
2. MS Project membuat resource dadakan bernama `C5100FAB` di Resource Sheet (tanpa ID server,
   jadi tidak pernah dikirim balik sebagai resource) lalu menempelkannya sebagai assignment.
3. Set `Work` sehingga Units jadi 200% — tampilan berubah jadi `C5100FAB[200%]`.
4. Save: `MsSafeTaskWorkcenter` membaca `ResourceNames` **apa adanya**
   ([ms_serializer.bas](../../tools/msproject-v2/ms_serializer.bas)) sehingga
   `ms_project_task.workcenter` terisi `"C5100FAB[200%]"`.

Ada **sumber kedua** yang terpisah: kalau `ResourceNames` kosong, `MsSafeTaskWorkcenter` jatuh ke
`t.Notes` — padahal Notes juga dipakai planner untuk catatan sungguhan. Catatan itu lalu naik
pangkat jadi "workcenter". Ukurannya ada di bagian 6.

**Jadi bug-nya bukan angka 200%.** Angka itu benar dan (menurut keputusan #3) bermakna 2 orang.
Bug-nya adalah **workcenter diangkut lewat string tampilan**. Selama itu dipertahankan, kolom
workcenter akan terus tercemar suffix units dan koma multi-resource.

## 2. Strategi: tetap `ResourceNames`, tapi baca OBJEK-nya bukan STRING-nya

Yang salah bukan kolomnya dan bukan "mengetik bebas" — yang salah adalah **kita membaca hasil
render, bukan model objeknya**.

`Task.ResourceNames` adalah teks yang dirender MS Project dari daftar assignment task
(`Nama[units%]`, digabung koma untuk multi-resource). Tapi assignment-nya sendiri ada sebagai
objek, dan di situ namanya bersih:

```vba
For Each a In t.Assignments
    a.Resource.Name   ' "C5100FAB"  <- tidak pernah mengandung [200%]
    a.Units           ' 2           <- angka unitsnya, terpisah dan utuh
Next a
```

Suffix `[200%]` hanya hidup di string tampilan. Baca `a.Resource.Name`, masalahnya hilang tanpa
memindahkan kolom apa pun.

**Keputusan: `ResourceNames` tetap jadi tempat planner mengetik workcenter** (kolom bawaan, sudah
familiar, tidak perlu rename header manual di tiap mesin planner, tidak perlu retraining).
Keputusan 2026-08-07 TIDAK dicabut — hanya cara serializer membacanya yang diperbaiki.

| Sekarang | Sesudah |
|---|---|
| `MsSafeTaskWorkcenter` baca string `ResourceNames` | Baca `t.Assignments(i).Resource.Name` |
| `[200%]` ikut tersimpan ke kolom workcenter | Units dibaca terpisah lewat `a.Units` = jumlah orang |
| Fallback ke `t.Notes` saat ResourceNames kosong | Fallback Notes **dihapus** (sumber pencemaran kedua) |

Pola iterasi ini sudah terbukti di kode yang sama: `MsAssignmentsJsonArray`
([ms_serializer.bas](../../tools/msproject-v2/ms_serializer.bas)) sudah meng-iterasi
`t.Assignments` dan membaca `MsObjObject(a, "Resource")`.

### Trade-off yang diterima
Mengetik workcenter ke Resource Names tetap melahirkan **resource bayangan** di Resource Sheet
(resource tanpa ID server). Hari ini tidak berbahaya: `MsResourceJsonArrayFromSheet` hanya
mengirim balik resource yang punya ID, jadi resource bayangan tidak pernah sampai DB — dan di
Fase 3 justru menjadi bahan "usulan".

Risikonya baru muncul kalau suatu saat **orang/mesin ikut di-assign** ke task: satu task punya
dua assignment dan "mana yang workcenter" jadi ambigu. Aturan pemilihan kalau itu terjadi:
utamakan resource yang kodenya ada di master workcenter; kalau tidak ada, ambil assignment
pertama dan tandai task itu di daftar "workcenter tak dikenal". Selama cakupan masih
**workcenter saja** (keputusan #1), kasus ini tidak muncul.

Alternatif `Task.Text6` (kolom teks murni, benar-benar lepas dari Resource Sheet) **ditolak**:
butuh rename header manual di tiap mesin planner, memakai field non-bawaan, dan menyelesaikan
masalah yang sebenarnya sudah selesai dengan membaca objek. Simpan sebagai rencana cadangan
kalau cakupan resource nanti melebar ke orang/mesin.

### Validasi tanpa memblokir
Karena diketik bebas, typo mungkin terjadi. Server memvalidasi kode terhadap master saat sync,
tapi sebagai **peringatan, bukan penolakan**: kode yang tak dikenal tetap tersimpan dan muncul
di Hub sebagai daftar "workcenter tak dikenal" — sekaligus jadi umpan alur usulan Fase 3.
Menolak save karena typo akan membuat planner berhenti memakai sistemnya.

### Kapasitas workcenter: dihitung dari task, bukan dari assignment
Konsekuensi yang harus disadari: kalau workcenter cuma teks, tidak ada
`ms_project_assignment` untuk workcenter, sehingga `GET /resources/conflicts` (yang bekerja atas
`assignment_units` per resource) **tidak bisa dipakai untuk workcenter**. Beban per workcenter
harus diagregasi dari task: `group by workcenter, tanggal` atas `planned_work_minutes`,
dibandingkan dengan `max_units` resource workcenter-nya.

Alternatif yang ditolak: server otomatis membuatkan assignment ke resource `WC-<kode>` dari teks
yang diketik. Itu memang mengaktifkan kembali endpoint konflik yang sudah ada, tapi memunculkan
assignment yang tidak pernah dibuat planner di plan mereka — membingungkan, dan bikin blok
`deactivate` (propagasi hapus) jadi rumit. Agregasi dari task lebih jujur.

### Jumlah orang: dua angka, dua pemilik, tidak saling menimpa (DIPUTUSKAN 2026-09-03)

`sow.people_required` dan `ms_project_assignment.assignment_units` menyatakan hal yang sama —
berapa orang mengerjakan satu operasi — tapi datang dari dua pihak. Aturannya:

| | `sow.people_required` | Jumlah orang versi MSP |
|---|---|---|
| Arti | **Rencana/standar**: berapa orang yang *seharusnya* | **Eksekusi**: berapa orang yang *dijadwalkan* planner |
| Sumber | Diisi orang di panel reservasi `/sow-scheduling/area` | **Dihitung**: `planned_work_minutes / duration_minutes` (lihat Fase 1b) |
| Kunci | `order_no` + `operation_no` (satu operasi SOW) | `task_id` |
| Ditulis oleh | `PATCH /sow-orders/:order_no/operations/people` (sudah ada) | Tidak ditulis siapa pun — turunan dari plan yang sudah tersinkron |

**Aturan inti: tidak ada yang menimpa yang lain.** Sync menyimpan `planned_work_minutes` dan
`duration_minutes` apa adanya dan TIDAK menyentuh `people_required`; edit di web menyimpan
`people_required` dan TIDAK menyentuh angka plan. Keduanya hidup berdampingan sebagai fakta
terpisah.

Yang dibangun sebagai gantinya: **penanda selisih**. Di panel reservasi, tiap operasi
menampilkan dua angka begitu berbeda — mis. `SOW 2 org - MSP 3 org` dengan badge amber — supaya
planner/PE melihat ketidakcocokan dan memutuskan sendiri mana yang salah. Diam-diam menyamakan
angka adalah cara tercepat merusak kepercayaan pada dua-duanya.

Untuk konsumen hilir (beban per workcenter, bagian "kapasitas" di bawah): pakai angka **versi
MSP** — itu yang benar-benar dijadwalkan. `people_required` dipakai sebagai target pembanding,
bukan basis perhitungan beban.

Catatan implementasi: satu operasi bisa punya lebih dari satu task (beberapa project memetakan
order yang sama). Agregasi per `operation_no`, jangan per task — pola dedupe yang sama sudah
dipakai di `ReservationPanel` untuk `people_required`.

**SELESAI 2026-09-03** (belum di-commit): kolom hitung `people_msp` di `listOrderTasks` +
badge amber `MSP <n>` di `ReservationPanel` yang hanya muncul saat berbeda >= 0,05 dari
headcount SOW. Badge disembunyikan kalau headcount SOW belum diisi (itu bukan selisih) atau
`duration_minutes` 0/kosong (tidak ada dasar hitung). Tidak ada migrasi, tidak ada perubahan VBA.

## 3. Yang SUDAH ada (jangan dibangun ulang)

Model backend-nya sebagian besar sudah berdiri — yang belum ada justru UI-nya.

| Komponen | Status |
|---|---|
| `ms_resource` (kategori PERSON/MACHINE/WORKCENTER/TEAM/MATERIAL, `max_units`, `is_assignable`, `is_generic`, kalender) | ada |
| `ms_project_resource` (tim per project) + `ms_project_resource_availability` (kapasitas ber-periode) | ada |
| `GET/POST /ms-project/resources`, `/resources/refresh`, `/projects/:id/resources` (+ DELETE) | ada |
| `refreshResources` sinkron dari master MPS: `usernfc` (EMPLOYEE), mesin (MACHINE), `workcenter` menjadi `WC-<kode>` (WORKCENTER) | ada |
| `GET /resources/conflicts` (deteksi over-allocation dari `assignment_units`) | ada |
| VBA menolak resource tanpa ID server saat kirim balik (`MsResourceJsonArrayFromSheet`) | ada |
| **Halaman web untuk mengelola resource** | **TIDAK ADA sama sekali** |
| Status DRAFT/approval untuk resource usulan | belum ada |

## 4. Fase kerja

### Fase 1 — Hentikan pencemaran (KODE SELESAI 2026-09-03, belum dirilis ke planner)

1. `ms_serializer.bas` — `MsSafeTaskWorkcenter` berhenti membaca string `ResourceNames`,
   ganti jadi iterasi `t.Assignments` lalu ambil `a.Resource.Name`. Aturan pemilihan:
   assignment pertama yang kodenya dikenal master; kalau tak ada yang dikenal, assignment
   pertama apa adanya. Task tanpa assignment mengembalikan string kosong.
2. **Hapus fallback `t.Notes`** di fungsi yang sama — itu sumber pencemaran kedua (bagian 6).
   Setelah ini `Notes` kembali murni jadi catatan planner.
3. Kirim `assignment_units` per task ke payload (untuk keputusan (b) jumlah orang) — sudah ada
   di array `assignments`, pastikan task tanpa assignment tidak memaksa nilai default 1.
4. Import: **tidak berubah** — tetap `t.ResourceNames = workcenter`. Penulisan `t.Notes =
   workcenter` DIHAPUS supaya Notes tidak lagi tercampur.
5. Backfill DB: simpan nilai lama ke tabel cadangan lebih dulu, lalu **hanya buang suffix
   units** — `regexp_replace(workcenter, '\s*\[[0-9.,]+%\]\s*', '', 'g')`. **JANGAN memecah
   pada koma**: semua nilai berkoma di prod adalah satu nilai utuh (`BLASTING, PRIMER &
   PAINTING`), bukan dua resource. Prosa panjang warisan fallback `Notes` dibiarkan untuk
   review manual (bagian 6). **SUDAH DIJALANKAN untuk CKP 2026-09-03**: 290 baris,
   cadangan di `ms_project_task_workcenter_backup_20260903`. Perlu diulang setelah langkah
   1-4 rilis, karena Save dari file lama masih bisa mencemari lagi sampai VBA baru terpasang.
6. Uji: task 1 resource 100% - 1 resource 200% - 2 resource (ambigu, harus masuk daftar tak
   dikenal) - task tanpa resource sama sekali - task lama yang workcenter-nya cuma ada di Notes
   (harus jadi kosong, bukan prosa).

### Fase 1b — DIBATALKAN (2026-09-03): angkanya sudah ada di DB

Awalnya direncanakan kolom baru `ms_project_task.workcenter_units` karena
**`ms_project_assignment` ternyata KOSONG** (0 baris di CKP vs 3.198 task aktif) —
`MsAssignmentsJsonArray` hanya mengirim assignment yang resource-nya punya ID server, sedangkan
workcenter yang diketik ke Resource Names melahirkan resource bayangan tanpa ID.

**Tidak jadi dibangun.** Karena `Units = Work / Duration`, dan `planned_work_minutes` +
`duration_minutes` SUDAH dikirim VBA dan sudah tersimpan di `ms_project_task`, angka orang
versi MSP tinggal dihitung:

```sql
round(planned_work_minutes::numeric / nullif(duration_minutes, 0), 2)  -- 540/270 = 2.00
```

Diuji terhadap 290 baris cadangan: **286 cocok (98,6%)** dengan angka di dalam string lama.
Empat yang tidak cocok justru membuktikan arah yang benar — string-nya bilang `[200%]` padahal
work = durasi (rasio 1.0), artinya plan sudah berubah setelah string itu terbentuk. **String
adalah snapshot rendering yang bisa basi; work/durasi hidup.** Menyimpan angka rendering =
menyimpan versi kedaluwarsa.

Syarat pakai: hanya bermakna kalau `duration_minutes > 0` dan task punya satu resource — dua
duanya berlaku selama cakupan = workcenter saja. Kalau cakupan melebar ke orang/mesin, rasio ini
tidak lagi mewakili units per resource dan Fase 1b perlu ditinjau ulang.

### Fase 2 — Halaman Resource Management (web, workcenter saja)

Halaman baru di bawah MS Project Hub (`/ms-project-resources`, RBAC menyusul pola
`ms_project_admin`):

- Daftar `ms_resource` kategori `WORKCENTER`: kode, nama, kapasitas (`max_units` = jumlah orang),
  kalender, aktif/tidak.
- CRUD + tombol **Sync dari master** (`POST /ms-project/resources/refresh` sources `["WORKCENTER"]`).
- Kapasitas ber-periode lewat `ms_project_resource_availability` (shutdown, cuti massal).
- Panel beban/konflik workcenter: endpoint **baru** yang mengagregasi task per workcenter per
  tanggal (lihat bagian 2) — `GET /resources/conflicts` yang ada tidak berlaku untuk workcenter
  karena workcenter bukan assignment.
- Daftar **workcenter tak dikenal** (kode hasil ketik bebas yang tidak ada di master) dengan
  aksi: tambahkan ke master, atau perbaiki di plan.
- Ikut Corporate Color System + Component-First (`ui/Modal`, `ui/Card`, `tables/Table` yang ada).

### Fase 3 — Alur usulan (DRAFT menjadi APPROVED)

1. Migrasi: `ms_resource` + `approval_status` (`APPROVED` / `DRAFT` / `REJECTED`), `proposed_by`,
   `proposed_at`, `approved_by`, `approved_at`. Baris existing menjadi `APPROVED`.
2. Payload sync VBA: blok **baru** `resource_proposals` (nama resource sheet yang belum punya ID).
   WAJIB terpisah dari `project_resources` — `upsertProjectResources` menolak ID tak dikenal, dan
   usulan tidak boleh menggagalkan save.
3. Server: usulan masuk sebagai `DRAFT` + `is_assignable=false`. Assignment ke resource DRAFT
   ditolak dengan pesan jelas.
4. Web: antrean approval di halaman Fase 2; approve mengubah ke `APPROVED` + `is_assignable=true`,
   dan ID-nya turun ke plan pada Open/Sync berikutnya.
5. VBA: tampilkan hasilnya setelah save ("2 resource diusulkan, menunggu approval").

### Fase 4 — Kebersihan

- Hapus fallback `Notes` sebagai sumber workcenter (peninggalan data lama) setelah backfill Fase 1 bersih.
- Perbarui `tools/msproject-v2/README.md` bagian "Field mapping" (keputusan 2026-08-07 dicabut).
- Tulis `docs/concepts/msproject-resource-model.md` sebagai pengetahuan menetap.

## 5. Risiko

- **File .mpp lama tetap mencemari sampai VBA baru terpasang di semua mesin planner.** Perbaikan
  ini ada di sisi klien, jadi satu planner yang belum update cukup untuk menulis balik
  `C5100FAB[200%]`. Backfill harus diulang setelah rollout VBA merata, bukan sebelumnya.
- **Menghapus fallback `Notes`** membuat task yang workcenter-nya SELAMA INI hanya ada di Notes
  jadi kosong. Itu benar (nilainya bukan workcenter), tapi akan terlihat seperti "data hilang"
  bagi planner. Sampaikan di catatan rilis, dan siapkan daftar task terdampak.
- **Typo kode workcenter** tetap mungkin karena diketik bebas (by design). Mitigasinya daftar
  "workcenter tak dikenal" di Fase 2 — kalau daftar itu tidak dipantau, data pelan-pelan kotor
  lagi dengan cara berbeda. Contoh yang sudah ada: `BLASTING, PRIMER & PAINTING` vs
  `BLASTING, PRIMER& PAINTING`.
- **Task dengan lebih dari satu assignment** jadi ambigu (mana yang workcenter). Tidak muncul
  selama cakupan = workcenter saja, tapi aturan pemilihannya harus tetap ditulis sekarang
  supaya tidak jadi kejutan saat cakupan melebar.
- **File .mpp lama** masih memuat resource dadakan tanpa ID di Resource Sheet. Fase 1 harus tahan
  menghadapinya (abaikan, jangan crash), dan Fase 3 akan memunculkannya sebagai usulan — bisa
  membanjiri antrean approval saat rilis pertama. Sediakan aksi "tolak semua" massal.
- **`assignment_units` vs `people_required`** belum diputuskan siapa yang menang (lihat bagian 2).
- Fase 1 mengubah arti kolom `workcenter`; laporan/query yang membacanya perlu dicek
  (`grep workcenter` di `apps/api` dan `apps/web`) sebelum backfill.

## 6. Status verifikasi

**Sudah pasti** (dikonfirmasi owner 2026-09-03): `Units = Work / Duration`. Contohnya durasi 1
hari (8 jam) dengan work 16 jam menghasilkan 200%. Import kita memicunya karena men-set
`ResourceNames` lebih dulu, baru `Duration` dan `Work`.

**Sudah diukur** di prod (2026-09-03, CKP tunnel 5441; BPN 0 baris — belum memakai jalur ini):

| | Baris | Nilai unik |
|---|---|---|
| Total task ber-workcenter | 2.962 | 171 |
| Mengandung suffix `[n%]` | **585** | — |
| Mengandung koma | 51 | 11 |
| Bentuk "mirip kode" (`^[A-Za-z][A-Za-z0-9_-]{2,15}$`) | **2.607 (88%)** | **22** |
| Teks bebas pendek | 344 (12%) | 133 |
| Prosa panjang (>40 char) | 11 | 6 |

Lima kode teratas: `C5100QIM` 836 - `C5100FAB` 739 - `C5100MPR` 426 - `C5100BPP` 314 -
`C5100FIT` 186. **Disiplin kode planner memang terbukti** untuk 88% baris; ekornya yang kotor
(`FABRICATION`, `FITTING`, `DROPSIDE`, nama proses, sampai catatan pengadaan satu paragraf).

Dua temuan yang mengubah rencana backfill:

1. **Koma BUKAN pemisah multi-resource.** Semua 11 nilai berkoma adalah satu nilai utuh yang
   memang mengandung koma: `BLASTING, PRIMER & PAINTING` (17), `Cutting List, Nesting & Native
   by PE` (5), `FRAME,DUMP:A-DOUBLE SIDE TIP TRAILER` (3), dst. Skrip backfill **tidak boleh
   memecah pada koma** — cukup buang suffix `[n%]`. (Efeknya: 171 nilai unik menjadi 161.)
   Bonus temuan: `BLASTING, PRIMER & PAINTING` vs `BLASTING, PRIMER& PAINTING` — dua ejaan untuk
   hal yang sama, contoh nyata risiko typo yang dibahas di bagian 2.
2. **Ada sumber pencemaran KEDUA: fallback `Notes`.** `MsSafeTaskWorkcenter` memakai
   `t.Notes` saat `ResourceNames` kosong, sedangkan import menulis workcenter ke `Notes` DAN
   planner memakai Notes untuk catatan asli. Itulah asal prosa panjang seperti "Stock On Hand
   for SHS ... tapi musti pengadaan untuk RHS ...". Prosa semacam ini **jangan dibersihkan
   otomatis** — tidak ada aturan yang bisa menebak kode yang dimaksud. Sisakan untuk review
   manual lewat daftar "workcenter tak dikenal" di Fase 2.
