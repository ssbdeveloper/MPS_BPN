# RBAC Interim Enforcement — What Was Built + How To Test

> Interim x-role enforcement (Phases A–E) per
> [RBAC_BACKEND_ENFORCEMENT_PLAN.md](./RBAC_BACKEND_ENFORCEMENT_PLAN.md).
> **Security note:** interim = `x-user-role`/`x-user-id` headers, which are
> client-supplied and spoofable. Stops casual cross-role use + gives a real
> per-user matrix, but a determined attacker can still bypass until verified
> tokens land (plan §6). Scope = **Operations Hub users**; operator/NFC flow is
> intentionally allow-listed (open).

---

## 1. What was built

### Backend (`apps/api/`)
| File | Purpose |
|---|---|
| `database/migrations/api/20260705_rbac_user_permissions.sql` | schema `rbac` + `rbac.user_permissions` (per-user overrides). **Applied.** |
| `rbac/permissionMatrix.js` | CJS mirror of the FE role matrix + `resolveLevel`/`actionAllowed`. Adds `sow_verification`. |
| `rbac/effective.js` | `effectiveLevel/isAllowed/effectiveMap` = user override ?? role default. |
| `rbac/features.js` | feature catalog (id + label) for the permission API. |
| `rbac/manifest.js` | every **write** endpoint → `{feature, action}` + allow-list (login/self/operator). |
| `rbac/rbacGuard.js` | one global **default-deny** middleware. Log-only unless `RBAC_ENFORCE=1`. |
| `server.js` | mounts `rbacGuard` before all routers. |
| `controllers/authController.js` | `getUserPermissions`, `updateUserPermissions`, `getMyPermissions`. |
| `routes/auth.js` | `GET /auth/me/permissions`, `GET/PUT /auth/users/:id/permissions`. |

### Frontend (`apps/web/`)
| File | Purpose |
|---|---|
| `pages/PPC/ManageUsersPage.jsx` | **per-user permission editor** (Inherit/none/read/full per feature) when editing a user. |
| `rbac/useAuth.js` | `readAuthPermissions()` (reads effective perms from sessionStorage). |
| `rbac/usePermissions.js` | now **override-aware**: uses effective perms, falls back to role matrix. |
| `pages/WelcomePage.jsx` | on login, loads `/auth/me/permissions` → sessionStorage `authPermissions`. |
| `pages/PE/SowHistoryPage.jsx`, `SowRevisionEditPage.jsx` | revision/edit write buttons gated with `useCan('sow_management','write')` — now consistent with Create SOW. |

### Resolution model
```
effective(user, feature) = user_permissions[user][feature] ?? roleMatrix[role][feature] ?? no_access
write needs full_access · read needs read_only
```

---

## 2. Run

```bash
# Backend (log-only by default)
cd apps/api && node server.js        # or: npx nodemon server.js
#   startup log: "🔒 RBAC guard: log-only (set RBAC_ENFORCE=1 to enforce)"

# Enforce mode (actually blocks):
RBAC_ENFORCE=1 node server.js        # Windows PS: $env:RBAC_ENFORCE='1'; node server.js
#   startup log: "🔒 RBAC guard: ENFORCING"

# Frontend
cd apps/web && npm run dev
```

---

## 3. Test scenarios

### A. Log-only cycle (do this FIRST, before enforcing)
1. Start API in log-only. Use the app normally as an admin for a bit.
2. Watch the API console for `[RBAC] would-deny …` lines:
   - `UNMAPPED POST /some/route` → a real write endpoint missing from the manifest.
     **Report it** — it must be added or it will fail-closed when enforcing.
   - `PUT /x feature=… role=… user=…` → a call that *would* be blocked. Confirm it's
     a role that *should* be blocked (not a false positive).
3. When a full cycle produces no surprising `would-deny`, you're safe to enforce.

### B. Per-user override via the UI (Manage Users)
1. Log in as **administrator** → open **Manage Users** (`/manage-users`).
2. Click **Edit** on a user → the **"Izin khusus user"** panel loads under the role
   preview.
