# 🎨 Logo Setup Guide

## Cara Mengganti Logo di Landing Page

### 📍 Lokasi Logo

Logo berada di folder **`public/`**:
```
apps/web/
└── public/
    └── logo.png  ← Taruh logo perusahaan di sini
```

### 🔧 Langkah-langkah

1. **Siapkan file logo**
   - Format: PNG (recommended) atau JPG
   - Ukuran: 512x512px atau 1024x1024px (square)
   - Background: Transparent PNG (optional)

2. **Replace logo.png**
   ```bash
   # Taruh file logo Anda ke folder public
   cp /path/to/your/logo.png D:/MPS2/apps/web/public/logo.png
   ```

3. **Refresh browser**
   - Logo akan otomatis berubah
   - Tidak perlu rebuild aplikasi

### 📐 Spesifikasi Logo

**Ukuran Display:**
- Width: 48px (12 rem)
- Height: 48px (12 rem)
- Object-fit: contain (logo tidak terdistorsi)

**Format Recommended:**
- PNG dengan transparent background
- Aspect ratio: 1:1 (square)
- Resolution: High DPI (2x untuk retina display)

### 🎨 Desain Tips

**Logo akan terlihat bagus jika:**
- Square shape (1:1 ratio)
- Clear pada ukuran kecil (48x48px)
- Kontras baik dengan background putih
- Simple & recognizable

**Hindari:**
- Logo terlalu detail (akan blur di ukuran kecil)
- Text terlalu kecil (tidak terbaca)
- Background kompleks (gunakan transparent)

### 🔄 Fallback Logo

Jika `logo.png` tidak ditemukan, sistem akan menampilkan fallback logo:
- Gradient box biru (from-blue-400 to-blue-600)
- Huruf "M" berwarna putih
- Size 48x48px

### 💻 Code Reference

Logo digunakan di file:
```jsx
// src/pages/LandingPage.jsx

<img
  src="/logo.png"
  alt="MPS Logo"
  className="w-12 h-12 object-contain"
/>
```

### 🎯 Testing

Setelah mengganti logo:

1. **Development Mode:**
   ```bash
   npm run dev
   ```
   Buka http://localhost:5173 dan lihat logo di header

2. **Production Build:**
   ```bash
   npm run build
   npm run preview
   ```

### 📱 Logo di PWA Manifest

Jika ingin logo muncul saat install PWA:

1. Buat icon PWA (192x192 dan 512x512):
   ```
   public/
   ├── logo.png (untuk header)
   ├── pwa-192x192.png (untuk PWA small icon)
   └── pwa-512x512.png (untuk PWA large icon)
   ```

2. Icon PWA sudah dikonfigurasi di `vite.config.js`

### 🐛 Troubleshooting

**Logo tidak muncul?**
- Check apakah file `logo.png` ada di folder `public/`
- Check nama file exact: `logo.png` (lowercase)
- Clear browser cache (Ctrl + Shift + R)
- Check browser console untuk error

**Logo terdistorsi?**
- Pastikan aspect ratio 1:1 (square)
- Gunakan `object-contain` bukan `object-cover`

**Logo blur/pixelated?**
- Gunakan high resolution (minimum 512x512px)
- Export dengan quality tinggi
- Gunakan PNG untuk transparency

### 📸 Preview

**Header dengan logo:**
```
┌────────────────────────────────┐
│ [LOGO] MPS SSB                 │
└────────────────────────────────┘
```

### 🎨 Color Scheme

Landing page menggunakan:
- **Background**: White (#FFFFFF)
- **Accent Blur 1**: Blue 200 (Biru Muda) - opacity 30%
- **Accent Blur 2**: Yellow 200 (Kuning) - opacity 30%
- **Accent Blur 3**: Blue 300 (Biru) - opacity 20%

Logo sebaiknya match dengan color scheme ini.

### ✅ Quick Checklist

- [ ] Logo file ready (PNG/JPG)
- [ ] Size minimum 512x512px
- [ ] Aspect ratio 1:1 (square)
- [ ] Nama file: `logo.png`
- [ ] Taruh di folder `public/`
- [ ] Test di browser
- [ ] Logo terlihat jelas

---

**Logo setup selesai! 🎉**

Logo akan muncul di:
- Header landing page
- (Optional) PWA install icon jika dikonfigurasi

Untuk pertanyaan, check dokumentasi atau hubungi tim development.
