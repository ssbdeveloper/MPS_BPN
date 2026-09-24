import { describe, expect, it } from 'vitest';
import { groupByOrder } from './constants';

const row = (over = {}) => ({
  schedule_id: 's1', schedule_group_id: 'g1', booking_type: 'ORDER', order_no: '1000121250',
  task_id: 't1', operation_no: '220', area_code: 'AREA-13', bay_codes: ['B29E'],
  start_date: '2026-09-22', end_date: '2026-09-30', status: 'RESERVED',
  timesheet_ref_count: 0, open_checkin_count: 0,
  ...over,
});

describe('groupByOrder — satu entri per order di sel bay', () => {
  it('menggabungkan semua operation satu order dari grup berbeda, urut operation', () => {
    const [entry, ...rest] = groupByOrder([
      row({ schedule_id: 'a', schedule_group_id: 'g1', task_id: 't280', operation_no: '280' }),
      row({ schedule_id: 'b', schedule_group_id: 'g2', task_id: 't220', operation_no: '220', status: 'CONFIRMED', timesheet_ref_count: 2, open_checkin_count: 1 }),
    ]);
    expect(rest).toEqual([]);
    expect(entry.tasks.map((task) => task.operation_no)).toEqual(['220', '280']);
    expect(entry.schedule_group_ids).toEqual(['g1', 'g2']);
    expect(entry.order_view).toBe(true);
    expect(entry.schedule_group_id).toBeNull();
    expect(entry.status).toBe('CONFIRMED');
    expect(entry.open_checkin_count).toBe(1);
    expect(entry.timesheet_ref_count).toBe(2);
  });

  it('order dengan satu grup tetap bisa diedit (group_key + schedule_group_id dipertahankan)', () => {
    const [entry] = groupByOrder([row(), row({ schedule_id: 's2', task_id: 't2', operation_no: '230' })]);
    expect(entry.schedule_group_id).toBe('g1');
    expect(entry.group_key).toBe('grp:g1');
    expect(entry.order_view).toBe(false);
    expect(entry.task_count).toBe(2);
  });

  it('order berbeda tetap terpisah; nol di depan order_no dianggap sama', () => {
    const list = groupByOrder([
      row({ schedule_id: 'a', order_no: '0001000121250' }),
      row({ schedule_id: 'b', schedule_group_id: 'g9', order_no: '1000121250', operation_no: '230', task_id: 't9' }),
      row({ schedule_id: 'c', schedule_group_id: 'g3', order_no: '1000999999' }),
    ]);
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.order_no === '1000999999').task_count).toBe(1);
  });

  it('booking non-job tidak digabung antar grup', () => {
    const list = groupByOrder([
      row({ schedule_id: 'a', schedule_group_id: 'n1', booking_type: 'PARKING', order_no: null, task_id: null }),
      row({ schedule_id: 'b', schedule_group_id: 'n2', booking_type: 'PARKING', order_no: null, task_id: null }),
    ]);
    expect(list).toHaveLength(2);
  });

  it('rentang = gabungan grup; bay = union', () => {
    const [entry] = groupByOrder([
      row({ schedule_id: 'a', start_date: '2026-09-24', end_date: '2026-10-01', bay_codes: ['B29E'] }),
      row({ schedule_id: 'b', schedule_group_id: 'g2', task_id: 't2', start_date: '2026-09-22', end_date: '2026-09-30', bay_codes: ['B29E', 'B30E'] }),
    ]);
    expect(String(entry.start_date).slice(0, 10)).toBe('2026-09-22');
    expect(String(entry.end_date).slice(0, 10)).toBe('2026-10-01');
    expect(entry.bay_codes).toEqual(['B29E', 'B30E']);
  });
});
