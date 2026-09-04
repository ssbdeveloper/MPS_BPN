---
type: design
status: done
tags: [domain/sow, domain/msproject]
updated: 2026-09-04
---

# Design — Fondasi Visual & Motion SOW Scheduling (Proyek A)

> Lanjutan dari [[SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN]] yang sudah menuntaskan Fase 0–3
> (navigasi route bersarang, kepatuhan design system, kejelasan aksi, bay board).
> Dokumen itu membuat halaman **patuh** pada Corporate Color System. Dokumen ini
> **memperluas** sistemnya: permukaan berlapis, motion, transisi antar-page, dan primitif
> komponen yang akan dipakai ulang oleh Proyek B dan C.
>
> **Cakupan: hanya UI/UX frontend.** Tidak menyentuh backend, model data, atau kontrak VBA.

---

## 0. Pembalikan keputusan yang perlu dicatat

`SOW_SCHEDULING_MFG_UI_REDESIGN_PLAN` §6 mencatat keputusan owner 2026-07-30:

> "**desktop-only, layar lebar** (abaikan tablet/sentuh; drag mouse dipertahankan kelas-satu)"

**Keputusan owner 2026-09-04 membalik sebagian:**

| Halaman | Sebelumnya | Sekarang |
|---|---|---|
| `/sow-scheduling` (menu) | desktop-only | desktop-only *(tetap)* |
| `/sow-scheduling/projects` | desktop-only | desktop-only *(tetap)* |
| `/sow-scheduling/map` | desktop-only | desktop-only *(tetap)* |
| **`/sow-scheduling/area`** | desktop-only | **adaptif desktop + tablet** |

Konsekuensinya nyata dan harus dipatuhi Proyek B: di Area, target sentuh kembali wajib
≥ 44px, tidak boleh ada afordansi hover-only, dan drag-and-drop wajib punya jalur tap
setara. Di tiga halaman lain, drag mouse tetap kelas satu.

---

## 1. Dekomposisi — kenapa dokumen ini hanya Proyek A

Permintaan awal (animasi + visual modern + transisi + tata letak + fleksibilitas, di 4 halaman)
terlalu besar untuk satu spec. Dua alasan terukur:

- `ReservationPanel` 1.120 baris dan `MapSapOperationPage` 1.029 baris — **sudah** kelebihan
  muatan sebelum ditambah mode tampilan, panel resizable, dan alur non-linear.
- Sistem dipakai produksi harian. Audit 2026-09-04 memperlihatkan tiga planner
  (`yogi.kogama`, `rizka.savitri`, `yeni.setyowati`) melakukan sync dan mengedit reservasi
  dalam rentang beberapa jam.

Dipecah jadi empat proyek berurutan, masing-masing dengan spec → plan → implementasi sendiri:

| # | Proyek | Isi | Status |
|---|---|---|---|
| **A** | Fondasi desain + motion | Token, motion, transisi route, primitif komponen | **dokumen ini** |
| **B** | Scheduling Area | Adaptif desktop+tablet, mode tampilan, alur non-linear, pecah `ReservationPanel` | belum |
| **C** | Map SAP Operations | Panel resizable, filter kuat, pecah file 1.029 baris | belum |
| **D** | Menu + Projects | Poles visual, konsistensi | belum |

Filter & pencarian **bukan** proyek terpisah — komponennya lahir di A, dipakai B dan C.

---

## 2. Keputusan yang sudah diambil (owner, 2026-09-04)

| Topik | Keputusan | Catatan |
|---|---|---|
| Perangkat | Desktop untuk semua, **kecuali Area** yang adaptif desktop+tablet | membalik sebagian §6 dokumen lama |
| Fleksibilitas yang diinginkan | Keempatnya: panel resizable, mode tampilan, filter kuat, alur non-linear | mayoritas dieksekusi di B dan C |
| Palet | **Boleh ditambah** netral & aksen semantik baru; biru brand tetap identitas | menyimpang dari CLAUDE.md yang menyebut palet "APPROVED" — lihat §8 |
| Transisi page | ~~Slide berarah + tile-expand dari menu~~ → **slide berarah SAJA** | tile-expand di-revert 2026-09-05, lihat §12 |
| Arah visual | **Layered + tepi status** | |
| Copy UI | **Bahasa Inggris** | konsisten dengan halaman yang ada |
| Blast radius | **Hanya `/sow-scheduling`** | halaman lain tak tersentuh sampai digarap |

---

## 3. Design tokens

Tiga hal yang CLAUDE.md sudah tetapkan tapi **belum pernah dikerjakan** (diverifikasi 2026-09-04):

