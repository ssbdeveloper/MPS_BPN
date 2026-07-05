# RBAC Rollout Plan — Whole-App Impact & Per-Page Tasks

> Companion to [RBAC_BACKEND_GAPS.md](./RBAC_BACKEND_GAPS.md).
> Framework lives in `apps/web/src/rbac/`. This doc is the roadmap to take RBAC
> from "2 wired examples" to the whole app, page by page.

---

## 1. Where we are now

**Done**
- Central framework: `permissionMatrix.js` (single source of truth), `featureRegistry.js`
  (feature catalog + `routeToFeature`), `useAuth`, `usePermissions`/`useCan`, `<Can>`,
  `<RequireFeature>` (route guard), `NoAccessPage`.
- Two layers proven end-to-end on **Manage Users** and **SOW Management**:
  route guard (`no_access` blocked before render) + action guard (write buttons
  hidden/disabled on `read_only`).
- **Menu auto-filters** in Operations Hub (`routeToFeature` + `canRead`).

**Not done**
- Every other feature is registered but **not yet enforced** (no route guard, no
  button gating).
- **No backend enforcement** and **no verified token** — see gaps doc. Frontend RBAC
  is UX only until that lands.

---

## 2. The model (recap)

- One role per user. `resolveLevel(role, feature) -> no_access | read_only | full_access`.
- `no_access` (0) < `read_only` (1) < `full_access` (2).
- **Route guard** = feature reachable at all (needs ≥ `read_only`).
- **Action guard** = write UI shown/enabled (needs `full_access`), via `<Can action="write">`
  or `useCan(feature,'write')`.
- Add a feature = one entry in `featureRegistry.js` + a column of levels per role in
  `permissionMatrix.js`.

---

## 3. Rollout phases (recommended order)

| Phase | Scope | Why this order |
|---|---|---|
| **0 – done** | Framework + Manage Users + SOW Management | Reference implementation |
| **1** | Admin/config pages: Shift Rules, MS Project Admin, Machine Hours Validation, Process Control, Edit Parameter | Already `protectedPage`, highest-risk writes, small blast radius |
| **2** | Warehouse: Consumable Control, Tools Management, Receiving & Shipping | Clear owner role (`warehouse`), self-contained CRUD |
| **3** | PPC/PE: Component Tracking, Buffer Transaction, SOW Scheduling, Kanban, SOW Orders/Edit | Shared production data |
| **4** | Timesheet admin: Timesheet Validation, Operator Performance, NFC Users | Sensitive (SAP posting) |
| **5** | Read-only surfaces: Dashboard, Order Progress, SAP Log, EWS | Guard-only, few/no write buttons |
| **6** | **Backend enforcement + token auth** | Makes it actually secure (prerequisite doc) |

> Do **not** guard the operator/public flow (see §6). Roll out one phase at a time,
> verify with each role, then move on.

---

## 4. Per-page impact & tasks

Legend — **Guard**: route-level `RequireFeature`. **Actions**: write buttons to gate.
Status: ✅ done · ⬜ to do · ➖ n/a.

### Core / read surfaces
| Route | Page | Feature | Guard | Write actions to gate |
|---|---|---|---|---|
| `/operations-hub`, `/LandingPage` | OperationsHubPage | `operations_hub` | ⬜ (login only; keep open to any verified user) | ➖ menu already filters |
| `/dashboard` | DashboardPage | `dashboard` | ⬜ | ➖ read-only |
| `/order-progress-dashboard` | OrderProgressDashboardPage | `order_progress` | ⬜ | ➖ read-only |
| `/sap-log` | SapLogPage | `sap_log` | ⬜ | audit: any retry/repost button → `can(sap_log,'write')` |
| `/ews/:type/detail` | EwsDetailPage | `ews` | ⬜ | **Resolve** issue button + issue-sync → gate with `can('ews','write')` |
| `/setting`, `/download`, `/editor-image` | misc | *(none)* | ➖ decide per page | audit |

