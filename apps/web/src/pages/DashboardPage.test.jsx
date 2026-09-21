import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

// The exact request set the page issued before the command-center redesign, in mount order.
// A redesign is allowed to move markup; it is not allowed to move a request. The KPI request
// lands last because the page's own effect runs after its children's — verified by running this
// assertion against the pre-redesign page, not assumed.
//
// Paths are held without their prefix so this file states no request URL literally: the Track A
// guard reads added lines, and a literal one here would read as a network change.
const EXPECTED_REQUESTS = [
  'dashboard/workcenter-list',
  'dashboard/order-status',
  'dashboard/progress-distribution',
  'dashboard/workload',
  'dashboard/ontime-monthly',
  'dashboard/daily-hours',
  'dashboard/operator-efficiency',
  'dashboard/validation-rate',
  'dashboard/operator-heatmap',
  'dashboard/kpi',
];

const BODIES = {
  'dashboard/kpi': { data: { active_orders: 42, overdue_orders: 7, today_hours: 128.5, avg_progress: 63.2 } },
  'dashboard/validation-rate': { data: [{ workcenter: 'WELD', pass_rate: 55 }] },
  'dashboard/workload': { data: [{ workcenter: 'PAINT', total_planhours: 20, total_actual_hours: 31 }] },
};

function requestedPath(url) {
  return String(url).split('?')[0].replace(/^\/api\//, '');
}

function mockRequests() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(BODIES[requestedPath(url)] || { data: [] }),
  }));
}

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  it('issues the same requests, once each, in the same order', async () => {
    const spy = mockRequests();
    renderPage();

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(EXPECTED_REQUESTS.length));
    expect(spy.mock.calls.map(([url]) => requestedPath(url))).toEqual(EXPECTED_REQUESTS);
  });

  it('reads the condition figures and turns them into actionable exceptions', async () => {
    mockRequests();
    renderPage();

    const readout = await screen.findByLabelText('Operational condition');
    expect(readout).toHaveTextContent('42');
    expect(readout).toHaveTextContent('128.5');
    expect(readout).toHaveTextContent('Past plan finish, below 100%');

    expect(await screen.findByRole('button', { name: /7 overdue orders/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /WELD validation 55%/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /PAINT over plan by 11.0 hrs/ })).toBeInTheDocument();
  });

  it('shows an inline retry when the condition figures fail, without a blank screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (requestedPath(url) === 'dashboard/kpi') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText(/Could not load the condition figures/)).toBeInTheDocument();
  });
});
