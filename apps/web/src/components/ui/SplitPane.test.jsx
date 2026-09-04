import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SplitPane from './SplitPane';

const props = {
  storageKey: 'test',
  left: <p>LEFT</p>,
  right: <p>RIGHT</p>,
};

describe('SplitPane', () => {
  it('merender kedua sisi', () => {
    render(<SplitPane {...props} />);
    expect(screen.getByText('LEFT')).toBeInTheDocument();
    expect(screen.getByText('RIGHT')).toBeInTheDocument();
  });

  it('memakai defaultLeft saat localStorage kosong', () => {
    render(<SplitPane {...props} defaultLeft={380} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '380px' });
  });

  it('memulihkan lebar tersimpan', () => {
    window.localStorage.setItem('mps.split.test', '420');
    render(<SplitPane {...props} defaultLeft={380} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '420px' });
  });

  it('menjepit lebar tersimpan ke rentang min/max', () => {
    window.localStorage.setItem('mps.split.test', '9999');
    render(<SplitPane {...props} defaultLeft={380} minLeft={280} maxLeft={520} />);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '520px' });
  });

  it('separatornya punya peran dan label yang benar', () => {
    render(<SplitPane {...props} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('menggeser lebar saat divider ditarik', () => {
    render(<SplitPane {...props} defaultLeft={380} minLeft={280} maxLeft={520} />);
    fireEvent.pointerDown(screen.getByRole('separator'));
    // getBoundingClientRect di jsdom selalu nol, jadi clientX = lebar kiri yang diminta.
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerUp(window);
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '420px' });
  });

  it('panah kanan/kiri menggeser lebar dan menjepit di batas', () => {
    render(<SplitPane {...props} defaultLeft={512} minLeft={280} maxLeft={520} />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });   // 512+16=528 -> dijepit ke 520
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '520px' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });    // 520-16=504
    expect(screen.getByTestId('splitpane-left')).toHaveStyle({ width: '504px' });
  });

  it('memulihkan gaya global saat unmount di TENGAH drag', () => {
    const { unmount } = render(<SplitPane {...props} />);
    fireEvent.pointerDown(screen.getByRole('separator'));
    expect(document.body.style.cursor).toBe('col-resize');
    unmount();
    // Tanpa stopDrag() di cleanup, kedua nilai ini tertinggal di SELURUH aplikasi.
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
