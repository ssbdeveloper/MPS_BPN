// RBAC — write-endpoint manifest + allow-list (interim x-role enforcement).
// ------------------------------------------------------------------
// Every WRITE route reachable from Operations Hub maps to { feature, action }.
// The guard (./rbacGuard.js) is DEFAULT-DENY: an unmapped, non-allow-listed write
// is refused. Reads (GET/HEAD/OPTIONS) are not gated in this phase.
//
// Paths are FULL paths (mount + route). `:param` matches one segment.
// Keep in sync with routes/*.js — a new write route must be added here or it
// fails closed (that is the intended safety property).

// action is 'write' for all mutations (create/update/delete/approve/etc).
const W = 'write';

const MANIFEST = [
  // ---- SOW management (/sow) ----
  { m: 'POST',   p: '/sow/templates',                         f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/templates/:id',                     f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/templates/:id',                     f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/standard/component/:id',            f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/standard/operation',                f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/standard/operation/:id',            f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/standard/operation/:id',            f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/standard/operation/:id/attachments',f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/standard/attachment/:id',           f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/nnva/base',                         f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/nnva/base/:id',                     f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/nnva/base/:id',                     f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/nnva/standard/:id',                 f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/operationcard/:id',                 f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/create',                            f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/history-order/:id/info',            f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/history-order/:id',                 f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/progress-history',                  f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/parts',                             f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/parts/:id',                         f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/parts/:id',                         f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/operations',                        f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/operations/:id',                    f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/operations/:id',                    f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/sow',                               f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/sow/:id',                           f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/createex',                          f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/upsert',                            f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/updateex/:id',                      f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/finish',                            f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow',                                   f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/:id',                               f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/:id',                               f: 'sow_management', a: W },

  // ---- SOW scheduling / shift rules / verification (/sow-schedule) ----
  { m: 'POST',   p: '/sow-schedule/shift-rules',              f: 'shift_rules',      a: W },
  { m: 'PUT',    p: '/sow-schedule/shift-rules/:id',          f: 'shift_rules',      a: W },
  { m: 'DELETE', p: '/sow-schedule/shift-rules/:id',          f: 'shift_rules',      a: W },
  { m: 'POST',   p: '/sow-schedule/batches',                  f: 'sow_scheduling',   a: W },
  { m: 'DELETE', p: '/sow-schedule/batches/:id',              f: 'sow_scheduling',   a: W },
  { m: 'PUT',    p: '/sow-schedule/capacity',                 f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/capacity',                 f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/overtime',                 f: 'sow_scheduling',   a: W },
  { m: 'PUT',    p: '/sow-schedule/overtime/:id',             f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/overtime/:id/approve',     f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/overtime/:id/reject',      f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/overtime/:id/assign',      f: 'sow_scheduling',   a: W },
  { m: 'DELETE', p: '/sow-schedule/overtime/:id',             f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/operation-status',         f: 'sow_verification', a: W },
  { m: 'DELETE', p: '/sow-schedule/operation-status/:id',     f: 'sow_verification', a: W },
  { m: 'POST',   p: '/sow-schedule',                          f: 'sow_scheduling',   a: W },
  { m: 'PUT',    p: '/sow-schedule/:id',                      f: 'sow_scheduling',   a: W },
  { m: 'DELETE', p: '/sow-schedule/:id',                      f: 'sow_scheduling',   a: W },

  // ---- NFC users (/usernfc) ----
  { m: 'POST',   p: '/usernfc',                               f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/update',                        f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/mode/:id',                      f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/nfcedit/:id',                   f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/:id',                           f: 'nfc_users', a: W },
  { m: 'DELETE', p: '/usernfc/:id',                           f: 'nfc_users', a: W },

  // ---- Timesheet ADMIN writes (/timesheet). Operator writes are allow-listed. ----
  { m: 'PUT',    p: '/timesheet/validation',                  f: 'timesheet_validation', a: W },
  { m: 'POST',   p: '/timesheet/post-to-sap',                 f: 'timesheet_validation', a: W },
  { m: 'PUT',    p: '/timesheet/updateadmin/:id',             f: 'timesheet_validation', a: W },
  { m: 'PATCH',  p: '/timesheet/:id',                         f: 'timesheet_validation', a: W },
  { m: 'DELETE', p: '/timesheet/:id',                         f: 'timesheet_validation', a: W },

  // ---- Process control / machine hours (/process-control) ----
  { m: 'POST',   p: '/process-control/categories',            f: 'machine_hours', a: W },
  { m: 'PUT',    p: '/process-control/categories/:id',        f: 'machine_hours', a: W },
  { m: 'DELETE', p: '/process-control/categories/:id',        f: 'machine_hours', a: W },
  { m: 'POST',   p: '/process-control/parameters',            f: 'machine_hours', a: W },
  { m: 'PUT',    p: '/process-control/parameters/:id',        f: 'machine_hours', a: W },
  { m: 'DELETE', p: '/process-control/parameters/:id',        f: 'machine_hours', a: W },
  { m: 'POST',   p: '/process-control/choices',               f: 'machine_hours', a: W },
  { m: 'PUT',    p: '/process-control/choices/:id',           f: 'machine_hours', a: W },
  { m: 'DELETE', p: '/process-control/choices/:id',           f: 'machine_hours', a: W },
  { m: 'POST',   p: '/process-control/items',                 f: 'machine_hours', a: W },
  { m: 'PUT',    p: '/process-control/items/:id',             f: 'machine_hours', a: W },
  { m: 'DELETE', p: '/process-control/items/:id',             f: 'machine_hours', a: W },
  { m: 'PATCH',  p: '/process-control/validate/:id',          f: 'machine_hours', a: W },
  { m: 'POST',   p: '/process-control',                       f: 'machine_hours', a: W },
  { m: 'PUT',    p: '/process-control/:id',                   f: 'machine_hours', a: W },
  { m: 'DELETE', p: '/process-control/:id',                   f: 'machine_hours', a: W },

  // ---- Receiving & shipping (/receiving-shipment) ----
  { m: 'POST',   p: '/receiving-shipment/customers',          f: 'receiving_shipment', a: W },
  { m: 'POST',   p: '/receiving-shipment/part-categories',    f: 'receiving_shipment', a: W },
  { m: 'POST',   p: '/receiving-shipment',                    f: 'receiving_shipment', a: W },
  { m: 'PUT',    p: '/receiving-shipment/:id',                f: 'receiving_shipment', a: W },
  { m: 'DELETE', p: '/receiving-shipment/:id',                f: 'receiving_shipment', a: W },

  // ---- Component tracking (/component-tracking) ----
  { m: 'POST',   p: '/component-tracking/buffers',            f: 'component_tracking', a: W },
  { m: 'PATCH',  p: '/component-tracking/buffers/priorities', f: 'component_tracking', a: W },
  { m: 'PATCH',  p: '/component-tracking/buffers/:id/note',   f: 'component_tracking', a: W },

  // ---- Kanban (/kanban) ----
  { m: 'POST',   p: '/kanban/refresh',                        f: 'kanban_board', a: W },

  // ---- Consumable control (/consumable) ----
  { m: 'PATCH',  p: '/consumable/control/:id/approve',        f: 'consumable_control', a: W },
  { m: 'PATCH',  p: '/consumable/control/:id/close',          f: 'consumable_control', a: W },
  { m: 'PATCH',  p: '/consumable/control/items/:id/quantity', f: 'consumable_control', a: W },
  { m: 'PATCH',  p: '/consumable/control/items/:id/reject',   f: 'consumable_control', a: W },
  { m: 'POST',   p: '/consumable/request',                    f: 'consumable_control', a: W },

  // ---- Tools management (/tools) ----
  { m: 'POST',   p: '/tools/reservations',                    f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/reservations/:id/:action',        f: 'tools_management', a: W },
  { m: 'POST',   p: '/tools/transactions/borrow',             f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/transactions/:id/return',         f: 'tools_management', a: W },
  { m: 'POST',   p: '/tools/handovers',                       f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/handovers/:id/accept',            f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/handovers/:id/reject',            f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/:id',                             f: 'tools_management', a: W },

  // ---- MS Project admin (/ms-project) ----
  { m: 'POST',   p: '/ms-project/bay-schedules',                     f: 'ms_project_admin', a: W },
  { m: 'DELETE', p: '/ms-project/bay-schedules/:id',                 f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/bulk-load',                f: 'ms_project_admin', a: W },
  { m: 'PUT',    p: '/ms-project/projects/:id/tasks/map-sow-order',  f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects',                          f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/file',                 f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/checkout',             f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/heartbeat',            f: 'ms_project_admin', a: W },
  { m: 'PUT',    p: '/ms-project/projects/:id/sync',                 f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/publish',             f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/checkin',             f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/force-checkin',       f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/calendars/refresh-from-shifts',     f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/resources/refresh',                 f: 'ms_project_admin', a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/resources',           f: 'ms_project_admin', a: W },
  { m: 'DELETE', p: '/ms-project/projects/:id/resources/:rid',      f: 'ms_project_admin', a: W },

  // ---- Dashboard maintenance (/dashboard) ----
  { m: 'POST',   p: '/dashboard/refresh-order-matviews',      f: 'dashboard', a: W },

  // ---- EWS (/ews) ----
  { m: 'POST',   p: '/ews/actions/sync',                      f: 'ews', a: W },
  { m: 'PUT',    p: '/ews/actions/:id/resolve',               f: 'ews', a: W },

  // ---- Manage users (/auth) ----
  { m: 'POST',   p: '/auth/users',                            f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/users/:id',                        f: 'manage_users', a: W },
  { m: 'DELETE', p: '/auth/users/:id',                        f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/users/:id/permissions',            f: 'manage_users', a: W },
];

// Writes that are NOT admin-RBAC and must stay open (operator/NFC shopfloor + self/login).
// Operator login is intentionally OUT OF SCOPE for now (focus = Operations Hub users).
const ALLOWLIST = [
  { m: 'POST', p: '/auth/login' },
  { m: 'POST', p: '/auth/change-password' },   // self-service
  { m: 'POST', p: '/token/verify-token' },
  // operator / shopfloor (NFC) timesheet flow — do NOT gate:
  { m: 'POST', p: '/timesheet' },
  { m: 'PUT',  p: '/timesheet/checkout' },
  { m: 'PUT',  p: '/timesheet/checkout-unprod' },
  { m: 'PUT',  p: '/timesheet/checkoutid' },
];

module.exports = { MANIFEST, ALLOWLIST };
