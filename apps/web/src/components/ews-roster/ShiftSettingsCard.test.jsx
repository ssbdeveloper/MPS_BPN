import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ShiftSettingsCard from './ShiftSettingsCard';

const SHIFTS = [
  { shift_code: 'DAY', sow_shift_code: 'SHIFT-1', shift_name: 'Shift 1', start_time: '07:25:00', end_time: '16:30:00', crosses_midnight: false, standard_hours: '8.00', default_capacity_hours: '8.00', is_active: true, standard_minutes: 480, span_minutes: 545 },
  { shift_code: 'NIGHT', sow_shift_code: 'SHIFT-2', shift_name: 'Shift 2', start_time: '16:30:00', end_time: '00:30:00', crosses_midnight: true, standard_hours: '7.00', default_capacity_hours: '7.00', is_active: true, standard_minutes: 420, span_minutes: 480 },
];
const OVERRIDES = [
  { id: '3', sow_shift_code: 'SHIFT-1', shift_code: 'DAY', effective_date: '2026-05-14', start_time: '07:00:00', end_time: '10:00:00', standard_hours: '3.00' },
];

describe('ShiftSettingsCard', () => {
  it('renders master values before any draft exists', () => {
    render(<ShiftSettingsCard shifts={SHIFTS} overrides={OVERRIDES} impact={null} onSave={vi.fn()} onPreview={vi.fn()} onResync={vi.fn()} busy={false} />);
    expect(screen.getAllByLabelText('Standard Hours').length).toBe(2);
    expect(screen.getAllByLabelText('Standard Hours')[0].value).toBe('8.00');
    expect(screen.getAllByLabelText('Start Time')[1].value).toBe('16:30');
  });

  it('shows date-specific shift hours', () => {
    render(<ShiftSettingsCard shifts={SHIFTS} overrides={OVERRIDES} impact={null} onSave={vi.fn()} onPreview={vi.fn()} onResync={vi.fn()} busy={false} />);
    expect(screen.getByText('2026-05-14')).toBeTruthy();
    expect(screen.getByText('3h standard')).toBeTruthy();
  });

  it('sends only the changed field', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<ShiftSettingsCard shifts={SHIFTS} overrides={OVERRIDES} impact={null} onSave={onSave} onPreview={vi.fn()} onResync={vi.fn()} busy={false} />);
    const hours = screen.getAllByLabelText('Standard Hours')[0];
    await user.clear(hours);
    await user.type(hours, '7.5');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect(onSave).toHaveBeenCalledWith('DAY', { standard_hours: '7.5' });
  });

  it('disables synchronization when no safe row differs', () => {
    render(<ShiftSettingsCard shifts={SHIFTS} overrides={[]} impact={{ future_rows: 910, differing_rows: 0, resyncable_rows: 0, skipped_rows: 1 }} onSave={vi.fn()} onPreview={vi.fn()} onResync={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: 'Apply to 0 Rows' }).disabled).toBe(true);
    expect(screen.getByText(/910 future rows/)).toBeTruthy();
  });
});
