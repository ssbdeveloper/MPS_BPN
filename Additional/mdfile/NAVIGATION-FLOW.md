# 🗺️ Navigation Flow Guide

Visual guide untuk alur navigasi di MPS Timesheet System.

## 📱 Application Flow

```
┌─────────────────────────────────────────────┐
│                                             │
│           LANDING PAGE (/)                  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │   🏠 MPS Timesheet System           │   │
│  │   Welcome to MPS System             │   │
│  │   Manufacturing Production System   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │  📋 TIMESHEET│  │ 📊 DASHBOARD │        │
│  │              │  │              │        │
│  │  Check-in,   │  │  Analytics & │        │
│  │  Check-out   │  │  Reports     │        │
│  └──────────────┘  └──────────────┘        │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │  ⚙️ SETTING  │  │ 📦 COMPONENT │        │
│  │              │  │   TRACKING   │        │
│  │  Config &    │  │              │        │
│  │  Preferences │  │  Track Items │        │
│  └──────────────┘  └──────────────┘        │
│                                             │
│  Plant: 5071 | Version: 2.0.0 | Online    │
└─────────────────────────────────────────────┘
```

## 🎯 Menu Actions

### 1. TIMESHEET Flow
```
Landing Page
    │
    │ Click "TIMESHEET" card
    ↓
┌─────────────────────────────────┐
│   TIMESHEET PAGE                │
│                                 │
│   ┌──────────────┐              │
│   │ Employee Info│              │
│   │  PO-12345    │              │
│   └──────────────┘              │
│                                 │
│   ┌─────┐ ┌─────┐               │
│   │Check│ │Check│               │
│   │ In  │ │ Out │               │
│   └─────┘ └─────┘               │
│                                 │
│   ┌──────────────────────────┐  │
│   │  Timesheet History       │  │
│   │  05/02 | Assembly | 9hrs│  │
│   │  04/02 | Quality  | 8hrs│  │
│   └──────────────────────────┘  │
│                                 │
│   [← Back]                      │
└─────────────────────────────────┘
    │
    │ Click "Back"
    ↓
Landing Page
```

### 2. DASHBOARD Flow
```
Landing Page
    │
    │ Click "DASHBOARD" card
    ↓
┌─────────────────────────────────┐
│   DASHBOARD PAGE                │
│                                 │
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│   │1245│ │ 48 │ │ 87%│ │2.5h│  │
│   │Prod│ │Work│ │Effi│ │Down│  │
│   └────┘ └────┘ └────┘ └────┘  │
│                                 │
│   ┌────────────┐ ┌────────────┐ │
│   │ Production │ │ Efficiency │ │
│   │   Chart    │ │   Chart    │ │
│   │    📈      │ │    📊      │ │
│   └────────────┘ └────────────┘ │
│                                 │
│   Machine Status                │
│   ┌─────┐ ┌─────┐ ┌─────┐      │
│   │M001 │ │M002 │ │M003 │      │
│   │92%  │ │75%  │ │88%  │      │
│   └─────┘ └─────┘ └─────┘      │
│                                 │
│   [← Back]                      │
└─────────────────────────────────┘
    │
    │ Click "Back"
    ↓
Landing Page
```

### 3. SETTING Flow
```
Landing Page
    │
    │ Click "SETTING" card
    ↓
┌─────────────────────────────────┐
│   SETTING PAGE                  │
│                                 │
│   👤 User Profile               │
│   ┌──────────────────────────┐  │
│   │ ID: EMP-001              │  │
│   │ Name: John Doe           │  │
│   │ Email: john@company.com  │  │
│   │ Phone: +62 812-xxx       │  │
│   └──────────────────────────┘  │
│                                 │
│   🔧 Application Settings       │
│   Auto Check-out      [ON ]     │
│   Notifications       [ON ]     │
│   Dark Mode          [OFF]     │
│   Offline Mode       [ON ]     │
│                                 │
│   ℹ️ System Information         │
│   Version: 2.0.0                │
│   Plant: 5071                   │
│   Status: 🟢 Online             │
│                                 │
│   [💾 Save] [🔄 Reset]          │
│   [← Back]                      │
└─────────────────────────────────┘
    │
    │ Click "Back"
    ↓
Landing Page
```

