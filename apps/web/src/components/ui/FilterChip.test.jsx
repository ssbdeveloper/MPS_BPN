import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import FilterChip from './FilterChip';

describe('FilterChip', () => {
  it('menampilkan label dan value', () => {
    render(<FilterChip label="Workcenter" value="C5100FAB" />);
    expect(screen.getByText('Workcenter')).toBeInTheDocument();
    expect(screen.getByText('C5100FAB')).toBeInTheDocument();
  });

  it('tidak menampilkan tombol hapus tanpa onRemove', () => {
    render(<FilterChip label="Workcenter" value="C5100FAB" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('memanggil onRemove saat tombol hapus diklik', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<FilterChip label="Workcenter" value="C5100FAB" onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove Workcenter filter' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
