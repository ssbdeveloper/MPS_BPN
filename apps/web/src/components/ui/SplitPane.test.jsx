import { render, screen } from '@testing-library/react';
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
});
