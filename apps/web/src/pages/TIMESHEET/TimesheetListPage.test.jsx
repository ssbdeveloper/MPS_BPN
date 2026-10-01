import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import TimesheetListPage from './TimesheetListPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Two concurrently running rows: same operator, same order, same operation,
// different workcenter (A = MILL-01 / ts 101, B = LATHE-02 / ts 102).
const badge = (ts) => `#${ts}`;
const runningRow = (tsnumber, workcentercode, workcenterdescription) => ({
  tsnumber,
  serialnumber: 'EMP-01',
  order_no: '100450',
  operation_no: 10,
  operation_text: 'Milling Op 10',
  workcentercode,
  workcenterdescription,
  date_checkin: '01/10/2026',
  hour_checkin: '08:00',
  hour_checkout: null,
  longdate_checkin: '2026-10-01T01:00:00Z',
});

const ROW_A = runningRow(101, 'MILL-01', 'Milling Station 1');
const ROW_B = runningRow(102, 'LATHE-02', 'Lathe Machine 2');

const jsonResponse = (body, { ok = true, status = 200 } = {}) =>
  Promise.resolve({ ok, status, json: async () => body });

const isList = (url) => String(url).includes('/timesheet/getsn/');
const isCheckoutId = (url, opts) => opts?.method === 'PUT' && String(url).endsWith('/timesheet/checkoutid/');
const callsOf = (pred) => globalThis.fetch.mock.calls.filter(([url, opts]) => pred(url, opts));

function setSession(workcenter) {
  sessionStorage.setItem(
    'datakaryawan',
    JSON.stringify({ snssb: 'EMP-01', full_name: 'Operator 1', workcenter, mode: 'multiple' }),
  );
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <TimesheetListPage />
    </MemoryRouter>,
  );

const rowFor = (tsLabel) => screen.getByText(tsLabel).closest('tr');

describe('TimesheetListPage - cross-workcenter rows and per-TS stop', () => {
  let rows;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    setSession('MILL-01');
    rows = [ROW_A, ROW_B];
    globalThis.fetch = vi.fn((url) => {
      if (isList(url)) return jsonResponse(rows);
      return jsonResponse({ ok: true });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows both running rows for the same order/operation with their own TS number and workcenter', async () => {
    renderPage();
    await screen.findByText(badge(101));

    const rowA = rowFor(badge(101));
    const rowB = rowFor(badge(102));
    expect(rowA).not.toBe(rowB);
    expect(within(rowA).getByText('100450')).toBeInTheDocument();
    expect(within(rowA).getByText('MILL-01')).toBeInTheDocument();
    expect(within(rowA).getByText('Milling Station 1')).toBeInTheDocument();
    expect(within(rowB).getByText('100450')).toBeInTheDocument();
    expect(within(rowB).getByText('LATHE-02')).toBeInTheDocument();
    expect(within(rowB).getByText('Lathe Machine 2')).toBeInTheDocument();
    expect(within(rowA).getByTitle('Stop')).toBeEnabled();
    expect(within(rowB).getByTitle('Stop')).toBeEnabled();
    expect(callsOf(isList)[0][0]).toContain('/timesheet/getsn/EMP-01');
  });

  it('Stop A closes only tsnumber 101 even after the session workcenter changed to B', async () => {
    renderPage();
    await screen.findByText(badge(101));
    // Operator re-selected workcenter B in the session after A was started.
    setSession('LATHE-02');

    await userEvent.click(within(rowFor(badge(101))).getByTitle('Stop'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Timesheet ${badge(101)} berhasil di-stop`));
    const stops = callsOf(isCheckoutId);
    expect(stops).toHaveLength(1);
    expect(JSON.parse(stops[0][1].body)).toEqual({ tsnumber: 101 });
    // The Stop All endpoint must never be used by the per-row stop.
    expect(callsOf((url) => String(url).endsWith('/timesheet/checkout'))).toHaveLength(0);
    // The list is reloaded after a successful stop.
    await waitFor(() => expect(callsOf(isList)).toHaveLength(2));
  });

  it('ignores a double click on Stop while the checkout is pending', async () => {
    let release;
    globalThis.fetch = vi.fn((url, opts) => {
      if (isList(url)) return jsonResponse(rows);
      if (isCheckoutId(url, opts)) {
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        });
      }
      return jsonResponse({});
    });

    renderPage();
    await screen.findByText(badge(101));
    const stopA = within(rowFor(badge(101))).getByTitle('Stop');

    await userEvent.click(stopA);
    expect(stopA).toBeDisabled();
    await userEvent.click(stopA);
    await userEvent.dblClick(stopA);
    expect(callsOf(isCheckoutId)).toHaveLength(1);
    // Row B stays actionable while A is pending.
    expect(within(rowFor(badge(102))).getByTitle('Stop')).toBeEnabled();

    await act(async () => release());
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(callsOf(isCheckoutId)).toHaveLength(1);
  });

  it('reports a failed checkout, keeps the row running and re-enables Stop', async () => {
    globalThis.fetch = vi.fn((url, opts) => {
      if (isList(url)) return jsonResponse(rows);
      if (isCheckoutId(url, opts)) return jsonResponse({ error: 'Timesheet sudah frozen' }, { ok: false, status: 409 });
      return jsonResponse({});
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPage();
    await screen.findByText(badge(101));
    const stopA = within(rowFor(badge(101))).getByTitle('Stop');
    await userEvent.click(stopA);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Gagal stop timesheet', { description: 'Timesheet sudah frozen' }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(stopA).toBeEnabled());
    // No reload after a failure: still only the initial list fetch.
    expect(callsOf(isList)).toHaveLength(1);
    expect(screen.getByText(badge(101))).toBeInTheDocument();
  });

  it('reaches the Stop button of row A by keyboard and activates it with Enter', async () => {
    renderPage();
    await screen.findByText(badge(101));
    const user = userEvent.setup();
    const stopA = within(rowFor(badge(101))).getByTitle('Stop');

    let reached = false;
    for (let i = 0; i < 10 && !reached; i += 1) {
      await user.tab();
      reached = document.activeElement === stopA;
    }
    expect(reached).toBe(true);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(callsOf(isCheckoutId)).toHaveLength(1));
    expect(JSON.parse(callsOf(isCheckoutId)[0][1].body)).toEqual({ tsnumber: 101 });
  });
});
