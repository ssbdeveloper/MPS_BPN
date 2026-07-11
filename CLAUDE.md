# CLAUDE.md — MPS Timesheet (apps/web)
 
> AI context file. Baca ini sebelum membuat atau mengubah kode apapun di project ini.
 
untuk koneksi dengan postgres gunakan
"C:\Program Files\PostgreSQL\15\bin\psql.exe" 
 $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\PostgreSQL\15\bin"; [System.Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
---
 
## Project Overview
 
**MPS Timesheet** adalah aplikasi Timesheet Manufacturing berbasis React + Vite + Tailwind CSS dengan dukungan PWA (Progressive Web App) untuk mode offline.
 
- **Framework:** React 19 + Vite 7
- **Styling:** Tailwind CSS v3 + inline style untuk nilai warna dinamis
- **Router:** React Router v7 (`createBrowserRouter`, semua route lazy)
- **State/Cache:** useState/useCallback + fetch native (TIDAK ada React Query / state library eksternal)
- **Notifications:** sonner (toast)
- **PWA:** vite-plugin-pwa + Workbox

---

## Dokumentasi & Second Brain

`docs/` adalah vault Obsidian (second brain proyek). **Baca `docs/KONVENSI.md` sebelum
menulis dokumen apa pun.** Aturan inti:

- **Sebelum mendesain/menjawab soal sistem:** cek `docs/concepts/` (pengetahuan menetap)
  dan `docs/log/` (keputusan per sesi) — jangan litigasi ulang keputusan yang sudah tercatat.
- **Setelah sesi kerja signifikan:** tulis `docs/log/YYYY-MM-DD-topik.md`, update baris di
  `docs/PLANNING.md`, dan update note `docs/concepts/` yang tersentuh.
- Papan kerja: `docs/PLANNING.md` · Peta dokumen: `docs/00-INDEX.md`.

---
 
## Corporate Color System
 
> Status: **APPROVED & ACTIVE** (ditetapkan 2026-03-19)
> Referensi implementasi (struktur/layout): `src/pages/TIMESHEET/TimesheetValidationPage.jsx`
> (catatan: file `TimesheetValidationPageV2.jsx` sudah tidak ada; jangan mencarinya.
> Warna tombol primary di file referensi masih standar lama `#0096c7` —
> standar yang berlaku sekarang `#0077b6`, lihat Accessibility Rules di bawah)
 
Palette ini adalah **standard corporate color** untuk seluruh UI aplikasi MPS Timesheet.
Setiap komponen baru atau halaman baru HARUS mengikuti aturan ini.
 
---
 
### 1. Color Palette
 
| Token Name         | CSS Variable             | HEX Value   | Keterangan                        |
|--------------------|--------------------------|-------------|-----------------------------------|
| `deep-twilight`    | `--deep-twilight`        | `#03045e`   | Terdalam — text kontras tinggi, border aktif |
| `french-blue`      | `--french-blue`          | `#023e8a`   | Warna brand utama (employee group header, hover button primary) |
| `bright-teal-blue` | `--bright-teal-blue`     | `#0077b6`   | **Primary action color** (bg button, link) — AA di atas putih (4.9:1) |
| `blue-green`       | `--blue-green`           | `#0096c7`   | Accent besar, ikon, border aktif, teks besar — BUKAN teks kecil / bg tombol (3.4:1 vs putih, gagal AA) |
| `turquoise-surf`   | `--turquoise-surf`       | `#00b4d8`   | Focus ring, spinner, highlight    |
| `sky-aqua`         | `--sky-aqua`             | `#48cae4`   | Subtle accent, icon accent        |
| `frosted-blue`     | `--frosted-blue`         | `#90e0ef`   | Border ringan, divider            |
| `frosted-blue-2`   | `--frosted-blue-2`       | `#ade8f4`   | Background surface sekunder       |
| `light-cyan`       | `--light-cyan`           | `#caf0f8`   | Background tabel header, stat card |
 
**Neutral (Tailwind built-in — gunakan langsung):**
 
| Peran             | Tailwind Class       | Keterangan                          |
|-------------------|----------------------|-------------------------------------|
| Background utama  | `bg-slate-50`        | Halaman & layout background         |
| Surface (card)    | `bg-white`           | Card, panel, modal, input           |
| Border default    | `border-slate-200`   | Semua border di atas background putih |
| Border hover      | `border-slate-300`   | Border saat hover                   |
| Text utama        | `text-slate-800`     | Heading & body text                 |
| Text sekunder     | `text-slate-500`     | Label, hint, placeholder            |
| Text placeholder  | `placeholder-slate-400` | Input placeholder                |
 
---
 
### 2. Prinsip Utama (WAJIB DIIKUTI)
 
```
Rasio penggunaan warna:
  ✅ ~80% Putih / neutral (slate-50, white, slate-100)
  ✅ ~20% Warna brand biru (sebagai accent, bukan background besar)
```
 
1. **Light theme only** — Aplikasi ini TIDAK menggunakan dark mode.
   Jangan gunakan `dark:` prefix Tailwind.
 
2. **Biru sebagai accent, bukan background** — Warna `deep-twilight` hingga `french-blue`
   hanya boleh digunakan sebagai background pada elemen kecil seperti:
   - Employee group header / card header gradient
   - Active nav indicator
   - Badge/chip
   Jangan gunakan sebagai background halaman, panel filter, atau header utama.
 
3. **Surface selalu putih atau slate-50** — Card, modal, panel, sidebar,
   dan container utama harus menggunakan `bg-white` atau `bg-slate-50`.
 
4. **Teks harus kontras** — Teks di atas background putih menggunakan `text-slate-800`
   minimum. Teks hint/secondary menggunakan `text-slate-500`. Jangan gunakan warna
   biru terang sebagai teks di atas background putih (kontras rendah).
 
---
 
### 3. Color Usage Rules
 
#### Background
 
| Konteks                   | Warna yang benar                  | Yang harus dihindari               |
|---------------------------|-----------------------------------|------------------------------------|
| Halaman / layout root     | `bg-slate-50`                     | Gradient biru gelap                |
| Header aplikasi           | `bg-white border-b border-slate-200` | `bg-blue-900`, rgba gelap        |
| Panel filter / sidebar    | `bg-white border-b border-slate-200` | Background semi-transparan gelap |
| Card / container          | `bg-white shadow-sm border border-slate-200 rounded-xl` | Background biru |
| Stat card accent          | `#fffbeb`, `#f0fdf4`, `#caf0f8`, `#eef2ff` (ringan) | Background pekat |
| Tabel header row          | `#caf0f8` (light-cyan)            | Background biru gelap              |
| Scrollable list area      | `bg-slate-50`                     | Gradient gelap                     |
| Employee group header     | Gradient `#023e8a → #0077b6`      | ✅ Boleh — elemen kecil yang terdefinisi |
 
#### Text
 
| Konteks                   | Class                   |
|---------------------------|-------------------------|
| Heading / title halaman   | `text-slate-800 font-bold` |
| Body / label              | `text-slate-700`        |
| Hint / secondary          | `text-slate-500`        |
| Placeholder input         | `placeholder-slate-400` |
| Teks di atas biru gelap   | `text-white`            |
| Teks accent / link        | `text-[#0077b6]` — jangan `#0096c7` (3.4:1, gagal AA) |
| Error text                | `text-red-600`          |
| Success text              | `text-emerald-600`      |
| Warning text              | `text-amber-600`        |
 
#### Button
 
