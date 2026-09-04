import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Panel from './Panel';

describe('Panel', () => {
  it('merender judul, eyebrow, dan isi', () => {
    render(<Panel eyebrow="Source" title="SOW orders"><p>body</p></Panel>);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('SOW orders')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('menghilangkan header sepenuhnya saat tidak ada title/eyebrow/right', () => {
    const { container } = render(<Panel><p>body</p></Panel>);
    expect(container.querySelector('header')).toBeNull();
  });

  it('memakai shadow-card saat elevated', () => {
    const { container } = render(<Panel elevated><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('shadow-card');
  });

  it('memakai border tanpa shadow saat tidak elevated', () => {
    const { container } = render(<Panel><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('border-slate-200');
    expect(container.firstChild.className).not.toContain('shadow-card');
  });
});
