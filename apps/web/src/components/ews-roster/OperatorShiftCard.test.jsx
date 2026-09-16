import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OperatorShiftCard from './OperatorShiftCard';

const operators = [
  { snssb: '100', full_name: 'Alex Doe', rotation_group: 'B', fixed_shift: null },
  { snssb: '101', full_name: 'Blair Doe', rotation_group: 'A', fixed_shift: 'DAY' },
  { snssb: '102', full_name: 'Casey Doe', rotation_group: null, fixed_shift: null },
];

describe('OperatorShiftCard', () => {
  it('maps hidden groups to shift labels and emits the backend group', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    const { container } = render(<OperatorShiftCard operators={operators} weekContext={{ week_start: '2026-09-13', day_group: 'B', night_group: 'A' }} onWeekChange={vi.fn()} onAssign={onAssign} onFixedShift={vi.fn()} />);
    expect(container.textContent).not.toMatch(/Group A|Group B|rotation_group/);
    expect(screen.getByRole('button', { name: 'Day Shift 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Night Shift 0' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Assign Casey Doe to Day Shift' }));
    expect(onAssign).toHaveBeenCalledWith('102', 'B');
  });

  it('uses three permanent-shift buttons and no select', async () => {
    const user = userEvent.setup();
    const onFixedShift = vi.fn();
    render(<OperatorShiftCard operators={operators} weekContext={{ week_start: '2026-09-13', day_group: 'B', night_group: 'A' }} onWeekChange={vi.fn()} onAssign={vi.fn()} onFixedShift={onFixedShift} />);
    expect(screen.getAllByRole('button', { name: /Follow Rotation/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Always Day/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Always Night/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All 3' }));
    await user.click(screen.getByRole('button', { name: 'Alex Doe: Always Night' }));
    expect(onFixedShift).toHaveBeenCalledWith('100', 'NIGHT');
  });
});
