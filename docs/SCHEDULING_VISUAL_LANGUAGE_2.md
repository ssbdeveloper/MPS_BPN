---
type: design
status: planning
tags: [domain/sow, domain/msproject]
updated: 2026-09-05
---

# Sistem Visual Scheduling v2 — "Shop Drawing"

> Mockup: [artifact](https://claude.ai/code/artifact/d568a26e-0dfc-4f2e-8572-5d71860db2d7)
>
> **Ditulis SENGAJA tanpa mengacu `CLAUDE.md`**, atas permintaan owner: "supaya lahir visual
> aturan baru". Dokumen ini karena itu **bertentangan** dengan Corporate Color System di beberapa
> titik. Pertentangan itu disengaja dan didaftar di §6 — bukan kelalaian.
>
> Cakupan: 4 halaman — `/sow-scheduling/projects`, `/sow-scheduling/map`,
> `/sow-scheduling/area`, `/ms-project-admin`.

---

## 1. Kenapa bahasa visualnya diganti, bukan dipoles

Proyek A (fondasi) sudah rilis dan hasilnya jujur: **hampir tak ada yang terlihat berubah selain
animasi.** Sebabnya bukan eksekusi — melainkan pilihan saya sendiri:

- Kanvas bernada `#eef2f6` hanya **1,075:1** terhadap latar lama `slate-50`. Tak terlihat mata.
- Kepadatan dan tile-expand dibatalkan; keduanya justru penyumbang daya pukul di mockup.
- Task 13 dibatasi jadi "surface treatment" — tata letak, tipografi, dan ritme spacing tak disentuh.

Kesimpulannya: **memoles palet yang ada tidak akan pernah menghasilkan perubahan yang terasa.**
Yang harus berubah adalah struktur informasi dan tipografi, bukan nilai heksa latar.

---

## 2. Bahasa: gambar kerja bengkel

Diambil dari dunia subjeknya sendiri — shop drawing, traveler, dan Gantt. Bukan dari tren UI.

| Prinsip | Isi |
|---|---|
| **Chrome akromatik** | Antarmuka abu netral. Warna **tidak pernah** berarti apa pun kecuali status data. |
| **Warna aksi ≠ warna status** | `--act` hanya untuk seleksi, fokus, tombol utama. Ia tak pernah menyatakan keadaan. |
| **Kode punya muka** | Order, bay, workcenter, operasi, revisi, jam → monospace + `tabular-nums`, diberi ukuran dan bobot nyata. Aplikasi ini **adalah** kode. |
| **Geometri persegi** | Radius maksimal 3px. Gambar teknik tak bersudut bulat; membulat membaca "konsumen". |
| **Garis terukur** | Pembagi horizontal membawa tick yang berarti (batas shift, awal minggu, hari ini) — bukan hiasan. |
| **Anotasi** | 9,5px uppercase tracking `.13em`, **hanya** untuk label struktural. Tak pernah untuk data yang dibaca. |
| **Status berbentuk** | Setiap status punya bentuk + teks, bukan hanya warna. |
| **Dua tema setara** | Pabrik jalan 24 jam. Shift malam bukan preferensi; tema gelap dihitung terpisah, bukan inversi. |

### 2.1 Token

```
paper    #fbfbfa / #131619      surface  #ffffff / #1a1e22
sunk     #f4f4f2 / #101316      rule     #dcdcd8 / #2b3138
ink      #14181c / #e9ebed      ink-2    #5c646c / #98a1a9
act      #00618f / #4aa8d8   ← INTERAKSI SAJA
late     #c2410c / #e8834c      run      #0f766e / #3fb3a6
done     #4d7c0f / #9dc157      stop     #b91c1c / #e06c6c
```

Kontras diverifikasi kedua tema, **4,56–6,92:1** — semua lolos AA. Netral dibias hangat
(`#fbfbfa`, bukan `slate-50`) supaya abu-abunya terbaca dipilih, bukan diwarisi.

---

## 3. Per halaman

### 3.1 `/sow-scheduling/projects` — register

**Tabel padat, bukan kartu.** Data project seragam (nama, status, pemegang, task, revisi, waktu);
kartu memboroskan ruang untuk keseragaman.

**Kolom baru "Beban"** — proporsi task yang sudah punya reservasi bay. Menjawab "project ini sudah
dijadwalkan seberapa jauh" tanpa membuka apa pun. Data sudah ada, belum pernah ditampilkan.

### 3.2 `/sow-scheduling/map` — pengikatan

Tindakannya satu: mengikat operasi SAP ke task MS Project. Dua pane **setara** dengan status ikatan
tampil di baris masing-masing (`→ 2.8.1.2`), bukan dua daftar terpisah yang kebetulan berdampingan.

Task tanpa `operation_no` ditandai `tanpa op` dan tak bisa jadi tujuan — aturan yang sudah berlaku
di backend, kini terlihat sebelum diklik.

### 3.3 `/sow-scheduling/area` — dua layout DISKRIT

Permintaan owner: dibedakan, tidak perlu terlalu dinamis.

| | Desktop | Mobile web |
|---|---|---|
| Kolom | rail order + lajur bay + inspector permanen | satu kolom |
| Pengalih tampilan | tombol berteks | **ikon** dalam satu bilah — teks dibuang, bukan dikecilkan |
| Inspector | panel kanan tetap | lembar bawah yang ditarik |
| Rentang hari | 7 kolom | 4 kolom, sisanya geser horizontal |
| Tombol simpan | 44px | **tetap 44px** — satu-satunya ukuran yang tak boleh menyusut |

**Satu titik ganti. Tidak ada keadaan setengah jalan.**

**Keputusan terbesar: bay dirender sebagai lajur waktu, bukan ubin denah.** Denah menjawab "di mana
B37C" — yang planner sudah hafal. Lajur menjawab "apa isinya dan kapan bebas". Efek samping: masalah
lebar 3.990px hilang dengan sendirinya.

**Risikonya nyata:** posisi fisik hilang. Kalau planner memakai kedekatan spasial antar bay untuk
memutuskan (memindahkan unit antar bay bersebelahan), lajur menghapus informasi itu. Karena itu
**Denah dipertahankan sebagai lensa kedua**, bukan dibuang. → **Butuh jawaban owner, §5 D-1.**

Slot bebas menjadi **target klik**, dan itulah yang membuat alur non-linear mungkin: mulai dari
order, atau mulai dari bay.

### 3.4 `/ms-project-admin` — kunci & revisi

Halaman ini melakukan hal berbahaya: paksa check-in, hapus project, batalkan reservasi.

- **Warna aksi tidak dipakai untuk aksi merusak.** Tombol destruktif memakai `stop`, dan hanya di
  border/teks — bukan bidang penuh yang mengundang klik.
- **Konsekuensi ditulis di sebelah tombolnya**, bukan di dialog setelahnya. "Pekerjaan lokal
  pemegang bisa hilang" terbaca sebelum diklik.
- **Tombol yang tidak bisa dipakai tetap terlihat beserta alasannya**, tidak disembunyikan. Planner
  yang mencari "Hapus" dan tak menemukannya akan mengira fiturnya tak ada.

---

## 4. Urutan kerja yang disarankan

Bukan rombak serentak — sistem ini dipakai produksi harian.

| # | Isi | Kenapa urutannya begini |
|---|---|---|
| **V1** | Token + primitif v2 berdampingan dengan yang lama (namespace terpisah) | Nol risiko; halaman lama tak tersentuh |
| **V2** | `/projects` + `/ms-project-admin` | Dua halaman paling sederhana, dipakai paling jarang. Tempat aman membuktikan bahasa visualnya |
| **V3** | `/map` | Satu tindakan, dua pane. Sedang |
| **V4** | `/area` desktop | Paling kompleks, paling berisiko |
| **V5** | `/area` mobile | Butuh V4 stabil dulu |

**Prasyarat yang tidak boleh dilewat:** Proyek A menutup pelajaran pahitnya sendiri — *test tak
pernah menyentuh satu pun halaman produksi*. Setiap defect serius di sana hidup persis di tempat
yang tak terjangkau test. **V1 harus menambah test tingkat halaman lebih dulu**, sebelum satu piksel
pun diubah.

---

## 5. Keputusan terbuka (butuh owner)

- **D-1 — Denah lantai.** Apakah posisi fisik bay benar-benar dipakai planner untuk mengambil
  keputusan? Kalau ya, "Denah" wajib setara dengan "Lajur", bukan pelengkap. Kalau tidak, ia bisa
  dihapus dan menghemat banyak kode.
- **D-2 — Titik ganti mobile/desktop.** Lebar berapa? Dan apakah tablet ikut layout desktop
  (padat) atau mobile (satu kolom)?
- **D-3 — Nasib visual Proyek A.** Kanvas `#eef2f6`, `shadow-card`, dan tepi status sudah rilis.
  Diganti sistem ini, atau v2 dibangun di atasnya?
- **D-4 — Cakupan.** Empat halaman sekaligus, atau berhenti setelah V2 untuk dinilai dulu?

---

## 6. Yang bertentangan dengan CLAUDE.md

Didaftar supaya menjadi keputusan sadar, bukan pelanggaran diam-diam. **Semua butuh restu owner
sebelum V1.**

| CLAUDE.md | Sistem ini |
|---|---|
| "Light theme only — jangan gunakan `dark:`" | Dua tema setara. Alasan: shift malam |
| Latar halaman `bg-slate-50` | `paper #fbfbfa` (terang) / `#131619` (gelap) |
| Palet biru korporat sebagai aksen | Chrome akromatik; `act #00618f` hanya untuk interaksi |
| `rounded-xl` kartu, `rounded-lg` tombol | Radius maksimal 3px |
| `text-[11px]` hanya label uppercase | Anotasi 9,5px uppercase tracking `.13em` |
| Rasio ~80% putih / 20% biru | Rasio tak relevan — warna hanya muncul saat ada status |

Kalau owner menolak salah satu baris, sistemnya masih berdiri — **kecuali baris "warna aksi ≠ warna
status"**. Itu tulang punggungnya; tanpa itu chrome akromatik kehilangan alasan.
