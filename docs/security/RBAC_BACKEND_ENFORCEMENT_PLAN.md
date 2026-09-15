---
tags: [domain/security]
type: plan
status: active
---

# RBAC Backend Enforcement — Interim (x-role) → Proper (verified token)

> Companion to [RBAC_BACKEND_GAPS.md](./RBAC_BACKEND_GAPS.md) (why) and
> [RBAC_ROLLOUT_PLAN.md](./RBAC_ROLLOUT_PLAN.md) (frontend rollout).
> This doc covers **backend enforcement**: the fast interim step we build now
> and the proper design we migrate to later.

---

## 0. Decisions taken (2026-07-05)

| Decision | Choice | Consequence |
|---|---|---|
| Granularity | **Per-user override** | role gives the default; each user can be overridden per feature via UI. Needs `rbac.user_permissions` table. |
| Enforcement scope | **All writes, default-deny** | every POST/PUT/PATCH/DELETE is checked against a manifest; anything not mapped (and not allow-listed) is **403 (fail-closed)**. |
| Identity source (now) | **`x-user-id` + `x-user-role` headers** | FAST but **spoofable** — see §5. Accepted as interim only. |
| Identity source (proper) | **Signed JWT** | §6 migration. `requirePermission` swaps its identity source, nothing else changes. |

---

## 1. Model

```
effectiveLevel(userId, role, feature)
  = user_permissions[userId][feature]        -- explicit override, if any
 ?? ROLE_MATRIX[role][feature]               -- role default
 ?? ROLE_MATRIX[role].__default__
 ?? no_access                                -- fail-safe
```

- Levels: `no_access` (0) < `read_only` (1) < `full_access` (2).
- A **write** action needs `full_access`; a **read** needs `read_only`.
- Override value `inherit` (i.e. no row) = fall back to the role default. The UI
  writes an override only when it differs from the role default; "reset to
  inherit" deletes the row.

---

## 2. Data model

New schema `rbac` (mirrors the `ews` pattern). One table:

```sql
CREATE SCHEMA IF NOT EXISTS rbac;

CREATE TABLE rbac.user_permissions (
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_id  text    NOT NULL,          -- matches featureRegistry ids
  level       text    NOT NULL CHECK (level IN ('no_access','read_only','full_access')),
  updated_by  integer,                   -- who set it (audit)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_id)
);
```

Role defaults stay in the **permission matrix** (see §3). Only per-user
*overrides* live in the DB. No row = inherit role default.

---

## 3. Single source of truth for the matrix (anti-drift)

The frontend matrix lives in `apps/web/src/rbac/permissionMatrix.js` (ESM). The
backend (CommonJS, separate app) cannot import it directly.

**Interim (now):** backend keeps a mirror module `apps/api/rbac/permissionMatrix.js`
with the SAME data + resolver. This risks drift — the two matrices must be kept
identical by review.

**Proper (target):** extract the DATA (`LEVELS`, `ROLES`, `PERMISSION_MATRIX`,
feature ids) into one JSON — e.g. `shared/rbac/matrix.json` — that FE imports and
BE `require`s. Both keep only their thin logic wrappers. Then there is exactly one
definition. `resolveLevel()` on both sides was written to be swappable for this.

> Until the shared JSON lands, a CI check (or a code-review checklist item) should
> diff the two matrices to catch drift.

---

## 4. Enforcement — default-deny manifest + one middleware

### 4.1 Route manifest
A single map of every **write** route → `{ feature, action }`, keyed by mount +
express path pattern:

```js
// apps/api/rbac/manifest.js  (illustrative)
module.exports = [
  { method: 'POST',   path: '/sow/standard/operation',       feature: 'sow_management',      action: 'write' },
  { method: 'DELETE', path: '/sow/standard/operation/:id',   feature: 'sow_management',      action: 'write' },
  { method: 'PUT',    path: '/timesheet/validation',         feature: 'timesheet_validation',action: 'write' },
  { method: 'POST',   path: '/sow-schedule/operation-status',feature: 'sow_verification',    action: 'write' },
  // ...one row per write endpoint (see the full inventory in RBAC_BACKEND_GAPS §1)
];
```

