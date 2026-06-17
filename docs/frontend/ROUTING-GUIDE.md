# 🗺️ Routing Guide - MPS Timesheet System

## Overview

Aplikasi menggunakan **React Router v6** untuk navigasi antar halaman. Sistem routing sudah dikonfigurasi dengan 4 menu utama + landing page.

## 📁 Struktur Files

```
src/
├── pages/                          # Semua page components
│   ├── LandingPage.jsx            # Main menu / Home
│   ├── TimesheetPage.jsx          # Timesheet management
│   ├── DashboardPage.jsx          # Analytics & reports
│   ├── SettingPage.jsx            # Settings & configuration
│   └── ComponentTrackingPage.jsx  # Component tracking
├── router/
│   └── index.jsx                  # Router configuration
├── App.jsx                        # Main app dengan RouterProvider
└── DemoComponents.jsx             # Demo komponen (backup)
```

## 🚀 Routes Available

| Path | Component | Description | Icon |
|------|-----------|-------------|------|
| `/` | LandingPage | Landing page dengan menu utama | 🏠 |
| `/timesheet` | TimesheetPage | Check-in/out & history | 📋 |
| `/dashboard` | DashboardPage | Analytics & reports | 📊 |
| `/setting` | SettingPage | Settings & preferences | ⚙️ |
| `/component-tracking` | ComponentTrackingPage | Component tracking | 📦 |
| `*` | 404 Page | Page not found | ❌ |

## 🎯 Cara Navigasi

### 1. Menggunakan `useNavigate` Hook

```jsx
import { useNavigate } from 'react-router-dom';

function MyComponent() {
  const navigate = useNavigate();

  const goToTimesheet = () => {
    navigate('/timesheet');
  };

  return (
    <button onClick={goToTimesheet}>
      Go to Timesheet
    </button>
  );
}
```

### 2. Menggunakan `Link` Component

```jsx
import { Link } from 'react-router-dom';

function Navigation() {
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/timesheet">Timesheet</Link>
      <Link to="/dashboard">Dashboard</Link>
    </nav>
  );
}
```

### 3. Programmatic Navigation dengan State

```jsx
const navigate = useNavigate();

// Navigasi dengan state data
navigate('/timesheet', {
  state: { poNumber: 'PO-12345' }
});

// Di page tujuan:
import { useLocation } from 'react-router-dom';

const location = useLocation();
const poNumber = location.state?.poNumber;
```

## 📄 Page Components Detail

### 1. LandingPage (`/`)

**Features:**
- 4 menu cards dengan animasi hover
- Hero section dengan info sistem
- Status indicator (Online/Offline)
- Footer dengan plant info

**Key Elements:**
```jsx
const menuItems = [
  {
    title: 'TIMESHEET',
    path: '/timesheet',
    icon: '📋',
    color: 'from-blue-500 to-blue-600'
  },
  // ... more items
];
```

**Usage:**
```jsx
<button onClick={() => navigate(item.path)}>
  {item.title}
</button>
```

---

### 2. TimesheetPage (`/timesheet`)

**Features:**
- Check-in/Check-out buttons
- Timesheet history table
- Search & filter
- Quick stats cards
- Barcode scanner integration ready

**Demo Data:**
```jsx
const timesheetData = [
  {
    date: '05/02/2026',
    operation: 'Assembly Line 1',
    checkinDate: '05/02/2026',
    checkinTime: '08:00',
    checkoutDate: '05/02/2026',
    checkoutTime: '17:00',
    duration: '9 jam'
  }
];
```

**Back Navigation:**
```jsx
<Button onClick={() => navigate('/')}>
  ← Back
</Button>
```

---

### 3. DashboardPage (`/dashboard`)

**Features:**
- 4 stats cards (Production, Workers, Efficiency, Downtime)
- Chart placeholders untuk analytics
- Machine status cards
- Quick action buttons

**Stats Cards:**
```jsx
const statsCards = [
  {
    title: 'Total Production',
    value: '1,245',
    unit: 'units',
    trend: '+12%',
    trendUp: true,
    icon: '📦',
    color: 'bg-blue-500'
  }
];
```

**Chart Integration Ready:**
- Placeholder untuk Chart.js atau Recharts
- Responsive grid layout

---

### 4. SettingPage (`/setting`)

**Features:**
- User profile form
- Application settings dengan toggle switches
- System information
- Action buttons (Save, Reset, Clear Cache)

**Settings State:**
```jsx
const [autoCheckout, setAutoCheckout] = useState(false);
const [notifications, setNotifications] = useState(true);
const [darkMode, setDarkMode] = useState(false);
const [offlineMode, setOfflineMode] = useState(true);
```

**Form Sections:**
1. User Profile (Employee ID, Name, Email, Phone, Department, Shift)
2. App Settings (Auto checkout, Notifications, Dark mode, Offline mode)
3. System Info (Version, Plant ID, Server status, Last sync)

---

### 5. ComponentTrackingPage (`/component-tracking`)

**Features:**
- Component list dengan search & filter
- Stats cards (Total, Available, Low Stock, Out of Stock)
- Detail view saat item dipilih
- Status color coding
- Action buttons (Add, Import, Reports, Sync)

