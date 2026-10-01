import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import ManufacturingMainMenu from './manufacturing/TimesheetMainMenuPage';
import SalvagingMainMenu from './salvaging/TimesheetMainMenuPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const jsonResponse = (body, { ok = true, status = 200 } = {}) =>
  Promise.resolve({ ok, status, json: async () => body });

const isStopAll = (url, opts) => opts?.method === 'PUT' && String(url).endsWith('/timesheet/checkout');
const isCreate = (url, opts) => opts?.method === 'POST' && String(url).endsWith('/timesheet/');
const callsOf = (pred) => globalThis.fetch.mock.calls.filter(([url, opts]) => pred(url, opts));

const DUP_MSG = 'Operasi produktif ini sedang aktif untuk operator tersebut pada workcenter MILL-01';

function setSession({ mode = 'single', workcenter = 'MILL-01' } = {}) {
  sessionStorage.setItem(
    'datakaryawan',
    JSON.stringify({ snssb: 'EMP-01', full_name: 'Operator 1', workcenter, machinename: 'Milling 1', mode }),
  );
  sessionStorage.setItem(
    'selectedactivity',
    JSON.stringify({
      order: '100450',
      order_no: '100450',
      operation_no: '10',
      operationtext: 'Milling Op 10',
      part_name: 'Shaft 01',
      ssbr_id: 'SSBR-01',
    }),
  );
}

const VARIANTS = [
  {
    name: 'Manufacturing',
    Component: ManufacturingMainMenu,
    successToast: 'Timesheet berhasil dibuat!',
    getCheckIn: () => screen.getByRole('button', { name: /^check in/i }),
    getPending: () => [screen.getByRole('button', { name: /^checking in/i })],
  },
  {
    name: 'Salvaging',
    Component: SalvagingMainMenu,
    successToast: 'TIMESHEET berhasil dibuat!',
    // Salvaging renders a portrait and a landscape menu; both share one handler.
    getCheckIn: () => screen.getAllByRole('button', { name: /^start$/i })[0],
    // Label change remounts the menu buttons (key={label}), so re-query both layouts.
    getPending: () => screen.getAllByRole('button', { name: /^starting/i }),
  },
];

describe.each(VARIANTS)('$name TimesheetMainMenuPage check-in', (variant) => {
  const { Component, successToast, getCheckIn, getPending } = variant;
  const renderPage = () =>
    render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('multiple mode: creates directly without Stop All and sends the session workcenter', async () => {
    setSession({ mode: 'multiple', workcenter: 'LATHE-02' });
    globalThis.fetch = vi.fn(() => jsonResponse({ tsnumber: 102 }));
    renderPage();

    await userEvent.click(getCheckIn());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(successToast));
    expect(callsOf(isStopAll)).toHaveLength(0);
    const creates = callsOf(isCreate);
    expect(creates).toHaveLength(1);
    expect(JSON.parse(creates[0][1].body)).toMatchObject({
      serialnumber: 'EMP-01',
      order_no: '100450',
      operation_no: '10',
      workcentercode: 'LATHE-02',
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('double tap while pending sends exactly one Stop All and one create', async () => {
    setSession({ mode: 'single' });
    let releaseCreate;
    globalThis.fetch = vi.fn((url, opts) => {
      if (isCreate(url, opts)) {
        return new Promise((resolve) => {
          releaseCreate = () => resolve({ ok: true, status: 201, json: async () => ({ tsnumber: 103 }) });
        });
      }
      return jsonResponse({ message: 'ok' });
    });
    renderPage();

    await userEvent.click(getCheckIn());
    await waitFor(() => expect(callsOf(isCreate)).toHaveLength(1));
    const pending = getPending();
    expect(pending.length).toBeGreaterThan(0);
    for (const b of pending) {
      expect(b).toBeDisabled();
      await userEvent.click(b);
      await userEvent.dblClick(b);
    }
    expect(callsOf(isStopAll)).toHaveLength(1);
    expect(callsOf(isCreate)).toHaveLength(1);

    await act(async () => releaseCreate());
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(callsOf(isCreate)).toHaveLength(1);
    expect(mockNavigate).toHaveBeenCalledWith('/login-timesheet');
    expect(getCheckIn()).toBeEnabled();
  });

  it('single mode: a non-404 Stop All failure halts create', async () => {
    setSession({ mode: 'single' });
    globalThis.fetch = vi.fn((url, opts) => {
      if (isStopAll(url, opts)) return jsonResponse({ error: 'DB connection failure' }, { ok: false, status: 500 });
      return jsonResponse({ tsnumber: 1 });
    });
    renderPage();
    const btn = getCheckIn();

    await userEvent.click(btn);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Gagal checkout aktivitas sebelumnya', {
        description: 'DB connection failure',
      }),
    );
    expect(callsOf(isCreate)).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(getCheckIn()).toBeEnabled());
  });

  it('single mode: a 404 with nothing active still proceeds to create', async () => {
    setSession({ mode: 'single' });
    globalThis.fetch = vi.fn((url, opts) => {
      if (isStopAll(url, opts)) {
        return jsonResponse({ error: 'Data tidak ditemukan atau sudah checkout' }, { ok: false, status: 404 });
      }
      return jsonResponse({ tsnumber: 104 });
    });
    renderPage();

    await userEvent.click(getCheckIn());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(successToast));
    expect(callsOf(isStopAll)).toHaveLength(1);
    expect(callsOf(isCreate)).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the backend 409 DUPLICATE_ACTIVE_OPERATION message and stays on the page', async () => {
    setSession({ mode: 'multiple' });
    globalThis.fetch = vi.fn((url, opts) => {
      if (isCreate(url, opts)) {
        return jsonResponse({ error: DUP_MSG, code: 'DUPLICATE_ACTIVE_OPERATION' }, { ok: false, status: 409 });
      }
      return jsonResponse({});
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    const btn = getCheckIn();

    await userEvent.click(btn);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Buat timesheet gagal', { description: DUP_MSG }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(getCheckIn()).toBeEnabled());
  });
});
