import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import DateRangeShiftForm from './DateRangeShiftForm';

// Regresi PREVIEW_STALE memakai bentuk error NYATA dari request() di EwsRosterConfigPage:
// message = payload.error (teks manusia dari server), code = payload.code.
// Message sengaja TIDAK mengandung string "PREVIEW_STALE" sehingga deteksi berbasis
// pencarian teks akan gagal di tes ini.
export const HUMAN_STALE_MESSAGE = 'Kondisi shift telah berubah sejak preview terakhir atau token tidak valid. Silakan muat ulang preview.';
export const staleError = () => Object.assign(new Error(HUMAN_STALE_MESSAGE), { status: 409, code: 'PREVIEW_STALE' });

export const DEFAULTS = [
  { shift_code: 'DAY', start_time: '06:30:00', end_time: '15:30:00', crosses_midnight: false, standard_hours: 8 },
  { shift_code: 'NIGHT', start_time: '21:00:00', end_time: '05:00:00', crosses_midnight: true, standard_hours: 7 },
];
export const PLANT_TODAY = '2026-10-02';
export const REASON = 'Perubahan darurat karena PLN padam';

export const applyPreview = (token) => ({
  plant_today: PLANT_TODAY,
  affects_today: true,
  preview_token: token,
  items: [{
    date: PLANT_TODAY, shift_code: 'DAY',
    today: { started: false, scheduled_operators: 3, operators_with_records: 1, stats_status: 'available' },
    before: { start_time: '06:30:00', end_time: '15:30:00' },
    after: { start_time: '06:30:00', end_time: '15:30:00' },
  }],
  blocking: [],
});

export const deletePreview = (token) => ({
  id: 202, effective_date: PLANT_TODAY, shift_code: 'DAY', affects_today: true,
  plant_today: PLANT_TODAY, preview_token: token, sow_blocking: false, overlap_conflict: null,
  today: {
    is_today: true, business_date: PLANT_TODAY, scheduled_operators: 4, operators_with_records: 2,
    stats_status: 'available', fallback_to: { start_time: '06:30:00', end_time: '15:30:00', standard_hours: 8 },
  },
});

export async function openApplyDialog(user, props) {
  render(<DateRangeShiftForm plantToday={PLANT_TODAY} defaultShifts={DEFAULTS} upcomingOverrides={[]}
    onDeleteOverride={vi.fn()} busy={false} {...props} />);
  await user.click(screen.getByRole('button', { name: /Terapkan Jam Khusus/i }));
  await screen.findByText('Konfirmasi Perubahan Hari Ini');
  return {
    reason: screen.getByLabelText(/Alasan Perubahan Operasional/i),
    checkbox: () => screen.getByRole('checkbox', { name: /Saya memahami dampak perubahan jam shift/i }),
    submit: () => screen.getByRole('button', { name: /Konfirmasi & Terapkan/i }),
  };
}

export async function openDeleteDialog(user, props) {
  const upcoming = [{ id: 202, shift_code: 'DAY', effective_date: PLANT_TODAY, start_time: '08:00:00', end_time: '14:00:00', standard_hours: 6, today: true }];
  render(<DateRangeShiftForm plantToday={PLANT_TODAY} defaultShifts={DEFAULTS} upcomingOverrides={upcoming}
    onApplyOverride={vi.fn()} onPreviewOverride={vi.fn()} busy={false} {...props} />);
  await user.click(screen.getByRole('button', { name: new RegExp(`Hapus jam khusus DAY tanggal ${PLANT_TODAY}`, 'i') }));
  await screen.findByText('Konfirmasi Hapus Jam Khusus Hari Ini');
  return {
    reason: screen.getByLabelText(/Alasan Pembatalan \/ Penghapusan Khusus/i),
    checkbox: () => screen.getByRole('checkbox', { name: /Saya memahami penghapusan jadwal hari ini/i }),
    submit: () => screen.getByRole('button', { name: /Konfirmasi & Hapus/i }),
  };
}