### PE — SOW  ✅ reference
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/sow-management` (+list/create/history) | SowManagementPage | `sow_management` | ✅ | ✅ Create nav hidden read-only |
| `/sow-management/list` | SowStandardListPage | `sow_management` | ✅ (via parent) | ✅ Tambah/Package/Edit/Delete gated |
| `/sow-orders` | OrderListPage | `sow_management` | ✅ | ⬜ audit row create/edit/delete |
| `/sow-edit/:id`, `/sow-edit/revision/:orderNo` | SowEditPage / SowRevisionEditPage | `sow_management` | ✅ | ⬜ gate Save/Submit |

### PPC
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/component-tracking` | ComponentTrackingPage | `component_tracking` | ⬜ | buffer create/edit/delete, priority, notes |
| `/buffer-transaction` | BufferTransactionPage | `buffer_transaction` | ⬜ | create/receive/ship writes |
| `/sow-scheduling` | SowSchedulingPage | `sow_scheduling` | ⬜ | schedule create/move/publish |
| `/kanban-board` | KanbanLevelOnePage | `kanban_board` | ⬜ | card move/update (drag) |
| `/shift-definition` | ShiftDefinitionPage | `shift_rules` | ⬜ (already `protectedPage`) | shift rule CRUD |
| `/ms-project-admin` | MsProjectAdminPage | `ms_project_admin` | ⬜ (already `protectedPage`) | import/publish/lock |
| `/receiving-shipment` | ReceivingShipmentPage | `receiving_shipment` | ⬜ | component receive/ship CRUD |

### Warehouse / Tools
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/consumable-control` | ConsumableControlPage | `consumable_control` | ⬜ (already `protectedPage`) | approve / close / adjust / reject |
| `/consumable-request` | ConsumableRequestPage | `consumable_control` | ⬜ | submit request |
| `/tools-management` | ToolsManagementPage | `tools_management` | ⬜ (already `protectedPage`) | tool CRUD / issue / return |
| `/tools-request`, `/tools-consumable-request` | ToolsRequest* | `tools_management` | ⬜ | submit request |

### Machine hours
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/machine-hours-sqlserver` | MachineHoursSqlServerPage | `machine_hours` | ⬜ | audit any write |
| `/machine-hours-validation` | MachineHoursValidationPage | `machine_hours` | ⬜ (already `protectedPage`) | **validate** actions |
| `/process-control` | ProcessControlPage | `machine_hours` | ⬜ | parameter/category/choice CRUD |
| `/edit-parameter` | EditParameterPage | `machine_hours` | ⬜ | parameter save/delete |

