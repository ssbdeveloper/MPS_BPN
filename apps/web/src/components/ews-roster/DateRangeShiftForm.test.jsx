import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DateRangeShiftForm from './DateRangeShiftForm';

const DEFAULT_SHIFTS = [
  { shift_code: 'DAY', sow_shift_code: 'SHIFT-1', start_time: '07:25:00', end_time: '16:30:00', crosses_midnight: false, standard_hours: 8 },
  { shift_code: 'NIGHT', sow_shift_code: 'SHIFT-2', start_time: '16:30:00', end_time: '00:30:00', crosses_midnight: true, standard_hours: 7 },
];

const UPCOMING = [
  { id: 101, shift_code: 'DAY', effective_date: '2026-10-15', start_time: '08:00:00', end_time: '14:00:00', standard_hours: 6, today: false },
];

describe('DateRangeShiftForm', () => {
  it('renders form inputs with default values and lists upcoming overrides', () => {
    render(<DateRangeShiftForm plantToday="2026-10-01" defaultShifts={DEFAULT_SHIFTS} upcomingOverrides={UPCOMING} onApplyOverride={vi.fn()} onDeleteOverride={vi.fn()} onPreviewOverride={vi.fn()} busy={false} />);
    expect(screen.getByLabelText(/Start Date \(From\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/End Date \(To\)/i)).toBeTruthy();
    expect(screen.getByText('2026-10-15')).toBeTruthy();
    expect(screen.getByText('(6h net)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply Temporary Hours/i })).toBeTruthy();
  });

  it('triggers delete callback when clicking trash button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<DateRangeShiftForm plantToday="2026-10-01" defaultShifts={DEFAULT_SHIFTS} upcomingOverrides={UPCOMING} onApplyOverride={vi.fn()} onDeleteOverride={onDelete} onPreviewOverride={vi.fn()} busy={false} />);
    await user.click(screen.getByRole('button', { name: /Delete temporary hours for DAY on 2026-10-15/i }));
    expect(onDelete).toHaveBeenCalledWith(101, {});
  });

  it('opens TodayImpactDialog when preview affects today', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plant_today: '2026-10-01', affects_today: true, preview_token: 'sha256:abc',
      items: [{ date: '2026-10-01', shift_code: 'DAY', today: { started: true, scheduled_operators: 35 }, before: { start_time: '07:25:00', end_time: '16:30:00' }, after: { start_time: '08:00:00', end_time: '13:00:00' } }],
      blocking: [],
    });
    const user = userEvent.setup();
    render(<DateRangeShiftForm plantToday="2026-10-01" defaultShifts={DEFAULT_SHIFTS} upcomingOverrides={[]} onApplyOverride={vi.fn()} onDeleteOverride={vi.fn()} onPreviewOverride={onPreview} busy={false} />);
    await user.click(screen.getByRole('button', { name: /Apply Temporary Hours/i }));
    await waitFor(() => {
      expect(screen.getByText(/Confirm Same-Day Shift Adjustments/i)).toBeTruthy();
      expect(screen.getByText(/35 Operators/i)).toBeTruthy();
      expect(screen.getByText(/Warning: Today's shift is currently active/i)).toBeTruthy();
    });
  });

  it('today impact submit requires min 10 char reason and checkbox checked', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plant_today: '2026-10-01', affects_today: true, preview_token: 'sha256:token123',
      items: [{ date: '2026-10-01', shift_code: 'DAY', today: { started: false, scheduled_operators: 20 }, after: { start_time: '08:00:00', end_time: '13:00:00' } }],
      blocking: [],
    });
    const onApply = vi.fn().mockResolvedValue({});
    const user = userEvent.setup();
    render(<DateRangeShiftForm plantToday="2026-10-01" defaultShifts={DEFAULT_SHIFTS} upcomingOverrides={[]} onApplyOverride={onApply} onDeleteOverride={vi.fn()} onPreviewOverride={onPreview} busy={false} />);
    await user.click(screen.getByRole('button', { name: /Apply Temporary Hours/i }));
    await waitFor(() => screen.getByText(/Confirm Same-Day Shift Adjustments/i));
    const submitBtn = screen.getByRole('button', { name: /Confirm & Apply/i });
    expect(submitBtn.disabled).toBe(true);
    const reasonInput = screen.getByLabelText(/Operational Change Reason/i);
    await user.type(reasonInput, 'short');
    expect(submitBtn.disabled).toBe(true);
    await user.clear(reasonInput);
    await user.type(reasonInput, 'Planned maintenance on facility line A');
    await user.click(screen.getByRole('checkbox', { name: /I acknowledge the operational impact/i }));
    expect(submitBtn.disabled).toBe(false);
    await user.click(submitBtn);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ confirm_today_impact: true, reason: 'Planned maintenance on facility line A', preview_token: 'sha256:token123' }));
  });

  it('delete today override triggers preview -> dialog -> delete with preview_token and manual reason', async () => {
    const todayOverride = [{ id: 202, shift_code: 'DAY', effective_date: '2026-10-01', start_time: '08:00:00', end_time: '14:00:00', standard_hours: 6, today: true }];
    const onPreviewDelete = vi.fn().mockResolvedValue({
      id: 202, effective_date: '2026-10-01', shift_code: 'DAY', affects_today: true, plant_today: '2026-10-01', preview_token: 'sha256:deltoken456', sow_blocking: false,
      today: { is_today: true, business_date: '2026-10-01', scheduled_operators: 15, fallback_to: { start_time: '07:25:00', end_time: '16:30:00', standard_hours: 8 } },
    });
    const onDelete = vi.fn().mockResolvedValue({});
    const user = userEvent.setup();
    render(<DateRangeShiftForm plantToday="2026-10-01" defaultShifts={DEFAULT_SHIFTS} upcomingOverrides={todayOverride} onApplyOverride={vi.fn()} onDeleteOverride={onDelete} onPreviewOverride={vi.fn()} onPreviewDeleteOverride={onPreviewDelete} busy={false} />);
    await user.click(screen.getByRole('button', { name: /Delete temporary hours for DAY on 2026-10-01/i }));
    expect(onPreviewDelete).toHaveBeenCalledWith(202);
    await waitFor(() => {
      expect(screen.getByText(/Confirm Same-Day Override Removal/i)).toBeTruthy();
      expect(screen.getByText(/15 Operators/i)).toBeTruthy();
      expect(screen.getByText(/Revert to Default/i)).toBeTruthy();
    });
    const submitBtn = screen.getByRole('button', { name: /Confirm & Remove/i });
    expect(submitBtn.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason for Removing Same-Day Override/i), 'Emergency override reverted as normal power restored');
    await user.click(screen.getByRole('checkbox', { name: /I acknowledge that deleting today's override/i }));
    expect(submitBtn.disabled).toBe(false);
    await user.click(submitBtn);
    expect(onDelete).toHaveBeenCalledWith(202, expect.objectContaining({ confirm_today_impact: true, reason: 'Emergency override reverted as normal power restored', preview_token: 'sha256:deltoken456' }));
  });
});
