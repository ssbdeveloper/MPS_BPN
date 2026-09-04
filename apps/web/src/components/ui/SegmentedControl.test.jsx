import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SegmentedControl from './SegmentedControl';

const ITEMS = [
  { key: 'all', label: 'All' },
  { key: 'mapped', label: 'Mapped', count: 66 },
  { key: 'unmapped', label: 'Unmapped', count: 0 },
];

describe('SegmentedControl', () => {
  it('merender satu tombol per item', () => {
    render(<SegmentedControl items={ITEMS} value="all" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('menandai item aktif dengan aria-pressed', () => {
    render(<SegmentedControl items={ITEMS} value="mapped" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getByRole('button', { name: /Mapped/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('memanggil onChange dengan key item', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SegmentedControl items={ITEMS} value="all" onChange={onChange} ariaLabel="Filter" />);
    await user.click(screen.getByRole('button', { name: /Mapped/ }));
    expect(onChange).toHaveBeenCalledWith('mapped');
  });

  it('menampilkan badge hanya saat count > 0', () => {
    render(<SegmentedControl items={ITEMS} value="all" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getByText('66')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