### Timesheet admin
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/timesheet-validation` | TimesheetValidationPage | `timesheet_validation` | ⬜ (already `protectedPage`) | validate / bulk-validate / **SAP post** / checkout |
| `/operator-performance` | OperatorPerformancePage | `operator_performance` | ⬜ (already `protectedPage`) | ➖ read-only |
| `/nfc-users`, `/create-edit-nfc` | NfcUserListPage / CreateEditNfcPage | `nfc_users` | ⬜ | NFC user CRUD |

### Admin  ✅ reference
| Route | Page | Feature | Guard | Actions |
|---|---|---|---|---|
| `/manage-users` | ManageUsersPage | `manage_users` | ✅ | ✅ create/edit/delete gated |
| `/manage-user` | ManageUserPage | `manage_users` | ✅ | ⬜ audit this page's buttons |

---

## 5. Standard "wire a page" checklist

For each page in a phase:

1. **Registry** — confirm the route is covered in `featureRegistry.js` (`routes[]`). Add if missing.
2. **Matrix** — set the level for every role in `permissionMatrix.js` (default falls back to
   the role's `__default__`; add explicit entries where it differs).
3. **Route guard** — in `router/index.jsx` change `page(...)`/`protectedPage(...)` →
   `guardedPage(() => import(...), 'feature_id')`. Parent routes with an `<Outlet>` cover children.
4. **Action guards** — audit the page for every write trigger (buttons, row click-to-edit,
   drag handlers, form submits, delete icons) and wrap/disable:
   ```jsx
   const canEdit = useCan('feature_id', 'write');
   {canEdit && <button onClick={save}>Save</button>}
   // or: <Can feature="feature_id" action="write"><button/></Can>
   // or: <button disabled={!canEdit} .../>
   ```
   Prefer **hide** for primary create buttons, **disable** for inline edit/delete so the row
   still reads as data.
5. **Read-only affordance** — for pages a role can open but not write, show a small
   "read-only mode" banner (see ManageUsersPage) so it's obvious, not silently broken.
6. **Test** with each role (see §8).

---

## 6. Menu / navigation impact

- Operations Hub sidebar already filters by `canRead(routeToFeature(path))`.
- Any **other** menu/launcher (WelcomePage tiles, MenuGrid, module sub-navs like the SOW
  sidebar) must apply the same filter so users don't see links they can't open. Audit list:
  - `OperationsHubPage` sidebar ✅
  - SOW Management sub-nav ✅ (Create hidden read-only)
  - WelcomePage / any landing tiles ⬜
  - Any module-level tab bars ⬜
- Rule of thumb: **if it links to a feature route, gate the link with `canRead`.**

---

## 7. ⚠️ Impact warnings (read before enforcing)

1. **Operator/public flow must stay public.** These are used without the admin login
   (NFC/timesheet operators): `/`, `/welcome`, `/login-timesheet`, `/timesheet`,
   `/timesheet-mainmenu`, `/view-timesheet`, `/timesheet-edit/:tsnumber`, `/select-job`,
   `/select-machine`, `/log-timesheet`, `/unproductive`, `/tts-audio-test`.
   **Do NOT add `RequireFeature` to these** — it would redirect operators to login and break
   production data entry. Leave them as `page(...)`.
2. **Guarding a previously-open route now requires login.** Several admin pages were `page(...)`
   (no auth). After `guardedPage`, an unauthenticated hit redirects to `/`. That's intended, but
   confirm no external bookmark/integration relies on open access.
3. **Don't lock people out on rollout.** Before enforcing a phase, make sure the matrix grants the
   real day-to-day roles at least `read_only` (and `full_access` where they currently write).
   Current live roles: `administrator`(8), `user`(24), `supervisor`(4), `foreman`(1),
   `warehouse`(1), plus a stray `admin`(1) normalized to `administrator`.
4. **Frontend ≠ security.** Until §6 of the gaps doc (token auth + backend `requirePermission`)
   is done, gating is cosmetic against a determined user. Treat write endpoints as unprotected.

---

## 8. Testing checklist (per phase)

For each role (`administrator`, `supervisor`, `foreman`, `warehouse`, `user`):
- [ ] Menu shows only readable features.
- [ ] `no_access` route → `NoAccessPage` (not a blank/hidden page).
- [ ] `read_only` route → opens, **all** write buttons hidden/disabled, no way to open an editor.
- [ ] `full_access` route → all actions work.
- [ ] Deep-link to a `no_access` route directly (paste URL) is still blocked.
- [ ] Log out / log in as another role updates access without stale cache.

---

## 9. Matrix governance

- **Change a role's access:** edit `PERMISSION_MATRIX[role][feature]` in `permissionMatrix.js`.
- **Add a role:** add to `ROLES` + a matrix row (set `__default__`).
- **Add a feature:** one entry in `featureRegistry.js` + a level per role.
- **Future (approved direction):** move the matrix to a `role_permissions` DB table and make
  `resolveLevel` read from an API so admins can edit access in ManageUsers without a deploy —
  `resolveLevel()` was written as the single swap point for exactly this. Keep frontend and
  backend matrices identical (share one source) to avoid drift.

---

## 10. Definition of done (whole app)

- [ ] Every non-public route wrapped with `guardedPage(..., feature)`.
- [ ] Every write control gated by `useCan(...,'write')` / `<Can>`.
- [ ] Every menu/launcher link filtered by `canRead`.
- [ ] Read-only banners on pages that support read-without-write.
- [ ] Backend: token auth + `requirePermission` on all write endpoints (gaps doc).
- [ ] Matrix reviewed & signed off with plant/ops owners.
