import { isManufacturing } from '../../config/appVariant';
import ManufacturingSowSchedulingPage from './manufacturing/SowSchedulingPage';
import SalvagingSowSchedulingPage from './salvaging/SowSchedulingPage';

export default function SowSchedulingPage() {
  return isManufacturing
    ? <ManufacturingSowSchedulingPage />
    : <SalvagingSowSchedulingPage />;
}