**Demo Data:**
```jsx
const components = [
  {
    id: 'COMP-001',
    name: 'Motor Assembly',
    category: 'Electronic',
    stock: 245,
    location: 'Warehouse A-12',
    status: 'Available'
  }
];
```

**Status Colors:**
- Available: Green
- Low Stock: Yellow
- Out of Stock: Red

---

## 🛠️ Customize Routes

### Menambah Route Baru

1. **Buat Page Component:**
```jsx
// src/pages/NewPage.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, AppHeader } from '../components';

const NewPage = () => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <AppHeader
        title="New Page"
        rightContent={
          <Button onClick={() => navigate('/')}>← Back</Button>
        }
      />
      {/* Page content */}
    </PageContainer>
  );
};

export default NewPage;
```

2. **Tambah ke Router:**
```jsx
// src/router/index.jsx
import NewPage from '../pages/NewPage';

const router = createBrowserRouter([
  // ... existing routes
  {
    path: '/new-page',
    element: <NewPage />,
  }
]);
```

3. **Tambah Menu di Landing Page:**
```jsx
// src/pages/LandingPage.jsx
const menuItems = [
  // ... existing items
  {
    title: 'NEW PAGE',
    icon: '🆕',
    description: 'Description here',
    path: '/new-page',
    color: 'from-purple-500 to-purple-600',
    hoverColor: 'hover:from-purple-600 hover:to-purple-700',
    shadow: 'shadow-purple-500/50'
  }
];
```

### Protected Routes (Coming Soon)

Untuk add authentication:

```jsx
// router/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = localStorage.getItem('token');

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Usage in router
{
  path: '/dashboard',
  element: (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  )
}
```

## 🎨 Page Layout Pattern

Semua pages mengikuti pattern yang sama:

```jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, AppHeader, Button } from '../components';

const MyPage = () => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      {/* Header dengan back button */}
      <AppHeader
        title="Page Title"
        rightContent={
          <Button variant="secondary" size="small" onClick={() => navigate('/')}>
            ← Back
          </Button>
        }
      />

      {/* Page content */}
      <div className="bg-white rounded-xl p-5 shadow-md">
        {/* Your content here */}
      </div>
    </PageContainer>
  );
};

export default MyPage;
```

## 🔄 Navigation Flow

```
Landing Page (/)
    ├─→ Timesheet (/timesheet)
    ├─→ Dashboard (/dashboard)
    ├─→ Setting (/setting)
    └─→ Component Tracking (/component-tracking)

Setiap page punya tombol "Back" → kembali ke Landing Page
```

## 📱 Mobile Navigation (Future)

Untuk mobile, bisa tambahkan bottom navigation:

```jsx
// components/layout/BottomNav.jsx
import { useNavigate, useLocation } from 'react-router-dom';

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: '/', icon: '🏠', label: 'Home' },
    { path: '/timesheet', icon: '📋', label: 'Timesheet' },
    { path: '/dashboard', icon: '📊', label: 'Dashboard' },
    { path: '/setting', icon: '⚙️', label: 'Setting' }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t">
      <div className="flex justify-around">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`py-2 ${
              location.pathname === item.path
                ? 'text-primary'
                : 'text-gray-500'
            }`}
          >
            <div className="text-2xl">{item.icon}</div>
            <div className="text-xs">{item.label}</div>
          </button>
        ))}
      </div>
    </nav>
  );
};
```

## 🐛 Troubleshooting

### Route tidak ketemu (404)
```bash
# Check apakah route sudah terdaftar di router/index.jsx
# Check spelling path: '/timesheet' bukan '/time-sheet'
```

### Navigate tidak jalan
```jsx
// Pastikan import dari 'react-router-dom'
import { useNavigate } from 'react-router-dom';

// Bukan dari './router' atau library lain
```

### Blank page setelah navigate
```jsx
// Check console browser untuk error
// Pastikan component di-import dengan benar
// Check export default di page component
```

### Back button browser tidak jalan
```jsx
// Gunakan navigate() bukan window.location
navigate('/path'); // ✅ Good
window.location = '/path'; // ❌ Bad (full page reload)
```

## 📖 Resources

- [React Router Docs](https://reactrouter.com/en/main)
- [useNavigate Hook](https://reactrouter.com/en/main/hooks/use-navigate)
- [Link Component](https://reactrouter.com/en/main/components/link)
- [Protected Routes Tutorial](https://reactrouter.com/en/main/start/tutorial)

## 🎯 Next Steps

### Immediate
- [ ] Add loading states saat transition
- [ ] Add page transition animations
- [ ] Implement 404 error page design

### Short Term
- [ ] Add breadcrumb navigation
- [ ] Add route guards (authentication)
- [ ] Add nested routes untuk sub-pages
- [ ] Add URL parameters untuk detail pages

### Long Term
- [ ] Add lazy loading untuk pages
- [ ] Add route-based code splitting
- [ ] Add SEO meta tags per page
- [ ] Add sitemap generation

---

**Routing sudah siap! 🎉**

Run aplikasi:
```bash
npm run dev
```

Buka: **http://localhost:5173**

Navigasi akan berjalan smooth tanpa page reload! ⚡
