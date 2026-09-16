import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DateExceptions from './DateExceptions';

describe('DateExceptions', () => {
  it('defaults to one date and makes range mode opt-in', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<DateExceptions exceptions={[]} onAdd={onAdd} onRemove={vi.fn()} busy={false} />);
    expect(screen.getByLabelText('Date')).toBeTruthy();
    expect(screen.queryByLabelText('End date')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Date Range' }));
    expect(screen.getByLabelText('End date')).toBeTruthy();
  });

  it('adds and removes exact-date exceptions', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<DateExceptions exceptions={[{ business_date: '2026-12-25', runs_day: false, runs_night: false, reason: 'Christmas Holiday' }]} onAdd={onAdd} onRemove={onRemove} busy={false} />);
    expect(screen.getByText('Christmas Holiday')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove exception for 2026-12-25' }));
    expect(onRemove).toHaveBeenCalledWith('2026-12-25');
  });
});
