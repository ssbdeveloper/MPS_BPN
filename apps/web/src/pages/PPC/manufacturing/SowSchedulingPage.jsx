import React, { useState } from 'react';
import { useLocation, useMatches, useNavigate, useOutlet } from 'react-router-dom';
import { DensityProvider, PageHeader, RouteTransition, SegmentedControl, useDensity } from '../../../components';

const DENSITY_ITEMS = [
  { key: 'normal', label: 'Normal' },
  { key: 'compact', label: 'Compact' },
];

function DensityToggle() {
  const { density, setDensity } = useDensity();
  return (
    <SegmentedControl
      items={DENSITY_ITEMS}
      value={density}
      onChange={setDensity}
      ariaLabel="Row density"
    />
  );
}

/**
 * FrozenRoute — WAJIB, bukan gaya-gayaan.
 *
 * <Outlet/> membaca konteks rute SAAT INI. Kalau ia dipakai langsung sebagai anak
 * AnimatePresence mode="wait", halaman yang sedang keluar ikut me-render konten BARU
 * sambil beranimasi keluar — yang terlihat: konten baru menggeser dirinya sendiri,
 * bukan transisi antar halaman.
 *
 * useState menangkap elemen outlet SEKALI saat mount. Karena komponen ini di-key oleh
 * pathname, tiap rute mendapat instance baru yang membekukan kontennya sendiri, dan
 * halaman yang keluar tetap menampilkan konten lamanya sampai animasi selesai.
 */
function FrozenRoute({ context }) {
  const outlet = useOutlet(context);
  const [frozen] = useState(outlet);
  return frozen;
}

/**
 * ManufacturingSchedulingLayout — shell rute BERSARANG untuk SOW Scheduling
 * (varian manufaktur). Menyediakan SATU <PageHeader> + <Outlet/> untuk sub-route.
 *
 * - Judul & eyebrow dibaca dari `handle` rute aktif (via useMatches).
 * - Back DETERMINISTIK: index -> /operations-hub, sub-route -> /sow-scheduling.
 * - PageHeader berada DI LUAR RouteTransition dengan sengaja: header harus diam
 *   saat konten bertransisi, kalau ikut bergerak seluruh layar terasa melompat.
 */
function SchedulingShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  const [headerRight, setHeaderRight] = useState(null);

  const isIndex = location.pathname.replace(/\/+$/, '') === '/sow-scheduling';
  const depth = isIndex ? 0 : 1;

  const active = [...matches].reverse().find((match) => match.handle?.title);
  const title = active?.handle?.title || 'SOW Scheduling';
  const eyebrow = active?.handle?.eyebrow || 'Manufacturing';

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-canvas">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        backLabel={isIndex ? 'Operations Hub' : 'Menu'}
        onBack={isIndex ? () => navigate('/operations-hub') : () => navigate('/sow-scheduling')}
        right={(
          <div className="flex items-center gap-2">
            <DensityToggle />
            {headerRight}
          </div>
        )}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RouteTransition routeKey={location.pathname} depth={depth}>
          <FrozenRoute key={location.pathname} context={{ setHeaderRight }} />
        </RouteTransition>
      </div>
    </div>
  );
}

export default function ManufacturingSchedulingLayout() {
  return (
    <DensityProvider>
      <SchedulingShell />
    </DensityProvider>
  );
}
