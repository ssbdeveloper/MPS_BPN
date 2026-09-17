import { describe, it, expect } from 'vitest';
import { unitMismatchOf } from './unitMismatch.js';

// Guard beda-unit (C). Kasus nyata di prod: dua order kembar (part SB10115AC,
// 48 operasi, part_name identik) di bawah UNIT 1 dan UNIT 2. Tanpa perbandingan
// unit, operasi UNIT 1 mendarat di subtree UNIT 2 tanpa satu pun peringatan —
// 22 baris mapping salah unit terbentuk seperti itu.
describe('unitMismatchOf', () => {
  it('menandai operasi yang mendarat di subtree unit lain', () => {
    const mismatch = unitMismatchOf(
      { order_no: '1000132018', operation_no: 20 },
      { unit_name: 'UNIT 2 - UPDATED', unit_order_no: '1000132024' },
    );
    expect(mismatch).toMatchObject({
      unitName: 'UNIT 2 - UPDATED',
      unitOrder: '1000132024',
      draggedOrder: '1000132018',
    });
  });

  it('diam saat unit target cocok dengan order operasi', () => {
    expect(
      unitMismatchOf(
        { order_no: '1000132018', operation_no: 20 },
        { unit_name: 'UNIT 1 - UPDATED', unit_order_no: '1000132018' },
      ),
    ).toBeNull();
  });

  // SAP memulas order dengan nol di depan ('0001000132018'); ms_project_task
  // menyimpannya tanpa padding. Kalau tidak dinormalkan, SETIAP drop akan
  // dianggap beda unit dan planner belajar mengabaikan peringatannya.
  it('menyamakan order meski beda nol di depan', () => {
    expect(
      unitMismatchOf(
        { order_no: '0001000132018', operation_no: 20 },
        { unit_name: 'UNIT 1 - UPDATED', unit_order_no: '1000132018' },
      ),
    ).toBeNull();
  });

  // Project berbasis proses tidak punya summary UNIT sama sekali. Peringatan di
  // situ hanya kebisingan yang tidak bisa ditindaklanjuti.
  it('diam saat task tidak bernaung di bawah unit mana pun', () => {
    expect(
      unitMismatchOf(
        { order_no: '1000132018', operation_no: 20 },
        { unit_name: null, unit_order_no: null },
      ),
    ).toBeNull();
  });

  it('diam saat data drag/task belum lengkap', () => {
    expect(unitMismatchOf(null, { unit_order_no: '1000132024' })).toBeNull();
    expect(unitMismatchOf({ order_no: '1000132018' }, null)).toBeNull();
    expect(
      unitMismatchOf({ order_no: '' }, { unit_order_no: '1000132024' }),
    ).toBeNull();
  });
});
