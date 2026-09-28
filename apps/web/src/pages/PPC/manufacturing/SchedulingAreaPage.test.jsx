import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AREA_BY_CODE } from '../../../features/bayScheduling/constants';
import SchedulingAreaPage from './SchedulingAreaPage';

// Batas yang di-mock hanya jaringan (service) dan toast. Hook useBaySchedules dan logika
// halaman berjalan asli, karena yang diuji justru interaksi `loading`/`readComplete`.
const service = vi.hoisted(() => ({
  pages: [],
  fetchBaySchedulesPage: null,
  createBaySchedule: null,
}));

vi.mock('../../../services/msProjectService', () => ({
  fetchBaySchedulesPage: (...args) => service.fetchBaySchedulesPage(...args),
  createBaySchedule: (...args) => service.createBaySchedule(...args),
  fetchSowOrdersPage: () => Promise.resolve({ rows: [], total: 0, limit: 0, offset: 0, counts: {} }),
  fetchAllBaySchedules: () => Promise.resolve({ rows: [], readComplete: true, pages: 1 }),
  fetchBayOccupants: () => Promise.resolve({ occupants: [] }),
  fetchBayScheduleConflicts: () => Promise.resolve([]),
  fetchOrderTasks: () => Promise.resolve([]),
  updateOperationPeople: () => Promise.resolve({}),
  cancelBaySchedule: () => Promise.resolve({}),
  cancelBayScheduleGroup: () => Promise.resolve({}),
  updateBayScheduleGroup: () => Promise.resolve({}),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

// Panel reservasi asli punya belasan fetch sendiri. Yang diuji di sini adalah apa yang terjadi
// SESUDAH simpan sukses, jadi panel diganti tombol yang langsung mengirim payload non-job.
vi.mock('../../../features/bayScheduling', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ReservationPanel: ({ open, bayCode, area, onSubmit }) => (open ? (
      <button
        type="button"
        onClick={() => onSubmit({
          area_code: area.areaCode,
          area_name: area.areaName,
          bay_codes: [bayCode],
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          booking_type: 'PARKING',
          purpose: 'unit parked',
        })}
      >
        Submit stub reservation
      </button>
    ) : null),
  };
});

const AREA = AREA_BY_CODE['AREA-01'];
const BAY_OLD = `${AREA.bays[0]}E`;
const BAY_NEW = `${AREA.bays[1]}E`;

function row(id, order, bay) {
  return {
    schedule_id: id,
    schedule_group_id: `g-${id}`,
    booking_type: 'ORDER',
    order_no: order,
    project_name: `Project ${order}`,
    area_code: AREA.areaCode,
    bay_codes: [bay],
    start_date: '2000-01-01',
    end_date: '2099-12-31',
    status: 'ACTIVE',
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Setiap panggilan fetch menjadi satu janji yang dikendalikan test. Abort ditolak sebagai
// AbortError, sama seperti Fetch API asli.
function queueFetch() {
  service.pages = [];
  service.fetchBaySchedulesPage = vi.fn((params, { signal } = {}) => {
    const call = deferred();
    signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      call.reject(err);
    });
    service.pages.push(call);
    return call.promise;
  });
}

const page = (rows, extra = {}) => ({ rows, hasMore: false, nextCursor: null, readComplete: true, ...extra });

async function settle(index, value) {
  await act(async () => {
    service.pages[index].resolve(value);
  });
}

function Shell() {
  const [headerRight, setHeaderRight] = useState(null);
  return (
    <>
      <div data-testid="header">{headerRight}</div>
      <Outlet context={{ setHeaderRight }} />
    </>
  );
}

function renderPage(url = '/area') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/area" element={<SchedulingAreaPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const TRUNCATED = /Peta belum terbaca lengkap/;
const REFRESHING = /Refreshing map/;

beforeEach(() => {
  queueFetch();
  service.createBaySchedule = vi.fn(() => Promise.resolve({ warnings: [] }));
});

describe('SchedulingAreaPage — reload setelah simpan (level area)', () => {
  it('initial load menampilkan skeleton, bukan warning pembacaan terpotong', async () => {
    renderPage('/area?area=AREA-01');
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();

    await settle(0, page([row(1, 'PO-OLD', BAY_OLD)]));
    expect(screen.getByRole('button', { name: /Order PO-OLD/ })).toBeInTheDocument();
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
  });

  it('save sukses -> refresh tertunda tanpa error palsu -> data baru tampil', async () => {
    renderPage('/area?area=AREA-01');
    await settle(0, page([row(1, 'PO-OLD', BAY_OLD)]));

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Bay ${BAY_OLD}`) }));
    fireEvent.click(screen.getByRole('button', { name: /Non-job booking/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit stub reservation' }));
    });

    expect(service.createBaySchedule).toHaveBeenCalledTimes(1);
    expect(service.fetchBaySchedulesPage).toHaveBeenCalledTimes(2);

    // Selama reload: tidak ada warning merah, data lama tetap tampil, status netral terlihat,
    // dan sel kosong TIDAK diklaim bebas.
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(REFRESHING);
    expect(screen.getByRole('button', { name: /Order PO-OLD/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`Bay ${BAY_NEW}, occupancy not loaded`) }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`Bay ${BAY_NEW}, free`) })).not.toBeInTheDocument();

    await settle(1, page([row(1, 'PO-OLD', BAY_OLD), row(2, 'PO-NEW', BAY_NEW)]));

    expect(screen.getByRole('button', { name: /Order PO-NEW/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
  });

  it('pembacaan selesai tetapi terpotong tetap memunculkan warning + retry', async () => {
    renderPage('/area?area=AREA-01');
    // Server menandai masih ada lanjutan tetapi tidak memberi cursor: rangkaian berhenti
    // dengan hasMore=true, jadi kelengkapan tidak terbukti.
    await settle(0, page([row(1, 'PO-OLD', BAY_OLD)], { hasMore: true, nextCursor: null }));

    expect(screen.getByText(TRUNCATED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

    // Retry sedang berjalan: warning disembunyikan, bukan diganti klaim lengkap.
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(REFRESHING);

    await settle(1, page([row(1, 'PO-OLD', BAY_OLD)]));
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`Bay ${BAY_NEW}, free`) })).toBeInTheDocument();
  });

  it('error request nyata tampil inline dan retry memulihkan peta', async () => {
    renderPage('/area?area=AREA-01');
    await act(async () => {
      service.pages[0].reject(new Error('Gateway timeout'));
    });

    expect(screen.getByText('Gateway timeout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(screen.queryByText('Gateway timeout')).not.toBeInTheDocument();

    await settle(1, page([row(1, 'PO-OLD', BAY_OLD)]));
    expect(screen.getByRole('button', { name: /Order PO-OLD/ })).toBeInTheDocument();
  });

  it('request yang dibatalkan oleh refresh baru tidak menjadi error', async () => {
    renderPage('/area?area=AREA-01');
    await settle(0, page([row(1, 'PO-OLD', BAY_OLD)]));

    const refresh = within(screen.getByTestId('header')).getByRole('button', { name: /Refresh/ });
    await act(async () => { fireEvent.click(refresh); });
    await act(async () => { fireEvent.click(refresh); });

    // Request #1 (reload pertama) dibatalkan oleh reload kedua.
    expect(service.fetchBaySchedulesPage).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('aborted')).not.toBeInTheDocument();
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();

    await settle(2, page([row(2, 'PO-NEW', BAY_NEW)]));
    expect(screen.getByRole('button', { name: /Order PO-NEW/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('SchedulingAreaPage — reload di peta overview + panel detail', () => {
  it('panel detail tetap terbuka tanpa error selama reload, lalu memuat data baru', async () => {
    const { container } = renderPage('/area');
    await settle(0, page([row(1, 'PO-OLD', BAY_OLD)]));

    fireEvent.click(container.querySelector(`[data-area="${AREA.areaCode}"]`));
    const panel = screen.getByRole('complementary', { name: `Detail ${AREA.areaName}` });
    expect(panel).toHaveTextContent('Project PO-OLD');

    const refresh = within(screen.getByTestId('header')).getByRole('button', { name: /Refresh/ });
    await act(async () => { fireEvent.click(refresh); });

    expect(screen.getByRole('status')).toHaveTextContent(REFRESHING);
    expect(screen.queryByText(TRUNCATED)).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: `Detail ${AREA.areaName}` })).toHaveTextContent('Project PO-OLD');

    await settle(1, page([row(1, 'PO-OLD', BAY_OLD), row(2, 'PO-NEW', BAY_NEW)]));
    expect(screen.getByRole('complementary', { name: `Detail ${AREA.areaName}` })).toHaveTextContent('Project PO-NEW');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
