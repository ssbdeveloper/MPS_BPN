import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import WeeklyPattern from './WeeklyPattern';

const RULES = Array.from({ length: 7 }, (_, day_of_week) => ({
  day_of_week,
  runs_day: day_of_week > 0 && day_of_week < 6,
  runs_night: day_of_week > 0 && day_of_week < 6,
}));

describe('WeeklyPattern', () => {
  it('keeps seven explicit day states as a draft until saved', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<WeeklyPattern rules={RULES} onSave={onSave} busy={false} />);

    expect(screen.getAllByRole('button', { name: /: (Both Shifts|Day Only|Night Only|Off)$/ })).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'Monday: Both Shifts' }));
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save Weekly Pattern' }));
    expect(screen.getByRole('dialog', { name: 'Confirm weekly pattern' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ day_of_week: 1, runs_day: true, runs_night: false }),
    ]));
  });

  it('does not show a color legend', () => {
    render(<WeeklyPattern rules={RULES} onSave={vi.fn()} busy={false} />);
    expect(screen.queryByText(/yellow top line|blue top/i)).toBeNull();
  });
});
