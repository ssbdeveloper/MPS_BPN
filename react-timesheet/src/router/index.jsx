import { createBrowserRouter } from 'react-router-dom';
import WelcomePage from '../pages/WelcomePage';
import OperationsHubPage from '../pages/OperationsHubPage';
import LoginTimesheetPage from '../pages/TIMESHEET/LoginTimesheetPage';
import TimesheetPage from '../pages/TIMESHEET/TimesheetPage';
import TimesheetMainMenuPage from '../pages/TIMESHEET/TimesheetMainMenuPage';
import TimesheetListPage from '../pages/TIMESHEET/TimesheetListPage';
import TimesheetValidationPage from '../pages/TIMESHEET/TimesheetValidationPage';
import LogTimesheetPage from '../pages/TIMESHEET/LogTimesheetPage';
import TtsAudioTestPage from '../pages/TIMESHEET/TtsAudioTestPage';


import TimesheetEditPage from '../pages/TIMESHEET/TimesheetEditPage';
import ProcessControlPage from '../pages/MACHINE_H/ProcessControlPage';
import SelectJobPage from '../pages/TIMESHEET/SelectJobPage';
import SelectMachinePage from '../pages/TIMESHEET/SelectMachinePage';
import DashboardPage from '../pages/DashboardPage';
import MPDashboardPage from '../pages/MPDashboardPage';
import SettingPage from '../pages/SettingPage';
import ComponentTrackingPage from '../pages/PPC/ComponentTrackingPage';
import BufferTransactionPage from '../pages/PPC/BufferTransactionPage';
import SowSchedulingPage from '../pages/PPC/SowSchedulingPage';
import EditParameterPage from '../pages/MACHINE_H/EditParameterPage';
import NfcUserListPage from '../pages/TIMESHEET/NfcUserListPage';
import CreateEditNfcPage from '../pages/TIMESHEET/CreateEditNfcPage';
import ManageUserPage from '../pages/PPC/ManageUserPage';
import ManageUsersPage from '../pages/PPC/ManageUsersPage';
import UnproductiveMenuPage from '../pages/TIMESHEET/UnproductiveMenuPage';
import DownloadPage from '../pages/DownloadPage';
import OrderListPage from '../pages/OrderListPage';
import SowEditPage from '../pages/PE/SowEditPage';
import SowRevisionEditPage from '../pages/PE/SowRevisionEditPage';
import SowManagementPage from '../pages/PE/SowManagementPage';
import SowStandardListPage from '../pages/PE/SowStandardListPage';
import SowCreatePage from '../pages/PE/SowCreatePage';
import SowHistoryPage from '../pages/PE/SowHistoryPage';
import EditorImage from '../pages/editorimage';
import ReceivingShipmentPage from '../pages/PPC/ReceivingShipmentPage';
import MachineHoursSqlServerPage from '../pages/MACHINE_H/MachineHoursSqlServerPage';
import MachineHoursValidationPage from '../pages/MACHINE_H/MachineHoursValidationPage';
import ConsumableRequestPage from '../pages/WAREHOUSE/ConsumableRequestPage';
import ConsumableControlPage from '../pages/WAREHOUSE/ConsumableControlPage';
import ToolsManagementPage from '../pages/TOOLS/ToolsManagementPage';
import ToolsRequestHubPage from '../pages/TOOLS/ToolsRequestHubPage';
import ToolsRequestPage from '../pages/TOOLS/ToolsRequestPage';
import ProtectedRoute from "../components/auth/ProtectedRoute";

/**
 * Router Configuration
 * Definisi semua routes aplikasi
 */
const router = createBrowserRouter([
  {
    path: '/LandingPage',
    element: <OperationsHubPage />,
  },
  {
    path: '/operations-hub',
    element: <OperationsHubPage />,
  },
  {
    path: '/receiving-shipment',
    element: <ReceivingShipmentPage />,
  },
  {
    path: '/consumable-request',
    element: <ConsumableRequestPage />,
  },
  {
    path: '/tools-consumable-request',
    element: <ToolsRequestHubPage />,
  },
  {
    path: '/tools-request',
    element: <ToolsRequestPage />,
  },
  {
    path: '/consumable-control',
    element: (
      <ProtectedRoute>
        <ConsumableControlPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/tools-management',
    element: (
      <ProtectedRoute>
        <ToolsManagementPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/machine-hours-sqlserver',
    element: <MachineHoursSqlServerPage />,
  },
  {
    path: '/machine-hours-validation',
    element: (
      <ProtectedRoute>
        <MachineHoursValidationPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: <WelcomePage />,
  },
  {
    path: '/welcome',
    element: <WelcomePage />,
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
    path: '/mps-dashboard',
    element: <MPDashboardPage />,
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
    path: '/buffer-transaction',
    element: <BufferTransactionPage />,
  },
  {
    path: '/sow-scheduling',
    element: <SowSchedulingPage />,
  },
  {
    path: '/edit-parameter',
    element: <EditParameterPage />,
  },
  {
    path: '/manage-user',
    element: (
      <ProtectedRoute>
        <ManageUserPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/manage-users',
    element: (
      <ProtectedRoute>
        <ManageUsersPage />
      </ProtectedRoute>
    ),
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
    path: '/sow-edit/revision/:orderNo',
    element: <SowRevisionEditPage />,
  },
  {
    path: '/sow-edit/:id',
    element: <SowEditPage />,
  },
  {
    path: '/sow-management',
    element: <SowManagementPage />,
    children: [
      {
        path: 'list',
        element: <SowStandardListPage />,
      },
      {
        path: 'create',
        element: <SowCreatePage />,
      },
      {
        path: 'history',
        element: <SowHistoryPage />,
      },
    ],
  },
{
  path: '/log-timesheet',
  element: <LogTimesheetPage />,
},
{
  path: '/tts-audio-test',
  element: <TtsAudioTestPage />,
},
{
  path: '/editor-image',
  element: <EditorImage />,
},

  {
    path: '*',
    element: (
      <div className="flex items-center justify-center h-dvh bg-gray-100">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">404</h1>
          <p className="text-xl text-gray-600 mb-6">Page not found</p>
          <a
            href="/operations-hub"
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Back to MPS Main
          </a>
        </div>
      </div>
    ),
  },
]);

export default router;
