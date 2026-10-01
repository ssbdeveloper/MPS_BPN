import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DateRangeShiftForm from './DateRangeShiftForm';

const DEFAULT_SHIFTS = [
  { shift_code: 'DAY', sow_shift_code: 'SHIFT-1', start_time: '07:25:00', end_time: '16:30:00', crosses_midnight: false, standard_hours: 8 },
  { shift_code: 'NIGHT', sow_shift_code: 'SHIFT-2', start_time: '16:30:00', end_time: '00:30:00', crosses_midnight: true, standard_hours: 7 },
];

const UPCOMING_OVERRIDES = [
  { id: 101, shift_code: 'DAY', effective_date: '2026-10-15', start_time: '08:00:00', end_time: '14:00:00', standard_hours: 6, today: false },
];

describe('DateRangeShiftForm', () => {
  it('renders form inputs with default values and lists upcoming overrides', () => {
    render(
      <DateRangeShiftForm
        plantToday="2026-10-01"
        defaultShifts={DEFAULT_SHIFTS}
        upcomingOverrides={UPCOMING_OVERRIDES}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    expect(screen.getByLabelText(/Mulai \(From\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/Selesai \(To\)/i)).toBeTruthy();
    expect(screen.getByText('2026-10-15')).toBeTruthy();
    expect(screen.getByText('(6h)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Terapkan Jam Khusus/i })).toBeTruthy();
  });

  it('triggers delete callback when clicking trash button', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <DateRangeShiftForm
        plantToday="2026-10-01"
        defaultShifts={DEFAULT_SHIFTS}
        upcomingOverrides={UPCOMING_OVERRIDES}
        onApplyOverride={vi.fn()}
        onDeleteOverride={onDelete}
        onPreviewOverride={vi.fn()}
        busy={false}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Hapus jam khusus DAY tanggal 2026-10-15/i });
    await user.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(101, false);
  });

  it('opens TodayImpactDialog when preview affects today', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plant_today: '2026-10-01',
      affects_today: true,
      preview_token: 'sha256:abc',
      items: [
        {
          date: '2026-10-01',
          shift_code: 'DAY',
          today: { started: true, scheduled_operators: 35 },
          before: { start_time: '07:25:00', end_time: '16:30:00' },
          after: { start_time: '08:00:00', end_time: '13:00:00' },
        },
      ],
      blocking: [],
    });

    const user = userEvent.setup();
    render(
      <DateRangeShiftForm
        plantToday="2026-10-01"
        defaultShifts={DEFAULT_SHIFTS}
        upcomingOverrides={[]}
        onApplyOverride={vi.fn()}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={onPreview}
        busy={false}
      />
    );

    await user.click(screen.getByRole('button', { name: /Terapkan Jam Khusus/i }));
    await waitFor(() => {
      expect(screen.getByText('Konfirmasi Perubahan Hari Ini')).toBeTruthy();
      expect(screen.getByText(/35 Orang/i)).toBeTruthy();
      expect(screen.getByText(/Shift hari ini sudah atau sedang berjalan/i)).toBeTruthy();
    });
  });

  it('today impact submit requires min 10 char reason and checkbox checked', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      plant_today: '2026-10-01',
      affects_today: true,
      preview_token: 'sha256:token123',
      items: [
        {
          date: '2026-10-01',
          shift_code: 'DAY',
          today: { started: false, scheduled_operators: 20 },
          after: { start_time: '08:00:00', end_time: '13:00:00' },
        },
      ],
      blocking: [],
    });

    const onApply = vi.fn().mockResolvedValue({});
    const user = userEvent.setup();

    render(
      <DateRangeShiftForm
        plantToday="2026-10-01"
        defaultShifts={DEFAULT_SHIFTS}
        upcomingOverrides={[]}
        onApplyOverride={onApply}
        onDeleteOverride={vi.fn()}
        onPreviewOverride={onPreview}
        busy={false}
      />
    );

    await user.click(screen.getByRole('button', { name: /Terapkan Jam Khusus/i }));
    await waitFor(() => screen.getByText('Konfirmasi Perubahan Hari Ini'));

    const submitBtn = screen.getByRole('button', { name: /Konfirmasi & Terapkan/i });
    expect(submitBtn.disabled).toBe(true);

    const reasonInput = screen.getByLabelText(/Alasan Perubahan Operasional/i);
    await user.type(reasonInput, 'pendek');
    expect(submitBtn.disabled).toBe(true);

    await user.clear(reasonInput);
    await user.type(reasonInput, 'Pemadaman listrik terencana PLN');

    const checkbox = screen.getByRole('checkbox', { name: /Saya memahami dampak/i });
    await user.click(checkbox);

    expect(submitBtn.disabled).toBe(false);
    await user.click(submitBtn);

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        confirm_today_impact: true,
        reason: 'Pemadaman listrik terencana PLN',
        preview_token: 'sha256:token123',
      })
    );
  });
});
