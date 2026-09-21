import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoHeatmapCell, RosterLegend } from './rosterVisuals';

// Warna sel adalah kontrak yang dibaca manusia sekilas, jadi diuji sebagai perilaku:
// kelas latar yang dipakai, bukan sekadar teks yang muncul.

const base = {
  serialnumber: 'OP1',
  business_date: '2026-09-01',
  scheduled_shift: 'DAY',
  status: 'SCHEDULED',
  attendance: 'PRESENT',
  recorded_hours: 7.5,
  half_day: false,
};

function cell(overrides, props = {}) {
  const row = overrides === null ? null : { ...base, ...overrides };
  render(
    <MemoHeatmapCell
      row={row}
      selected={false}
      onStart={() => {}}
      onExtend={() => {}}
      ri={0}
      ci={0}
      name="Budi"
      date="2026-09-01"
      {...props}
    />
  );
  return screen.getByRole('button');
}

describe('heatmap cell colour', () => {
  it('marks any recorded hours as activity', () => {
    expect(cell({ recorded_hours: 7.5 }).className).toContain('bg-emerald-100');
  });

  it('still counts as activity while the shift is running', () => {
    // Keputusan produk: aktivitas nyata menang atas apakah shift sudah tuntas.
    expect(cell({ attendance: 'IN_PROGRESS', recorded_hours: 3 }).className).toContain('bg-emerald-100');
  });

  it('shows a running shift with no hours yet as scheduled, not absent', () => {
    const el = cell({ attendance: 'IN_PROGRESS', recorded_hours: 0 });
    expect(el.className).toContain('bg-slate-50');
    expect(el.getAttribute('title')).toContain('Scheduled');
  });

  it('treats a finished shift with no hours as absent', () => {
    expect(cell({ attendance: 'ABSENT', recorded_hours: 0 }).className).toContain('bg-red-100');
  });

  it.each([['SICK', 'S'], ['LEAVE', 'L'], ['PERMIT', 'P']])(
    'separates %s from unexplained absence',
    (status, code) => {
      // Merah hanya untuk absen tanpa keterangan; izin/sakit/cuti pakai amber + kode huruf.
      const el = cell({ status, attendance: status, recorded_hours: 0 });
      expect(el.className).toContain('bg-amber-50');
      expect(el.className).not.toContain('bg-red-100');
      expect(el.textContent).toContain(code);
    }
  );

  it('keeps scheduled time off neutral', () => {
    expect(cell({ status: 'OFF', attendance: 'OFF', recorded_hours: 0 }).className).toContain('bg-slate-200');
  });

  it('shows a site visit as its own colour', () => {
    expect(cell({ status: 'SITE_VISIT', attendance: 'SITE_VISIT', recorded_hours: 0 }).className).toContain('bg-sky-100');
  });

  it('marks an unscheduled day with a dash, distinct from Off', () => {
    const el = cell(null);
    expect(el.className).toContain('bg-white');
    expect(el.textContent).toContain('—');
  });

  it('separates No schedule from Scheduled by border shape, not a louder colour', () => {
    // Both are nearly white, so a second visual cue is required to distinguish them.
    const none = cell(null);
    expect(none.className).toContain('border-dashed');
    cleanup();
    const sched = cell({ attendance: 'IN_PROGRESS', recorded_hours: 0 });
    expect(sched.className).not.toContain('border-dashed');
  });

  it('no longer paints a Today outline on every cell of the column', () => {
    // Today is marked in the header/column; a per-cell outline looks too much like selection.
    expect(cell({}, { today: true }).className).not.toContain('outline-[#0077b6]');
  });

  it('prints the shift letter shown in the legend', () => {
    expect(cell({ scheduled_shift: 'DAY' }).textContent).toContain('D');
    cleanup();
    expect(cell({ scheduled_shift: 'NIGHT' }).textContent).toContain('N');
  });

  it('drops the shift colour stripes so status colour leads', () => {
    const el = cell({ scheduled_shift: 'NIGHT' });
    expect(el.className).not.toContain('border-amber-400');
    expect(el.className).not.toContain('border-indigo-500');
    expect(el.innerHTML).not.toContain('bg-indigo-500');
  });

  it('gives touch targets at least 44px in week view', () => {
    // Width follows the table-fixed column; height provides the fixed touch target.
    const el = cell({}, { size: 'lg' });
    expect(el.className).toContain('h-11');
    expect(el.className).toContain('w-full');
  });

  it('describes the cell for screen readers, not just a tooltip', () => {
    const label = cell({ scheduled_shift: 'NIGHT' }).getAttribute('aria-label');
    expect(label).toContain('Budi');
    expect(label).toContain('2026-09-01');
    expect(label).toContain('night shift');
    expect(label).toContain('Recorded');
  });

  it('activates from keyboard, not only mouse drag', () => {
    const onActivate = vi.fn();
    render(
      <MemoHeatmapCell
        row={{ ...base }}
        selected={false}
        onStart={() => {}}
        onExtend={() => {}}
        onActivate={onActivate}
        ri={0}
        ci={0}
        name="Budi"
        date="2026-09-01"
      />
    );
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(0, 0, 'keyboard');
  });

  it('reports condition without hour figures in the tooltip', () => {
    const title = cell({ recorded_hours: 7.5 }).getAttribute('title');
    expect(title).toContain('Recorded');
    expect(title).not.toMatch(/7\.5|\/7h|%/);
  });
});

