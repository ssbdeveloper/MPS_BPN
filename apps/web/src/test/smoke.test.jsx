import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('merender komponen React dan memuat matcher jest-dom', () => {
    render(<button type="button">Save</button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
