import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FloorMapOverview from './FloorMapOverview';
import AreaDetailPanel from './AreaDetailPanel';
import { AREA_BY_CODE, buildAreaReservations, groupAreaProjects } from './constants';
import { BLASTING_AREA, LANE_A, LANE_B, buildSchedulesByBay } from './constants';

// Hanya area milik satu lane, supaya bisa melacak kartu mana yang muncul.
const LANE_A_AREA = LANE_A.find((item) => item.type === 'area').areaCode;
const LANE_B_AREA = LANE_B.find((item) => item.type === 'area').areaCode;

const RESERVATION = {
  // AR-1: AR-2 di satu bay & zona = overlap; AR-3 di zona lain bay yang sama.
  'AR-1': {
    schedule_id: 1, schedule_group_id: 'g1', booking_type: 'ORDER', order_no: 'PO-77',
    project_name: 'MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7',
    area_code: LANE_A_AREA, bay_codes: [`${firstBay(LANE_A_AREA)}E`],
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'ACTIVE',
  },
  'AR-2': {
    schedule_id: 2, schedule_group_id: 'g2', booking_type: 'ORDER', order_no: 'PO-88',
    project_name: 'MPS - JOB INTERDIVE-2026',
    area_code: LANE_A_AREA, bay_codes: [`${firstBay(LANE_A_AREA)}E`],
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'ACTIVE',
  },
  'AR-3': {
    schedule_id: 3, schedule_group_id: 'g3', booking_type: 'ORDER', order_no: 'PO-99',
    project_name: 'MPS - JOB INTERDIVE-2026',
    area_code: LANE_A_AREA, bay_codes: [`${firstBay(LANE_A_AREA)}C`],
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'ACTIVE',
  },
  'BR-1': {
    schedule_id: 4, schedule_group_id: 'g4', booking_type: 'ORDER', order_no: 'PO-11',
    project_name: 'WDJ - 2x CRANE TRUCK PK41002EHC-rev4',
    area_code: LANE_B_AREA, bay_codes: [`${firstBay(LANE_B_AREA)}E`],
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'ACTIVE',
  },
  'BP-1': {
    schedule_id: 5, schedule_group_id: 'g5', booking_type: 'ORDER', order_no: 'PO-22',
    project_name: 'MPS - 21 Units ISO TANK - ORICA - (PO 02.04.26)',
    area_code: BLASTING_AREA.areaCode, bay_codes: ['PT1'],
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'ACTIVE',
  },
};

// Kode bay pertama sebuah area, tanpa sufiks zona ('A38E' -> 'A38').
function firstBay(areaCode) {
  const area = [...LANE_A, ...LANE_B, BLASTING_AREA]
    .find((item) => item.type === 'area' && item.areaCode === areaCode);
  return area.bays[0];
}

function renderFloor(overrides = {}) {
  const schedulesByBay = buildSchedulesByBay(Object.values(RESERVATION), '2026-06-15');
  const props = {
    schedulesByBay,
    cursorDate: '2026-06-15',
    selectedAreaCode: null,
    onSelectArea: vi.fn(),
    orderFilter: '',
    onClearFilter: vi.fn(),
    ...overrides,
  };
  const view = render(<FloorMapOverview {...props} />);
  return { ...view, props };
}

const tabs = () => screen.getAllByRole('tab');

