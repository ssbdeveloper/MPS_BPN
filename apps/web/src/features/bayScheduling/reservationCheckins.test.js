import { describe, expect, it } from 'vitest';
import { dedupeByGroup, orderReservationList } from './constants';

// Satu baris = satu task. Hitungan timesheet datang per BARIS dari server (F3/B2), jadi
// agregat per reservasi harus dijumlahkan di klien — dan baris yang sudah dibatalkan
// tidak boleh ikut menghalangi pembatalan.
const row = (over = {}) => ({
  schedule_id: 's1', schedule_group_id: 'g1', booking_type: 'ORDER', order_no: '1000121250',
  task_id: 't1', operation_no: '230', area_code: 'AREA-13', bay_codes: ['B29E'],
  start_date: '2026-09-23', end_date: '2026-10-02', status: 'RESERVED',
  timesheet_ref_count: 0, open_checkin_count: 0,
  ...over,
});

describe('dedupeByGroup — hitungan timesheet per reservasi (F3)', () => {
  it('menjumlahkan referensi & check-in terbuka seluruh baris grup', () => {
    const [entry] = dedupeByGroup([
      row({ schedule_id: 's1', task_id: 't1', status: 'CONFIRMED', timesheet_ref_count: 3, open_checkin_count: 1 }),
      row({ schedule_id: 's2', task_id: 't2', timesheet_ref_count: 0 }),
    ]);
    expect(entry.timesheet_ref_count).toBe(3);
    expect(entry.open_checkin_count).toBe(1);
  });

  it('menyimpan status & hitungan di setiap task agar modal bisa bertindak per baris', () => {
    const [entry] = dedupeByGroup([row({ status: 'CONFIRMED', timesheet_ref_count: 2, open_checkin_count: 1 })]);
    expect(entry.tasks[0]).toMatchObject({ schedule_id: 's1', status: 'CONFIRMED', timesheet_ref_count: 2, open_checkin_count: 1 });
  });

  it('server lama tanpa field hitungan -> 0, bukan NaN', () => {
    const legacy = row();
    delete legacy.timesheet_ref_count;
    delete legacy.open_checkin_count;
    const [entry] = dedupeByGroup([legacy]);
    expect(entry.timesheet_ref_count).toBe(0);
    expect(entry.open_checkin_count).toBe(0);
    expect(entry.tasks[0].open_checkin_count).toBe(0);
  });
});

describe('orderReservationList — daftar reservasi satu order lintas tanggal', () => {
  it('satu entri per grup, urut tanggal mulai lalu identitas grup', () => {
    const list = orderReservationList([
      row({ schedule_id: 'a', schedule_group_id: 'g2', start_date: '2026-09-25' }),
      row({ schedule_id: 'b', schedule_group_id: 'g1', start_date: '2026-09-22' }),
      row({ schedule_id: 'c', schedule_group_id: 'g1', task_id: 't2', start_date: '2026-09-22' }),
      row({ schedule_id: 'd', schedule_group_id: 'g3', start_date: '2026-09-22' }),
    ]);
    expect(list.map((entry) => entry.schedule_group_id)).toEqual(['g1', 'g3', 'g2']);
    expect(list[0].task_count).toBe(2);
  });

  it('baris CANCELLED tidak ikut', () => {
    const list = orderReservationList([row({ status: 'CANCELLED' })]);
    expect(list).toEqual([]);
  });
});
