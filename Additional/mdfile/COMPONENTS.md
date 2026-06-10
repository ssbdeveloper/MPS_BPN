# Dokumentasi Komponen React Timesheet

Project ini berisi komponen-komponen React reusable yang dikonversi dari CSS aplikasi MPS Timesheet. Semua komponen menggunakan Tailwind CSS dan support offline mode dengan PWA.

## 📁 Struktur Folder

```
src/
├── components/
│   ├── ui/              # Komponen UI dasar
│   │   ├── Button.jsx
│   │   ├── Switch.jsx
│   │   ├── Card.jsx
│   │   └── Modal.jsx
│   ├── layout/          # Komponen layout
│   │   └── PageContainer.jsx
│   ├── forms/           # Komponen form
│   │   └── Input.jsx
│   ├── tables/          # Komponen tabel dan gallery
│   │   └── Table.jsx
│   └── index.js         # Export semua komponen
```

## 🎨 Komponen UI

### Button
Komponen button dengan efek 3D dan berbagai varian warna.

```jsx
import { Button } from './components';

// Varian
<Button variant="primary">Primary</Button>
<Button variant="success">Success</Button>
<Button variant="danger">Danger</Button>
<Button variant="warning">Warning</Button>
<Button variant="secondary">Secondary</Button>

// Ukuran
<Button size="default">Default</Button>
<Button size="small">Small</Button>
<Button size="small2">Small 2</Button>
<Button size="icon" icon="/path/to/icon.svg">Icon Button</Button>

// Disabled
<Button disabled>Disabled</Button>
```

**Props:**
- `variant`: 'primary' | 'success' | 'danger' | 'warning' | 'secondary'
- `size`: 'default' | 'small' | 'small2' | 'icon'
- `icon`: path ke icon (optional)
- `iconPosition`: 'top' | 'left' | 'right'
- `disabled`: boolean
- `onClick`: function
- `className`: custom classes

---

### Switch
Toggle switch component.

```jsx
import { Switch } from './components';

const [checked, setChecked] = useState(false);

<Switch
  checked={checked}
  onChange={setChecked}
  label="Auto Check-in"
/>
```

**Props:**
- `checked`: boolean
- `onChange`: function(boolean)
- `label`: string (optional)
- `className`: custom classes

---

### Card Components

#### MachineCard
Card untuk menampilkan informasi mesin dengan hover effect.

```jsx
import { MachineCard } from './components';

<MachineCard
  title="M001"
  details={[
    { label: 'Name', value: 'CNC Machine 1' },
    { label: 'Status', value: 'Active' },
    { label: 'Operator', value: 'John Doe' }
  ]}
  onClick={() => console.log('clicked')}
/>
```

**Props:**
- `title`: string
- `details`: array of { label, value }
- `onClick`: function
- `className`: custom classes

#### InfoBox
Box untuk menampilkan informasi dengan action buttons.

```jsx
import { InfoBox } from './components';

<InfoBox
  items={[
    { label: 'PO Number', value: 'PO-12345' },
    { label: 'Serial', value: 'SN-67890' }
  ]}
  actions={<Button>Action</Button>}
/>
```

**Props:**
- `items`: array of { label, value }
- `actions`: React node (optional)
- `className`: custom classes

---

### Modal Components

#### Modal
Modal overlay generic.

```jsx
import { Modal } from './components';

const [isOpen, setIsOpen] = useState(false);

<Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
  <div>Modal Content</div>
</Modal>
```

#### PreviewBox
Modal khusus untuk preview kamera/video.

```jsx
import { PreviewBox } from './components';

const videoRef = useRef(null);

<PreviewBox
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  videoRef={videoRef}
/>
```

---

## 📐 Komponen Layout

### PageContainer
Container utama halaman dengan flex layout.

```jsx
import { PageContainer } from './components';

<PageContainer>
  {/* content */}
</PageContainer>
```

---

### AppHeader
Header aplikasi dengan gradient background.

```jsx
import { AppHeader } from './components';

<AppHeader
  title="MPS Timesheet"
  rightContent={<Button>Logout</Button>}
/>
```

**Props:**
- `title`: string
- `rightContent`: React node (optional)
- `className`: custom classes

---

### StatusBar
Bar untuk menampilkan status dengan layout kiri-kanan.

```jsx
import { StatusBar } from './components';

<StatusBar
  leftContent={<div>Total: 10</div>}
  rightContent={<div>Status: Active</div>}
/>
```

---

### MenuGrid
Grid layout responsif untuk menu items.

```jsx
import { MenuGrid } from './components';

<MenuGrid>
  <Button>Menu 1</Button>
  <Button>Menu 2</Button>
  <Button>Menu 3</Button>
</MenuGrid>
```

---

### Container Horizontal/Vertical
Container dengan flex direction horizontal/vertical.

```jsx
import { ContainerHorizontal, ContainerVertical } from './components';

<ContainerHorizontal border={true}>
  {/* content */}
</ContainerHorizontal>

<ContainerVertical border={false}>
  {/* content */}
</ContainerVertical>
```

---

## 📝 Komponen Form

### Input
Text input standard.

```jsx
import { Input } from './components';

<Input
  type="text"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="Masukkan text..."
/>
```

---

### TextArea
Multi-line text input.

```jsx
import { TextArea } from './components';

<TextArea
  value={value}
  onChange={(e) => setValue(e.target.value)}
  rows={5}
  placeholder="Masukkan text..."
/>
```

---