### 4. COMPONENT TRACKING Flow
```
Landing Page
    │
    │ Click "COMPONENT TRACKING" card
    ↓
┌─────────────────────────────────┐
│   COMPONENT TRACKING PAGE       │
│                                 │
│   ┌───┐ ┌───┐ ┌───┐ ┌───┐      │
│   │502│ │490│ │12 │ │ 0 │      │
│   │Tot│ │Avl│ │Low│ │Out│      │
│   └───┘ └───┘ └───┘ └───┘      │
│                                 │
│   [Search component...]         │
│                                 │
│   Component List                │
│   ┌────────────────────────┐    │
│   │ COMP-001 | Motor Assy │    │
│   │ Stock: 245 | ✅        │    │
│   ├────────────────────────┤    │
│   │ COMP-002 | Gear Box   │    │
│   │ Stock: 89  | ✅        │    │
│   ├────────────────────────┤    │
│   │ COMP-003 | Control    │    │
│   │ Stock: 12  | ⚠️        │    │
│   └────────────────────────┘    │
│                                 │
│   [← Back]                      │
└─────────────────────────────────┘
    │
    │ Click "Back"
    ↓
Landing Page
```

## 🔄 Navigation Patterns

### Pattern 1: Direct Navigation
```
User Action                  Result
───────────────────────────────────────
Click TIMESHEET card    →   /timesheet
Click DASHBOARD card    →   /dashboard
Click SETTING card      →   /setting
Click COMPONENT card    →   /component-tracking
```

### Pattern 2: Back Navigation
```
Any Page
    │
    │ Click "← Back" button
    ↓
Landing Page (/)
```

### Pattern 3: Browser Navigation
```
Browser Back Button    →   Previous page
Browser Forward Button →   Next page
Type URL directly      →   Go to page
```

## 🎨 Visual Hierarchy

### Landing Page Layout
```
┌─────────────────────────────────────┐
│ Header: MPS Timesheet System  [X]  │ ← App Header
├─────────────────────────────────────┤
│                                     │
│  ┌──────────────────────────────┐   │
│  │   HERO SECTION              │   │ ← Welcome message
│  │   Welcome to MPS System     │   │
│  └──────────────────────────────┘   │
│                                     │
│  ┌────────────┐  ┌────────────┐    │
│  │            │  │            │    │
│  │ TIMESHEET  │  │ DASHBOARD  │    │ ← Menu Cards (2x2 grid)
│  │            │  │            │    │
│  └────────────┘  └────────────┘    │
│                                     │
│  ┌────────────┐  ┌────────────┐    │
│  │            │  │            │    │
│  │  SETTING   │  │ COMPONENT  │    │
│  │            │  │            │    │
│  └────────────┘  └────────────┘    │
│                                     │
│  Plant: 5071 | Ver: 2.0.0 | Online│ ← Footer
└─────────────────────────────────────┘
```

### Page Layout Template
```
┌─────────────────────────────────────┐
│ Header: Page Title        [← Back] │ ← Page Header
├─────────────────────────────────────┤
│                                     │
│  ┌──────────────────────────────┐   │
│  │   Main Content Area         │   │ ← Content Section 1
│  └──────────────────────────────┘   │
│                                     │
│  ┌──────────────────────────────┐   │
│  │   Secondary Content         │   │ ← Content Section 2
│  └──────────────────────────────┘   │
│                                     │
│  ┌──────────────────────────────┐   │
│  │   Actions / Details         │   │ ← Content Section 3
│  └──────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

## 📱 Mobile Navigation (Responsive)

### Desktop (> 768px)
```
┌────────────────────────────────┐
│ Header                         │
├────────────────────────────────┤
│ [Card 1] [Card 2]              │
│ [Card 3] [Card 4]              │
│                                │
│ 2 columns grid                 │
└────────────────────────────────┘
```

### Mobile (< 768px)
```
┌──────────────┐
│ Header       │
├──────────────┤
│ [Card 1]     │
│              │
├──────────────┤
│ [Card 2]     │
│              │
├──────────────┤
│ [Card 3]     │
│              │
├──────────────┤
│ [Card 4]     │
│              │
└──────────────┘
```

## 🎯 User Journey Examples

### Journey 1: Check-in Process
```
1. User opens app
   ↓
