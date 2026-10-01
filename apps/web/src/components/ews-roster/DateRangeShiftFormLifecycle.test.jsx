import { render, screen, waitFor } from '@testing-library/react';
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

  it('retains typed reason on PREVIEW_STALE and succeeds on retry', async () => {
    let callCount = 0;
    const onApply = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('PREVIEW_STALE: State telah berubah di database');
      return { success: true };
    });

    let previewCount = 0;
    const onPreview = vi.fn().mockImplementation(async () => {
      previewCount += 1;
      return {
        plant_today: '2026-10-01',
        affects_today: true,
        preview_token: `token_fresh_${previewCount}`,
        items: [{
          date: '2026-10-01',
          shift_code: 'DAY',
          today: { started: false, scheduled_operators: 12 },
          after: { start_time: '08:00:00', end_time: '14:00:00' },
        }],
        blocking: [],
      };
    });

    const user = userEvent.setup();
    const defaults = [
      { shift_code: 'DAY', start_time: '07:25:00', end_time: '16:30:00', crosses_midnight: false, standard_hours: 8 },
      { shift_code: 'NIGHT', start_time: '16:30:00', end_time: '00:30:00', crosses_midnight: true, standard_hours: 7 },
    ];

    render(
      <DateRangeShiftForm
        plantToday="2026-10-01"
        defaultShifts={defaults}
        upcomingOverrides={[]}
        onApplyOverride={onApply}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={onPreview}
        busy={false}
      />
    );

    await user.click(screen.getByRole('button', { name: /Terapkan Jam Khusus/i }));
    await waitFor(() => {
      expect(screen.getByText('Konfirmasi Perubahan Hari Ini')).toBeTruthy();
    });

    const reasonInput = screen.getByPlaceholderText(/Wajib diisi manual minimal 10 karakter/i);
    await user.type(reasonInput, 'Perubahan darurat PLN padam');
    const checkbox = screen.getByLabelText(/Saya memahami dampak perubahan jam shift hari ini/i);
    await user.click(checkbox);

    const submitBtn = screen.getByRole('button', { name: /Konfirmasi & Terapkan/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Kondisi jadwal di server telah berubah/i)).toBeTruthy();
    });

    expect(reasonInput.value).toBe('Perubahan darurat PLN padam');
    await user.click(checkbox);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Konfirmasi Perubahan Hari Ini')).toBeNull();
    });
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