3. Change a feature (e.g. `SOW Management` → `Full access`) → **Simpan (N)**.
4. Reload / re-open that user → the override persists and shows highlighted (blue).
5. Set it back to **Inherit (role)** → Simpan → the row is removed (falls back to the
   role default).

Direct API check (admin headers):
```bash
# read effective map
curl -s http://localhost:3001/auth/users/1/permissions \
  -H "x-user-role: administrator" | jq .permissions.sow_management
# set an override
curl -s -X PUT http://localhost:3001/auth/users/1/permissions \
  -H "x-user-role: administrator" -H "content-type: application/json" \
  -d '{"overrides":{"sow_management":"no_access"}}' | jq .permissions.sow_management
# clear it (inherit)
curl -s -X PUT http://localhost:3001/auth/users/1/permissions \
  -H "x-user-role: administrator" -H "content-type: application/json" \
  -d '{"overrides":{"sow_management":null}}' | jq .permissions.sow_management
```

### C. Frontend gating (per role / per override)
Log in as different roles (or override a test user), then check:
- **Menu** (Operations Hub) shows only features you can read.
- **SOW History** (`/sow-management/history`): as a `read_only` user (e.g. `user`),
  the **Edit SOW**, **Create Revision**, and **Save Info** buttons are **hidden**.
  As `foreman`/`supervisor`/`administrator` (full), they appear. This is the fix for
  "user biasa bisa buat revision" — now identical to **Create SOW**.
- Override a user's `sow_management` to `full_access` in Manage Users, re-login as that
  user → the revision buttons appear (override beat the role default).

> Note: FE reads effective perms captured **at login**. After changing a user's
> override, that user must **re-login** to see the UI change (backend enforces
> immediately regardless).

### D. Backend enforcement (the real security check)
Flip to `RBAC_ENFORCE=1` and prove header-role gating:
```bash
# user role (sow_management = read_only) -> revision write BLOCKED (403)
curl -i -X PUT http://localhost:3001/sow/history-order/1000123166 \
  -H "x-user-role: user" -H "content-type: application/json" -d '{"operations":[]}'
#   => HTTP/1.1 403 Forbidden  {"error":"Forbidden","reason":"insufficient_permission","feature":"sow_management"}

# foreman (sow_management = full_access) -> allowed through to the controller
curl -i -X PUT http://localhost:3001/sow/history-order/1000123166 \
  -H "x-user-role: foreman" -H "content-type: application/json" -d '{"operations":[]}'
#   => passes the guard (controller handles the body)

# unmapped write -> fail-closed
curl -i -X POST http://localhost:3001/sow/definitely-not-a-route -H "x-user-role: administrator"
#   => 403 {"reason":"unmapped_write"}
```

### E. Operator flow stays open (must NOT break)
```bash
# operator timesheet create/checkout are allow-listed -> never blocked, even in enforce
curl -i -X POST http://localhost:3001/timesheet -H "content-type: application/json" -d '{}'
curl -i -X POST http://localhost:3001/auth/login -H "content-type: application/json" -d '{}'
#   => reach their controllers (no RBAC 403)
```

### F. Read endpoints
Reads (GET) are **not** gated in this phase — only writes. (Sensitive-read gating is
listed for the proper/token phase.)

---

## 4. Enable / disable & rollback

- **Disable enforcement:** unset `RBAC_ENFORCE` (default) → log-only, nothing blocked.
- **Fully remove the guard:** comment out `app.use(rbacGuard)` in `server.js`.
- **Drop the table:** `DROP TABLE rbac.user_permissions;` (role defaults still work).
- Empty `rbac.user_permissions` ⇒ everyone keeps their role default (no lockouts).

---

## 5. Known gaps / next

1. **Spoofable headers** — swap `x-user-*` for a verified JWT (plan §6). This is the
   real security step; interim only deters casual misuse.
2. **Matrix drift** — BE matrix is a hand-kept copy of the FE one. Move to a shared JSON.
3. **`sow_verification`** default = foreman/supervisor `full_access`; add a `verifier`
   role if you want it separate.
4. **Reads not gated** — add sensitive-read gating (manage_users, ms_project_admin) later.
5. **FE registry** still lacks `sow_verification` (BE has it) — add for menu/labels.
