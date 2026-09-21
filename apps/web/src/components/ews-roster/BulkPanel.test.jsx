import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import BulkPanel from './BulkPanel';

const ROW = {
  serialnumber: '16502', operator_name: 'ABDUL BASIR', business_date: '2099-09-16',
  status: 'SCHEDULED', attendance: 'PRESENT', scheduled_shift: 'NIGHT',
  scheduled_standard_hours: '7', recorded_hours: 6.5, half_day: false,
  shift_override: null, standard_hours_override: null,
};
const KEY = '16502|2099-09-16';
const baseProps = (extra = {}) => ({
  selectedKeys: [KEY], rowsByKey: { [KEY]: ROW }, onClose: vi.fn(), onApply: vi.fn(),
  onDeleteDay: vi.fn(), onClear: vi.fn(), ...extra,
});

describe('BulkPanel', () => {
  it('renders one operator and its direct cell controls', () => {
    render(<BulkPanel {...baseProps()} />);
    expect(screen.getByText('Operator Details')).toBeTruthy();
    expect(screen.getByText('ABDUL BASIR')).toBeTruthy();
    expect(screen.getAllByText('NIGHT').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Change Shift')).toBeTruthy();
    expect(screen.getByLabelText('Target Hours')).toBeTruthy();
  });

  it('closes from the header button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onClose })} />);
    await user.click(screen.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('applies a one-cell shift change immediately', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onApply })} />);
    await user.selectOptions(screen.getByLabelText('Change Shift'), 'DAY');
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }],
      shift_override: 'DAY',
    });
  });

  it('resets target hours to the shift default', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onApply })} />);
    await user.click(screen.getByRole('button', { name: 'Shift Default' }));
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }],
      standard_hours_override: null,
    });
  });

  it('applies the exact selected cells in multi-cell mode', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    const key2 = '16503|2099-09-17';
    render(<BulkPanel {...baseProps({
      onApply, selectedKeys: [KEY, key2],
      rowsByKey: { [KEY]: ROW, [key2]: { ...ROW, serialnumber: '16503', business_date: '2099-09-17' } },
    })} />);
    expect(screen.getByText('2 cells selected')).toBeTruthy();
    const apply = screen.getByRole('button', { name: 'Apply to 2 Cells' });
    expect(apply.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Change Shift'), 'DAY');
    await user.click(apply);
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }, { serialnumber: '16503', business_date: '2099-09-17' }],
      status: undefined, half_day: undefined, shift_override: 'DAY', standard_hours_override: undefined,
    });
  });

  it('reads rows from a Map, the shape the page actually passes', () => {
    // Halaman menyimpan rowsByKey sebagai Map; membacanya dengan rowsByKey[key]
    // membuat detail operator hilang pada seleksi satu sel.
    render(<BulkPanel {...baseProps({ rowsByKey: new Map([[KEY, ROW]]) })} />);
    expect(screen.getByText('Operator Details')).toBeTruthy();
    expect(screen.getByText('ABDUL BASIR')).toBeTruthy();
  });

  it('shows overtime as part of the recorded total, not an amount to add again', () => {
    const row = { ...ROW, recorded_hours: 10, overtime_hours: 2, overtime_record_count: 3 };
    const { container } = render(<BulkPanel {...baseProps({ rowsByKey: { [KEY]: row } })} />);
    const text = container.textContent;
    expect(text).toMatch(/10\.0h recorded/i);
    expect(text).toMatch(/includes 2\.0h overtime/i);
    expect(text).toMatch(/3 OV transactions/i);
    expect(text).not.toMatch(/10\.0h \+ 2\.0h/i);
  });

  it('shows pending overtime without inventing hours', () => {
    const row = { ...ROW, overtime_hours: 0, overtime_record_count: 0, overtime_pending_count: 2 };
    render(<BulkPanel {...baseProps({ rowsByKey: { [KEY]: row } })} />);
    expect(screen.getByText(/overtime hours not yet available/i)).toBeTruthy();
  });

  it('does not claim the absence of an OV field proves there was no overtime', () => {
    render(<BulkPanel {...baseProps()} />);
    expect(screen.queryByText(/no overtime/i)).toBeNull();
  });

  it('locks past dates and explains the state', () => {
    const pastKey = '16502|2020-01-02';
    render(<BulkPanel {...baseProps({ selectedKeys: [pastKey], rowsByKey: { [pastKey]: { ...ROW, business_date: '2020-01-02' } } })} />);
    expect(screen.getByText('Past dates are locked.')).toBeTruthy();
    expect(screen.getByLabelText('Change Shift').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Delete Day/i })).toBeNull();
  });

  it('locks a mixed past/future selection', () => {
    const pastKey = '16502|2020-01-02';
    render(<BulkPanel {...baseProps({
      selectedKeys: [KEY, pastKey],
      rowsByKey: { [KEY]: ROW, [pastKey]: { ...ROW, business_date: '2020-01-02' } },
    })} />);
    expect(screen.getByText(/1 of 2 cells are in the past/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply to 2 Cells' }).disabled).toBe(true);
  });
});
