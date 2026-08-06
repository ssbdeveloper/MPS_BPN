import React, { useState } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components';
import { goBackOrFallback } from '../../../utils/navigation';

/**
 * ManufacturingSchedulingLayout — shell rute BERSARANG untuk SOW Scheduling
 * (varian manufaktur). Menyediakan SATU <PageHeader> + <Outlet/> untuk sub-route.
 *
 * - Judul & eyebrow dibaca dari `handle` rute aktif (via useMatches) — sub-page
 *   TIDAK punya header sendiri.
 * - Back:
 *     index ('/sow-scheduling')  -> goBackOrFallback(navigate, '/operations-hub')
 *     sub-route                  -> kembali ke menu ('/sow-scheduling')
 *   Karena kini rute nyata, tombol back browser/hardware juga otomatis benar
 *   (memperbaiki keluhan "back malah ke Operations Hub").
 */
export default function ManufacturingSchedulingLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  // Slot aksi kanan header diisi sub-page lewat Outlet context (mis. tombol
  // Refresh milik SchedulingAreaPage) supaya sejajar dengan tombol Back.
  const [headerRight, setHeaderRight] = useState(null);

  const isIndex = location.pathname.replace(/\/+$/, '') === '/sow-scheduling';

  // Ambil handle dari match terdalam yang mendefinisikannya.
  const active = [...matches].reverse().find((match) => match.handle?.title);
  const title = active?.handle?.title || 'SOW Scheduling';
  const eyebrow = active?.handle?.eyebrow || 'Manufacturing';

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        backLabel={isIndex ? 'Operations Hub' : 'Menu'}
        onBack={isIndex
          ? () => goBackOrFallback(navigate, '/operations-hub')
          : () => navigate('/sow-scheduling')}
        right={headerRight}
      />

      {/* Pembungkus scroll konten. Sub-page mempertahankan padding-nya sendiri
          (px-4 py-4 md:px-6) — layout TIDAK menambah padding horizontal agar
          tidak dobel. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet context={{ setHeaderRight }} />
      </div>
    </div>
  );
}
