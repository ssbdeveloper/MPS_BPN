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
  { m: 'PUT',    p: '/sow/standard/component/:id',            f: 'sow_management', a: W },
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
  { m: 'POST',   p: '/sow/documentnos',                       f: 'sow_management', a: W }, // A-03, sebelumnya unmapped
  { m: 'POST',   p: '/sow/create',                            f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/history-order/:id/info',            f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/history-order/:id',                 f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/drafts/:context/:refKey',           f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/drafts/:context/:refKey',           f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/saved',                             f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/saved/:id',                         f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/saved/:id',                         f: 'sow_management', a: W },
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

  // Sub-operasi / child-task (rollup progress fisik ke sow.progress) — A-03, sebelumnya
  // unmapped. Semuanya menulis sow_sub_operation + memicu recomputeOperationProgress.
  // route asli memakai :idsow / :subId; di sini ':id' seperti entri lain (nama param
  // tidak dipakai saat mencocokkan, hanya jumlah segmennya).
  { m: 'POST',   p: '/sow/operations/:id/subtasks',           f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/operations/:id/subtasks/batch',     f: 'sow_management', a: W },
  { m: 'PUT',    p: '/sow/subtasks/:id',                      f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/subtasks/:id/progress',             f: 'sow_management', a: W },
  // Import Excel: commit=false hanya dry-run, TAPI commit=true menulis. Route yang sama
  // untuk dua-duanya, jadi digating sebagai write (preview ikut butuh izin tulis).
  { m: 'POST',   p: '/sow/subtasks/import',                   f: 'sow_management', a: W },
  { m: 'POST',   p: '/sow/subtask-standards/import',         f: 'sow_management', a: W },
  { m: 'DELETE', p: '/sow/subtask-standards/:id',            f: 'sow_management', a: W },

  // ---- Penanda subcont (/sow/subcont-marks) — Fase 6 / D4 ----
  // Feature TERPISAH dari sow_management: menandai operasi mengeluarkan jamnya dari
  // beban internal (implikasi biaya), jadi tidak boleh ikut izin edit teknis SOW.
  // route asli: DELETE /sow/subcont-marks/:order_no/:operation_no
  { m: 'POST',   p: '/sow/subcont-marks',                     f: 'sow_subcont', a: W },
  { m: 'DELETE', p: '/sow/subcont-marks/:id/:opno',           f: 'sow_subcont', a: W },

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
  { m: 'POST',   p: '/sow-schedule/:id/reschedule',           f: 'sow_scheduling',   a: W },
  { m: 'POST',   p: '/sow-schedule/:id/reorder',              f: 'sow_scheduling',   a: W },
  { m: 'PUT',    p: '/sow-schedule/:id',                      f: 'sow_scheduling',   a: W },
  { m: 'DELETE', p: '/sow-schedule/:id',                      f: 'sow_scheduling',   a: W },

  // ---- NFC users (/usernfc) ----
  { m: 'POST',   p: '/usernfc',                               f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/update',                        f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/mode/:id',                      f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/nfcedit/:id',                   f: 'nfc_users', a: W },
  { m: 'PUT',    p: '/usernfc/inactive/:snssb',               f: 'nfc_users', a: W },
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
  { m: 'POST',   p: '/consumable/stock/upload',               f: 'consumable_control', a: W },

  // ---- Tools management (/tools) ----
  { m: 'POST',   p: '/tools/reservations',                    f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/reservations/:id/:action',        f: 'tools_management', a: W },
  { m: 'POST',   p: '/tools/transactions/borrow',             f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/transactions/:id/return',         f: 'tools_management', a: W },
  { m: 'POST',   p: '/tools/handovers',                       f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/handovers/:id/accept',            f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/handovers/:id/reject',            f: 'tools_management', a: W },
  { m: 'PATCH',  p: '/tools/:id',                             f: 'tools_management', a: W },

  // ---- MS Project (/ms-project) ----
  // `ms_project_admin` dipecah jadi 4 feature (Fase 0 / D1) supaya hak booking bay
  // tidak lagi ikut memberi kendali penuh atas file .mpp (anomali A-04).

  // Bay scheduling (PPC) — reservasi bay + write-back headcount operasi.
  { m: 'POST',   p: '/ms-project/bay-schedules',                     f: 'bay_scheduling',    a: W },
  { m: 'DELETE', p: '/ms-project/bay-schedules/:id',                 f: 'bay_scheduling',    a: W },
  { m: 'PUT',    p: '/ms-project/bay-schedules/group/:id',           f: 'bay_scheduling',    a: W },
  { m: 'DELETE', p: '/ms-project/bay-schedules/group/:id',           f: 'bay_scheduling',    a: W },
  // route asli: PATCH /ms-project/sow-orders/:order_no/operations/people (A-03, sebelumnya unmapped)
  { m: 'PATCH',  p: '/ms-project/sow-orders/:id/operations/people',  f: 'bay_scheduling',    a: W },

  // Mapping operasi SAP -> task MS Project (prasyarat booking, per D2).
  { m: 'PUT',    p: '/ms-project/projects/:id/tasks/map-operation',  f: 'msproject_mapping', a: W },

  // Kolaborasi file .mpp — publish, upload, checkout/checkin, sync, status.
  { m: 'POST',   p: '/ms-project/projects',                          f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/bulk-load',                f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/file',                 f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/checkout',             f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/heartbeat',            f: 'msproject_collab',  a: W },
  { m: 'PUT',    p: '/ms-project/projects/:id/sync',                 f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/publish',              f: 'msproject_collab',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/checkin',              f: 'msproject_collab',  a: W },
  { m: 'PUT',    p: '/ms-project/projects/:id/status',               f: 'msproject_collab',  a: W }, // A-03, sebelumnya unmapped
  { m: 'PUT',    p: '/ms-project/projects/:id',                      f: 'msproject_collab',  a: W }, // rename project
  { m: 'PUT',    p: '/ms-project/projects/:id/tasks/:task_id',       f: 'msproject_collab',  a: W }, // edit task
  { m: 'DELETE', p: '/ms-project/projects/:id',                      f: 'ms_project_admin',  a: W }, // delete project (destructive)

  // Admin scheduling (dipersempit) — merebut lock orang lain, kalender, resource.
  { m: 'POST',   p: '/ms-project/projects/:id/force-checkin',        f: 'ms_project_admin',  a: W },
  { m: 'POST',   p: '/ms-project/calendars/refresh-from-shifts',     f: 'ms_project_admin',  a: W },
  { m: 'POST',   p: '/ms-project/resources/refresh',                 f: 'ms_project_admin',  a: W },
  { m: 'POST',   p: '/ms-project/projects/:id/resources',            f: 'ms_project_admin',  a: W },
  { m: 'DELETE', p: '/ms-project/projects/:id/resources/:rid',       f: 'ms_project_admin',  a: W },

  // ---- Dashboard maintenance (/dashboard) ----
  { m: 'POST',   p: '/dashboard/refresh-order-matviews',      f: 'dashboard', a: W },

  // Pipeline posting SAP — ter-mount di /dashboard, tapi satu-satunya permukaannya
  // halaman /sap-log (SapLogPage + ReconciliationPanel + CorrectionsPanel), dan yang
  // dititipkan adalah antrean sap_ops_request yang dieksekusi ops_worker.py ke SAP.
  // Karena itu feature-nya `sap_log`, BUKAN `dashboard` (yang read-only untuk semua
  // role non-admin dan artinya bukan pembeda apa pun). A-03, sebelumnya unmapped.
  { m: 'POST',   p: '/dashboard/sap-ops/enqueue',             f: 'sap_log', a: W },
  { m: 'POST',   p: '/dashboard/sap-ops/post-corrections',    f: 'sap_log', a: W },
  // Koreksi manual satu baris mch_transaction (+ jejak di mch_transaction_override).
  // Datanya domain jam mesin -> `machine_hours`. CATATAN: UI-nya (MachineHoursMatrix)
  // hanya dirender di halaman /sap-log, jadi supervisor/foreman yang cuma read-only di
  // `sap_log` tetap boleh menulis di sini lewat `machine_hours` (FULL). Perlu konfirmasi
  // owner kalau maunya senada dengan gate halaman.
  { m: 'POST',   p: '/dashboard/machine-hours-override',      f: 'machine_hours', a: W },

  // ---- Configuration Rules (/config/rules) — break hours + max record untuk
  // pipeline SAP. Halaman FE /config-rules (feature `config_rules`). B-2026-08-19.
  { m: 'PUT',    p: '/config/rules',                           f: 'config_rules', a: W },

  // ---- EWS (/ews) ----
  { m: 'PUT',    p: '/ews/issue-log/:id/resolve',             f: 'ews', a: W },
  { m: 'POST',   p: '/ews/issue-log/generate',                f: 'ews', a: W },
  { m: 'POST',   p: '/ews/notifications/:id/played',          f: 'ews', a: W },

  // ---- EWS roster / attendance (/ews/roster) ----
  { m: 'PUT',    p: '/ews/roster/status',                     f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/bulk',                       f: 'roster_operator', a: W },
  { m: 'DELETE', p: '/ews/roster',                            f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/half-day',                   f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/foreman-team/member',        f: 'roster_foreman_team', a: W },
  { m: 'DELETE', p: '/ews/roster/foreman-team/member',        f: 'roster_foreman_team', a: W },
  { m: 'PUT',    p: '/ews/roster/config/workday',             f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/config/exceptions',          f: 'roster_operator', a: W },
  { m: 'DELETE', p: '/ews/roster/config/exceptions/:businessDate', f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/group',                      f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/permanent-shift',            f: 'roster_operator', a: W },
  // Master shift (single source) — ubah jam/standard hours di public.shift_definition dan
  // sinkronkan snapshot baris future. Fallback A-03: route baru wajib ikut manifest.
  { m: 'PUT',    p: '/ews/roster/shift',                      f: 'roster_operator', a: W },
  { m: 'PUT',    p: '/ews/roster/shift/resync-future',         f: 'roster_operator', a: W },
  { m: 'POST',   p: '/ews/roster/generate',                   f: 'roster_operator', a: W },
  { m: 'POST',   p: '/ews/roster/generate/preview',           f: 'roster_operator', a: W },
  { m: 'POST',   p: '/ews/roster/generate/apply',             f: 'roster_operator', a: W },
  // Shift-lock R3 — pin operator DAY/NIGHT (INSERT ews.operator_shift_lock) dan
  // soft-cancel-nya. Domain sama dengan route roster lain. A-03, sebelumnya unmapped.
  { m: 'POST',   p: '/ews/roster/lock',                       f: 'roster_operator', a: W },
  { m: 'POST',   p: '/ews/roster/lock/:id/cancel',            f: 'roster_operator', a: W },

  // ---- Manage users (/auth) ----
  { m: 'POST',   p: '/auth/users',                            f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/users/:id',                        f: 'manage_users', a: W },
  { m: 'DELETE', p: '/auth/users/:id',                        f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/users/:id/permissions',            f: 'manage_users', a: W },
  // Role packages (rbacController) — 2026-09-07
  { m: 'POST',   p: '/auth/roles',                            f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/roles/:role_key',                  f: 'manage_users', a: W },
  { m: 'DELETE', p: '/auth/roles/:role_key',                  f: 'manage_users', a: W },
  { m: 'PUT',    p: '/auth/users/:id/roles',                  f: 'manage_users', a: W },
];

// Writes that are NOT admin-RBAC and must stay open (operator/NFC shopfloor + self/login).
// Operator login is intentionally OUT OF SCOPE for now (focus = Operations Hub users).
const ALLOWLIST = [
  { m: 'POST', p: '/auth/login' },
  { m: 'POST', p: '/auth/change-password' },   // self-service
  // operator / shopfloor (NFC) timesheet flow — do NOT gate:
  { m: 'POST', p: '/timesheet' },
  { m: 'PUT',  p: '/timesheet/checkout' },
  { m: 'PUT',  p: '/timesheet/checkout-unprod' },
  { m: 'PUT',  p: '/timesheet/checkoutid' },
  // device fleet heartbeat — device anonim, autentikasi via X-Device-Token di controller:
  { m: 'POST', p: '/device-heartbeat' },
  // POST berbaju BACA — bukan mutasi. getPlanhoursMulti hanya
  // `SELECT codenumber, planhours FROM sow WHERE codenumber = ANY($1)`; POST dipakai
  // semata karena daftar codenumber-nya panjang (tidak muat di query string).
  // Memetakannya sebagai write akan menolak role read-only untuk sekadar membaca,
  // padahal GET /sow/planhours yang setara TIDAK digating sama sekali di fase ini.
  { m: 'POST', p: '/sow/planhours/multi' },
];

module.exports = { MANIFEST, ALLOWLIST };
