import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/appVariant', () => ({ isManufacturing: vi.fn() }));
vi.mock('./manufacturing/OrderProgressDashboardPage', () => ({ default: () => <h1>Manufacturing variant</h1> }));
vi.mock('./salvaging/OrderProgressDashboardPage', () => ({ default: () => <h1>Salvaging variant</h1> }));

import { isManufacturing } from '../config/appVariant';
import OrderProgressDashboardPage from './OrderProgressDashboardPage';

afterEach(() => vi.clearAllMocks());

describe('Order progress variant router', () => {
  it('renders Manufacturing for a Manufacturing plant', () => {
    isManufacturing.mockReturnValue(true);
    render(<MemoryRouter><OrderProgressDashboardPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Manufacturing variant' })).toBeInTheDocument();
  });

  it('renders Salvaging without changing its route', () => {
    isManufacturing.mockReturnValue(false);
    render(<MemoryRouter><OrderProgressDashboardPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Salvaging variant' })).toBeInTheDocument();
  });
});
