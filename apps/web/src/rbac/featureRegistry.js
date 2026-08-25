// ------------------------------------------------------------------
// Feature registry — the catalog of RBAC-guarded features/pages.
//
// Adding a new feature to RBAC = add ONE entry here (id, label, module,
// routes). Route guards and the menu read from this registry, so nothing
// else needs to change.
// ------------------------------------------------------------------

export const FEATURES = {
  operations_hub:       { id: 'operations_hub',       label: 'Operations Hub',      module: 'Core',      routes: ['/operations-hub', '/LandingPage'] },
  dashboard:            { id: 'dashboard',            label: 'Dashboard',           module: 'Core',      routes: ['/dashboard'] },
  order_progress:       { id: 'order_progress',       label: 'Order Progress',      module: 'Core',      routes: ['/order-progress-dashboard'] },
  ews:                  { id: 'ews',                  label: 'Early Warning',       module: 'Core',      routes: ['/ews'] },

  sow_management:       { id: 'sow_management',        label: 'SOW Management',      module: 'PE',        routes: ['/sow-management', '/sow-orders', '/sow-edit'] },
  // Fase 6 (D4). Penandaan subcont berimplikasi BIAYA, jadi izinnya dipisah dari sow_management
  // yang mengatur pengeditan teknis SOW. Tanpa route sendiri: kontrolnya hidup di dalam halaman
  // SOW History. Entri ini tetap wajib ada supaya feature-nya muncul di Manage Users dan bisa
  // di-assign per orang — cermin dari apps/api/rbac/features.js.
  sow_subcont:          { id: 'sow_subcont',            label: 'SOW Subcont',         module: 'PE',        routes: [] },
  sow_scheduling:      { id: 'sow_scheduling',        label: 'SOW Scheduling',      module: 'PPC',       routes: ['/sow-scheduling'] },
  shift_rules:          { id: 'shift_rules',           label: 'Shift Capacity',      module: 'PPC',       routes: ['/shift-definition'] },
  roster_operator:      { id: 'roster_operator',       label: 'Roster Operator',     module: 'Timesheet', routes: ['/ews/roster'] },
  roster_foreman_team:  { id: 'roster_foreman_team',   label: 'Foreman Team',        module: 'Timesheet', routes: ['/ews/foreman-team'] },
  // MS Project / bay scheduling — `ms_project_admin` was one coarse feature covering
  // bay booking, SAP-operation mapping, .mpp collaboration AND the admin panel. Split
  // into four so booking rights no longer imply control over the .mpp files.
  // These three mirror `apps/api/rbac/features.js` — keep both sides identical.
  // Their routes are longer than '/sow-scheduling', so ROUTE_INDEX (longest first)
  // resolves them before the parent `sow_scheduling` entry.
  bay_scheduling:       { id: 'bay_scheduling',        label: 'Bay Scheduling',      module: 'PPC',       routes: ['/sow-scheduling/area'] },
  msproject_mapping:    { id: 'msproject_mapping',     label: 'MS Project Mapping',  module: 'PPC',       routes: ['/sow-scheduling/map'] },
  msproject_collab:     { id: 'msproject_collab',      label: 'MS Project Collaboration', module: 'PPC',  routes: ['/sow-scheduling/projects'] },
  ms_project_admin:     { id: 'ms_project_admin',      label: 'MS Project Admin',    module: 'PPC',       routes: ['/ms-project-admin'] },
  component_tracking:   { id: 'component_tracking',    label: 'Component Tracking',  module: 'PPC',       routes: ['/component-tracking'] },
  kanban_board:         { id: 'kanban_board',          label: 'Kanban Board',        module: 'PPC',       routes: ['/kanban-board'] },
  buffer_transaction:   { id: 'buffer_transaction',    label: 'Buffer Transaction',  module: 'PPC',       routes: ['/buffer-transaction'] },
  receiving_shipment:   { id: 'receiving_shipment',    label: 'Receiving & Shipping', module: 'PPC',      routes: ['/receiving-shipment'] },

  consumable_control:   { id: 'consumable_control',    label: 'Consumable Control',  module: 'Warehouse', routes: ['/consumable-control', '/consumable-request'] },
  tools_management:     { id: 'tools_management',      label: 'Tools Management',    module: 'Warehouse', routes: ['/tools-management', '/tools-request', '/tools-consumable-request'] },

  timesheet_validation: { id: 'timesheet_validation',  label: 'Timesheet Validation', module: 'Timesheet', routes: ['/timesheet-validation'] },
  operator_performance: { id: 'operator_performance',  label: 'Operator Performance', module: 'Timesheet', routes: ['/operator-performance'] },
  machine_hours:        { id: 'machine_hours',         label: 'Machine Hours',       module: 'Machine',   routes: ['/machine-hours-sqlserver', '/machine-hours-validation', '/process-control', '/edit-parameter'] },
  nfc_users:            { id: 'nfc_users',             label: 'NFC Users',           module: 'Timesheet', routes: ['/nfc-users', '/create-edit-nfc'] },
  sap_log:              { id: 'sap_log',               label: 'SAP Log',             module: 'Core',      routes: ['/sap-log'] },
  config_rules:         { id: 'config_rules',          label: 'Configuration Rules',  module: 'Core',      routes: ['/config-rules'] },

  manage_users:         { id: 'manage_users',          label: 'Manage Users',        module: 'Admin',     routes: ['/manage-users', '/manage-user'] },
};

// Build a route-prefix -> featureId lookup once.
const ROUTE_INDEX = Object.values(FEATURES)
  .flatMap((f) => f.routes.map((route) => ({ route, featureId: f.id })))
  // Longest route first so more specific prefixes win.
  .sort((a, b) => b.route.length - a.route.length);

/** Resolve which feature a pathname belongs to (prefix match), or null if unguarded. */
export function routeToFeature(pathname) {
  const path = String(pathname || '');
  const hit = ROUTE_INDEX.find(({ route }) => path === route || path.startsWith(`${route}/`));
  return hit ? hit.featureId : null;
}

export function featureLabel(featureId) {
  return FEATURES[featureId]?.label || featureId;
}