2. Sees Landing Page with 4 menu cards
   ↓
3. Clicks "TIMESHEET" card (blue)
   ↓
4. Arrives at Timesheet Page
   ↓
5. Sees employee info and Check-in button
   ↓
6. Clicks "Check In" button
   ↓
7. System records check-in time
   ↓
8. Clicks "← Back" to return to main menu
```

### Journey 2: View Dashboard
```
1. User at Landing Page
   ↓
2. Clicks "DASHBOARD" card (green)
   ↓
3. Sees production stats (1245 units, 48 workers)
   ↓
4. Scrolls down to see charts
   ↓
5. Views machine status cards
   ↓
6. Clicks "← Back" when done
```

### Journey 3: Change Settings
```
1. User at Landing Page
   ↓
2. Clicks "SETTING" card (purple)
   ↓
3. Sees user profile and app settings
   ↓
4. Toggles "Dark Mode" switch
   ↓
5. Clicks "💾 Save Settings" button
   ↓
6. Sees success message
   ↓
7. Clicks "← Back" to main menu
```

## 🔗 Route Mapping

```javascript
URL Path                Component Name          Menu Card
──────────────────────────────────────────────────────────
/                      LandingPage              (Home)
/timesheet             TimesheetPage            TIMESHEET
/dashboard             DashboardPage            DASHBOARD
/setting               SettingPage              SETTING
/component-tracking    ComponentTrackingPage    COMPONENT TRACKING
/*                     404 Page                 (Error)
```

## ⚡ Performance Notes

### Navigation Speed
- **Page transition**: < 50ms (instant)
- **No page reload**: SPA architecture
- **Route switching**: Client-side only
- **Back button**: Instant (browser history)

### Loading Behavior
```
Click Menu Card
    ↓
New page renders immediately
(No loading spinner needed - instant)
    ↓
User sees page content
```

## 🎨 Animation Timeline

### Card Hover Animation
```
Mouse hover on card
    ↓
[0ms]    Card starts moving up
[150ms]  Card at -8px position
         Shadow increases
         Arrow appears from right
         Background circles scale
[300ms]  Animation complete
```

### Page Navigation
```
Click card
    ↓
[0ms]    Router initiates navigation
[20ms]   Old page unmounts
[30ms]   New page mounts
[50ms]   New page fully rendered
```

## 📊 Navigation Statistics

### Average User Flow
```
Landing Page View Time:     5-10 seconds
Menu Selection Time:        2-3 seconds
Page View Time:            30-60 seconds
Back to Home:              1 second
Total Session:             3-5 minutes
```

### Expected Click Patterns
```
Most Clicked:
1. TIMESHEET (40%)
2. DASHBOARD (25%)
3. COMPONENT TRACKING (20%)
4. SETTING (15%)
```

## 🚀 Quick Reference

### To Navigate:
```javascript
// In component
const navigate = useNavigate();
navigate('/timesheet');
```

### To Go Back:
```javascript
navigate('/');  // Back to home
navigate(-1);   // Browser back
```

### To Check Current Route:
```javascript
const location = useLocation();
console.log(location.pathname); // e.g., '/timesheet'
```

---

**Navigation system visual guide complete! 🎉**

Untuk detail teknis, lihat: `ROUTING-GUIDE.md`
