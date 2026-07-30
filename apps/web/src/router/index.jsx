import { createBrowserRouter } from 'react-router-dom';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import RequireFeature from '../rbac/RequireFeature';

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

// RBAC route guard: blocks `no_access` before render. Adding a guard to a
// route = wrap it here with the feature id from the feature registry.
const guardedPage = (loader, feature) => async () => {
  const module = await loader();
  const Page = module.default;
  return {
    Component: () => (
      <RequireFeature feature={feature}>
        <Page />
      </RequireFeature>
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
    // Phase 6 — drill-through issue log ke culprit records (read-only)
    path: '/ews/issue/:issueKey',
    lazy: page(() => import('../pages/EwsIssueDrillPage')),
  },
  {
    path: '/ews/notifications',
    lazy: page(() => import('../pages/EwsNotificationsPage')),
  },
  {
    path: '/ews/roster',
    lazy: guardedPage(() => import('../pages/EwsRosterPage'), 'roster_operator'),
  },
  {
    path: '/ews/roster/config',
    lazy: guardedPage(() => import('../pages/EwsRosterConfigPage'), 'roster_operator'),
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
    children: [
      // Varian manufaktur: dispatcher me-render layout (PageHeader + <Outlet/>).
      // Salvaging me-render halaman utuh tanpa Outlet, jadi child ini diabaikan.
      {
        index: true,
        lazy: page(() => import('../pages/PPC/manufacturing/SchedulingMenuPage')),
        handle: { title: 'SOW Scheduling', eyebrow: 'Manufacturing' },
      },
      {
        path: 'projects',
        lazy: page(() => import('../pages/PPC/manufacturing/ProjectBrowserPage')),
        handle: { title: 'View All Projects', eyebrow: 'Manufacturing' },
      },
      {
        path: 'map',
        lazy: page(() => import('../pages/PPC/manufacturing/MapSapOperationPage')),
        handle: { title: 'Map SAP Operations', eyebrow: 'Manufacturing' },
      },
      {
        path: 'area',
        lazy: page(() => import('../pages/PPC/manufacturing/SchedulingAreaPage')),
        handle: { title: 'Scheduling Area', eyebrow: 'Manufacturing' },
      },
    ],
  },
  {
    path: '/sow-verification',
    lazy: page(() => import('../pages/PPC/salvaging/SowVerificationPage')),
  },
  {
    path: '/shift-definition',
    lazy: protectedPage(() => import('../pages/PPC/ShiftDefinitionPage')),
  },
  {
    path: '/ms-project-hub',
    lazy: protectedPage(() => import('../pages/PPC/MsProjectHubPage')),
  },
  {
    // Alias lama — halaman admin force-checkin sudah dilebur ke Hub.
    path: '/ms-project-admin',
    lazy: protectedPage(() => import('../pages/PPC/MsProjectHubPage')),
  },
  {
    path: '/edit-parameter',
    lazy: page(() => import('../pages/MACHINE_H/EditParameterPage')),
  },
  {
    path: '/manage-user',
    lazy: guardedPage(() => import('../pages/PPC/ManageUserPage'), 'manage_users'),
  },
  {
    path: '/manage-users',
    lazy: guardedPage(() => import('../pages/PPC/ManageUsersPage'), 'manage_users'),
  },
  {
    path: '/nfc-users',
    lazy: guardedPage(() => import('../pages/TIMESHEET/NfcUserListPage'), 'nfc_users'),
  },
  {
    path: '/create-edit-nfc',
    lazy: guardedPage(() => import('../pages/TIMESHEET/CreateEditNfcPage'), 'nfc_users'),
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
    lazy: guardedPage(() => import('../pages/OrderListPage'), 'sow_management'),
  },
  {
    path: '/sow-edit/revision/:orderNo',
    lazy: guardedPage(() => import('../pages/PE/SowRevisionEditPage'), 'sow_management'),
  },
  {
    path: '/sow-edit/:id',
    lazy: guardedPage(() => import('../pages/PE/SowEditPage'), 'sow_management'),
  },
  {
    path: '/sow-management',
    lazy: guardedPage(() => import('../pages/PE/SowManagementPage'), 'sow_management'),
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