| Tipe              | Class                                                                 |
|-------------------|-----------------------------------------------------------------------|
| **Primary**       | `bg-[#0077b6] hover:bg-[#023e8a] text-white rounded-lg`              |
| **Outline**       | `bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg` |
| **Danger**        | `bg-red-600 hover:bg-red-500 text-white rounded-lg`                  |
| **Success**       | `bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg`          |
| **Ghost (di atas biru)** | `bg-white/20 hover:bg-white/35 text-white rounded-full`       |
| **Disabled**      | Tambahkan `disabled:opacity-50 disabled:cursor-not-allowed`          |
| **Active press**  | Tambahkan `active:scale-95 transition-all duration-150`              |
| **Tinggi minimum** | Tambahkan `min-h-[44px]` — touch target WAJIB di layar sentuh (lihat Touch Target Rules) |
| **Focus**         | Tambahkan `focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none` |
 
#### Input & Form
 
```jsx
// Kelas standar untuk semua input text, date, select:
className="bg-white border border-slate-200 text-slate-800 placeholder-slate-400
           rounded-lg text-sm focus:outline-none focus:ring-2
           focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all duration-150"
```
 
| State  | Efek                                                        |
|--------|-------------------------------------------------------------|
| Normal | `border-slate-200`                                          |
| Focus  | `ring-2 ring-[#00b4d8]` + `border-[#0096c7]`               |
| Error  | `border-red-400 ring-2 ring-red-200`                        |
| Disabled | `opacity-50 cursor-not-allowed bg-slate-50`               |
 
#### Status Badge (pill)
 
```jsx
// Pending
"px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200"
 
// Validated
"px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"
 
// Deleted
"px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 border border-red-200"
 
// SAP Reject
"px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200"
```
 
---
 
### 4. Accessibility Rules
 
1. **Kontras minimum WCAG AA:**
   - Teks normal: rasio kontras ≥ 4.5:1 terhadap background
   - Teks besar (≥ 24px, atau bold ≥ 18.66px): rasio ≥ 3:1
   - `text-slate-800` di atas `bg-white` → ✅ ~14:1 (AA pass)
   - `text-white` di atas `#0077b6` → ✅ 4.9:1 (AA pass) — **standar bg tombol primary**
   - `text-white` di atas `#0096c7` → ❌ **3.4:1 — GAGAL AA untuk teks normal.**
     Kombinasi ini hanya untuk teks besar/ikon — BUKAN untuk tombol `text-xs`
   - `#0096c7` sebagai teks/link di atas putih → ❌ 3.4:1 — gunakan `#0077b6`
   - Teks `#48cae4` (sky-aqua) di atas `bg-white` → ❌ jauh di bawah AA
 
2. **Focus state wajib terlihat** — Button/link/elemen interaktif:
   `focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none`
   (ring hanya muncul saat navigasi keyboard, tidak menyala saat tap).
   Input/select tetap `focus:ring-2 focus:ring-[#00b4d8]`.
   Jangan `outline-none` tanpa pengganti visual.
 
3. **Jangan mengandalkan warna saja** — Status (pending/validated/deleted) harus
   ditunjukkan dengan label teks + warna, bukan warna saja.
 
4. **Ukuran teks minimum 12px (`text-xs`)** untuk teks yang dibaca.
   `text-[11px]` hanya untuk label uppercase kecil (badge/eyebrow).
   `text-[10px]` ke bawah dilarang.
 
---
 
### 5. Tailwind Config — Extend Colors
 
Tambahkan ke `tailwind.config.js` untuk bisa menggunakan nama token sebagai class:
 
```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      // ... existing colors (primary, success, dll) ...
 
      // Corporate Blue Palette
      brand: {
        'deep-twilight':    '#03045e',
        'french-blue':      '#023e8a',
        'bright-teal-blue': '#0077b6',  // ← primary action
        'blue-green':       '#0096c7',
        'turquoise-surf':   '#00b4d8',  // ← focus ring
        'sky-aqua':         '#48cae4',
        'frosted-blue':     '#90e0ef',
        'frosted-blue-2':   '#ade8f4',
        'light-cyan':       '#caf0f8',
      },
    },
  },
},
```
 
Setelah ditambahkan, bisa digunakan sebagai:
```jsx
<button className="bg-brand-bright-teal-blue hover:bg-brand-french-blue text-white">
  Primary Action
</button>
```
 
> **Catatan:** Selama belum ditambahkan ke config, gunakan inline `bg-[#0077b6]` — ini valid di Tailwind v3.
> Saat menambahkan palet ini ke config, sekaligus rencanakan deprecation token legacy
> `primary (#007bff)/success/danger/warning/secondary` dan `boxShadow 3d-*` yang masih ada
> di `tailwind.config.js` dan dipakai komponen lama (`ui/Button`, `forms/Input`, `ui/Switch`,
> `tables/Table`) — jangan pakai token legacy itu untuk UI baru.
 
---
 
### 6. Contoh Implementasi Lengkap
 
#### Page Shell (layout dasar)
```jsx
<div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50">
 
  {/* Header */}
  <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5
                     bg-white border-b border-slate-200 shadow-sm">
    <button className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50
                       px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95">
      Back
    </button>
    <h1 className="text-base font-extrabold text-slate-800">Page Title</h1>
    <button className="bg-[#0077b6] hover:bg-[#023e8a] text-white
                       px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95">
      Action
    </button>
  </header>
 
  {/* Filter / toolbar */}
  <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-slate-200">
    <input
      className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                 placeholder-slate-400 rounded-lg text-sm focus:outline-none
                 focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
      placeholder="Search..."
    />
  </div>
 
  {/* Content */}
  <div className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50">
    {/* Cards */}
    <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-4">
      Content here
    </div>
  </div>
 
</div>
```
 
#### Stat Card
```jsx
// Pending (amber)
<div className="rounded-xl px-2 py-3 text-center border shadow-sm
                bg-amber-50 border-amber-200">
  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">Pending</div>
  <div className="text-base font-extrabold text-amber-700">12 Act</div>
  <div className="text-[11px] text-gray-500">45.5 hrs</div>
</div>
 
// Validated (emerald)
<div className="rounded-xl px-2 py-3 text-center border shadow-sm
                bg-emerald-50 border-emerald-200">
  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Validated</div>
  <div className="text-base font-extrabold text-emerald-700">30 Act</div>
</div>
 
// Info (brand blue)
<div className="rounded-xl px-2 py-3 text-center border shadow-sm"
     style={{ background: '#caf0f8', borderColor: '#90e0ef' }}>
  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#023e8a' }}>Total Hrs</div>
  <div className="text-base font-extrabold" style={{ color: '#023e8a' }}>120.5</div>
</div>
```
 
#### Employee Group Header (satu-satunya elemen yang boleh pakai background biru gelap)
```jsx
<div className="px-4 py-3 cursor-pointer transition-colors"
     style={{ background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)' }}>
  <div className="text-sm font-bold text-white">John Doe</div>
  <div className="text-xs font-mono text-[#ade8f4]">EMP001</div>
</div>
```
 
---
 
### 7. Anti-Patterns

> Lihat section **"Anti-Patterns → Perbaikan"** di bawah — versi berpasangan ❌/✅
> (setiap larangan ada padanan yang benar). Jangan duplikasi daftarnya di sini.
 
---
 
## CSS Variable Declarations (`:root`)
 
> Tambahkan ke `src/index.css` atau file CSS global sebelum Tailwind directives.
> Wajib ada agar `var(--...)` bisa digunakan di inline style.
> **Status: BELUM ada di `index.css`** (diverifikasi 2026-07-11) — tambahkan blok ini
> saat pertama kali menyentuh `index.css` atau saat butuh `var(--...)`.
 
