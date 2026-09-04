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

  // Penjaga regresi untuk bug nyata: `TONES[tone] || TONES.neutral` membaca rantai
  // prototype, sehingga nama-nama ini mengembalikan fungsi Object.prototype yang truthy
  // dan bocor ke atribut class sebagai "function ... { [native code] }".
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'jatuh ke neutral untuk tone "%s" (nama milik Object.prototype)',
    (tone) => {
      render(<StatusPill tone={tone}>X</StatusPill>);
      const cls = screen.getByText('X').className;
      expect(cls).toContain('text-slate-600');
      expect(cls).not.toContain('native code');
    },
  );
});