### 4.2 Allow-list (writes that are NOT admin-RBAC)
Public / operator-shopfloor / self writes that must stay open:

```
POST /auth/login, POST /auth/change-password (self),
POST /token/verify-token,
POST /timesheet, PUT /timesheet/checkout, /checkout-unprod, /checkoutid  (NFC operator flow)
```

### 4.3 The middleware (mounted once, before all routers)
```
for each request:
  if method in {GET, HEAD, OPTIONS}          -> allow (reads gated in a later phase)
  if path matches allow-list                  -> allow
  find manifest row matching (method, path)
    - none  -> 403  (DEFAULT-DENY: unmapped write fails closed)
    - found -> requirePermission(feature, action):
        role   = verified role   (interim: x-user-role header)
        userId = verified userId (interim: x-user-id header)
        lvl    = effectiveLevel(userId, role, feature)   // reads rbac.user_permissions
        actionAllowed(lvl, action) ? next() : 403
```

Path matching: each manifest/allow-list pattern is precompiled to a regex
(`:param` → `[^/]+`). First match wins. Longest/most-specific patterns first.

**Why manifest + global, not per-route:** a per-route middleware that someone
forgets to add = a silently unprotected endpoint (fail-open). A global default-deny
makes "forgot to map it" fail **closed** — the safe direction.

---

## 5. Interim identity = headers (the honest caveat)

`x-user-id` / `x-user-role` are **client-supplied**. A determined user can still
`curl -H "x-user-role: administrator"` and bypass everything. So the interim step:

- **Does** stop casual/accidental cross-role use and gives a real per-user matrix +
  audit trail.
- **Does NOT** stop a deliberate attacker. Until §6, treat the app as "gated, not
  secured". This is an explicit, time-boxed tradeoff for speed.

---

## 6. Proper future (migration path)

1. **Verified token**: issue a signed JWT on `POST /auth/login` (role + id in the
   claims). Add an `authenticate` middleware that verifies it and sets
   `req.user = { id, role }`.
2. **Swap the identity source**: `requirePermission` reads `req.user` instead of the
   headers. **Nothing else in §4 changes** — the manifest, matrix, and override table
   are reused as-is.
3. **Shared matrix JSON** (§3) to kill drift.
4. **Gate sensitive reads** too (manage_users, ms_project_admin): extend the middleware
   to GET for a listed set of features.
5. Retire `x-user-*` headers.

Because the interim was built around `requirePermission(feature, action)` + the
manifest, the proper version is a **drop-in identity swap**, not a rewrite.

---

## 7. Build phases (this effort)

| Phase | Deliverable | Files |
|---|---|---|
| A | `rbac` schema + `user_permissions` table + BE matrix mirror + `effectiveLevel()` resolver (reads DB) | migration, `apps/api/rbac/{permissionMatrix,effective}.js` |
| B | Manifest (all writes) + allow-list + global default-deny middleware, wired in `server.js` | `apps/api/rbac/{manifest,requirePermission}.js`, `server.js` |
| C | Permission API: `GET/PUT /auth/users/:id/permissions` (guarded by `manage_users`) | `authController.js`, `routes/auth.js` |
| D | ManageUsers UI: per-user permission editor (feature list, Inherit/none/read/full, effective vs override) | `ManageUsersPage.jsx`, `rbac` service |
| E | FE loads the logged-in user's *effective* perms on login so UI gating matches BE | `useAuth`/`usePermissions`, small `/auth/me/permissions` |

New feature ids to add to the registry before wiring: **`sow_verification`** (the
daily-verification writes) — and decide its default level per role (e.g. foreman /
a new `verifier` role → `full_access`).

---

## 8. Rollout safety

- Seed nothing destructive: with an empty `user_permissions`, everyone keeps their
  **role default** — behaviour is unchanged until an admin sets an override.
- Ship the middleware in **log-only mode first** (log "would 403" without blocking)
  for one cycle to catch any legitimate write the manifest missed, then flip to enforce.
- Keep the operator/shopfloor allow-list correct or the plant floor breaks (§4.2).
- Live role counts (for not locking anyone out): administrator 8, user 24,
  supervisor 4, foreman 1, warehouse 1, +1 stray `admin`→administrator.
