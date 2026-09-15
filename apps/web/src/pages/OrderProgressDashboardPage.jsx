import React from 'react';
import { isManufacturing } from '../config/appVariant';
import ManufacturingOrderProgressDashboardPage from './manufacturing/OrderProgressDashboardPage';
import SalvagingOrderProgressDashboardPage from './salvaging/OrderProgressDashboardPage';

export default function OrderProgressDashboardPage() {
  return isManufacturing()
    ? <ManufacturingOrderProgressDashboardPage />
    : <SalvagingOrderProgressDashboardPage />;
}
