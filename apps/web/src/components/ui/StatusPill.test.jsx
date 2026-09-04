import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from './StatusPill';

describe('StatusPill', () => {
  it('menampilkan isinya', () => {
    render(<StatusPill>REL</StatusPill>);
    expect(screen.getByText('REL')).toBeInTheDocument();
  });

  it('memakai warna aksen late untuk tone late', () => {
    render(<StatusPill tone="late">LATE</StatusPill>);
    expect(screen.getByText('LATE').className).toContain('text-status-late');
  });

  it('jatuh ke neutral untuk tone yang tidak dikenal', () => {
    render(<StatusPill tone="banana">X</StatusPill>);
    expect(screen.getByText('X').className).toContain('text-slate-600');
  });

  it('meneruskan title untuk tooltip', () => {
    render(<StatusPill title="Order masih terbuka di SAP">REL</StatusPill>);
    expect(screen.getByText('REL')).toHaveAttribute('title', 'Order masih terbuka di SAP');
  });
});