```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
 
:root {
  /* Corporate Blue Palette */
  --deep-twilight:    #03045e;
  --french-blue:      #023e8a;
  --bright-teal-blue: #0077b6;   /* ← primary action */
  --blue-green:       #0096c7;
  --turquoise-surf:   #00b4d8;   /* ← focus ring */
  --sky-aqua:         #48cae4;
  --frosted-blue:     #90e0ef;
  --frosted-blue-2:   #ade8f4;
  --light-cyan:       #caf0f8;
 
  /* Shadow scale (gunakan konsisten, lihat aturan di bawah) */
  --shadow-card:    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-panel:   0 4px 12px rgba(0,0,0,0.08);
  --shadow-modal:   0 8px 32px rgba(0,0,0,0.12);
}
```
 
---
 
## Shadow & Elevation Scale
 
> Pakai shadow yang **paling ringan** yang masih cukup untuk memberi kesan kedalaman.
> Jangan gunakan shadow gelap atau besar pada elemen kecil.
 
| Konteks | Tailwind / Variable | Kapan Dipakai |
|---|---|---|
| Card / list item | `shadow-sm` | Container konten di atas bg-slate-50 |
| Panel / drawer | `shadow-md` | Sidebar, filter panel yang "mengambang" |
| Modal / popover | `shadow-xl` | Overlay di atas halaman |
| Header | `shadow-sm` + `border-b border-slate-200` | App header — **selalu kombinasikan** |
| Tombol | Tidak ada shadow | Button tidak perlu shadow |
| Input | Tidak ada shadow | Gunakan border + ring saja |
 
```jsx
// ✅ Card — shadow-sm cukup di atas bg-slate-50
<div className="bg-white shadow-sm border border-slate-200 rounded-xl p-4">
 
// ✅ Modal
<div className="bg-white shadow-xl rounded-2xl p-6">
 
// ❌ Jangan: shadow besar pada card biasa
<div className="bg-white shadow-xl border ...">
```
 
---
 
## Spacing & Sizing Scale
 
> Aturan padding dan gap standar agar semua halaman terasa konsisten.
> AI wajib mengikuti ini — jangan menggunakan nilai arbitrary tanpa alasan.
 
### Padding Internal (dalam komponen)
 
| Komponen | Class |
|---|---|
| Card / panel body | `p-4` (16px) |
| Card header (dengan judul) | `px-4 py-3` |
| Table cell | `px-3 py-2` |
| Input / select | `px-3 py-2` |
| Button default | `px-4 py-2` |
| Button kecil (compact) | `px-3 py-1.5` |
| Badge / pill | `px-2 py-0.5` |
| Modal | `p-6` |
| Page section | `px-4 py-3` (mobile) / `px-6 py-4` (tablet+) |
 
### Gap / Spacing Antar Elemen
 
| Konteks | Class |
|---|---|
| Antar card dalam grid | `gap-3` |
| Antar item dalam list | `gap-2` |
| Antar field dalam form | `gap-4` |
| Antar tombol dalam group | `gap-2` |
| Antar section / block | `gap-6` |
| Icon + teks dalam button | `gap-1.5` |
 
### Border Radius
 
| Elemen | Class |
|---|---|
| Card, panel, modal | `rounded-xl` |
| Input, select, textarea | `rounded-lg` |
| Button | `rounded-lg` |
| Badge / pill | `rounded-full` |
| Avatar / gambar kecil | `rounded-full` |
| Tabel (wrapper) | `rounded-xl overflow-hidden` |
 
---
 
## Anti-Patterns → Perbaikan (Pasangan ❌ / ✅)
 
> Setiap larangan harus ada padanan yang benar. AI wajib menggunakan versi ✅.
 
### Background halaman
 
```jsx
// ❌ Background halaman dengan gradient gelap
<div style={{ background: 'linear-gradient(160deg, #03045e 0%, #0077b6 100%)' }}>
 
// ✅ Background halaman selalu slate-50
<div className="min-h-screen bg-slate-50">
```
 
### Header aplikasi
 
```jsx
// ❌ Header gelap
<header className="bg-blue-900 text-white px-4 py-3">
 
// ✅ Header putih dengan border bawah
<header className="bg-white border-b border-slate-200 shadow-sm px-4 py-2.5
                   flex items-center justify-between">
```
 
### Filter panel / toolbar
 
```jsx
// ❌ Filter panel semi-transparan gelap
<div style={{ background: 'rgba(3,4,94,0.55)', backdropFilter: 'blur(8px)' }}>
 
// ✅ Filter panel putih dengan border bawah
<div className="bg-white border-b border-slate-200 px-4 py-3">
```
 
### Input field
 
```jsx
// ❌ Input gelap
<input className="bg-white/10 text-white placeholder-white/50 border-white/20">
 
// ✅ Input standar
<input className="bg-white border border-slate-200 text-slate-800 placeholder-slate-400
                  rounded-lg px-3 py-2 text-sm focus:outline-none
                  focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all">
```
 
### Teks accent / link
 
```jsx
// ❌ Sky-aqua ATAU blue-green sebagai teks di atas putih — dua-duanya gagal AA
<span className="text-[#48cae4]">Label di atas bg-white</span>
<span className="text-[#0096c7]">Link di atas bg-white (3.4:1 — FAIL)</span>
 
// ✅ Gunakan bright-teal-blue untuk teks/link di atas putih (4.9:1 — AA pass)
<span className="text-[#0077b6]">Label di atas bg-white</span>
```
 
### Deep-twilight / french-blue sebagai background besar
 
```jsx
// ❌ Seluruh halaman biru gelap
<div className="bg-[#03045e] min-h-screen">
 
// ✅ Hanya gunakan pada elemen kecil tertentu (employee group header, badge, dll)
<div className="px-4 py-3"
     style={{ background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)' }}>
  <span className="text-sm font-bold text-white">Employee Group</span>
</div>
```
 
---
 
## Responsive Layout — Tablet (Landscape & Portrait)
 
> MPS Timesheet digunakan di tablet (landscape 800–960px / portrait 768×1024).
> Semua halaman WAJIB responsif di kedua orientasi.
> Gunakan breakpoint `md:` (768px) sebagai breakpoint landscape utama.
 
---
 
### Prinsip Responsive
 
1. **Mobile-first** — tulis class tanpa prefix dulu (untuk mobile/portrait kecil),
   lalu override dengan `md:` untuk tablet landscape.
 
2. **Hindari fixed width** — jangan gunakan `w-[320px]` atau nilai pixel tetap
   untuk container utama. Gunakan `w-full`, `max-w-*`, atau `flex-1`.
 
3. **Orientasi landscape tablet (≥768px)** — manfaatkan lebar dengan layout 2-kolom.
   Filter / sidebar bisa muncul berdampingan dengan konten.
 
4. **Orientasi portrait tablet (< 768px)** — layout tetap 1 kolom,
   tapi padding dan ukuran elemen lebih besar dari mobile.
 
5. **Touch-friendly tap target** — semua elemen interaktif minimal `44×44px`.
   Gunakan `min-h-[44px]` dan `min-w-[44px]` pada tombol dan item list.
 
---
 
### Breakpoint Reference
 
| Prefix | Min-width | Target Device |
|---|---|---|
| (none) | 0px | Mobile portrait (fallback) |
| `sm:` | 640px | Mobile landscape (jarang dipakai) |
| `md:` | 768px | Tablet landscape — **breakpoint utama** |
| `lg:` | 1024px | Desktop only (bukan target tablet) |
| `xl:` | 1280px | Desktop lebar (opsional, bukan target utama) |
 
---
 
### Page Shell — Responsive
 
