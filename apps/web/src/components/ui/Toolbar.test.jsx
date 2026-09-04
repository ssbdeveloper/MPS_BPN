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

  it('meneruskan atribut lain (a11y, data-*) ke elemen', () => {
    render(<Toolbar role="toolbar" aria-label="Order filters"><span>x</span></Toolbar>);
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'Order filters');
  });
});
