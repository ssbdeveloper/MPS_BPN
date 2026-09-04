import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { DensityProvider, useDensity } from './DensityProvider';

function Probe() {
  const { density, toggle } = useDensity();
  return <button type="button" onClick={toggle}>{density}</button>;
}

describe('DensityProvider', () => {
  it('default ke normal saat localStorage kosong', () => {
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('normal');
  });

  it('toggle berganti ke compact dan menyimpannya', async () => {
    const user = userEvent.setup();
    render(<DensityProvider><Probe /></DensityProvider>);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('compact');
    expect(window.localStorage.getItem('mps.density')).toBe('compact');
  });

  it('memulihkan nilai tersimpan saat mount', () => {
    window.localStorage.setItem('mps.density', 'compact');
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('compact');
  });

  it('mengabaikan nilai tersimpan yang tidak sah', () => {
    window.localStorage.setItem('mps.density', 'gigantic');
    render(<DensityProvider><Probe /></DensityProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('normal');
  });
});
