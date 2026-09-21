import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExceptionPanel from './ExceptionPanel';
import deriveExceptions from './deriveExceptions';

describe('deriveExceptions', () => {
  it('ignores a healthy plant', () => {
    expect(deriveExceptions({
      kpi: { overdue_orders: 0 },
      validation: [{ workcenter: 'C5100FIT', pass_rate: 91 }],
      workload: [{ workcenter: 'C5100FIT', total_planhours: 100, total_actual_hours: 80 }],
    })).toEqual([]);
  });

  it('flags overdue orders, validation below 80 and workload above plan', () => {
    const rows = deriveExceptions({
      kpi: { overdue_orders: 12 },
      validation: [{ workcenter: 'WELD', pass_rate: 64 }],
      workload: [{ workcenter: 'PAINT', total_planhours: 40, total_actual_hours: 52.5 }],
    });
    expect(rows.map((r) => r.id)).toEqual(['overdue-orders', 'validation-WELD', 'workload-PAINT']);
    expect(rows[2].subject).toBe('PAINT over plan by 12.5 hrs');
  });

  it('treats a pass rate under 50 as high severity and orders it above a medium one', () => {
    const rows = deriveExceptions({
      kpi: null,
      validation: [{ workcenter: 'MILD', pass_rate: 79 }, { workcenter: 'BAD', pass_rate: 12 }],
    });
    expect(rows.map((r) => [r.id, r.severity]))
      .toEqual([['validation-BAD', 'high'], ['validation-MILD', 'medium']]);
  });

  it('keeps the 80 target and the plan hours boundary exclusive', () => {
    expect(deriveExceptions({
      kpi: null,
      validation: [{ workcenter: 'EDGE', pass_rate: 80 }],
      workload: [{ workcenter: 'EDGE', total_planhours: 10, total_actual_hours: 10 }],
    })).toEqual([]);
  });

  it('skips rows whose numbers are missing rather than inventing an exception', () => {
    expect(deriveExceptions({
      kpi: null,
      validation: [{ workcenter: 'NULLS', pass_rate: null }],
      workload: [{ workcenter: 'NULLS', total_planhours: 0, total_actual_hours: 9 }],
    })).toEqual([]);
  });
});

describe('ExceptionPanel', () => {
  const rows = deriveExceptions({ kpi: { overdue_orders: 3 } });

  it('states that nothing needs action instead of showing a blank area', () => {
    render(<ExceptionPanel rows={[]} loading={false} error={false} onOpen={() => {}} />);
    expect(screen.getByText(/No exceptions/)).toBeInTheDocument();
    expect(screen.getByLabelText('Exceptions')).toHaveTextContent('0');
  });

  it('opens the linked page when a row is activated', () => {
    const onOpen = vi.fn();
    render(<ExceptionPanel rows={rows} loading={false} error={false} onOpen={onOpen} />);
    const row = screen.getByRole('button', { name: /3 overdue orders/ });
    expect(within(row).getByText('Act now')).toBeInTheDocument();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('/sow-orders');
  });

  it('warns that the list is incomplete when a source failed', () => {
    render(<ExceptionPanel rows={rows} loading={false} error onOpen={() => {}} />);
    expect(screen.getByText(/this list is incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /overdue orders/ })).not.toBeInTheDocument();
  });
});
