import { isManufacturing } from '../../config/appVariant';
import ManufacturingSchedulingLayout from './manufacturing/SowSchedulingPage';
import SalvagingSowSchedulingPage from './salvaging/SowSchedulingPage';

// Dispatcher varian. Manufaktur = layout rute bersarang (PageHeader + <Outlet/>);
// salvaging = halaman utuh apa adanya (tanpa Outlet).
export default function SowSchedulingPage() {
  return isManufacturing()
    ? <ManufacturingSchedulingLayout />
    : <SalvagingSowSchedulingPage />;
}
