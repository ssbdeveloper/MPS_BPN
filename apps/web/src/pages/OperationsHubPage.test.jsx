import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}));

// Panel berat yang tidak ada hubungannya dengan kartu KPI: EwsControlTower membuka
// EventSource (tidak ada di jsdom) dan chart recharts mahal dirender. Di-stub supaya tes
// ini benar-benar menguji kartu Order Health, bukan seluruh dashboard.
vi.mock('../components/ews/EwsControlTower', () => ({ default: () => <div data-testid="ews-stub" /> }));

/**
 * Kartu Order Health menggantikan Machine Productive (2026-09-16, keputusan owner 2a/3a/4c).
 * Yang dijaga tes ini:
 *   - angka besar = project Critical, chip = at risk / on track,
 *   - deep-link ke /order-progress-dashboard?health=red saat diklik,
 *   - plant tanpa data project (mis. varian salvaging tanpa MS Project) TIDAK merusak halaman
 *     dan kartunya tidak bisa diklik.
 */
const hubPayload = {
  data: {
    kpi: {
      total_orders: 10, active_orders: 6, teco_orders: 4, ongoing_orders: 5, not_started_orders: 1,
      validation_pending: 0, validation_total: 0, machine_productive_pct: 70, avg_progress: 40,
    },
    basis_dates: { machine_date: null, labor_date: null },
    machine_trend: [], machine_status: [], progress_status: [], sap_posting: {},
    labor_by_workcenter: [], top_operators: [],
  },
};

function mockFetch(healthResponse) {
  return vi.fn((url) => {
    if (String(url).includes('manufacturing-order-progress')) return Promise.resolve(healthResponse());
    if (String(url).includes('/ews/tts/playlist')) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    return Promise.resolve({ ok: true, json: async () => hubPayload });
  });
}

let OperationsHubPage;

beforeEach(async () => {
  sessionStorage.setItem('isVerified', 'true');
  navigate.mockClear();
  ({ default: OperationsHubPage } = await import('./OperationsHubPage'));
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Operations Hub — kartu Order Health', () => {
  it('menampilkan project critical dan deep-link ke daftar yang bermasalah', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      ok: true,
      json: async () => ({ summary: { red: 4, yellow: 3, green: 12, unknown: 1 }, pagination: { total_projects: 20 } }),
    })));
    render(<MemoryRouter><OperationsHubPage /></MemoryRouter>);

    const card = await screen.findByRole('button', { name: /order health/i });
    await waitFor(() => expect(card).toHaveTextContent('dari 20 project aktif'));
    expect(card).toHaveTextContent('at risk');
    expect(card).toHaveTextContent('on track');
    expect(screen.queryByText(/Machine Productive/i)).not.toBeInTheDocument();

    card.click();
    expect(navigate).toHaveBeenCalledWith('/order-progress-dashboard?health=red');
  });

  it('tetap aman di plant tanpa data project dan tidak bisa diklik', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      ok: true,
      json: async () => ({ summary: { red: 0, yellow: 0, green: 0, unknown: 0 }, pagination: { total_projects: 0 } }),
    })));
    render(<MemoryRouter><OperationsHubPage /></MemoryRouter>);

    await screen.findByText('Order Health');
    await waitFor(() => expect(screen.getByText(/dari 0 project aktif/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /order health/i })).not.toBeInTheDocument();
  });

  it('memberi keterangan jelas ketika endpoint health gagal', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ ok: false, json: async () => ({}) })));
    render(<MemoryRouter><OperationsHubPage /></MemoryRouter>);

    await screen.findByText('Order Health');
    await waitFor(() => expect(screen.getByText('Data belum tersedia')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /order health/i })).not.toBeInTheDocument();
  });
});
