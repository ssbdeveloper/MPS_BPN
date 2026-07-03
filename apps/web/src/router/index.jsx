import { createBrowserRouter } from 'react-router-dom';
import ProtectedRoute from '../components/auth/ProtectedRoute';

const page = (loader) => async () => {
  const module = await loader();
  return { Component: module.default };
};

const protectedPage = (loader) => async () => {
  const module = await loader();
  const Page = module.default;
  return {
    Component: () => (
      <ProtectedRoute>
        <Page />
      </ProtectedRoute>
    ),
  };
};

function NotFoundPage() {
  return (
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
  );
}

const router = createBrowserRouter([
  {
    path: '/LandingPage',
    lazy: page(() => import('../pages/OperationsHubPage')),
  },
  {
    path: '/operations-hub',
    lazy: page(() => import('../pages/OperationsHubPage')),
  },
  {
    path: '/ews/:type/detail',
    lazy: page(() => import('../pages/EwsDetailPage')),
  },
  {
    path: '/sap-log',
    lazy: page(() => import('../pages/SapLogPage')),
  },
  {
    path: '/order-progress-dashboard',
    lazy: page(() => import('../pages/OrderProgressDashboardPage')),
  },
  {
    path: '/receiving-shipment',
    lazy: page(() => import('../pages/PPC/ReceivingShipmentPage')),
  },
  {
    path: '/consumable-request',
    lazy: page(() => import('../pages/WAREHOUSE/ConsumableRequestPage')),
  },
  {
    path: '/tools-consumable-request',
    lazy: page(() => import('../pages/TOOLS/ToolsRequestHubPage')),
  },
  {
    path: '/tools-request',
    lazy: page(() => import('../pages/TOOLS/ToolsRequestPage')),
  },
  {
    path: '/consumable-control',
    lazy: protectedPage(() => import('../pages/WAREHOUSE/ConsumableControlPage')),
  },
  {
    path: '/tools-management',
    lazy: protectedPage(() => import('../pages/TOOLS/ToolsManagementPage')),
  },
  {
    path: '/machine-hours-sqlserver',
    lazy: page(() => import('../pages/MACHINE_H/MachineHoursSqlServerPage')),
  },
  {
    path: '/machine-hours-validation',
    lazy: protectedPage(() => import('../pages/MACHINE_H/MachineHoursValidationPage')),
  },
  {
    path: '/',
    lazy: page(() => import('../pages/WelcomePage')),
  },
  {
    path: '/welcome',
    lazy: page(() => import('../pages/WelcomePage')),
  },
  {
    path: '/login-timesheet',
    lazy: page(() => import('../pages/TIMESHEET/LoginTimesheetPage')),
  },
  {
    path: '/timesheet',
    lazy: page(() => import('../pages/TIMESHEET/TimesheetPage')),
  },
  {
    path: '/timesheet-mainmenu',
    lazy: page(() => import('../pages/TIMESHEET/TimesheetMainMenuPage')),
  },
  {
    path: '/view-timesheet',
    lazy: page(() => import('../pages/TIMESHEET/TimesheetListPage')),
  },
  {
    path: '/timesheet-validation',
    lazy: protectedPage(() => import('../pages/TIMESHEET/TimesheetValidationPage')),
  },
  {
    path: '/operator-performance',
    lazy: protectedPage(() => import('../pages/TIMESHEET/OperatorPerformancePage')),
  },
  {
    path: '/timesheet-edit/:tsnumber',
    lazy: page(() => import('../pages/TIMESHEET/TimesheetEditPage')),
  },
  {
    path: '/process-control',
    lazy: page(() => import('../pages/MACHINE_H/ProcessControlPage')),
  },
  {
    path: '/select-job',
    lazy: page(() => import('../pages/TIMESHEET/SelectJobPage')),
  },
  {
    path: '/select-machine',
    lazy: page(() => import('../pages/TIMESHEET/SelectMachinePage')),
  },
  {
    path: '/dashboard',
    lazy: page(() => import('../pages/DashboardPage')),
  },
  {
    path: '/setting',
    lazy: page(() => import('../pages/SettingPage')),
  },
  {
    path: '/component-tracking',
    lazy: page(() => import('../pages/PPC/ComponentTrackingPage')),
  },
  {
    path: '/kanban-board',
    lazy: page(() => import('../pages/PPC/KanbanLevelOnePage')),
  },
  {
    path: '/buffer-transaction',
    lazy: page(() => import('../pages/PPC/BufferTransactionPage')),
  },
  {
    path: '/sow-scheduling',
    lazy: page(() => import('../pages/PPC/SowSchedulingPage')),
  },
  {
    path: '/shift-definition',
    lazy: protectedPage(() => import('../pages/PPC/ShiftDefinitionPage')),
  },
  {
    path: '/ms-project-admin',
    lazy: protectedPage(() => import('../pages/PPC/MsProjectAdminPage')),
  },
  {
    path: '/edit-parameter',
    lazy: page(() => import('../pages/MACHINE_H/EditParameterPage')),
  },
  {
    path: '/manage-user',
    lazy: protectedPage(() => import('../pages/PPC/ManageUserPage')),
  },
  {
    path: '/manage-users',
    lazy: protectedPage(() => import('../pages/PPC/ManageUsersPage')),
  },
  {
    path: '/nfc-users',
    lazy: page(() => import('../pages/TIMESHEET/NfcUserListPage')),
  },
  {
    path: '/create-edit-nfc',
    lazy: page(() => import('../pages/TIMESHEET/CreateEditNfcPage')),
  },
  {
    path: '/unproductive',
    lazy: page(() => import('../pages/TIMESHEET/UnproductiveMenuPage')),
  },
  {
    path: '/download',
    lazy: page(() => import('../pages/DownloadPage')),
  },
  {
    path: '/sow-orders',
    lazy: page(() => import('../pages/OrderListPage')),
  },
  {
    path: '/sow-edit/revision/:orderNo',
    lazy: page(() => import('../pages/PE/SowRevisionEditPage')),
  },
  {
    path: '/sow-edit/:id',
    lazy: page(() => import('../pages/PE/SowEditPage')),
  },
  {
    path: '/sow-management',
    lazy: page(() => import('../pages/PE/SowManagementPage')),
    children: [
      {
        path: 'list',
        lazy: page(() => import('../pages/PE/SowStandardListPage')),
      },
      {
        path: 'create',
        lazy: page(() => import('../pages/PE/SowCreatePage')),
      },
      {
        path: 'history',
        lazy: page(() => import('../pages/PE/SowHistoryPage')),
      },
    ],
  },
  {
    path: '/log-timesheet',
    lazy: page(() => import('../pages/TIMESHEET/LogTimesheetPage')),
  },
  {
    path: '/tts-audio-test',
    lazy: page(() => import('../pages/TIMESHEET/TtsAudioTestPage')),
  },
  {
    path: '/editor-image',
    lazy: page(() => import('../pages/editorimage')),
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

export default router;