```jsx
// Layout dasar yang adaptif untuk tablet landscape & portrait
<div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50">
 
  {/* Header — selalu full width */}
  <header className="flex-shrink-0 flex items-center justify-between
                     px-4 md:px-6 py-2.5
                     bg-white border-b border-slate-200 shadow-sm">
    <button className="min-h-[44px] min-w-[44px] flex items-center justify-center
                       bg-white border border-slate-200 text-slate-700
                       hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold
                       transition-all active:scale-95">
      Back
    </button>
    <h1 className="text-sm md:text-base font-extrabold text-slate-800">Page Title</h1>
    <button className="min-h-[44px] flex items-center
                       bg-[#0077b6] hover:bg-[#023e8a] text-white
                       px-3 md:px-4 py-1.5 rounded-lg text-xs font-semibold
                       transition-all active:scale-95">
      Action
    </button>
  </header>
 
  {/* Body: portrait = 1 kolom, landscape = bisa 2 kolom */}
  <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
 
    {/* Filter / sidebar — collapse di portrait, side panel di landscape */}
    <div className="flex-shrink-0
                    border-b border-slate-200 md:border-b-0 md:border-r
                    bg-white px-4 py-3 md:w-72 md:overflow-y-auto">
      {/* Filter controls */}
      <input
        className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                   placeholder-slate-400 rounded-lg text-sm focus:outline-none
                   focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
        placeholder="Search..."
      />
    </div>
 
    {/* Content area */}
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 md:py-4 bg-slate-50">
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-4">
        Content
      </div>
    </div>
 
  </div>
</div>
```
 
---
 
### Grid Responsive
 
```jsx
// 1 kolom di mobile, 2 di tablet portrait, 3 di tablet landscape
<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
  {items.map(item => (
    <div key={item.id} className="bg-white shadow-sm border border-slate-200 rounded-xl p-4">
      {/* card content */}
    </div>
  ))}
</div>
 
// Stat cards: 2 kolom di mobile, 4 di tablet landscape
<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
  {/* stat cards */}
</div>
```
 
---
 
### Tabel Responsive
 
> Tabel data sering overflow di tablet portrait. Gunakan pola ini.
 
```jsx
// Wrapper dengan horizontal scroll — lebih baik dari collapse kolom
<div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr style={{ background: '#caf0f8' }}>
          {/* Kolom penting: visible selalu */}
          <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">
            No. TS
          </th>
          {/* Kolom sekunder: hide di portrait, show di landscape */}
          <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap
                         hidden md:table-cell">
            Tanggal
          </th>
          <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">
            Teknisi
          </th>
          <th className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">
            Status
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(row => (
          <tr key={row.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-3 py-2 text-slate-800 font-mono text-xs">{row.tsNumber}</td>
            <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{row.date}</td>
            <td className="px-3 py-2 text-slate-800">{row.technician}</td>
            <td className="px-3 py-2">{/* badge */}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```
 
---
 
### Modal Responsive
 
```jsx
// Modal yang nyaman di tablet landscape maupun portrait
<div className="fixed inset-0 z-50 flex items-end md:items-center justify-center
                bg-black/30 backdrop-blur-sm px-0 md:px-4">
  <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl
                  shadow-xl p-6 max-h-[90vh] overflow-y-auto">
    {/* Modal content */}
    <h2 className="text-base font-bold text-slate-800 mb-4">Judul Modal</h2>
    {/* form fields */}
    <div className="flex gap-2 justify-end mt-6">
      <button className="bg-white border border-slate-200 text-slate-700
                         hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold
                         transition-all active:scale-95">
        Batal
      </button>
      <button className="bg-[#0077b6] hover:bg-[#023e8a] text-white
                         px-4 py-2 rounded-lg text-sm font-semibold
                         transition-all active:scale-95">
        Simpan
      </button>
    </div>
  </div>
</div>
 
{/* Catatan: di mobile/portrait = bottom sheet (rounded-t-2xl, items-end)
            di tablet/landscape = centered modal (rounded-2xl, items-center md:) */}
```
 
---
 
### Typography Scale Responsive
 
```jsx
// Heading halaman
<h1 className="text-sm md:text-base font-extrabold text-slate-800">
 
// Sub-heading / section title
<h2 className="text-xs md:text-sm font-bold text-slate-700 uppercase tracking-wide">
 
// Body / label
<p className="text-xs md:text-sm text-slate-700">
 
// Hint / secondary
<span className="text-[11px] md:text-xs text-slate-500">
 
// Mono / kode (no. TS, kode operasi)
<span className="font-mono text-xs text-slate-600">
```
 
---
 
### Touch Target Rules
 
```jsx
// ✅ Semua elemen interaktif harus punya area tap minimal 44×44px
<button className="min-h-[44px] min-w-[44px] flex items-center justify-center ...">
  <IconSearch size={16} />
</button>
 
// ✅ List item yang bisa diklik
<div className="min-h-[52px] flex items-center px-4 cursor-pointer
                hover:bg-slate-50 active:bg-slate-100 transition-colors">
  Content
</div>
 
// ❌ Jangan: tap target terlalu kecil
<button className="p-1 text-xs">×</button>
```
 
---
 
### Orientation Detection (opsional, untuk behavior khusus)
 
```jsx
// Jika perlu deteksi orientasi secara programatik
import { useState, useEffect } from 'react';
 
function useOrientation() {
  const [isLandscape, setIsLandscape] = useState(
    window.innerWidth > window.innerHeight
  );
 
  useEffect(() => {
    const handler = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
 
  return isLandscape;
}
 
// Penggunaan
const isLandscape = useOrientation();
// Tapi UTAMAKAN CSS Tailwind (md:) — gunakan hook ini hanya untuk logic JS
```

---

## UI Engineering Standards (Professional Grade)

> Corporate Color System mengatur *tampilan*; section ini mengatur *perilaku dan
> cara membangun* UI. Berlaku untuk semua halaman/komponen baru, dan setiap kali
> halaman lama disentuh.

### 1. Component-First (WAJIB — anti-boilerplate)

Jangan menulis ulang string className panjang di tiap halaman. Urutan kerja SELALU:

1. **Cek dulu `apps/web/src/components/`** — kalau komponennya sudah ada, pakai/extend.
2. Kalau belum ada dan polanya dipakai (atau akan dipakai) di ≥2 tempat →
   **buat komponennya dulu** di `components/ui/` (atau `forms/`, `tables/`, `layout/`),
   baru pakai di halaman.
3. Saat melihat markup duplikat ≥2× ketika mengedit halaman, **rekomendasikan
   ekstraksi komponen** secara eksplisit — jangan menambah salinan ketiga.

Aturan API komponen:
- Varian lewat props (`variant="primary|outline|danger|success|ghost"`, `size`),
  BUKAN lewat className bebas dari pemanggil.
- `className` dari luar hanya untuk layout (margin, width, grid placement) —
  bukan override warna/radius/shadow, supaya sistem tetap konsisten.
