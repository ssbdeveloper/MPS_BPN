# 📋 Login Timesheet Page - Documentation

## Overview

Halaman Login Timesheet untuk scan NFC/ID karyawan sebelum masuk ke sistem timesheet. Converted dari `MPS2/UI/index.html` ke React component.

## 🎯 Fitur

### 1. Dual Mode Scanning
- **Internal Mode (NFC)**: Scan menggunakan Web NFC API (Chrome Android)
- **External Mode (Scanner)**: Input manual menggunakan barcode/ID scanner

### 2. Tiga Aksi Timesheet
- **Productive**: Start timesheet productive → redirect ke `/timesheet`
- **Unproductive**: Start timesheet unproductive → redirect ke `/unproductive`
- **Stop Timesheet**: Stop semua timesheet yang aktif

### 3. Button State Management
- Button yang dipilih akan disabled (pressed in effect)
- Visual feedback dengan shadow & opacity
- Persistent state di sessionStorage

### 4. Auto-focus Management
- External scanner input auto-focus
- Re-focus setelah blur/click
- Enter key untuk submit

## 🗺️ Route

```
/login-timesheet
```

Akses dari Landing Page → Click "TIMESHEET" button

## 🎨 Design

### Layout Structure

```
┌─────────────────────────────────────┐
│ Header: Timesheet Login  [Switch]  │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │ Productive   │  │Unproductive  ││
│  └──────────────┘  └──────────────┘│
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │Stop Timesheet│  │Tools & Cons. ││
│  └──────────────┘  └──────────────┘│
│                                     │
│  [External Scanner Input Box]      │ ← Hanya muncul di mode external
│                                     │
├─────────────────────────────────────┤
│ Status | Version | ID NFC          │
└─────────────────────────────────────┘
```

### Button Colors

```jsx
Productive:      Green  (from-green-400 to-green-600)
Unproductive:    Yellow (from-yellow-400 to-yellow-600)
Stop Timesheet:  Red    (from-red-400 to-red-600)
Tools & Cons:    Blue   (from-blue-400 to-blue-600)
```

### Button States

**Normal (Clickable):**
```css
- Gradient background
- Shadow-lg
- Hover effects
- Active translate
```

**Selected (Disabled):**
```css
- Solid color (lighter)
- Shadow-inner (pressed effect)
- Opacity 60%
- Translate-y-1 (pushed down)
- Cursor not-allowed
```

## 💻 Component Structure

### States

```jsx
const [mode, setMode] = useState('internal' | 'external');
const [selectedAction, setSelectedAction] = useState('start' | 'unprod' | 'stop');
const [status, setStatus] = useState(string);
const [nfcId, setNfcId] = useState(string);
const [scanInput, setScanInput] = useState(string);
```

### Key Functions

#### 1. Mode Management

```jsx
const handleModeChange = (checked) => {
  const newMode = checked ? 'external' : 'internal';
  setMode(newMode);
  sessionStorage.setItem('scanMode', newMode);
  // Update status & focus
};
```

#### 2. NFC Scan Handler

```jsx
const handleNfcScan = async (action) => {
  // Check if Web NFC supported
  // Start NFC Reader
  // Extract NFC ID
  // Get user from API
  // Handle action (start/stop/unprod)
  // Redirect or show message
};
```

#### 3. External Scanner Handler

```jsx
const handleScannerInput = async (e) => {
  // Listen Enter key
  // Get scanned ID
  // Get user from API
  // Handle action
  // Redirect
};
```

#### 4. Button Click Handler

```jsx
const handleButtonClick = (action) => {
  setSelectedAction(action);
  sessionStorage.setItem('scanAction', action);
  handleNfcScan(action);
};
```

## 🔌 API Integration

### 1. Get User by NFC

```javascript
GET /usernfc/nfcid/{nfcid}

Response:
{
  "sn": "12345",
  "name": "John Doe",
  "workcenter": "WC-001",
  // ... other fields
}
```

### 2. Stop Timesheet

```javascript
POST /usernfc/checkout

Body:
{
  "datakaryawan": {
    "sn": "12345"
  }
}

Response: 200 OK / 4xx Error
```

## 📦 SessionStorage Usage

### Data Stored

```javascript
// 1. Scan Mode
sessionStorage.setItem('scanMode', 'internal' | 'external');

// 2. Selected Action
sessionStorage.setItem('scanAction', 'start' | 'unprod' | 'stop');

// 3. User Data (after successful scan)
sessionStorage.setItem('datakaryawan', JSON.stringify(userData));
```

### Data Retrieved

```javascript
// In other pages (Timesheet, etc)
const userData = JSON.parse(sessionStorage.getItem('datakaryawan'));

console.log(userData.sn);
console.log(userData.name);
console.log(userData.workcenter);
```

## 🔄 Flow Diagram

### Internal Mode (NFC)

```
User clicks "Productive"
    ↓
Button disabled (selected state)
    ↓
NFC Reader starts
    ↓
User taps NFC card
    ↓
Extract NFC ID
    ↓
API: Get user by NFC ID
    ↓
User found?
    Yes → Save to sessionStorage
          → Redirect to /timesheet
    No  → Alert "User tidak ditemukan"
```

### External Mode (Scanner)

```
User clicks "Productive"
    ↓
Button disabled (selected state)
    ↓
User scans ID with barcode scanner
    ↓
Input receives ID + Enter
    ↓
API: Get user by NFC ID
    ↓
User found?
    Yes → Save to sessionStorage
          → Redirect to /timesheet
    No  → Alert "User tidak ditemukan"
```

