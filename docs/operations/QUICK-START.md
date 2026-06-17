# 🚀 Quick Start Guide - MPS Timesheet React

## Setup Cepat (5 Menit)

### 1. Install Dependencies
```bash
cd apps/web
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

Buka browser di: **http://localhost:5173**

## 📖 Dokumentasi Lengkap

- **[README.md](./README.md)** - Setup guide & configuration
- **[COMPONENTS.md](./COMPONENTS.md)** - Dokumentasi semua komponen (20+ komponen)
- **[MIGRATION-SUMMARY.md](./MIGRATION-SUMMARY.md)** - Ringkasan migrasi dari CSS

## 🎯 Yang Perlu Anda Ketahui

### Import Komponen
```jsx
// Import from central hub
import { Button, Input, InfoBox, AppHeader } from './components';

// Gunakan langsung
<Button variant="primary">Click Me</Button>
```

### Contoh Lengkap di App.jsx
File `src/App.jsx` berisi demo lengkap semua komponen. Lihat file ini untuk belajar cara penggunaan.

## 🎨 Komponen Utama

### Button (5 Varian)
```jsx
<Button variant="primary">Primary</Button>
<Button variant="success">Success</Button>
<Button variant="danger">Danger</Button>
<Button variant="warning">Warning</Button>
<Button variant="secondary">Secondary</Button>
```

### InfoBox
```jsx
<InfoBox
  items={[
    { label: 'PO Number', value: 'PO-12345' },
    { label: 'Status', value: 'Active' }
  ]}
  actions={<Button>Action</Button>}
/>
```

### Form Input
```jsx
<FormRow label="Quantity" uom="pcs">
  <Input type="number" placeholder="0" />
</FormRow>
```

### Table
```jsx
<TimesheetTable
  data={timesheetData}
  onEdit={(row) => console.log('Edit:', row)}
  onDelete={(row) => console.log('Delete:', row)}
/>
```

## 📱 PWA Offline Mode

Aplikasi sudah support PWA. Untuk test:

1. Build production: `npm run build`
2. Preview: `npm run preview`
3. Buka di browser Chrome
4. Klik icon "Install" di address bar
5. Test dengan matikan WiFi/internet

## 🔧 Tailwind Custom Classes

```jsx
// Custom colors
<div className="bg-primary text-white">Primary Color</div>
<div className="bg-success">Success Color</div>
<div className="bg-danger">Danger Color</div>

// 3D Shadow effects
<div className="shadow-3d-primary">3D Effect</div>
```

## 🎓 Struktur Component Props

Semua komponen menggunakan pattern yang sama:

```jsx
<ComponentName
  // Data props
  value={value}
  items={items}

  // Event handlers
  onClick={handleClick}
  onChange={handleChange}

  // Customization
  variant="primary"
  size="default"
  className="custom-classes"

  // Children
>
  Content here
</ComponentName>
```

## 💡 Tips Development

### 1. Lihat Demo di App.jsx
Semua komponen ada contohnya di `src/App.jsx`

### 2. Baca Props di Component File
Setiap component file punya komentar JSDoc tentang props yang tersedia

### 3. Check COMPONENTS.md
Dokumentasi lengkap ada di `COMPONENTS.md`

### 4. Hot Reload
Perubahan code langsung terlihat di browser tanpa refresh

## 🐛 Troubleshooting Cepat

### Tailwind tidak jalan?
```bash
# Restart dev server
npm run dev
```

### Import error?
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Build error?
```bash
# Clear cache
npm run build
```

## 📦 Build untuk Production

```bash
# Build
npm run build

# Preview build result
npm run preview
```

Output ada di folder `dist/`

## 🔗 Links Penting

- **Demo App**: http://localhost:5173 (setelah `npm run dev`)
- **Tailwind Docs**: https://tailwindcss.com/docs
- **React Docs**: https://react.dev
- **Vite Docs**: https://vitejs.dev

## 📞 Need Help?

1. Baca `COMPONENTS.md` untuk detail komponen
2. Lihat `App.jsx` untuk contoh code
3. Check console browser untuk error messages

---

**Happy Coding! 🚀**
