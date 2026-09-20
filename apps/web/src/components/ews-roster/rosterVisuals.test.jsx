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
    expect(cell({}, { size: 'lg' }).className).toContain('h-11');
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
    expect(onActivate).toHaveBeenCalledWith(0, 0);
  });

  it('reports condition without hour figures in the tooltip', () => {
    const title = cell({ recorded_hours: 7.5 }).getAttribute('title');
    expect(title).toContain('Recorded');
    expect(title).not.toMatch(/7\.5|\/7h|%/);
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
