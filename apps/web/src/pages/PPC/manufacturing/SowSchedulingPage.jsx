import React, { useState } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components';

/**
 * ManufacturingSchedulingLayout — shell rute BERSARANG untuk SOW Scheduling
 * (varian manufaktur). Menyediakan SATU <PageHeader> + <Outlet/> untuk sub-route.
 *
 * - Judul & eyebrow dibaca dari `handle` rute aktif (via useMatches) — sub-page
 *   TIDAK punya header sendiri.
 * - Back DETERMINISTIK (bukan riwayat browser):
 *     index ('/sow-scheduling')  -> SELALU '/operations-hub' (label "Operations Hub")
 *     sub-route                  -> SELALU kembali ke menu ('/sow-scheduling')
 *   goBackOrFallback TIDAK dipakai di sini: navigate(-1) di SPA hampir selalu
 *   kembali ke halaman sow-scheduling sebelumnya (mis. scheduling area), bukan
 *   ke operations hub — label tombol jadi bohong.
 * - Tombol back browser/hardware tetap mengikuti riwayat (perilaku bawaan SPA).
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
        onBack={isIndex ? () => navigate('/operations-hub') : () => navigate('/sow-scheduling')}
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
