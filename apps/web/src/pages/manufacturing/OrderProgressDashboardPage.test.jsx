import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ManufacturingOrderProgressDashboardPage from './OrderProgressDashboardPage';

const payload = {
  data: [{
    project_id: 'p1',
    project_name: 'Project Red',
    plan_hours: 100,
    actual_hours: 40,
    target_progress_pct: 40,
    progress_pct: 30,
    consume_hours_pct: 40,
    eac_hours: 133.33,
    eac_variance_hours: 33.33,
    health: 'red',
    health_basis: 'WORST_CHILD',
    units: [{
      unit_key: 'no-unit',
      unit_name: 'No Unit',
      plan_hours: 100,
      actual_hours: 40,
      target_progress_pct: 40,
      progress_pct: 30,
      consume_hours_pct: 40,
      eac_hours: 133.33,
      eac_variance_hours: 33.33,
      health: 'red',
      operations: [{
        idsow: 21,
        order_no: '1000123456',
        operation_no: 120,
        operation_text: 'FINAL ASSEMBLY',
        workcenter: 'C5100FIT',
        plan_hours: 100,
        actual_hours: 40,
        target_progress_pct: 40,
        progress_pct: 30,
        consume_hours_pct: 40,
        health: 'red',
        health_gap_pct_point: 10,
        eac_hours: 133.33,
        eac_variance_hours: 33.33,
        latest_issue: 'Waiting material',
        latest_image_path: '/uploads/op.jpg',
        subtasks: [{
          id: 9,
          title: 'Fit bracket',
          standard_hours: 12,
          progress_pct: 25,
          status: 'IN_PROGRESS',
          latest_issue: 'Bracket mismatch',
          latest_image_path: '/uploads/sub.jpg',
          latest_update_at: '2026-09-14T02:00:00Z',
        }],
      }],
    }],
  }],
  pagination: { page: 1, limit: 20, total_projects: 1 },
  summary: { red: 1, yellow: 0, green: 0, unknown: 0 },
  meta: {
    actual_source: 'LOCAL_TIMESHEET_TEMPORARY',
    actual_is_posted: false,
    actual_note: 'Temporary local hours — may include records not yet posted to SAP',
  },
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function renderPage() {
  sessionStorage.setItem('isVerified', 'true');
  return render(<MemoryRouter><ManufacturingOrderProgressDashboardPage /></MemoryRouter>);
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('Manufacturing order progress dashboard', () => {
  it('loads the project outline and keeps SAP hours off sub-tasks', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse(payload));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Manufacturing Order Progress' })).toBeInTheDocument();
    expect(screen.queryByText(/Temporary local hours/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Project Red/ })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: /Project Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /No Unit/ }));
    const operation = screen.getByTestId('operation-21');
    expect(operation).toHaveTextContent('1000123456');
    expect(operation).toHaveTextContent('Op 120');
    expect(operation).toHaveTextContent('C5100FIT');
    expect(within(operation).getAllByText('Critical').length).toBeGreaterThan(0);

    fireEvent.click(within(operation).getByRole('button', { name: /tasks/ }));
    const subtask = screen.getByTestId('subtask-9');
    expect(within(subtask).getByText('Fit bracket')).toBeInTheDocument();
    expect(within(subtask).getByText('25%')).toBeInTheDocument();
    expect(within(subtask).queryByText(/Actual|EAC|Consume/)).not.toBeInTheDocument();
  });

  it('flags an operation whose hours grew while progress stood still', async () => {
    const stalled = structuredClone(payload);
    const operation = stalled.data[0].units[0].operations[0];
    operation.update_trend = {
      prev_update_at: '2026-09-11T02:00:00Z', prev_progress_pct: 40, prev_actual_hours: 70, prev_eac_hours: 175,
      last_update_at: '2026-09-14T02:00:00Z', last_progress_pct: 40, last_actual_hours: 90, last_eac_hours: 225,
      actual_hours_delta: 20, progress_delta_pct_point: 0, eac_delta_hours: 50, eac_delta_pct: 28.57,
      progress_stalled: true, eac_jumped: true, flags: ['PROGRESS_STALLED', 'EAC_JUMP'],
    };
    stalled.data[0].progress_stalled_count = 1;
    stalled.data[0].eac_jump_count = 1;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse(stalled));
    renderPage();

    await screen.findByText('Project Red');

    fireEvent.click(screen.getByRole('button', { name: /Project Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /No Unit/ }));
    const card = screen.getByTestId('operation-21');
    expect(within(card).getByText(/Unchanged/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /View update history/ })).toBeInTheDocument();
    expect(card).not.toHaveTextContent('175 h');
    expect(card).not.toHaveTextContent('225 h');
  });

  it('sends schedule, status, health and search filters on manual requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse(payload));
    renderPage();
    await screen.findByText('Project Red');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'assembly' } });
    fireEvent.change(screen.getByLabelText('Schedule from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      const url = String(globalThis.fetch.mock.calls.at(-1)[0]);
      expect(url).toContain('/dashboard/manufacturing-order-progress?');
      expect(url).toContain('q=assembly');
      expect(url).toContain('date_from=2026-09-01');
      expect(url).toContain('status=completed');
      expect(url).toContain('health=red');
    });
  });

  it('loads evidence history only when requested and closes the dialog with Escape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/progress-history/21')) {
        return jsonResponse([{ id: 1, progress: 30, issue_description: 'Waiting material', image_path: '/uploads/op.jpg', created_at: '2026-09-14T01:00:00Z' }]);
      }
      if (String(url).includes('/subtasks/9/progress-history')) {
        return jsonResponse([{ id: 2, progress: 25, issue_description: 'Bracket mismatch', image_path: '/uploads/sub.jpg', created_at: '2026-09-14T02:00:00Z' }]);
      }
      return jsonResponse(payload);
    });
    renderPage();
    await screen.findByText('Project Red');
    fireEvent.click(screen.getByRole('button', { name: /Project Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /No Unit/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View update history for order 1000123456 operation 120' }));
    expect(await screen.findByRole('dialog', { name: /Update history/ })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Latest update')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 updates' }));
    expect(screen.getByText('Bracket mismatch')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'View image' })[0]);
    expect(screen.getByRole('img').getAttribute('src')).toMatch(/^\/uploads\/(op|sub)\.jpg$/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens only the selected sub-task history', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/subtasks/9/progress-history')) return jsonResponse([{ id: 2, progress: 25, issue_description: 'Bracket mismatch', created_at: '2026-09-14T02:00:00Z' }]);
      return jsonResponse(payload);
    });
    renderPage();
    await screen.findByText('Project Red');
    fireEvent.click(screen.getByRole('button', { name: /Project Red/ }));
    fireEvent.click(screen.getByRole('button', { name: /No Unit/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show 1 sub-tasks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View update history for Fit bracket' }));
    expect(await screen.findByText('Bracket mismatch')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/progress-history/21'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/subtasks/9/progress-history'))).toBe(true);
  });
});