### Select
Dropdown select component.

```jsx
import { Select } from './components';

<Select
  value={value}
  onChange={(e) => setValue(e.target.value)}
  options={[
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' }
  ]}
  placeholder="Pilih opsi..."
/>
```

---

### FormRow
Row layout untuk form dengan label, input, dan UOM.

```jsx
import { FormRow, Input } from './components';

<FormRow label="Quantity" uom="pcs">
  <Input type="number" />
</FormRow>
```

**Props:**
- `label`: string
- `children`: React node (input component)
- `uom`: string (optional, unit of measure)
- `className`: custom classes

---

### SearchRow
Input dengan button search.

```jsx
import { SearchRow } from './components';

<SearchRow
  value={searchValue}
  onChange={(e) => setSearchValue(e.target.value)}
  onSearch={() => console.log('search')}
  placeholder="Cari..."
  buttonText="Cari"
/>
```

---

## 📊 Komponen Table

### Gallery
List/Gallery generic dengan header dan selectable items.

```jsx
import { Gallery } from './components';

<Gallery
  headers={[
    { label: 'PO', span: 1 },
    { label: 'Operation', span: 2 }
  ]}
  items={data}
  selectedIndex={selectedIndex}
  onItemClick={(item, index) => setSelectedIndex(index)}
  renderItem={(item) => (
    <>
      <div>{item.po}</div>
      <div>{item.operation}</div>
    </>
  )}
/>
```

---

### TimesheetTable
Tabel khusus untuk timesheet dengan actions.

```jsx
import { TimesheetTable } from './components';

<TimesheetTable
  data={timesheetData}
  onEdit={(row) => console.log('Edit:', row)}
  onDelete={(row) => console.log('Delete:', row)}
/>
```

**Data Format:**
```js
[
  {
    date: '05/02/2026',
    operation: 'Assembly',
    checkinDate: '05/02/2026',
    checkinTime: '08:00',
    checkoutDate: '05/02/2026',
    checkoutTime: '17:00',
    duration: '9 jam'
  }
]
```

---

### MachineGallery
Grid gallery untuk machine cards.

```jsx
import { MachineGallery } from './components';

<MachineGallery
  machines={[
    { code: 'M001', name: 'CNC 1', status: 'Active' }
  ]}
  onMachineClick={(machine) => console.log(machine)}
/>
```

---

### TextBox
Box untuk menampilkan text dengan berbagai varian border color.

```jsx
import { TextBox } from './components';

<TextBox variant="order">PO-12345</TextBox>
<TextBox variant="seq">010</TextBox>
<TextBox variant="hrs">8.5 hrs</TextBox>
<TextBox variant="act">Assembly</TextBox>
<TextBox variant="wct">WC-001</TextBox>
```

**Variants:**
- `default`: border abu-abu
- `order`: border biru (untuk PO)
- `seq`: border hijau (untuk sequence)
- `hrs`: border kuning (untuk jam)
- `act`: border merah (untuk activity)
- `wct`: border hijau tua (untuk work center)

---

## 🎨 Tailwind Config

### Custom Colors
```js
primary: '#007bff'
success: '#28a745'
danger: '#ff6b6b'
warning: '#ffd966'
secondary: '#adb5bd'
```

### Custom Shadows (3D Effect)
- `shadow-3d-primary`
- `shadow-3d-success`
- `shadow-3d-danger`
- `shadow-3d-warning`
- `shadow-3d-secondary`

---

## 📱 PWA & Offline Mode

Aplikasi sudah dikonfigurasi dengan PWA untuk support offline mode:

- **Service Worker**: Auto-generated dengan Workbox
- **Cache Strategy**:
  - Static assets: CacheFirst
  - API calls: NetworkFirst dengan fallback ke cache
  - Fonts: CacheFirst dengan expiry 365 hari

### Install sebagai PWA
1. Buka aplikasi di browser
2. Klik tombol "Install" atau "Add to Home Screen"
3. Aplikasi akan berjalan seperti native app

---

## 🚀 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build untuk production
npm run build

# Preview production build
npm run preview
```

---

## 📦 Dependencies

- **React 18**: UI framework
- **Vite**: Build tool
- **Tailwind CSS**: Utility-first CSS
- **vite-plugin-pwa**: PWA plugin
- **workbox-window**: Service worker management

---

## 🔄 Migrasi dari CSS Lama

Semua komponen di atas sudah dikonversi dari CSS files berikut:
- `main.css` → Button, Layout, Cards, Tables
- `style.css` → Container, TextBox, Gallery
- `stylets.css` → Table styles
- `stylets2.css` → Advanced table features
- `processcontrol.css` → Form components
- `pss.css` → Parameter form styles

---

## 💡 Tips Penggunaan

1. **Import hanya yang dibutuhkan**:
   ```jsx
   import { Button, Input } from './components';
   ```

2. **Custom styling dengan className**:
   ```jsx
   <Button className="w-full mt-4">Full Width</Button>
   ```

3. **Combine dengan Tailwind utilities**:
   ```jsx
   <div className="flex gap-4">
     <Button variant="primary">Button 1</Button>
     <Button variant="success">Button 2</Button>
   </div>
   ```

4. **Responsive design**:
   ```jsx
   <div className="flex flex-col md:flex-row gap-4">
     {/* Vertical on mobile, horizontal on desktop */}
   </div>
   ```

---

## 📞 Support

Untuk pertanyaan atau issue, silakan buka issue di repository atau hubungi tim development.