- Blok `:root` CSS variables belum ada di `apps/web/src/index.css`
- Palet brand belum masuk `tailwind.config.js` (masih token lama `primary #007bff`, `shadow-3d`)
- Font masih `Arial`, bukan system stack

Ketiganya dituntaskan di sini. **Didefinisikan global, dipakai hanya di `/sow-scheduling`** —
halaman lain tidak berubah karena tidak memakai token barunya.

### 3.1 Tambahan baru

```css
/* Kanvas bernada — dasar untuk kartu mengambang (arah visual "layered") */
--canvas:            #eef2f6;

/* Aksen semantik. Kontras dihitung, bukan diperkirakan — lihat §3.3. */
--status-late:       #b45309;  /* amber tua — 5.02:1 di atas putih */
--status-running:    #0077b6;  /* biru brand — 4.87:1 di atas putih */
--status-ok:         #047857;  /* emerald  — 5.48:1 di atas putih */

/* Elevation dua lapis, menggantikan shadow-sm untuk kartu */
--shadow-card:       0 1px 2px rgba(15,23,42,.05), 0 4px 12px rgba(15,23,42,.06);

/* Motion */
--dur-press:   150ms;   --dur-panel:  200ms;
--dur-route:   250ms;   --dur-modal:  300ms;
--ease-enter:  cubic-bezier(0.16, 1, 0.3, 1);   /* ease-out */
--ease-exit:   cubic-bezier(0.7, 0, 0.84, 0);   /* ease-in  */
```

Aksen `late` bukan hiasan: audit 2026-09-04 menemukan order terbuka yang lewat jadwal
(mis. `1000128544`, telat 74 hari; `1000128545`, 4 hari; `1000129387`, 1 hari) **tidak punya
penanda visual apa pun** di UI sekarang.

### 3.3 Aturan yang dipaksa oleh kanvas bernada

Kontras dihitung ulang saat review spec, dan hasilnya mengubah satu aturan. Nilai di atas
**kanvas** `#eef2f6`, bukan di atas putih:

| Warna | vs putih | vs kanvas `#eef2f6` |
|---|---|---|
| `--status-late` `#b45309` | 5,02:1 ✅ | **4,46:1 ❌** |
| `--status-running` `#0077b6` | 4,87:1 ✅ | **4,33:1 ❌** |
| `--status-ok` `#047857` | 5,48:1 ✅ | 4,87:1 ✅ |

Dua dari tiga aksen — termasuk **biru brand, warna aksi utama** — jatuh di bawah 4,5:1 begitu
diletakkan langsung di atas kanvas. Karena itu:

> **Aturan: kanvas bernada hanya untuk latar. Semua teks, tautan, dan label berwarna aksen
> wajib berada di atas permukaan putih (kartu/panel), tidak pernah langsung di atas kanvas.**

Konsekuensi kedua: kanvas terhadap putih hanya **1,12:1**. Pemisahan kartu dari latar karena
itu **tidak boleh mengandalkan beda warna** — ia harus datang dari `--shadow-card` + border.
Kalau shadow dimatikan (mis. mode kontras tinggi OS), border tetap wajib ada.

### 3.2 Kepadatan

Dua mode, `compact` dan `normal`, sebagai token spacing — bukan komponen terpisah.
Disimpan per-user di `localStorage`. Ini bentuk paling murah dari "panel bisa diatur ukurannya"
yang Anda minta, dan langsung terasa: pada mockup, tata letak padat memuat **4 order di tinggi
yang sama dengan 2 kartu** mode normal. Pool order saat ini 251 baris.

**Batasan:** di `/sow-scheduling/area`, mode `compact` **tidak boleh** menurunkan target sentuh
di bawah 44px, karena Area kini wajib tablet-ready (§0).

> **REVISI 2026-09-05 — kepadatan TIDAK rilis di Proyek A.** `DensityProvider` + `useDensity`
> dibangun dan diuji (5 test), tapi **toggle-nya sengaja tidak dipasang** dan tidak ada halaman
> yang membaca nilainya. Alasannya: sampai ada yang mengonsumsinya, toggle itu kontrol yang
> terlihat, memakan ~20px di setiap header, dan tidak mengubah satu piksel pun — ia berbohong
> kepada penggunanya. Proyek B/C harus lebih dulu membuat baris `OrderPanel`, kartu operasi,
> dan baris pohon task membaca `useDensity`, baru memasang kembali toggle-nya.

---

## 4. Sistem motion

- Durasi & easing mengikuti token §3.1, yang mengikuti angka CLAUDE.md (150 press, 200 panel,
  250–300 transisi besar).
- **`prefers-reduced-motion` wajib** — seluruh transisi jadi potong langsung, bukan sekadar
  dipercepat. Ini syarat rilis, bukan penyempurnaan.
