import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import BulkPanel from './BulkPanel';

// Regresi: saat BulkPanel dipindah ke file sendiri, ikon X tertinggal dari daftar import
// sehingga panel mati dengan "X is not defined" begitu dibuka. Test ini me-render panel,
// jadi kesalahan import seperti itu langsung ketahuan.

const ROW = {
  serialnumber: '16502',
  operator_name: 'ABDUL BASIR',
  business_date: '2099-09-16',
  status: 'SCHEDULED',
  attendance: 'PRESENT',
  scheduled_shift: 'NIGHT',
  scheduled_standard_hours: '7',
  recorded_hours: 6.5,
  half_day: false,
  shift_override: null,
  standard_hours_override: null,
};

const KEY = '16502|2099-09-16';
const baseProps = (extra = {}) => ({
  selectedKeys: [KEY],
  rowsByKey: { [KEY]: ROW },
  onClose: vi.fn(),
  onApply: vi.fn(),
  onDeleteDay: vi.fn(),
  onClear: vi.fn(),
  ...extra,
});

describe('BulkPanel', () => {
  it('render detail satu operator tanpa error (ikon header ikut ter-import)', () => {
    render(<BulkPanel {...baseProps()} />);
    expect(screen.getByText('Operator detail')).toBeTruthy();
    expect(screen.getByText('ABDUL BASIR')).toBeTruthy();
    expect(screen.getAllByText('NIGHT').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    expect(screen.getByLabelText('Ganti shift')).toBeTruthy();
    expect(screen.getByLabelText('Target jam khusus')).toBeTruthy();
  });

  it('tombol silang memanggil onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onClose })} />);
    await user.click(screen.getByLabelText('Tutup panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('satu sel: ganti shift langsung terkirim tanpa tombol simpan', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onApply })} />);
    await user.selectOptions(screen.getByLabelText('Ganti shift'), 'DAY');
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }],
      shift_override: 'DAY',
    });
  });

  it('tombol "Ikut shift" mengembalikan target jam ke nilai master', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BulkPanel {...baseProps({ onApply })} />);
    await user.click(screen.getByRole('button', { name: 'Ikut shift' }));
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }],
      standard_hours_override: null,
    });
  });

  it('mode banyak sel memakai kontrol shift yang sama dan mengirim cells tepat', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    const key2 = '16503|2099-09-17';
    render(<BulkPanel {...baseProps({ onApply, selectedKeys: [KEY, key2], rowsByKey: { [KEY]: ROW, [key2]: { ...ROW, serialnumber: '16503', business_date: '2099-09-17' } } })} />);
    expect(screen.getByText('2 sel dipilih')).toBeTruthy();
    const apply = screen.getByRole('button', { name: /Terapkan ke 2 sel/i });
    expect(apply.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Ganti shift'), 'DAY');
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(onApply).toHaveBeenCalledWith({
      cells: [{ serialnumber: '16502', business_date: '2099-09-16' }, { serialnumber: '16503', business_date: '2099-09-17' }],
      status: undefined,
      half_day: undefined,
      shift_override: 'DAY',
      standard_hours_override: undefined,
    });
  });

  it('tanggal lampau: kontrol dinonaktifkan dan alasannya dijelaskan', () => {
    const pastKey = '16502|2020-01-02';
    render(<BulkPanel {...baseProps({
      selectedKeys: [pastKey],
      rowsByKey: { [pastKey]: { ...ROW, business_date: '2020-01-02' } },
    })} />);
    expect(screen.getByText(/jadwal dikunci karena kehadiran sudah dihitung/i)).toBeTruthy();
    expect(screen.getByLabelText('Ganti shift').disabled).toBe(true);
    // tombol hapus jadwal tidak boleh muncul untuk tanggal lampau
    expect(screen.queryByRole('button', { name: /Hapus jadwal/i })).toBeNull();
  });

  it('campuran lampau dan masa depan: sebutkan berapa sel yang bermasalah', () => {
    const pastKey = '16502|2020-01-02';
    render(<BulkPanel {...baseProps({
      selectedKeys: [KEY, pastKey],
      rowsByKey: { [KEY]: ROW, [pastKey]: { ...ROW, business_date: '2020-01-02' } },
    })} />);
    expect(screen.getByText(/1 dari 2 sel sudah lewat tanggalnya/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Terapkan ke 2 sel/i }).disabled).toBe(true);
  });
});
