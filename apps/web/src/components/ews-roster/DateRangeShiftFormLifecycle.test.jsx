import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DateRangeShiftForm from './DateRangeShiftForm';
import TodayImpactDialog from './TodayImpactDialog';

describe('DateRangeShiftForm — Lifecycle, Delayed Config & Error Retention', () => {
  it('does not mount usable form before plantToday and defaultShifts are available', () => {
    const { rerender } = render(
      <DateRangeShiftForm
        plantToday={null}
        defaultShifts={[]}
        upcomingOverrides={[]}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    expect(screen.getByTestId('date-range-loading')).toBeTruthy();
    expect(screen.queryByLabelText(/Mulai \(From\)/i)).toBeNull();

    const customDefaults = [
      { shift_code: 'DAY', start_time: '06:30:00', end_time: '15:30:00', crosses_midnight: false, standard_hours: 8.5 },
      { shift_code: 'NIGHT', start_time: '21:00:00', end_time: '05:00:00', crosses_midnight: true, standard_hours: 7.5 },
    ];

    rerender(
      <DateRangeShiftForm
        plantToday="2026-10-02"
        defaultShifts={customDefaults}
        upcomingOverrides={[]}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    const fromInput = screen.getByLabelText(/Mulai \(From\)/i);
    expect(fromInput.value).toBe('2026-10-02');
    expect(screen.queryByTestId('date-range-loading')).toBeNull();
  });

  it('preserves user draft input and does not overwrite on background reload', async () => {
    const customDefaults = [
      { shift_code: 'DAY', start_time: '06:30:00', end_time: '15:30:00', crosses_midnight: false, standard_hours: 8 },
      { shift_code: 'NIGHT', start_time: '21:00:00', end_time: '05:00:00', crosses_midnight: true, standard_hours: 7 },
    ];
    const user = userEvent.setup();

    const { rerender } = render(
      <DateRangeShiftForm
        plantToday="2026-10-02"
        defaultShifts={customDefaults}
        upcomingOverrides={[]}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    const fromInput = screen.getByLabelText(/Mulai \(From\)/i);
    await user.clear(fromInput);
    await user.type(fromInput, '2026-10-10');
    expect(fromInput.value).toBe('2026-10-10');

    rerender(
      <DateRangeShiftForm
        plantToday="2026-10-02"
        defaultShifts={[...customDefaults]}
        upcomingOverrides={[]}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    expect(fromInput.value).toBe('2026-10-10');
  });

  it('displays operator statistics correctly for nonzero, genuine zero, and query failure', () => {
    const basePreview = {
      plant_today: '2026-10-01',
      operation: 'DELETE_OVERRIDE',
      mode: 'delete',
      preview_token: 'token_xyz',
      today: {
        is_today: true,
        business_date: '2026-10-01',
        scheduled_operators: 14,
        operators_with_records: 5,
        stats_status: 'available',
        fallback_to: { start_time: '07:25:00', end_time: '16:30:00', standard_hours: 8 },
      },
    };

    const { rerender } = render(
      <TodayImpactDialog isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} previewData={basePreview} busy={false} />
    );
    expect(screen.getByText(/14 Orang/i)).toBeTruthy();

    rerender(
      <TodayImpactDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        previewData={{ ...basePreview, today: { ...basePreview.today, scheduled_operators: 0, operators_with_records: 0 } }}
        busy={false}
      />
    );
    expect(screen.getByText('0 Orang')).toBeTruthy();

    rerender(
      <TodayImpactDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        previewData={{ ...basePreview, today: { ...basePreview.today, scheduled_operators: null, stats_status: 'unavailable' } }}
        busy={false}
      />
    );
    expect(screen.getByText('Data Tidak Tersedia (Error)')).toBeTruthy();
  });
});
