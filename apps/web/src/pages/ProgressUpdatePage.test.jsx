import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProgressUpdatePage from './ProgressUpdatePage';

const hierarchy = {
  data: [{
    project_id: 'project-1', project_name: 'ORICA ISO Tank', progress_pct: 30,
    units: [{
      unit_key: 'unit-1', unit_name: 'Unit 01', progress_pct: 25,
      operations: [{
        idsow: 21, order_no: '1000123456', operation_no: 120,
        operation_text: 'FINAL ASSEMBLY', workcenter: 'C5100FIT',
        plan_hours: 100, progress_pct: 25, subtasks: [],
      }],
    }],
  }],
  pagination: { page: 1, limit: 50, total_projects: 1 },
};

const subtasks = [{
  id: 9, order_no: '1000123456', title: 'Fit bracket', standard_hours: 12,
  weight: 1, progress: 25, status: 'IN_PROGRESS', updated_at: '2026-09-14T02:00:00Z',
}];

const response = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('Foreman physical progress hierarchy', () => {
  it('expands project, unit and SAP operation before showing editable sub-tasks', async () => {
    sessionStorage.setItem('authUser', JSON.stringify({ id: 1, name: 'Foreman One', roles: 'foreman' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => (
      String(url).includes('/sow/operations/21/subtasks') ? response(subtasks) : response(hierarchy)
    ));

    render(<MemoryRouter><ProgressUpdatePage /></MemoryRouter>);
    expect(await screen.findByText('ORICA ISO Tank')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ORICA ISO Tank/ }));
    fireEvent.click(screen.getByRole('button', { name: /Unit 01/ }));
    expect(screen.getByText('FINAL ASSEMBLY')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /FINAL ASSEMBLY/ }));
    expect(await screen.findByText('Fit bracket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit sub-task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate sub-task' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=active'))).toBe(true));
  });

  it('hides sub-task edit/deactivate for roles without SOW Management write access', async () => {
    sessionStorage.setItem('authUser', JSON.stringify({ id: 5, name: 'Read Only User', roles: 'warehouse' }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => (
      String(url).includes('/sow/operations/21/subtasks') ? response(subtasks) : response(hierarchy)
    ));

    render(<MemoryRouter><ProgressUpdatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /ORICA ISO Tank/ }));
    fireEvent.click(screen.getByRole('button', { name: /Unit 01/ }));
    fireEvent.click(screen.getByRole('button', { name: /FINAL ASSEMBLY/ }));

    expect(await screen.findByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit sub-task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate sub-task' })).not.toBeInTheDocument();
  });

  it('keeps hierarchy sub-tasks visible with their progress when the sub-task fetch fails', async () => {
    // Endpoint /sow/operations/:idsow/subtasks pernah 500 (cast created_by 'sap-auto'
    // ke integer). Saat itu panel sub-task jadi kosong total; sekarang baris dari
    // payload hierarki tetap tampil (progress_pct dinormalkan ke progress).
    sessionStorage.setItem('authUser', JSON.stringify({ id: 1, name: 'Foreman One', roles: 'foreman' }));
    const withInlineSubtasks = structuredClone(hierarchy);
    withInlineSubtasks.data[0].units[0].operations[0].subtasks = [
      { id: 9, title: 'Fit bracket', sort_order: 1, standard_hours: 12, progress_pct: 40, status: 'IN_PROGRESS' },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => (
      String(url).includes('/sow/operations/21/subtasks')
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) })
        : response(withInlineSubtasks)
    ));

    render(<MemoryRouter><ProgressUpdatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /ORICA ISO Tank/ }));
    fireEvent.click(screen.getByRole('button', { name: /Unit 01/ }));
    fireEvent.click(screen.getByRole('button', { name: /FINAL ASSEMBLY/ }));

    expect(await screen.findByText('Fit bracket')).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();
  });

  it('defaults the status filter to Active and switches to Completed on click', async () => {
    sessionStorage.setItem('authUser', JSON.stringify({ id: 1, name: 'Foreman One', roles: 'foreman' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => response(hierarchy));

    render(<MemoryRouter><ProgressUpdatePage /></MemoryRouter>);
    await screen.findByText('ORICA ISO Tank');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=active'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=completed'))).toBe(true));
  });
});
