import { createBrowserRouter } from 'react-router-dom';
import LandingPage from '../pages/LandingPage';
import LoginTimesheetPage from '../pages/LoginTimesheetPage';
import TimesheetPage from '../pages/TimesheetPage';
import TimesheetMainMenuPage from '../pages/TimesheetMainMenuPage';
import TimesheetListPage from '../pages/TimesheetListPage';
import TimesheetValidationPage from '../pages/TimesheetValidationPage';
import TimesheetValidationPageV2 from '../pages/TimesheetValidationPageV2';
import LogTimesheetPage from '../pages/LogTimesheetPage';


import TimesheetEditPage from '../pages/TimesheetEditPage';
import ProcessControlPage from '../pages/ProcessControlPage';
import SelectJobPage from '../pages/SelectJobPage';
import SelectMachinePage from '../pages/SelectMachinePage';
import DashboardPage from '../pages/DashboardPage';
import SettingPage from '../pages/SettingPage';
import ComponentTrackingPage from '../pages/ComponentTrackingPage';
import EditParameterPage from '../pages/EditParameterPage';
import NfcUserListPage from '../pages/NfcUserListPage';
import CreateEditNfcPage from '../pages/CreateEditNfcPage';
import UnproductiveMenuPage from '../pages/UnproductiveMenuPage';
import DownloadPage from '../pages/DownloadPage';
import OrderListPage from '../pages/OrderListPage';
import SowEditPage from '../pages/SowEditPage';
import ProtectedRoute from "../components/auth/ProtectedRoute";

/**
 * Router Configuration
 * Definisi semua routes aplikasi
 */
const router = createBrowserRouter([
  {
    path: '/LandingPage',
    element: <LandingPage />,
  },
  {
    path: '/',
    element: <LoginTimesheetPage />,
  },
  {
    path: '/login-timesheet',
    element: <LoginTimesheetPage />,
  },
  {
    path: '/timesheet',
    element: <TimesheetPage />,
  },
  {
    path: '/timesheet-mainmenu',
    element: <TimesheetMainMenuPage />,
  },
  {
    path: '/view-timesheet',
    element: <TimesheetListPage />,
  },
  {
  path: '/timesheet-validation',
  element: (
    <ProtectedRoute>
      <TimesheetValidationPage />
    </ProtectedRoute>
  ),
},

  {
    path: '/timesheet-edit/:tsnumber',
    element: <TimesheetEditPage />,
  },
  {
    path: '/process-control',
    element: <ProcessControlPage />,
  },
  {
    path: '/select-job',
    element: <SelectJobPage />,
  },
  {
    path: '/select-machine',
    element: <SelectMachinePage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/setting',
    element: <SettingPage />,
  },
  {
    path: '/component-tracking',
    element: <ComponentTrackingPage />,
  },
  {
    path: '/edit-parameter',
    element: <EditParameterPage />,
  },
  {
    path: '/nfc-users',
    element: <NfcUserListPage />,
  },
  {
    path: '/create-edit-nfc',
    element: <CreateEditNfcPage />,
  },
  {
    path: '/unproductive',
    element: <UnproductiveMenuPage />,
  },
  {
    path: '/download',
    element: <DownloadPage />,
  },
  {
    path: '/sow-orders',
    element: <OrderListPage />,
  },
  {
    path: '/sow-edit/:id',
    element: <SowEditPage />,
  },
{
  path: '/log-timesheet',
  element: <LogTimesheetPage />,
},
{
  path: '/timesheet-validation-v2',
  element: (
    <ProtectedRoute>
      <TimesheetValidationPageV2 />
    </ProtectedRoute>
  ),
},

  {
    path: '*',
    element: (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">404</h1>
          <p className="text-xl text-gray-600 mb-6">Page not found</p>
          <a
            href="/"
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    ),
  },
]);

export default router;