describe('FloorMapOverview — tab lane otoritatif', () => {
  it('menampilkan tiga tab dengan lane yang benar terpilih', () => {
    renderFloor();
    const labels = tabs().map((t) => t.textContent);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain('Lane A');
    expect(labels[1]).toContain('Lane B');
    expect(labels[2]).toContain('Blasting/Painting');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('mengganti pane saat tab diklik (bukan hanya mengubah gaya tombol)', () => {
    const { container } = renderFloor();
    const frame = container.querySelector('.floor-frame');
    expect(frame).toHaveAttribute('data-lane', 'A');

    fireEvent.click(tabs()[1]);
    expect(frame).toHaveAttribute('data-lane', 'B');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(tabs()[2]);
    expect(frame).toHaveAttribute('data-lane', 'BP');
    // Pane Blasting/Painting harus ada isinya, bukan layar kosong.
    const bpPane = container.querySelector('.floor-pane[data-pane="BP"]');
    expect(within(bpPane).getByText('PT1')).toBeInTheDocument();
  });

  it('mengikuti area terpilih walau tab belum diklik (buka dari URL)', () => {
    const { container } = renderFloor({ selectedAreaCode: LANE_B_AREA });
    expect(container.querySelector('.floor-frame')).toHaveAttribute('data-lane', 'B');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('membuka tab Blasting/Painting saat AREA-18 terpilih', () => {
    const { container } = renderFloor({ selectedAreaCode: BLASTING_AREA.areaCode });
    expect(container.querySelector('.floor-frame')).toHaveAttribute('data-lane', 'BP');
    expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('memilih area lewat klik kartu dan lewat keyboard', () => {
    const { props, container } = renderFloor();
    const card = container.querySelector(`[data-area="${LANE_A_AREA}"]`);

    fireEvent.click(card);
    expect(props.onSelectArea).toHaveBeenCalledWith(LANE_A_AREA);

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(props.onSelectArea).toHaveBeenCalledTimes(2);
  });
});

describe('FloorMapOverview — pencarian tidak menghapus okupansi', () => {
  // Invariant inti: jumlah kartu, sel zona, sel terpakai, dan sel overlap HARUS
  // identik sebelum dan sesudah pencarian. Pencarian hanya menambah peredupan.
  function zoneSnapshot(container) {
    return {
      cards: container.querySelectorAll('[data-area]').length,
      cells: container.querySelectorAll('.zone-cell').length,
      used: container.querySelectorAll('.zone-cell:not(.is-empty)').length,
      over: container.querySelectorAll('.zone-cell[data-over="true"]').length,
      dimmed: container.querySelectorAll('[data-dimmed="true"]').length,
    };
  }

  it('tidak mengubah okupansi saat filter tidak cocok sama sekali', () => {
    const plain = renderFloor();
    const before = zoneSnapshot(plain.container);
    plain.unmount();

    const filtered = renderFloor({ orderFilter: 'zzz-tidak-ada' });
    const after = zoneSnapshot(filtered.container);

    expect(before.cards).toBeGreaterThan(0);
    expect(before.cells).toBeGreaterThan(0);
    expect(after).toEqual({ ...before, dimmed: before.cards });
  });

  it('meredupkan kartu tanpa hasil, bukan menyembunyikannya', () => {
    const { container } = renderFloor({ orderFilter: 'zzz-tidak-ada' });
    const dimmed = container.querySelectorAll('[data-dimmed="true"]');
    expect(dimmed.length).toBeGreaterThan(0);
    dimmed.forEach((node) => expect(node).toBeVisible());
    // Tidak ada kartu yang hilang dari DOM.
    expect(container.querySelector(`[data-area="${LANE_A_AREA}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-area="${LANE_B_AREA}"]`)).toBeInTheDocument();
  });

  it('menandai kartu yang cocok dan menyebut okupansi tidak berubah', () => {
    const { container } = renderFloor({ orderFilter: 'ORICA' });
    const card = container.querySelector(`[data-area="${BLASTING_AREA.areaCode}"]`);
    expect(card.closest('[data-dimmed]')).toBeNull();
    expect(screen.getByTestId('floor-filter-note').textContent).toContain('Search never changes map occupancy');
  });

  it('mencari lewat nomor order walau order tidak tampil di kartu', () => {
    const { container } = renderFloor({ orderFilter: 'PO-11' });
    const card = container.querySelector(`[data-area="${LANE_B_AREA}"]`);
    expect(card.closest('[data-dimmed]')).toBeNull();
  });

  it('meneruskan aksi hapus filter', () => {
    const { props } = renderFloor({ orderFilter: 'ORICA' });
    fireEvent.click(screen.getByText('Clear filter'));
    expect(props.onClearFilter).toHaveBeenCalled();
  });
});

describe('FloorMapOverview — peta zona & overlap', () => {
  it('memisahkan zona EDGE dan CENTER pada bay yang sama', () => {
    const { container } = renderFloor();
    const card = container.querySelector(`[data-area="${LANE_A_AREA}"]`);
    const bay = firstBay(LANE_A_AREA);

    const edge = card.querySelector(`[data-bay="${bay}"] [data-zone="EDGE"]`);
    const center = card.querySelector(`[data-bay="${bay}"] [data-zone="CENTER"]`);
    expect(edge).toHaveAttribute('data-over', 'true');   // AR-1 + AR-2
    expect(center).not.toHaveAttribute('data-over');     // hanya AR-3
    // Jumlah overlap TIDAK di sel (sel terlalu pendek, angkanya jatuh ke 8px);
    // jumlahnya dibawa badge amber di bawah peta dan tetap terbaca sebagai teks.
    expect(edge).toHaveTextContent('E');
    expect(within(card).getByText(/× \d+ reservations/)).toBeInTheDocument();
  });

  it('mempertahankan zona kosong supaya peta tidak menyusut', () => {
    const { container } = renderFloor();
    const card = container.querySelector(`[data-area="${LANE_A_AREA}"]`);
    expect(card.querySelectorAll('.zone-cell.is-empty').length).toBeGreaterThan(0);
  });

  it('membaca overlap lewat teks, bukan warna saja', () => {
    const { container } = renderFloor();
    const card = container.querySelector(`[data-area="${LANE_A_AREA}"]`);
    expect(within(card).getByText(/Overlap \d+ zones? × \d+ reservations/)).toBeInTheDocument();
    expect(card.querySelector('[data-over="true"]')).toBeInTheDocument();
  });

  it('menampilkan project dengan jumlah order, bukan nomor order', () => {
    const { container } = renderFloor();
    const card = container.querySelector(`[data-area="${LANE_A_AREA}"]`);
    expect(within(card).getByText(/JOB INTERDIVE-2026/)).toBeInTheDocument();
    expect(within(card).queryByText('PO-88')).toBeNull();
  });
});

describe('FloorMapOverview — panel detail terdok', () => {
  it('menaruh panel detail di dalam grid lantai saat dikirim', () => {
    const { container } = renderFloor({ detailPanel: <p>Panel detail</p> });
    const pane = container.querySelector('.floor-detail-pane');
    expect(pane).toBeInTheDocument();
    expect(within(pane).getByText('Panel detail')).toBeInTheDocument();
    // Pane detail TIDAK boleh memakai .floor-pane: kelas itu dimatikan di ≤1180.
    expect(pane.classList.contains('floor-pane')).toBe(false);
    expect(container.querySelector('.floor-grid')).toHaveAttribute('data-detail', 'docked');
  });

  it('tidak merender pane detail kalau tidak ada panel', () => {
    const { container } = renderFloor();
    expect(container.querySelector('.floor-detail-pane')).toBeNull();
    expect(container.querySelector('.floor-grid')).toHaveAttribute('data-detail', 'none');
  });
});

describe('FloorMapOverview — Blasting & Painting vertikal (PLAN §4.3, Tahap 3)', () => {
  const bpPane = (container) => container.querySelector('.floor-pane[data-pane="BP"]');

  it('mengelompokkan slot: Painting dulu, lalu Blasting', () => {
    const { container } = renderFloor();
    const headers = [...bpPane(container).querySelectorAll('.bp-group')];
    expect(headers.map((h) => h.textContent)).toEqual(['Painting', 'Blasting']);
  });

  it('merender SEMUA bay AREA-18, tidak ada yang hilang saat dikelompokkan', () => {
    const { container } = renderFloor();
    const rendered = [...bpPane(container).querySelectorAll('.slot-row')]
      .map((row) => row.getAttribute('data-bay'));
    expect(rendered).toEqual(['PT1', 'PT2', 'PT3', 'BL1', 'BL2']);
  });

  it('memberi pita warna project pada slot terpakai, bukan pada slot kosong', () => {
    const { container } = renderFloor();
    const used = bpPane(container).querySelector('[data-bay="PT1"] .slot-code');
    const empty = bpPane(container).querySelector('[data-bay="BL2"] .slot-code');
    // PT1 dipakai BP-1 (lihat RESERVATION) -> punya warna project di --pc.
    expect(used.style.getPropertyValue('--pc')).not.toBe('');
    expect(empty.style.getPropertyValue('--pc')).toBe('');
  });

  it('menandai slot kosong lewat kelas, bukan hanya warna latar', () => {
    const { container } = renderFloor();
    expect(bpPane(container).querySelector('[data-bay="BL2"]')).toHaveClass('is-empty');
    expect(bpPane(container).querySelector('[data-bay="PT1"]')).not.toHaveClass('is-empty');
  });
});


describe('AreaDetailPanel — panel detail area/zona (PLAN §4.4, Tahap 5)', () => {
  const AREA = AREA_BY_CODE[LANE_A_AREA];

  function renderPanel(overrides = {}) {
    const byBay = buildSchedulesByBay(Object.values(RESERVATION), '2026-06-15');
    const groups = groupAreaProjects(buildAreaReservations(byBay, AREA));
    const props = {
      area: AREA,
      groups,
      cursorDate: '2026-06-15',
      selection: null,
      onClose: vi.fn(),
      onManage: vi.fn(),
      ...overrides,
    };
    return { ...render(<AreaDetailPanel {...props} />), props };
  }

  it('menampilkan SEMUA reservasi pada zona overlap, bukan hanya yang pertama', () => {
    const bay = firstBay(LANE_A_AREA);
    const { container } = renderPanel({ selection: { bay, zone: 'EDGE' } });
    // AR-1 dan AR-2 sama-sama di zona EDGE bay itu.
    expect(container.querySelectorAll('.detail-row')).toHaveLength(2);
  });

  it('memisahkan zona: CENTER tidak membawa reservasi EDGE', () => {
    const bay = firstBay(LANE_A_AREA);
    const { container } = renderPanel({ selection: { bay, zone: 'CENTER' } });
    expect(container.querySelectorAll('.detail-row')).toHaveLength(1);
  });

  it('NON-MODAL: tidak memasang scrim maupun role=dialog (PLAN §9 butir 16)', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
    // Body tidak boleh dikunci — peta harus tetap bisa di-scroll.
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('meneruskan konteks area+zona ke Kelola reservasi (PLAN §9 butir 14)', () => {
    const bay = firstBay(LANE_A_AREA);
    const { props } = renderPanel({ selection: { bay, zone: 'EDGE' } });
    fireEvent.click(screen.getByText('Manage reservations'));
    expect(props.onManage).toHaveBeenCalledWith({
      areaCode: LANE_A_AREA, bay, zone: 'EDGE',
    });
  });

  it('menutup lewat tombol dan lewat Escape', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByLabelText('Close detail panel'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('membaca overlap lewat jumlah, bukan warna saja', () => {
    renderPanel();
    expect(screen.getByText(/Overlap \d+ zones? × \d+ reservations/)).toBeInTheDocument();
  });

  it('menyatakan kosong dengan jujur saat zona tidak ada reservasi', () => {
    const emptyBay = AREA.bays[AREA.bays.length - 1];
    const { container } = renderPanel({ selection: { bay: emptyBay, zone: 'EDGE' } });
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0);
    expect(screen.getByText(/No reservations/)).toBeInTheDocument();
  });
});

describe('FloorMapOverview — sel zona membuka panel dengan konteks', () => {
  it('mengirim bay dan zona saat sel zona diklik', () => {
    const onSelectZone = vi.fn();
    const { container } = renderFloor({ onSelectZone });
    const bay = firstBay(LANE_A_AREA);
    const cell = container.querySelector(`[data-area="${LANE_A_AREA}"] [data-bay="${bay}"] [data-zone="EDGE"]`);

    fireEvent.click(cell);
    expect(onSelectZone).toHaveBeenCalledWith(LANE_A_AREA, { bay, zone: 'EDGE' });
  });

  it('slot Blasting/Painting mengirim bay tanpa zona (bay tidak dibagi zona)', () => {
    const onSelectZone = vi.fn();
    const { container } = renderFloor({ onSelectZone });
    const slot = container.querySelector('[data-pane="BP"] [data-bay="PT1"]');

    fireEvent.click(slot);
    expect(onSelectZone).toHaveBeenCalledWith(BLASTING_AREA.areaCode, { bay: 'PT1', zone: null });
  });

  it('klik sel zona TIDAK ikut memicu pemilihan area (event tidak menggelembung)', () => {
    const onSelectArea = vi.fn();
    const onSelectZone = vi.fn();
    const { container } = renderFloor({ onSelectArea, onSelectZone });
    const bay = firstBay(LANE_A_AREA);
    const cell = container.querySelector(`[data-area="${LANE_A_AREA}"] [data-bay="${bay}"] [data-zone="EDGE"]`);

    fireEvent.click(cell);
    expect(onSelectZone).toHaveBeenCalled();
    expect(onSelectArea).not.toHaveBeenCalled();
  });
});