describe('overtime indicator', () => {
  // In Week the cell prints "OV"; in the dense Month cell the same fact is carried by a
  // marker element, because the text would collide with the shift letter. Both cases are
  // asserted through data-ov so the test does not depend on which of the two is rendered.
  const ovMark = (el) => el.querySelector('[data-ov]');

  it('marks a day that includes overtime', () => {
    const el = cell({ recorded_hours: 9.4, overtime_hours: 6.6, overtime_record_count: 2 });
    expect(ovMark(el)).toBeTruthy();
    expect(ovMark(el).getAttribute('data-ov')).toBe('yes');
  });

  it('prints the OV letters where the cell is large enough', () => {
    const el = cell({ recorded_hours: 9.4, overtime_record_count: 2 }, { size: 'lg' });
    expect(el.textContent).toContain('OV');
  });

  it('leaves a day without overtime unmarked', () => {
    const el = cell({ recorded_hours: 7.5 });
    expect(ovMark(el)).toBeNull();
    expect(el.textContent).not.toContain('OV');
  });

  it('does not treat hours above target as overtime', () => {
    // Overtime comes only from the confirmation number, never inferred from long hours.
    const el = cell({ recorded_hours: 12, scheduled_standard_hours: 7, overtime_record_count: 0 });
    expect(ovMark(el)).toBeNull();
  });

  it('keeps the status colour when overtime is present', () => {
    // OV is an extra mark, not a new status colour: a present day stays green.
    const el = cell({ recorded_hours: 9.4, overtime_hours: 6.6, overtime_record_count: 1 });
    expect(el.className).toContain('bg-emerald-100');
  });

  it('announces overtime to screen readers, not only as a glyph', () => {
    const el = cell({ recorded_hours: 9.4, overtime_hours: 6.6, overtime_record_count: 1 });
    expect(el.getAttribute('aria-label')).toContain('overtime');
  });

  it('flags overtime whose hours are not recorded yet without inventing hours', () => {
    // 7 operator-days in September carry only zero-duration overtime rows. They must not
    // look identical to a day with no overtime, and must not claim any hours.
    const el = cell({ recorded_hours: 0, overtime_hours: 0, overtime_record_count: 0, overtime_pending_count: 1 });
    expect(ovMark(el).getAttribute('data-ov')).toBe('pending');
    expect(el.getAttribute('aria-label')).toMatch(/not (yet )?available|pending/i);
  });

  it('distinguishes recorded overtime from overtime still missing its hours', () => {
    const recorded = cell({ recorded_hours: 9, overtime_record_count: 1 });
    expect(recorded.querySelector('[data-ov]').getAttribute('data-ov')).toBe('yes');
    cleanup();
    const pending = cell({ recorded_hours: 0, overtime_pending_count: 1 });
    expect(pending.querySelector('[data-ov]').getAttribute('data-ov')).toBe('pending');
  });
});

describe('overtime worked on a day with no roster', () => {
  // Saturday and Sunday are switched off in roster_workday_rule, so the generator writes no
  // row at all. 91 such operator-days in September carry real overtime.
  const activityOnly = {
    serialnumber: 'OP1',
    business_date: '2026-09-12',
    has_roster: false,
    scheduled_shift: null,
    status: null,
    attendance: null,
    recorded_hours: 9.44,
    overtime_hours: 6.61,
    overtime_record_count: 2,
    overtime_pending_count: 0,
    half_day: false,
  };

  it('shows the overtime instead of hiding the day', () => {
    expect(cell(activityOnly).querySelector('[data-ov]')).toBeTruthy();
  });

  it('does not claim a shift that was never scheduled', () => {
    const el = cell(activityOnly);
    expect(el.textContent).not.toMatch(/\bD\b|\bN\b/);
    expect(el.getAttribute('aria-label')).not.toMatch(/day shift|night shift/);
  });

  it('is announced as having no roster rather than as Off', () => {
    const label = cell(activityOnly).getAttribute('aria-label');
    expect(label).toMatch(/no schedule/i);
    expect(label).not.toMatch(/\bOff\b/);
  });

  it('is not selectable, because there is no roster row to edit', () => {
    const onActivate = vi.fn();
    const el = cell(activityOnly, { onActivate });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
    expect(el.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('roster legend', () => {
  it('keys shifts with the same letters printed in the cells', () => {
    render(<RosterLegend />);
    const day = screen.getByText('Day Shift').closest('span');
    const night = screen.getByText('Night Shift').closest('span');
    expect(within(day).getByText('D')).toBeTruthy();
    expect(within(night).getByText('N')).toBeTruthy();
  });

  it('splits attendance and shift into separate groups', () => {
    const { container } = render(<RosterLegend />);
    expect(container.textContent).toContain('Kehadiran');
    expect(container.textContent).toContain('Shift');
    // Absent tidak lagi digabung dengan izin/sakit/cuti.
    expect(container.textContent).not.toMatch(/Absent · Sick/);
  });

  it('no longer advertises hour percentages', () => {
    const { container } = render(<RosterLegend />);
    expect(container.textContent).not.toMatch(/%|In progress/);
    expect(container.textContent).toContain('Recorded');
    expect(container.textContent).toContain('Scheduled');
  });
});
