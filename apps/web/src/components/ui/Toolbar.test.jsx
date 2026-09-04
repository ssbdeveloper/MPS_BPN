import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Toolbar from './Toolbar';

describe('Toolbar', () => {
  it('merender anak-anaknya', () => {
    render(<Toolbar><button type="button">Refresh</button></Toolbar>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('menerima className tambahan untuk layout', () => {
    const { container } = render(<Toolbar className="mt-4"><span>x</span></Toolbar>);
    expect(container.firstChild.className).toContain('mt-4');
  });
});
