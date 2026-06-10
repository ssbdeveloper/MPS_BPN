# 🚀 Development Quick Guide

## Quick Start

```bash
cd D:\MPS2\react-timesheet
npm install
npm run dev
```

Open: **http://localhost:5173**

## 📁 Project Structure

```
react-timesheet/
├── public/
│   └── logo.png              # Taruh logo perusahaan di sini
├── src/
│   ├── components/           # Reusable components
│   │   ├── ui/              # Button, Switch, Card, Modal
│   │   ├── layout/          # PageContainer, AppHeader
│   │   ├── forms/           # Input, Select, FormRow
│   │   └── tables/          # Gallery, Table, TextBox
│   ├── pages/               # Page components
│   │   ├── LandingPage.jsx          # Main menu (FIXED!)
│   │   ├── TimesheetPage.jsx        # Timesheet
│   │   ├── DashboardPage.jsx        # Dashboard
│   │   ├── SettingPage.jsx          # Settings
│   │   └── ComponentTrackingPage.jsx
│   ├── router/
│   │   └── index.jsx        # Router config
│   ├── App.jsx              # Main app
│   ├── index.css            # Tailwind CSS
│   └── main.jsx             # Entry point
└── docs/
    ├── COMPONENTS.md        # Component docs
    ├── ROUTING-GUIDE.md     # Routing docs
    ├── LOGO-SETUP.md        # Logo setup
    └── LANDING-PAGE-FIXED.md # Landing page fix
```

## 🎨 Landing Page (BARU - FIXED!)

**Design:**
- White background
- Biru muda & kuning blur effects
- Clean header: Logo + "MPS SSB"
- 4 gradient menu buttons
- Simple footer: "Version 2.0.0"

**Logo:**
- Taruh `logo.png` di folder `public/`
- Size: 512x512px (square)
- Format: PNG (transparent)

## 🗺️ Routes

| Path | Page | Icon |
|------|------|------|
| `/` | Landing Page | 🏠 |
| `/timesheet` | Timesheet | 📋 |
| `/dashboard` | Dashboard | 📊 |
| `/setting` | Settings | ⚙️ |
| `/component-tracking` | Component Tracking | 📦 |

## 🎨 Components Available

**UI:**
- Button (5 varian)
- Switch
- MachineCard
- InfoBox
- Modal
- PreviewBox

**Layout:**
- PageContainer
- AppHeader
- StatusBar
- MenuGrid
- Container H/V

**Forms:**
- Input
- TextArea
- Select
- FormRow
- SearchRow

**Tables:**
- Gallery
- TimesheetTable
- MachineGallery
- TextBox

## 💻 Common Commands

```bash
# Development
npm run dev          # Start dev server

# Build
npm run build        # Production build
npm run preview      # Preview build

# Dependencies
npm install          # Install deps
npm install <pkg>    # Add package
```

## 🔧 Customization

### Change Colors

Edit `tailwind.config.js`:
```js
theme: {
  extend: {
    colors: {
      primary: '#007bff',  // Your color
    }
  }
}
```

### Add New Page

1. Create page: `src/pages/NewPage.jsx`
2. Add route: `src/router/index.jsx`
3. Add menu button: `src/pages/LandingPage.jsx`

### Modify Logo

Replace `public/logo.png` with your logo.

## 🐛 Troubleshooting

**CSS tidak muncul?**
- Check `src/index.css` ada `@tailwind` directives
- Restart dev server: `npm run dev`

**Logo tidak muncul?**
- Check file `public/logo.png` exists
- Check nama file: `logo.png` (lowercase)
- Clear browser cache

**Build error?**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 📖 Documentation

- `COMPONENTS.md` - Component library
- `ROUTING-GUIDE.md` - Routing & navigation
- `LOGO-SETUP.md` - Logo replacement
- `LANDING-PAGE-FIXED.md` - Landing page details
- `README.md` - Full documentation

## 🎯 Next Steps

1. **Test landing page** - `npm run dev`
2. **Replace logo** - Taruh `logo.png` di `public/`
3. **Connect API** - Integrate backend
4. **Add features** - Based on requirements

## ✅ Status

- ✅ Landing page FIXED (clean design)
- ✅ 20+ components ready
- ✅ 5 pages with routing
- ✅ PWA offline mode
- ✅ Build successful
- ✅ Documentation complete

---

**Ready for development! 🚀**
