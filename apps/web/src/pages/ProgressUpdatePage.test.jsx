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
