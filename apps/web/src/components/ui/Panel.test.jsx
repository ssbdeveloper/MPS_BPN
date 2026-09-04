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

  it('memakai shadow-card saat elevated, TAPI border tetap ada', () => {
    const { container } = render(<Panel elevated><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('shadow-card');
    // Ini invarian utama komponen ini, bukan detail. Kanvas vs putih hanya 1,12:1, jadi
    // kalau OS mematikan shadow (mode kontras tinggi), border satu-satunya yang memisahkan
    // kartu dari latar. Tanpa assertion ini, seseorang bisa memindahkan border ke dalam
    // ternary `elevated` dan seluruh test tetap hijau.
    expect(container.firstChild.className).toContain('border-slate-200');
  });

  it('memakai border tanpa shadow saat tidak elevated', () => {
    const { container } = render(<Panel><p>body</p></Panel>);
    expect(container.firstChild.className).toContain('border-slate-200');
    expect(container.firstChild.className).not.toContain('shadow-card');
  });
});
