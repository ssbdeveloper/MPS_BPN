import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ScheduleCard from './ScheduleCard';

const props = (extra = {}) => ({
  rules: [], exceptions: [], onSavePattern: vi.fn(), onAddException: vi.fn(), onRemoveException: vi.fn(),
  onPreview: vi.fn().mockResolvedValue({ rows_added: 4, rows_updated: 3, rows_removed: 2, rows_protected: 1 }),
  onApply: vi.fn(), busy: false, ...extra,
});

describe('ScheduleCard', () => {
  it('requires a successful preview before apply and shows exact counts', async () => {
    const user = userEvent.setup();
    render(<ScheduleCard {...props()} />);
    expect(screen.getByRole('heading', { name: 'Weekly Pattern' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Date Exceptions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Schedule' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Preview Changes' }));
    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByText('1 protected row will not change.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Schedule' }).disabled).toBe(false);
  });

  it('invalidates preview when the generation range changes', async () => {
    const user = userEvent.setup();
    render(<ScheduleCard {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Preview Changes' }));
    expect(screen.getByRole('button', { name: 'Apply Schedule' }).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2030-01-01' } });
    expect(screen.getByRole('button', { name: 'Apply Schedule' }).disabled).toBe(true);
  });
});
