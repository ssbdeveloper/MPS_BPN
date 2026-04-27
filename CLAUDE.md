# CLAUDE.md — MPS Timesheet (react-timesheet)
 
> AI context file. Baca ini sebelum membuat atau mengubah kode apapun di project ini.
 
untuk koneksi dengan postgres gunakan
"C:\Program Files\PostgreSQL\15\bin\psql.exe" 
 $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\PostgreSQL\15\bin"; [System.Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
---
 
## Project Overview
 
**MPS Timesheet** adalah aplikasi Timesheet Manufacturing berbasis React + Vite + Tailwind CSS dengan dukungan PWA (Progressive Web App) untuk mode offline.
 
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS v3 + inline style untuk nilai warna dinamis
- **Router:** React Router v6
- **State/Cache:** TanStack React Query (server state), useState/useCallback (local state)
- **Notifications:** sonner (toast)
- **PWA:** vite-plugin-pwa + Workbox
 
---
 
## Corporate Color System
 
> Status: **APPROVED & ACTIVE** (ditetapkan 2026-03-19)
> Referensi implementasi: `src/pages/TimesheetValidationPageV2.jsx`
 
Palette ini adalah **standard corporate color** untuk seluruh UI aplikasi MPS Timesheet.
Setiap komponen baru atau halaman baru HARUS mengikuti aturan ini.
 
---
 
### 1. Color Palette
 
| Token Name         | CSS Variable             | HEX Value   | Keterangan                        |
|--------------------|--------------------------|-------------|-----------------------------------|
| `deep-twilight`    | `--deep-twilight`        | `#03045e`   | Terdalam — text kontras tinggi, border aktif |
| `french-blue`      | `--french-blue`          | `#023e8a`   | Warna brand utama (employee group header) |
| `bright-teal-blue` | `--bright-teal-blue`     | `#0077b6`   | Hover state button primary        |
| `blue-green`       | `--blue-green`           | `#0096c7`   | **Primary action color** (button, link) |
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
| Teks accent / link        | `text-[#0096c7]`        |
| Error text                | `text-red-600`          |
| Success text              | `text-emerald-600`      |
| Warning text              | `text-amber-600`        |
 
#### Button
 
| Tipe              | Class                                                                 |
|-------------------|-----------------------------------------------------------------------|
| **Primary**       | `bg-[#0096c7] hover:bg-[#0077b6] text-white rounded-lg`              |
| **Outline**       | `bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg` |
| **Danger**        | `bg-red-600 hover:bg-red-500 text-white rounded-lg`                  |
| **Success**       | `bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg`          |
| **Ghost (di atas biru)** | `bg-white/20 hover:bg-white/35 text-white rounded-full`       |
| **Disabled**      | Tambahkan `disabled:opacity-50 disabled:cursor-not-allowed`          |
| **Active press**  | Tambahkan `active:scale-95 transition-all duration-150`              |
 
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
"px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200"
 
// Validated
"px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"
 
// Deleted
"px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200"
 
// SAP Reject
"px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200"
```
 
---
 
### 4. Accessibility Rules
 
1. **Kontras minimum WCAG AA:**
   - Teks normal: rasio kontras ≥ 4.5:1 terhadap background
   - Teks besar (≥ 18px / bold ≥ 14px): rasio ≥ 3:1
   - `text-slate-800` di atas `bg-white` → ✅ memenuhi WCAG AA
   - `text-white` di atas `#0096c7` → ✅ memenuhi WCAG AA
   - **HINDARI** teks `#48cae4` (sky-aqua) di atas `bg-white` → kontras terlalu rendah
 
2. **Focus state wajib terlihat** — Semua elemen interaktif harus memiliki
   `focus:ring-2 focus:ring-[#00b4d8]` atau setara. Jangan `focus:outline-none`
   tanpa pengganti visual.
 
3. **Jangan mengandalkan warna saja** — Status (pending/validated/deleted) harus
   ditunjukkan dengan label teks + warna, bukan warna saja.
 
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
        'bright-teal-blue': '#0077b6',
        'blue-green':       '#0096c7',  // ← primary action
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
<button className="bg-brand-blue-green hover:bg-brand-bright-teal-blue text-white">
  Primary Action
