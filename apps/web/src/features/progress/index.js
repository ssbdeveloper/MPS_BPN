// features/progress — shared sub-task / physical-progress toolkit.
//
// One implementation, two consumers:
//   • pages/OrderListPage.jsx        (PE — Order List, operation-level + sub-tasks)
//   • pages/ProgressUpdatePage.jsx   (Foreman — dedicated Update Progress page)
//
// Everything here is presentation/logic identical to the original inline copies
// that lived in OrderListPage.jsx. Endpoint-agnostic: callers pass full URLs.

export {
  API_BASE,
  SUBTASK_STATUS,
  compressImage,
  fmtTs,
  authHeaders,
  fmtHours,
  fmtWeightPct,
  computeRollup,
} from './helpers';

export {
  StatusPill,
  InfoRow,
  ProgressBar,
  HistoryCard,
  ModalShell,
} from './primitives';

export { ProgressUpdatePanel } from './ProgressUpdatePanel';

export {
  SubTaskProgressModal,
  SubTaskFormModal,
  SubTaskFromStandardModal,
  SubTaskRow,
  SubOperationPanel,
} from './subtasks';

export { SubTaskImportButton, SubTaskTemplateLink } from './SubTaskImport';
