---
title: "Fix tombol Back Scheduling Area tidak kembali ke overview"
date: 2026-08-13
tags: [bay-scheduling, scheduling-area, back, deep-link]
---

# Fix Back button Scheduling Area (A-2026-08-13)

## Masalah

Tombol **Back** di detail area (BayAreaDetail) tidak kembali ke pemilihan area
(overview) — klik Back seolah tidak terjadi, tetap di area detail.

## Akar masalah

`SchedulingAreaPage.jsx` punya efek deep-link (keputusan 4b, `?area=AREA-XX`
dari Gantt portfolio):

```js
const areaFromUrl = selectedAreaCode && level === 'overview';
useEffect(() => { if (areaFromUrl) setLevel('area'); }, [areaFromUrl]);
```

Begitu satu area pernah dipilih, `selectedAreaCode` terisi. Klik Back →
`setLevel('overview')` → `areaFromUrl` jadi `true` → efek langsung
`setLevel('area')` lagi → Back selalu mental. Berlaku untuk SEMUA entry
(bukan cuma deep-link), selama ada area yang pernah dipilih.

## Perbaikan

Inisialisasi level langsung di `useState` saat mount (deep-link berlaku sekali),
hapus efeknya:

```js
const initialArea = initialAreaCode && AREA_BY_CODE[initialAreaCode.toUpperCase()]
  ? initialAreaCode.toUpperCase() : null;
const [level, setLevel] = useState(() => (initialArea ? 'area' : 'overview'));
const [selectedAreaCode, setSelectedAreaCode] = useState(initialArea);
```

Back (`setLevel('overview')`) kini bebas — tidak ada efek yang menimpa.

## Verifikasi (dev browser, port 5174, backend LAN 192.168.202.50:3001)

1. Entry biasa: pilih Blasting & Prime → detail area → Back → overview (Area
   summary + Cikupa layout tampil). PASS.
2. Deep-link `?area=AREA-18`: langsung detail area → Back → overview. PASS.
3. `npx eslint` + `npm run build` lolos.

## Catatan lingkungan (bukan bug aplikasi)

VS Code port-forward mengambil alih `127.0.0.1:3001` dan membalas HTTP 426
"Upgrade Required" → `npm run dev` (proxy ke localhost:3001) gagal dengan
"Konfigurasi plant tak tersedia" padahal backend `node server.js` sehat di
`0.0.0.0:3001` (tembus via LAN IP). Solusi: matikan port forward 3001 di
panel Ports VS Code (atau buka backend lewat IP LAN).

## File

- `apps/web/src/pages/PPC/manufacturing/SchedulingAreaPage.jsx` (commit a6e4a50)