</button>
```
 
> **Catatan:** Selama belum ditambahkan ke config, gunakan inline `bg-[#0096c7]` — ini valid di Tailwind v3.
 
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
    <button className="bg-[#0096c7] hover:bg-[#0077b6] text-white
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
  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Pending</div>
  <div className="text-base font-extrabold text-amber-700">12 Act</div>
  <div className="text-[10px] text-gray-500">45.5 hrs</div>
</div>
 
// Validated (emerald)
<div className="rounded-xl px-2 py-3 text-center border shadow-sm
                bg-emerald-50 border-emerald-200">
  <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Validated</div>
  <div className="text-base font-extrabold text-emerald-700">30 Act</div>
</div>
 
// Info (brand blue)
<div className="rounded-xl px-2 py-3 text-center border shadow-sm"
     style={{ background: '#caf0f8', borderColor: '#90e0ef' }}>
  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#0077b6' }}>Total Hrs</div>
  <div className="text-base font-extrabold" style={{ color: '#0077b6' }}>120.5</div>
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
 
### 7. Anti-Patterns (JANGAN DILAKUKAN)
 
```jsx
// ❌ Background halaman dengan warna gelap
<div style={{ background: 'linear-gradient(160deg, #03045e 0%, #0077b6 100%)' }}>
 
// ❌ Header gelap dengan text putih
<header className="bg-blue-900 text-white">
 
// ❌ Filter panel gelap / semi-transparan di atas background gelap
<div style={{ background: 'rgba(3,4,94,0.55)', backdropFilter: 'blur(8px)' }}>
 
// ❌ Input dengan background gelap
<input className="bg-white/10 text-white placeholder-white/50">
 
// ❌ Teks berwarna terang di atas background putih (kontras rendah)
<span className="text-[#48cae4]">Label di atas bg-white</span>
 
// ❌ Menggunakan deep-twilight / french-blue sebagai background besar
<div className="bg-[#03045e]"> {/* seluruh halaman */}
```
 
---
 
## CSS Variable Declarations (`:root`)
 
> Tambahkan ke `src/index.css` atau file CSS global sebelum Tailwind directives.
> Wajib ada agar `var(--...)` bisa digunakan di inline style.
 
```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
 
:root {
  /* Corporate Blue Palette */
  --deep-twilight:    #03045e;
  --french-blue:      #023e8a;
  --bright-teal-blue: #0077b6;
  --blue-green:       #0096c7;   /* ← primary action */
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
// ❌ Sky-aqua di atas putih — kontras terlalu rendah (WCAG FAIL)
<span className="text-[#48cae4]">Label di atas bg-white</span>
 
// ✅ Gunakan blue-green minimum untuk teks di atas putih
<span className="text-[#0096c7]">Label di atas bg-white</span>
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
                       bg-[#0096c7] hover:bg-[#0077b6] text-white
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
      <button className="bg-[#0096c7] hover:bg-[#0077b6] text-white
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
<span className="text-[10px] md:text-xs text-slate-500">
 
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
 
## Tech Stack
 
| Layer | Technology |
|-------|-----------|
| Framework | React 18 + Vite |
| Language | JavaScript (JSX) |
| Styling | Tailwind CSS v3 |
| Router | React Router v6 |
| Server state | TanStack React Query v5 |
| Toast | sonner |
| PWA | vite-plugin-pwa + Workbox |
| API | fetch (native) |
| Dev port | 5173 |
 
---
 
## Key Commands
 
```bash
# Dev server
npm run dev              # → http://localhost:5173
 
# Type check (jika ada TS)
npx tsc --noEmit
 
# Production build
npm run build
 
# Preview production build
npm run preview
```
 
---
 
## Repository Structure
 
```
react-timesheet/
├── CLAUDE.md                     ← File ini — AI context + design system
├── README.md                     ← Quick start & project overview
├── tailwind.config.js            ← Tailwind config (extend colors di sini)
├── vite.config.js                ← Vite + PWA config
├── public/                       ← Static assets
└── src/
    ├── api/                      ← API calls (fetch)
    ├── components/
    │   ├── auth/ProtectedRoute.jsx
    │   ├── ui/                   ← Reusable UI components
    │   ├── layout/               ← PageContainer, AppHeader
    │   ├── forms/                ← Input, Select, FormRow
    │   └── tables/               ← Gallery, Table
    ├── pages/
    │   ├── TimesheetValidationPage.jsx    ← Original (V1)
    │   ├── TimesheetValidationPageV2.jsx  ← Redesign APPROVED — referensi design system
    │   ├── TimesheetEditPage.jsx
    │   ├── TimesheetListPage.jsx
    │   ├── TimesheetMainMenuPage.jsx
    │   ├── TimesheetPage.jsx
    │   ├── LandingPage.jsx
    │   ├── DashboardPage.jsx
    │   ├── LoginTimesheetPage.jsx
    │   └── ... (halaman lainnya)
    ├── router/index.jsx          ← Semua route didefinisikan di sini
    ├── App.jsx                   ← Root: RouterProvider
    └── main.jsx                  ← Entry point
```
 
---
 
## Routes
 
| Path | Component | Auth |
|------|-----------|------|
| `/` | `LoginTimesheetPage` | — |
| `/login-timesheet` | `LoginTimesheetPage` | — |
| `/timesheet` | `TimesheetPage` | — |
| `/timesheet-mainmenu` | `TimesheetMainMenuPage` | — |
| `/view-timesheet` | `TimesheetListPage` | — |
| `/timesheet-validation` | `TimesheetValidationPage` | ✅ ProtectedRoute |
| `/timesheet-validation-v2` | `TimesheetValidationPageV2` | ✅ ProtectedRoute |
| `/timesheet-edit/:tsnumber` | `TimesheetEditPage` | — |
| `/dashboard` | `DashboardPage` | — |
| `/setting` | `SettingPage` | — |
| `/process-control` | `ProcessControlPage` | — |
| `/select-job` | `SelectJobPage` | — |
| `/select-machine` | `SelectMachinePage` | — |
| `/component-tracking` | `ComponentTrackingPage` | — |
| `/edit-parameter` | `EditParameterPage` | — |
| `/nfc-users` | `NfcUserListPage` | — |
| `/create-edit-nfc` | `CreateEditNfcPage` | — |
| `/unproductive` | `UnproductiveMenuPage` | — |
| `/download` | `DownloadPage` | — |
| `/sow-orders` | `OrderListPage` | — |
| `/sow-edit/:id` | `SowEditPage` | — |
 
---
 
## Critical Rules
 
1. **Ikuti Corporate Color System** — Semua halaman dan komponen baru HARUS menggunakan
   aturan warna di atas. `TimesheetValidationPageV2.jsx` adalah referensi yang disetujui.
 
2. **Light theme only** — Jangan gunakan dark background sebagai surface utama.
 
3. **Logic tetap di komponen** — Tidak ada library state management eksternal saat ini
   (tidak ada Redux/Zustand). Gunakan useState + useCallback + React Query.
 
4. **FormData upload via fetch native** — Jika ada upload file/form multipart,
   jangan gunakan Axios untuk FormData (transformRequest bisa corrupt payload).
 
5. **Daftarkan route baru di `src/router/index.jsx`** — Selalu import page baru
   dan tambahkan entri route di sana.
 
 