- `framer-motion` **sudah terpasang** (dipakai `ComponentTrackingPage`, `KanbanLevelOnePage`).
  Tidak ada dependensi baru. Dipakai **hanya** untuk transisi route; hover/press tetap
  `transition-*` Tailwind. (Tile-expand direncanakan tapi di-revert — lihat §12.)

---

## 5. Transisi antar-page

Shell `ManufacturingSchedulingLayout` (53 baris) sudah berbentuk benar: `PageHeader` berada
**di luar** `<Outlet/>`, jadi header otomatis diam saat konten bertransisi. Tidak perlu diubah
strukturnya.

- `RouteTransition` dipasang membungkus `<Outlet/>`.
- **Arah dari kedalaman rute.** Maju (menu → sub-halaman): konten baru masuk dari kanan
  (translateX 24px → 0, opacity 0 → 1), konten lama keluar ke kiri. Back: kebalikannya.
  Ini memakai kembali logika kedalaman yang sudah ada di shell untuk menentukan label Back.
- **Dari menu:** tile memakai `layoutId` framer-motion sehingga memuai jadi halaman tujuan.
  Hanya berlaku dari menu; navigasi lain memakai slide berarah.
- **Scroll:** direset ke atas saat maju, dipulihkan saat mundur.

---

## 6. Primitif komponen

CLAUDE.md §1 mewajibkan ekstraksi saat pola muncul ≥2×. Yang sudah terbukti duplikat:
segmented control (ada di `OrderPanel` **dan** di `MapSapOperationPage` sejak 2026-09-04),
dan status pill (inline di 3+ tempat).

| Komponen | Alasan | Dipakai oleh |
|---|---|---|
| `Panel` | Permukaan berbatas/berelevasi + slot header | A, B, C |
| `Toolbar` | Baris search + kontrol, sudah duplikat | A, B, C |
| `SegmentedControl` | Sudah duplikat 2× | A, B, C |
| `FilterChip` | Chip filter aktif yang bisa dilepas | B, C |
| `StatusPill` | Inline di 3+ tempat | A, B, C |
| `DensityProvider` + `useDensity` | Mode kepadatan, persist localStorage | A, B, C |
| `SplitPane` | Dua kolom resizable, lebar persist | B, C |
| `RouteTransition` | Pembungkus motion route | A |

`EmptyState`, `Skeleton`, `SearchInput`, `PageHeader` **sudah ada** (dibangun oleh rencana
sebelumnya) — dipakai ulang, tidak dibuat baru.

`SplitPane` dan `FilterChip` sebenarnya milik B dan C. Dibangun di sini supaya kedua proyek itu
tidak melahirkan versinya masing-masing.

---

## 7. Penerapan ke halaman

| Halaman | Yang dilakukan |
|---|---|
| Shell | `RouteTransition` + toggle kepadatan di slot `headerRight` yang sudah tersedia |
| Menu | `layoutId` pada tile untuk transisi expand |
| Projects · Map · Area | Markup inline ditukar primitif; permukaan berlapis + tepi status diterapkan |

**Tata letak tidak diubah di Proyek A.** Restrukturisasi adalah pekerjaan B dan C.

---

## 8. Revisi yang dipaksa dokumen ini terhadap CLAUDE.md

Arah visual "layered" melanggar aturan yang berlaku sekarang. Dicatat eksplisit supaya tidak
terlihat sebagai pelanggaran diam-diam:

1. **Shadow.** CLAUDE.md membatasi kartu ke `shadow-sm` dan melarang shadow lebih besar pada
   kartu biasa. Arah visual yang dipilih memakai `--shadow-card` dua lapis. Aturan itu perlu
   direvisi menjadi: `shadow-sm` untuk permukaan datar, `--shadow-card` untuk kartu di atas
   kanvas bernada.
2. **Palet.** CLAUDE.md menyebut Corporate Color System "APPROVED & ACTIVE". Dokumen ini
   menambah `--canvas` dan tiga aksen semantik. Biru brand tidak diubah sedikit pun.
3. **Background halaman.** CLAUDE.md mewajibkan `bg-slate-50`. Kanvas bernada `#eef2f6` adalah
   penyimpangan kecil, berlaku **hanya** di `/sow-scheduling`.

CLAUDE.md diperbarui sebagai bagian dari implementasi A, bukan setelahnya.

---

## 9. Verifikasi