### Stop Timesheet

```
User clicks "Stop Timesheet"
    ↓
Button disabled (selected state)
    ↓
User scans NFC/ID
    ↓
API: Get user by NFC ID
    ↓
User found?
    Yes → API: Stop all timesheet
          → Alert "Timesheet dihentikan"
    No  → Alert "User tidak ditemukan"
```

## 🎯 Use Cases

### Use Case 1: Login Productive

```
Actor: Operator
1. Buka aplikasi → Landing page
2. Klik button "TIMESHEET"
3. Di halaman Login Timesheet
4. Klik button "Productive" (default selected)
5. Scan NFC card
6. Redirect ke Timesheet page
7. Data karyawan tersimpan di sessionStorage
```

### Use Case 2: Login Unproductive

```
Actor: Operator
1. Di halaman Login Timesheet
2. Klik button "Unproductive"
3. Scan NFC card
4. Redirect ke Unproductive page
```

### Use Case 3: Stop Timesheet

```
Actor: Operator/Supervisor
1. Di halaman Login Timesheet
2. Klik button "Stop Timesheet"
3. Scan NFC card operator yang akan di-stop
4. Konfirmasi "Timesheet dihentikan"
5. Tidak redirect (stay di halaman)
```

### Use Case 4: External Scanner

```
Actor: Operator (no NFC phone)
1. Toggle switch ke "Eksternal"
2. Input box muncul
3. Klik button "Productive"
4. Scan barcode ID
5. Scanner input ID + Enter
6. Redirect ke Timesheet page
```

## 🔧 Configuration

### Web NFC Browser Support

```javascript
// Check support
if ('NDEFReader' in window) {
  // NFC supported
} else {
  // Not supported - show alert
  // User must use External mode
}
```

**Supported:**
- ✅ Chrome for Android (79+)
- ✅ Edge for Android
- ✅ Samsung Internet

**Not Supported:**
- ❌ iOS Safari
- ❌ Desktop Chrome
- ❌ Firefox

### Auto-focus Management

```javascript
// Input auto-focus in external mode
useEffect(() => {
  const focusInput = () => {
    if (mode === 'external' && inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Events
  window.addEventListener('load', focusInput);
  document.addEventListener('click', focusInput);
  inputRef.current?.addEventListener('blur', focusInput);

  return () => {
    // Cleanup
  };
}, [mode]);
```

## 🐛 Error Handling

### Common Errors

**1. Web NFC not supported**
```javascript
setStatus('Web NFC tidak didukung');
alert('Browser Anda tidak mendukung Web NFC. Gunakan mode Eksternal.');
```

**2. User not found**
```javascript
setStatus('User tidak ditemukan');
alert('User tidak ditemukan di database!');
```

**3. NFC scan failed**
```javascript
setStatus('Gagal scan NFC');
alert('Gagal melakukan scan NFC: ' + err.message);
```

**4. API error**
```javascript
console.error('Error fetching user:', error);
return null;
```

## 🎨 Styling Classes

### Button Classes

```jsx
// Normal state
className="h-36 text-xl font-bold rounded-xl transition-all duration-150
  bg-gradient-to-b from-green-400 to-green-600 text-white
  shadow-lg hover:from-green-500 hover:to-green-700
  active:translate-y-1"

// Selected state (disabled)
className="h-36 text-xl font-bold rounded-xl transition-all duration-150
  bg-green-400 shadow-inner opacity-60 translate-y-1
  cursor-not-allowed"
```

### Mode Switch

```jsx
<label className="relative inline-block w-12 h-6 cursor-pointer">
  <input type="checkbox" className="hidden" />
  <span className="absolute inset-0 rounded-full
    bg-green-500 (if checked) / bg-gray-400 (if not)
    before:translate-x-6 (if checked) / before:translate-x-0"
  />
</label>
```

## 📱 Responsive Design

**Mobile (< 640px):**
```
- Grid: 1 column
- Buttons: Full width
- Stacked vertically
```

**Desktop (≥ 640px):**
```
- Grid: 2 columns
- Buttons: 50% width each
- Side by side
```

## 🔜 Next Steps

### Enhancements
- [ ] Add loading spinner during API call
- [ ] Add sound feedback on scan success
- [ ] Add vibration on mobile scan
- [ ] Add scan history log
- [ ] Add offline queue for failed scans

### Integration
- [ ] Connect to actual backend API
- [ ] Test with real NFC cards
- [ ] Test with barcode scanner hardware
- [ ] Add error retry mechanism
- [ ] Add timeout handling

## 📖 Related Pages

- **Landing Page** (`/`) - Main menu
- **Timesheet Page** (`/timesheet`) - After productive login
- **Unproductive Page** (`/unproductive`) - After unprod login (TODO)

## 🧪 Testing

### Manual Test

```bash
npm run dev
```

**Test Cases:**
1. ✅ Mode switch working
2. ✅ Button state changes (selected)
3. ✅ External input appears/hides
4. ✅ Status updates correctly
5. ✅ Build successful

**Production Test:**
1. Test with real NFC cards
2. Test with barcode scanner
3. Test API integration
4. Test error scenarios
5. Test redirect flow

---

## 📞 Support

**Browser Issues:**
- Pastikan Chrome for Android (latest)
- Enable NFC di phone settings
- Grant NFC permission ke browser

**Scanner Issues:**
- Mode harus "Eksternal"
- Input harus auto-focus
- Scanner harus send Enter after ID

---

**Login Timesheet Page Ready! 📋**

Route: `/login-timesheet`
Status: ✅ Complete
Build: ✅ Success