- Komponen UI murni presentasional; logic/fetch tetap di halaman (Critical Rule #3).

**Inventaris komponen saat ini (status per 2026-07-11):**

| Komponen | Status |
|---|---|
| `ui/Button.jsx`, `forms/Input.jsx`, `ui/Switch.jsx`, `tables/Table.jsx` | ⚠️ Ada, tapi masih gaya LAMA (`shadow-3d`, `primary #007bff`) — JANGAN dijadikan acuan visual; migrasikan ke standar ini saat disentuh |
| `ui/Modal.jsx`, `ui/ConfirmationModal.jsx`, `ui/Card.jsx`, `layout/PageContainer.jsx` | ✅ Ada — pakai ini; jangan bikin modal/card inline baru |
| `dashboard/KpiCard.jsx`, `dashboard/ChartErrorBoundary.jsx`, `dashboard/*Chart.jsx` | ✅ Ada — chart baru ikut pola ini + aturan Dataviz (§8) |

**Komponen target — buat saat pertama kali dibutuhkan, jangan tulis inline:**
`Badge`/`StatusPill`, `EmptyState`, `Skeleton`, `Spinner`/`LoadingButton`,
`PageHeader` (back + title + action standar), `SearchInput`, `Select`,
`StatCard`, `FilterBar`, `OfflineIndicator`.

### 2. Offline-First — Larangan Aset Eksternal (WAJIB)

Aplikasi berjalan di jaringan pabrik yang bisa terputus dari internet. Semua aset
HARUS berasal dari bundle sendiri (npm → Vite) atau origin sendiri.

- ❌ Dilarang: `<link>`/`<script>`/`@import` ke CDN apapun (unpkg, jsdelivr,
  cdnjs, dll.), Google Fonts, ikon/gambar hotlink dari URL eksternal.
- ✅ Library selalu via npm dan di-bundle Vite: `lucide-react` untuk ikon,
  `echarts`/`recharts` untuk chart, dst.
- ✅ Font: **system font stack** (nol network, render instan — lihat §3). Kalau
  suatu saat butuh font brand → self-host via package `@fontsource/*` (ikut
  bundle), BUKAN link CDN.
- Entry `google-fonts-cache` di `vite.config.js` (workbox) adalah sisa konfigurasi
  lama — tidak ada referensi Google Fonts di aplikasi; hapus saat menyentuh file itu.

### 3. Typography & Angka

- Font stack standar (ganti `Arial` di `index.css` saat menyentuh file itu):
  ```css
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  ```
- **Kolom angka WAJIB `tabular-nums`** (class Tailwind) — jam, qty, durasi,
  no. order. Tanpa ini digit tidak sejajar antar-baris dan kolom sulit di-scan.
- Ukuran minimum: 12px (`text-xs`) untuk teks yang dibaca; `text-[11px]` hanya
  label uppercase kecil (badge/eyebrow); `text-[10px]` ke bawah dilarang.

### 4. State Standar: Loading / Empty / Error (WAJIB di setiap halaman fetch)

| State | Pola |
|---|---|
| Loading konten | Skeleton (`animate-pulse`, blok abu-abu seukuran konten) — bukan spinner satu layar |
| Loading aksi | Spinner kecil DI DALAM tombol + `disabled` — jangan blok seluruh layar |
| Empty | Ikon + 1 kalimat penjelasan + aksi utama ("Belum ada timesheet hari ini" + tombol buat) — jangan tabel/area kosong tanpa keterangan |
| Error fetch | Pesan inline di area konten + tombol "Coba lagi" — JANGAN hanya toast (toast hilang, halaman tetap kosong) |
| Error form | Inline di bawah field (`border-red-400` + `text-red-600 text-xs`); fokus pindah ke field pertama yang error |

Aturan toast (sonner):
- Toast hanya untuk HASIL aksi async: "Timesheet tersimpan", "Gagal posting SAP: <sebab>".
- Toast error menyebut penyebab + apa yang bisa dilakukan user; jangan generik "Error!".
- JANGAN toast untuk validasi form (inline) atau error fetch halaman (inline + retry).
- Copy konsisten dengan label tombol: tombol "Simpan" → toast "Tersimpan"
  (bukan "Submit berhasil"); kata kerja aktif, sentence case.

### 5. Motion

- Durasi: hover/press **150ms**; dropdown/panel **200ms**; modal/drawer **250–300ms**.
  Masuk `ease-out`, keluar `ease-in`.
- framer-motion hanya untuk transisi bermakna (modal, reorder list, page
  transition). Untuk hover/press cukup Tailwind `transition-*`.
- **WAJIB hormati `prefers-reduced-motion`**: `motion-reduce:transition-none
  motion-reduce:transform-none` (Tailwind) atau `useReducedMotion()` (framer-motion).
- Animasi berjalan terus (pulse/spin) hanya untuk status loading yang nyata.

### 6. Focus & Keyboard

- Button/link: `focus-visible:ring-2 focus-visible:ring-[#00b4d8]
  focus-visible:outline-none` (ring hanya saat keyboard). Input: tetap `focus:ring-2`.
- Modal WAJIB pakai `ui/Modal.jsx` (jangan modal inline): fokus pindah ke modal
  saat buka, `Escape` menutup, fokus kembali ke tombol pemicu saat tutup,
  `role="dialog" aria-modal="true"`.
- Elemen klik-able = `<button>`, bukan `<div onClick>`. Kalau terpaksa div:
  `role="button" tabIndex={0}` + handler Enter/Space.

### 7. Z-Index Scale

| Layer | Class |
|---|---|
| Dropdown / popover | `z-30` |
| Sticky header / toolbar | `z-40` |
| Modal overlay + modal | `z-50` |
| Toast (sonner) | default sonner (di atas modal) — jangan diubah |

Jangan pakai nilai arbitrary (`z-[999]`). Butuh layer baru → tambahkan ke tabel ini.

### 8. Chart & Dataviz (ECharts + Recharts)

Palet kategorikal standar — **urutan TETAP, sudah tervalidasi colorblind-safe
(ΔE CVD ≥ 19) dan kontras ≥ 3:1 di atas putih**. Seri ke-1 selalu warna ke-1, dst:

| Urutan | Hex | Nama |
|---|---|---|
| 1 | `#0077b6` | biru brand |
| 2 | `#b45309` | amber tua |
| 3 | `#7c3aed` | violet |
| 4 | `#0d9488` | teal |
| 5 | `#be185d` | magenta |
| 6 | `#4d7c0f` | olive |

- **> 6 seri** → gabungkan sisanya jadi "Lainnya" (`#94a3b8`) atau pecah jadi
  small multiples. Jangan generate hue baru.
- **Warna mengikuti entitas, bukan urutan render** — filter yang mengubah jumlah
  seri tidak boleh mengecat ulang seri yang tersisa.
- Sequential (magnitude/heatmap): satu hue biru, terang→gelap:
  `#caf0f8 → #90e0ef → #00b4d8 → #0077b6 → #023e8a`. Jangan rainbow.
- Diverging (di atas/bawah target): `#0077b6` ↔ `#b45309`, titik tengah netral
  `#e2e8f0`.
- Warna status (emerald/amber/red) HANYA untuk makna status — jangan dipakai
  sebagai warna seri biasa.
- **Satu sumbu Y per chart** — dilarang dual-axis. Dua ukuran beda skala →
  dua chart bertumpuk / small multiples.
- ≥ 2 seri wajib legend; jangan tempel angka di setiap titik (label selektif
  saja); teks label/axis pakai warna teks slate — bukan warna seri; grid tipis
  `#e2e8f0`.
- Tooltip/hover wajib aktif di semua chart (ECharts `tooltip`, Recharts `<Tooltip>`).

### 9. PWA / Offline UX

- Sediakan indikator offline global (komponen `OfflineIndicator`, listen event
  `online`/`offline`) — user harus tahu sedang offline SEBELUM kehilangan input.
- Data yang tampil dari cache (NetworkFirst) saat offline diberi tanda:
  "Data tersimpan — terakhir diperbarui HH:mm".
- Aksi tulis saat offline: tolak langsung dengan pesan jelas ("Tidak ada koneksi —
  perubahan belum disimpan"), kecuali fitur antrian offline memang dibangun.

### 10. Status Implementasi Design System (per 2026-07-11 — JANGAN berasumsi)

| Item | Standar (dokumen ini) | Kondisi kode nyata |
|---|---|---|
| CSS vars `:root` | blok di atas | ❌ Belum ada di `index.css` — tambahkan saat menyentuh file itu |
| Palet brand di `tailwind.config.js` | §5 Corporate Color | ❌ Belum — config masih token legacy `primary #007bff` + `shadow-3d` (jangan dipakai UI baru) |
| `ui/Button`, `forms/Input`, `ui/Switch`, `tables/Table` | Component-First §1 | ⚠️ Ada tapi gaya lama — migrasikan saat disentuh |
| Font | system stack (§3) | ❌ `index.css` masih `Arial` |
| Warna primary button | `#0077b6` (AA 4.9:1) | ⚠️ ±363 pemakaian `#0096c7` di 58 file (standar lama). Migrasi bertahap: saat mengedit sebuah halaman, samakan SELURUH tombol primary halaman itu ke `#0077b6` — jangan campur dua warna primary dalam satu halaman |

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend Framework | React 19.2 + Vite 7 | ESM (`"type": "module"`) |
| Language | JavaScript (JSX) | No TypeScript |
| Styling | Tailwind CSS v3.4 | + inline `bg-[#xxx]` for dynamic brand colors |
| Router | React Router v7.13 | `createBrowserRouter` |
| State Management | useState + useCallback | No Redux/Zustand/MobX — logic stays in components |
| Notifications | sonner v2 | `Toaster` in `App.jsx` with `richColors` |
| PWA | vite-plugin-pwa + Workbox v7 | Runtime caching /api/* (NetworkFirst 5min). Entry `google-fonts-cache` di vite.config = sisa lama — app TIDAK memakai Google Fonts (offline-first), boleh dihapus saat menyentuh vite.config.js |
| Charts | ECharts v6 + Recharts v3 | Both used across dashboard |
| Drag & Drop | @dnd-kit (core, sortable, modifiers) | |
| Icons | lucide-react v1 | |
| Animations | framer-motion v12 | |
| Backend API | Express.js 4 (Node 20, CommonJS) | In `apps/api/server.js` |
| Backend Python | FastAPI (Python 3.11, uvicorn) | In `apps/fastapi-msproject/main.py` — SOW plan-sync + antrian TTS (MS Project .mpp sync sebenarnya di Express `/ms-project`) |
| Database | PostgreSQL 15 | + Microsoft SQL Server (SSB_OEE for machine hours) |
| Reverse Proxy | Nginx (Alpine) | SSL/TLS 1.2-1.3, HTTP→HTTPS redirect, routes `/api/`, `/fastapi/`, `/tts/`, `/uploads/`, SPA fallback |
| Containerization | Docker Compose | 13 services — lihat tabel "Docker Compose Services" di bawah |
| API Client | fetch (native) | No Axios |
| Dev port (frontend) | 5173 | Proxied `/api` → `http://localhost:3001` |
| API port | 3001 | |

---

## Key Commands

```bash
# === Frontend (apps/web/) ===
cd apps/web
npm run dev              # → http://localhost:5173
npm run build            # Production build → dist/
npm run preview          # Preview production build
npm run lint             # ESLint

# === Backend API (apps/api/) ===
cd apps/api
node server.js           # Express API on port 3001
# or with nodemon:
npx nodemon server.js

# === PostgreSQL (local/dev) ===
"C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -d ptssb

# === Docker (production) ===
scripts/deploy.sh build        # Build all containers
scripts/deploy.sh start        # Start all services
scripts/deploy.sh stop         # Stop all services
scripts/deploy.sh restart      # Restart all services
scripts/deploy.sh status       # Check service status
scripts/deploy.sh logs api     # View API logs
```

---

## Monorepo Structure

```text
MPS2/
+- apps/
�  +- web/                         # React + Vite frontend
�  +- api/                         # Express API, controllers, routes, rbac, jobs, uploads
�  +- fastapi-msproject/            # FastAPI SOW/TTS helper service (MS Project sync sebenarnya di Express /ms-project)
�  +- tts-worker/                   # Piper/Edge TTS worker (EWS audio announcements)
+- jobs/
�  +- sap_staging/                  # Stage/post/seed SAP payload rows
�  +- etl/                          # SQL Server -> Postgres ETL (machine hours, heartbeat, order sync)
�  +- export/                       # CSV/TXT export helpers
�  +- sow/                          # SOW seed/export Docker helper files
�  +- machine_ping/                 # Dockerfile untuk machine-ping-worker (script di scripts/ping_m5051_machines.js)
+- database/
�  +- migrations/                   # api/ (timestamped) + legacy/ (tidak berurut)
�  +- seeds/                        # Seed data and seed helpers
�  +- schema/                       # schema_prod.sql = SATU-SATUNYA dump kanonik (regenerate dari prod tiap batch migrasi)
�  +- machinehours/                 # CSV data + import scripts machine hours
�  +- toolsmanagement/              # SQL domain tools management
�  +- paket_kumplit/, query_use/    # SQL/data pendukung
+- docs/
�  +- operations/, sap/, frontend/, deployment/, archive/
�  +- Work Instruction/, security/, timesheet/
+- samples/
�  +- sap_payloads/, excel/, media/
+- infra/
�  +- docker/                       # Shared docker infra notes/assets
�  +- nginx/                        # Nginx config and SSL material
+- aws/
�  +- sap-ph3-order-lambda/         # AWS Lambda inbound order feed dari SAP -> ph3_order
+- backups/                         # pg_dump output (gitignored)
+- export/                          # Mount target sow_exporter (/data/export)
+- tools/
�  +- msproject-v2/                 # VBA MS Project v2 AKTIF (config.ini, checkout/checkin) — versi lama di docs/archive
+- scripts/                         # Root-level operational helper scripts
```

## Folder Ownership Rules

- Frontend changes go in `apps/web`; run npm commands from that folder.
- Express API changes go in `apps/api`; route/controller imports must stay relative inside that app.
- FastAPI MS Project changes go in `apps/fastapi-msproject`.
- TTS worker changes go in `apps/tts-worker`; generated upload output belongs under `apps/api/uploads` or the Docker `/uploads` mount.
- SAP staging/posting code goes in `jobs/sap_staging`; shared staging helpers stay in `sap_staging_common.py` only when used by more than one SAP script.
- ETL sync jobs go in `jobs/etl`; export-only helpers go in `jobs/export`; SOW seed/export container files go in `jobs/sow`.
- SQL migrations and schema references go under `database`; do not put new migration files in app folders.
- Operational docs go in `docs`; current SAP docs go in `docs/sap`; old/historical docs go in `docs/archive`.
- Example payloads and manual test JSON go in `samples/sap_payloads`; do not keep test payloads inside runtime app folders.

---

## Frontend Routes (Current)

> Guard types: **PIN** = `ProtectedRoute` (sessionStorage `isVerified`); **RBAC:x** = `RequireFeature(x)` (permission dari sessionStorage `authPermissions`). Keduanya client-side only.

| Path | Component | Guard | Module |
|------|-----------|-------|--------|
| `/` , `/welcome` | `WelcomePage` | — | Core |
| `/LandingPage` , `/operations-hub` | `OperationsHubPage` | — | Core |
| `/ews/:type/detail` | `EwsDetailPage` | — | EWS |
| `/ews/notifications` | `EwsNotificationsPage` | — | EWS |
| `/ews/roster` | `EwsRosterPage` | RBAC:roster_operator | EWS |
| `/ews/roster/config` | `EwsRosterConfigPage` | RBAC:roster_operator | EWS |
| `/sap-log` | `SapLogPage` | — | Core |
| `/order-progress-dashboard` | `OrderProgressDashboardPage` | — | Core |
| `/login-timesheet` | `LoginTimesheetPage` | — | TIMESHEET |
| `/timesheet` | `TimesheetPage` | — | TIMESHEET |
| `/timesheet-mainmenu` | `TimesheetMainMenuPage` (dispatcher varian) | — | TIMESHEET |
| `/view-timesheet` | `TimesheetListPage` | — | TIMESHEET |
| `/timesheet-validation` | `TimesheetValidationPage` | PIN | TIMESHEET |
| `/operator-performance` | `OperatorPerformancePage` | PIN | TIMESHEET |
| `/timesheet-edit/:tsnumber` | `TimesheetEditPage` | — | TIMESHEET |
| `/log-timesheet` | `LogTimesheetPage` | — | TIMESHEET |
| `/select-job` | `SelectJobPage` (dispatcher varian) | — | TIMESHEET |
| `/select-machine` | `SelectMachinePage` | — | TIMESHEET |
| `/tts-audio-test` | `TtsAudioTestPage` | — | TIMESHEET |
| `/nfc-users` | `NfcUserListPage` | — | TIMESHEET |
| `/create-edit-nfc` | `CreateEditNfcPage` | — | TIMESHEET |
| `/unproductive` | `UnproductiveMenuPage` | — | TIMESHEET |
| `/dashboard` | `DashboardPage` | — | Core |
| `/setting` | `SettingPage` | — | Core |
| `/download` | `DownloadPage` | — | Core |
| `/editor-image` | `EditorImage` | — | Core |
| `/process-control` | `ProcessControlPage` | — | MACHINE_H |
| `/edit-parameter` | `EditParameterPage` | — | MACHINE_H |
| `/machine-hours-sqlserver` | `MachineHoursSqlServerPage` | — | MACHINE_H |
| `/machine-hours-validation` | `MachineHoursValidationPage` | PIN | MACHINE_H |
| `/component-tracking` | `ComponentTrackingPage` | — | PPC |
| `/kanban-board` | `KanbanLevelOnePage` | — | PPC |
| `/buffer-transaction` | `BufferTransactionPage` | — | PPC |
| `/sow-scheduling` | `SowSchedulingPage` (dispatcher varian) | — | PPC |
| `/sow-verification` | `SowVerificationPage` | — | PPC |
| `/shift-definition` | `ShiftDefinitionPage` | PIN | PPC |
| `/ms-project-hub` | `MsProjectHubPage` | PIN | PPC |
| `/ms-project-admin` | `MsProjectHubPage` (alias lama) | PIN | PPC |
| `/receiving-shipment` | `ReceivingShipmentPage` | — | PPC |
| `/manage-user` | `ManageUserPage` (menu hub) | RBAC:manage_users | PPC |
| `/manage-users` | `ManageUsersPage` (user CRUD) | RBAC:manage_users | PPC |
| `/sow-orders` | `OrderListPage` | RBAC:sow_management | PE |
| `/sow-edit/revision/:orderNo` | `SowRevisionEditPage` | RBAC:sow_management | PE |
| `/sow-edit/:id` | `SowEditPage` | RBAC:sow_management | PE |
| `/sow-management` (parent) | `SowManagementPage` | RBAC:sow_management | PE |
| `/sow-management/list` | `SowStandardListPage` | — (di bawah parent) | PE |
| `/sow-management/create` | `SowCreatePage` | — (di bawah parent) | PE |
| `/sow-management/history` | `SowHistoryPage` | — (di bawah parent) | PE |
| `/consumable-request` | `ConsumableRequestPage` | — | WAREHOUSE |
| `/tools-consumable-request` | `ToolsRequestHubPage` | — | WAREHOUSE |
| `/tools-request` | `ToolsRequestPage` | — | WAREHOUSE |
| `/consumable-control` | `ConsumableControlPage` | PIN | WAREHOUSE |
| `/tools-management` | `ToolsManagementPage` | PIN | WAREHOUSE |
| `*` | `NotFoundPage` (link ke /operations-hub) | — | — |

> Semua route lazy-loaded. Halaman TIMESHEET/PPC tertentu punya varian `salvaging/` vs `manufacturing/` yang dipilih dispatcher berdasarkan `VITE_APP_VARIANT` (default `salvaging`).

---

## Backend API Routes

> 18 router di-mount di `server.js`. Jumlah endpoint per router tidak dihitung ulang — lihat file route masing-masing.

| Base Path | Description |
|-----------|-------------|
| `/timesheet` | CRUD, search, validation stats, bulk validation, SAP posting, CSV/Excel export, checkout |
| `/sow` | Standard CRUD, grouped orders, parts/operations, history, reports, planhours |
| `/sow-schedule` | SOW scheduling, shift rules, overtime, capacity |
| `/process-control` | Categories, parameters, choices, items, controls CRUD + validation |
| `/dashboard` | KPI, order status, workload, daily hours, operator efficiency, on-time, progress, heatmap |
| `/component-tracking` | Machines, SOW operations, buffer transactions |
| `/kanban` | Kanban order board (materialized view + refresh job) |
| `/machine-hours-sqlserver` | Machine hours dari SQL Server, validation stats, health + WebSocket |
| `/machine-hours-validation` | Validation stats, group records |
| `/receiving-shipment` | Lookups, components, CRUD |
| `/consumable` | History, stock search, control tickets, approve/close/adjust/reject |
| `/tools` | Tool reservations/handovers |
| `/auth` | Login, change password, user CRUD, permissions |
| `/usernfc` | NFC user CRUD, search by NFC ID/SN/name |
| `/workcenter` | List all workcenters |
| `/production-operations` | List all, lookup, get by ID |
| `/ms-project` | MS Project sync (.mpp upload/import; dipakai VBA client) |
| `/ews` | EWS KPI summary/detail/trend/actions/roster/notifications + SSE `/ews/stream` |

### Important Backend Details
- **PostgreSQL pool:** `.env` dari root `D:\website\MPS2\.env`. Di Docker, api konek via **pgbouncer:6432** (transaction pooling) dengan `DB_POOL_MAX` default 5; default pool di kode 10. Pool disimpan di `global.pool`; ada pool kedua di `db.js` (fallback `require("../db")`) — dua instance berbeda, hati-hati.
- **Timezone:** env `TIMEZONE` saat ini `Asia/Makassar` (WITA), bukan Asia/Jakarta.
- **RBAC guard:** `rbacGuard` global untuk semua write (POST/PUT/PATCH/DELETE), identitas dari header `x-user-id`/`x-user-role`; **log-only kecuali `RBAC_ENFORCE=1`**.
- **Timestamp handling:** OID 1082/1114/1184 forced to string (no JS Date conversion)
- **WebSocket:** `/machine-hours-sqlserver/ws` (streaming machine data); `mpsDashboardSocket` opsional via `ENABLE_MPS_DASHBOARD_WS=1`. SSE di `/ews/stream`.
- **EWS jobs:** `apps/api/jobs/` (ewsSnapshotJob, ewsAdoptionBucketJob, ewsRosterGenerateJob) — dijalankan sebagai service compose `ews-*-job` (`npm run ews:*`).
- **File uploads:** multer, disimpan di `apps/api/uploads/` (sow-pdf/, ms-project-mpp/, consumable/)
- **SAP Integration:** POST ke SAP CPI inbound URL (env `SAP_INBOUND_URL`)
- **CORS:** `*` origin (all origins allowed)

---

## Database Schema (Key Tables — PostgreSQL)

| Table | Description |
|-------|-------------|
| `timesheet_transaction` | Core timesheet (tsnumber PK, check-in/out, validation, SAP status) |
| `sow` | Scope of Work orders + operations |
| `sow_standard` | Standard SOW operation templates |
| `order` | Materialized view aggregating SOW by order_no |
| `usernfc` | NFC user master data |
| `workcenter` | Workcenter definitions |
| `parts` | Part master data |
| `operations` | Operation definitions |
| `components` | Component definitions |
| `process_category` | Process parameter categories |
| `process_parameter` | Process parameters with choice/number flags |
| `process_parameter_choicebase` | Parameter choice options |
| `processcontroldata` | Process control data records (linked to timesheet) |
| `processcontroldata_item` | Process control data item values |
| `production_operations` | Production operations from SAP/ETL |
| `log_timesheet_sap` | SAP posting audit log |
| `progress_update_history` | Progress update tracking |
| `ph3_order` / `qh3_order` | Order/operation master dari SAP (via AWS Lambda + ETL) — acuan eligibility SAP |
| `sap_timesheet_staging` | Antrian posting SAP (unique `(source_system, source_key)`, status PENDING/POSTED/FAILED) |
| `mch_productiondata`, `mch_transaction`, `mch_machines`, `mch_statustypes` | Machine hours dari SQL Server SSB_OEE (via ETL) |
| `machine_heartbeat` | Mirror heartbeat mesin dari SQL Server (sync tiap 10 detik) |
| `mch_machine_ping_log` | Log ping jaringan mesin (machine-ping-worker) |
| `ews.*` (schema) | kpi_snapshot, kpi_threshold, adoption_bucket/summary_snapshot, shift_roster, operator_shift, rotation_config, action_table/history, alert_log, tts_notification, activity_type_ref |
| `ms_project_*` | MS Project sync (task, assignment, resource, calendar, revision, lock, audit_log, dll) |
| `sow_schedule*`, `sow_verification_log`, `sow_revision_history`, `sow_templates`, `sow_template_lines` | SOW extended (scheduling, verifikasi, revisi, template) |
| `consumable_item/stock/ticket`, tools tables | Warehouse consumable & tools management |
| `users`, `rbac.user_permissions` | Login users + RBAC per-user overrides |
| `shift_definition`, `tablet_status`, `tts_notification_order` | Shift, monitoring tablet, antrian TTS |

- **Trigram indexes** on `full_name`, `order_no`, `serialnumber`, `part_name` (pg_trgm extension)
- **Foreign keys:** process control → timesheet, SOW ↔ parts/operations; FK `timesheet_transaction.serialnumber → usernfc.snssb` berstatus `NOT VALID`
- **Schema kanonik:** `database/schema/schema_prod.sql` (regenerate dari prod setelah tiap batch migrasi). Migration ledger: tabel `schema_migrations` + `node database/migrate.js` (per 2026-07-11); dump lama yang saling drift sudah dihapus.

---

## Docker Compose Services

| Service | Image/Build | Port | Notes |
|---------|-------------|------|-------|
| `db` | `postgres:15-alpine` | 5433→5432 | Healthcheck, volume `postgres_data`, mount `./backups`, `shm_size: 1gb` |
| `pgbouncer` | bitnamilegacy/pgbouncer | 6432 (internal) | Transaction pooling; api konek ke sini, bukan langsung ke db |
| `api` | Node 20 Alpine (`./apps/api`) | 3001 (internal) | Express.js; `DB_HOST=pgbouncer`, `DB_PORT=6432`, `DB_POOL_MAX=5` |
| `ews-snapshot-job` | (image api) | — | `npm run ews:snapshot` |
| `ews-adoption-job` | (image api) | — | `npm run ews:adoption` |
| `ews-roster-job` | (image api) | — | `npm run ews:roster` |
| `frontend` | nginx:alpine (built React) | 80 (internal) | Build args `VITE_API_URL=/api`, `VITE_APP_VARIANT` |
| `nginx` | nginx:alpine | 80, 443 | Reverse proxy + SSL; routes `/api/`, `/fastapi/`, `/tts/`, `/uploads/` |
| `sow_exporter` | Python (`./jobs` + `sow/Dockerfile`) | — | SOW export ke `./export`; cron `*/10` via `docker compose run` |
| `machine-ping-worker` | `jobs/machine_ping/Dockerfile` | — | Ping mesin M5051, `cap_add: NET_RAW` |
| `fastapi` | Python 3.11 slim | 8000 (internal) | FastAPI SOW/TTS helper |
| `tts-worker` | `./apps/tts-worker` | — | Piper TTS worker |
| `ews-tts-worker` | (tts-worker) | — | `generate_ews_audio.py`, Edge TTS `id-ID-GadisNeural` |

> Compose terpisah: `jobs/etl/docker-compose.etl.yml` (`timesheet_sap_etl` = etl_sync_v2) dan `jobs/etl/docker-compose.heartbeat.yml` (`machine-heartbeat-sync`).

---

## Critical Rules

1. **Ikuti Corporate Color System + UI Engineering Standards** — Semua halaman dan komponen baru HARUS mengikuti keduanya. Referensi struktur/layout: `TimesheetValidationPage.jsx` (warna tombol primary di file itu masih standar lama `#0096c7`; standar berlaku `#0077b6`).

2. **Light theme only** — Jangan gunakan dark background sebagai surface utama.

3. **Logic tetap di komponen** — Tidak ada library state management eksternal (tidak ada Redux/Zustand). Gunakan useState + useCallback + fetch ke API.

4. **FormData upload via fetch native** — Jangan gunakan Axios untuk FormData (transformRequest bisa corrupt payload).

5. **Daftarkan route baru di `src/router/index.jsx`** — Selalu import page baru dan tambahkan entri route.

6. **Work in `apps/web/` for frontend** — Semua perintah npm (dev, build, lint) dijalankan dari direktori `apps/web/`.

7. **Backend di `apps/api/`** — Express.js CommonJS. Nodemon untuk development.

8. **`.env` di root `MPS2/`** — Dibaca oleh backend (`apps/api/server.js`) dan frontend (`vite.config.js` envDir points to repo root (`../..` from apps/web)).

9. **PostgreSQL connection (local):** `"C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -d ptssb`

10. **Environment variables (kunci utama):** `DB_HOST`, `DB_NAME` (ptssb), `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `PORT` (3001), `PLANT_SSB` (5100), `TIMEZONE` (**Asia/Makassar**). Selain itu `.env` root juga berisi kelompok: `SAP_INBOUND_*`, `SAP_STAGING_DB_*`, `SAP_STAGE_*`, `SQLSERVER_*`, `SRC_*`/`TGT_*` (+ varian per-plant `_BALIKPAPAN/_CIKUPA/_KUALA_KENCANA/_SEBAMBAN`), `EWS_*`, `AWS_PG*`, `VITE_API_URL`, `VITE_API_PROXY_TARGET`, `VITE_APP_VARIANT`, `VITE_TTS_PROXY_TARGET`, `CORS_ORIGIN`, `DRAWINGS_PATH`, `clientid_ph3/qh3`, `clientsecret_ph3/qh3`, `tokenurl`, `url_ph3/qh3`.

11. **Component-first (anti-boilerplate)** — Sebelum menulis UI, cek `apps/web/src/components/`. Pakai/extend komponen yang ada; kalau pola akan dipakai ≥2 tempat, buat komponennya dulu di `components/`. Saat melihat markup duplikat ≥2×, WAJIB merekomendasikan ekstraksi komponen — jangan menambah salinan baru. Detail: "UI Engineering Standards §1".

12. **Offline-first — dilarang aset eksternal** — Tidak boleh ada CDN, Google Fonts, atau URL aset eksternal apapun di frontend. Semua library via npm (di-bundle Vite); font = system stack. Detail: "UI Engineering Standards §2".

13. **Aksesibilitas terukur** — Bg tombol primary & warna link di atas putih: `#0077b6` (4.9:1, AA). `#0096c7` GAGAL AA untuk teks kecil (3.4:1) — hanya untuk ikon/teks besar/border. Teks minimum 12px. `focus-visible:` untuk button/link, `focus:` untuk input. Touch target ≥ 44px.
 
 