| Aspek | Cara |
|---|---|
| Visual | Jalankan aplikasi, bandingkan tangkapan layar sebelum/sesudah tiap halaman |
| Kontras | Verifikasi aksen terhadap latar sesungguhnya. **Cari pelanggaran §3.3:** tidak boleh ada teks aksen langsung di atas `--canvas` |
| Pemisahan kartu | Matikan shadow di devtools — kartu harus tetap terbaca terpisah lewat border (kanvas vs putih hanya 1,12:1) |
| Reduced motion | Aktifkan `prefers-reduced-motion`, pastikan transisi **hilang**, bukan sekadar cepat |
| Target sentuh | Di `/area`, ukur target pada mode `compact` — wajib ≥ 44px |
| Regresi | Halaman di luar `/sow-scheduling` tidak boleh berubah sama sekali |
| Build | `npm run lint` + `npm run build` bersih dari `apps/web` |
| Dependensi runtime | **Tidak ada paket baru** — `framer-motion` sudah terpasang |
| Dependensi dev | **Vitest + Testing Library ditambahkan** (keputusan owner 2026-09-04). `apps/web` sebelumnya tidak punya test runner sama sekali (scripts hanya `dev`/`build`/`lint`/`preview`), sehingga perilaku komponen tak bisa diverifikasi otomatis. `devDependencies` saja — tidak masuk bundle produksi. Dipakai ulang oleh Proyek B dan C |
| Cakupan tes | Perilaku komponen (`SegmentedControl`, `useDensity`, `RouteTransition` + reduced-motion). Token CSS, shadow, dan rasa motion **tidak** di-unit-test — diverifikasi visual |

---

## 10. Yang TIDAK dikerjakan di Proyek A

Mode tampilan (peta/timeline/tabel), logika filter, alur non-linear, restrukturisasi tata
letak, pemecahan `ReservationPanel` dan `MapSapOperationPage` — semuanya Proyek B dan C.
Backend, model data, kontrak VBA, dan varian salvaging tidak tersentuh.

---

## 11. Risiko

| Risiko | Sikap |
|---|---|
| Aplikasi tampil dua bahasa visual selama A–D berjalan | **Diterima** — konsekuensi langsung dari pilihan blast radius `/sow-scheduling` saja |
| `--canvas` dan aksen baru menyebar tak sengaja ke halaman lain | Token global tapi penerapan lokal; verifikasi regresi (§9) menangkapnya |
| Motion terasa lambat bagi planner yang bekerja cepat | Durasi 250ms mengikuti standar yang sudah ada; kalau mengganggu, turunkan token `--dur-route`, bukan hapus transisinya |
| Mode compact merusak Area di tablet | Batas 44px di §3.2, diverifikasi di §9 |

---

## 12. Yang berubah selama eksekusi (2026-09-05)

Dua fitur yang disetujui di §2 **tidak jadi rilis**. Dicatat di sini, bukan dihapus diam-diam,
supaya keputusannya bisa ditinjau ulang kalau prasyaratnya berubah.

### 12.1 Tile-expand — DIBATALKAN (arsitektural)

Dikerjakan (`35c1cce`) lalu di-revert (`d40a393`).

`RouteTransition` memakai `AnimatePresence mode="wait"`, yang meng-unmount halaman menu
SEPENUHNYA sebelum halaman tujuan mount. Shared-layout morph framer-motion mensyaratkan kedua
elemen ber-`layoutId` hidup BERSAMAAN — dengan `mode="wait"` itu tak pernah terjadi. Tak ada
halaman tujuan yang mendefinisikan `layoutId` pasangannya pun.

Ini cacat desain di dokumen ini: tile-expand ditawarkan sebagai "tambahan, bukan pengganti"
yang butuh slide berarah sebagai dasar — tanpa menyadari bahwa dasar itulah yang meniadakannya.

Prasyarat kalau ingin dihidupkan: ganti `mode="wait"` (mis. `popLayout`) lebih dulu. Itu
mengubah dasar transisi yang sudah berjalan, jadi butuh verifikasi browser, bukan test.

### 12.2 Toggle kepadatan — TIDAK DIPASANG

`DensityProvider` + `useDensity` rilis dan teruji; toggle-nya tidak (`b69ebf4`).
Alasan lengkap di §3.2.

### 12.3 Utang verifikasi yang BELUM ditutup

**Tidak ada satu pun cek browser yang dilakukan sepanjang 14 task.** Tak ada agent yang punya
tool browser. Yang berikut hanya terverifikasi lewat pembacaan kode dan test jsdom:

| Hal | Risiko kalau salah |
|---|---|
| Font stack (4 halaman, perubahan global) | Metrik glyph berbeda → kolom tabel membungkus, label tombol tak muat |
| Dua segmented control yang diganti | Perilaku tab/filter di halaman produksi |
| Transisi route: arah, FrozenRoute, reduced-motion | Animasi salah arah atau konten "menggeser dirinya sendiri" |
| Permukaan berlapis + tepi status | Kontras dan keterbacaan nyata |

Test membuktikan **logika**-nya benar. Tidak ada yang membuktikan **tampilannya** benar.
