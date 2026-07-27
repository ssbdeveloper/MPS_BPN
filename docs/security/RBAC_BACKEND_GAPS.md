---
tags: [domain/security]
---

# RBAC — Backend Enforcement Gaps

> **Status:** Frontend RBAC implemented (UX only). Backend enforcement **NOT done**.
> Frontend RBAC hides/disables UI, but any user can still call the API directly
> (curl/devtools). **Do not treat the app as secured until the endpoints below
> validate permissions server-side.**

## Root problem: there is no verified session/token
`POST /auth/login` returns the user JSON but **no token/JWT/session cookie**. The
frontend stores it in `sessionStorage` and sends role via the `x-user-role`
header. That header is **client-supplied and trivially spoofable** — so it is only
acceptable for low-stakes gating, not real authorization.

**Prerequisite for real backend RBAC:** issue a signed token on login (JWT or a
server session), and derive the role from that verified token — never from a
request header the client sets.

## Endpoints that currently have ZERO role validation (write actions)
| Route group | Example write actions | Maps to feature |
|---|---|---|
| `/sow/*` | create/update/delete SOW, operations, packages, attachments | `sow_management` |
| `/timesheet/*` | validate, bulk-validate, SAP post, checkout, edit | `timesheet_validation` |
| `/process-control/*` | parameter/category/choice CRUD | `machine_hours` |
| `/component-tracking/*` | buffer transactions CRUD, priorities, notes | `component_tracking` |
| `/consumable/*` | approve/close/adjust/reject tickets | `consumable_control` |
| `/receiving-shipment/*` | components CRUD | `receiving_shipment` |
| `/usernfc/*` | NFC user CRUD | `nfc_users` |
| `/machine-hours-sqlserver`, `/machine-hours-validation` | validation writes | `machine_hours` |
| tools endpoints | tools management writes | `tools_management` |
| `/sow` scheduling / shift / ms-project | schedule/shift/publish writes | `sow_scheduling` / `shift_rules` / `ms_project_admin` |

**Already protected:** `GET/POST/PUT/DELETE /auth/users*` — validates `administrator`
via `x-user-role` in [authController.js](../../apps/api/controllers/authController.js)
(still header-based, so subject to the spoofing caveat above).

## Recommended fix (when ready)
1. Add token auth (JWT) on `/auth/login`; verify it in an `authenticate` middleware.
2. Mirror the frontend matrix server-side (or move both to a `role_permissions`
   DB table — the frontend `resolveLevel()` is already written to be swappable).
3. Add a `requirePermission(feature, action)` middleware and attach it to each
   write route.

```js
// apps/api/middleware/requirePermission.js  (SKETCH — needs verified token first)
const { resolveLevel, actionAllowed, normalizeRole } = require('../rbac/permissionMatrix');

function requirePermission(feature, action = 'write') {
  return (req, res, next) => {
    // TODO: derive role from a VERIFIED session/JWT, NOT from req.headers.
    const role = normalizeRole(req.user?.role);
    if (!actionAllowed(resolveLevel(role, feature), action)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return next();
  };
}
module.exports = requirePermission;

// usage in a route file:
// router.post('/standard/operation', requirePermission('sow_management', 'write'), controller.create);
```

Keep the permission matrix identical on both sides (share a JSON, or a small
package) so frontend and backend never drift.
