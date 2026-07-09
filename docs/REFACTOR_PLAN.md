  # MPS2 Large-Scale Refactor Plan

**Date:** 2026-07-07 · **Scope:** database, API, scripts (Python/VBA/shell), frontend
**Audience:** solo developer. Every recommendation is filtered for "maintainable by one person" — no new frameworks unless they remove more code than they add.
**Highest severity:** anything on the labour-incentive (payroll) data path.

---

## 0. How this plan was produced, and how to read it

This is a single analysis pass over a ~40k-line frontend, ~25k-line API, ~20 Python/JS jobs, 60+ SQL files, and 18 VBA modules. **A single pass cannot read everything.** Every finding is labeled:

- **READ (direct)** — I opened and read the file in this session.
- **READ (delegated)** — a scoped exploration sub-pass opened and read the file in this same session and reported exact file:line evidence. Treat as read, but spot-check the cited line before acting.
- **INFERRED** — concluded from names, partial context, or absence of evidence. Verify before acting.
- **HYPOTHESIS** — a suspected correctness issue. A scan cannot confirm a bug; each hypothesis comes with the query/test that would confirm or kill it (§8). **Update 2026-07-07: those queries have now been run against production — verdicts inline in §8, new data-only findings in §8.5.**

Files/areas that were **not inspected at all** are listed in §10. "Not reviewed" there means exactly that — no claim is made about them.

Business rules that live only in code (shift hours, rounding, SAP idempotency semantics, the Outsource `pernr` constant, OEE exclusion lists) are flagged in §9 — **I did not guess them**; they need your confirmation before any refactor touches them.

---
  
## 1. Executive summary

The system works, and parts of it are genuinely well-engineered (the SAP staging queue design, `etl_sync_v2.py`, the EWS roster schema). The risk is concentrated in four places:

1. **Payroll-path integrity (Severity 0).** Labour hours flow `timesheet_transaction → sap_timesheet_staging → SAP` and `SSB_OEE → mch_productiondata → mch_transaction → staging → SAP`, and in parallel into EWS adoption/accuracy KPIs. Most writers are idempotent (good), but: the FK from timesheets to operators is `NOT VALID`; check-in/out dates are partially stored as `text`; `post_sap_staging.py` has a residual double-post window; SAP posting from the API is untransacted; and the EWS trend endpoint uses a different timezone than the calculator. Any of these can silently distort incentive numbers.
2. **Secrets in git (Severity 0).** At least 7 tracked files contain plaintext DB passwords (shared `@dmin*` family) plus internal IPs; one API controller has SQL Server credentials as in-source defaults.
3. **No real authentication (Severity 1).** The API trusts spoofable `x-user-*` headers, RBAC is log-only by default, passwords are unsalted SHA-256 with a plaintext fallback, CORS is `*`, and the frontend "auth" is a sessionStorage flag. Anyone on the network can write anything, including validated timesheets.
4. **Drift and duplication tax (Severity 2).** No migration runner; two divergent schema dumps; three coexisting ETL transform versions; salvaging/manufacturing page pairs; 3,500-line page files; a stale backup controller in the deployable image. None of this is on fire, but it is why every change is slow.

The sequencing in §5 fixes 1 and 2 first (days, not weeks), then 3, then chips at 4 opportunistically.

---

## 2. The payroll-critical data path (map + integrity verdicts)

**READ (direct + delegated).** Lineage that feeds incentive pay:

```
LABOUR:  tablet app → POST /timesheet (Express) → timesheet_transaction
           → jobs/sap_staging/stage_timesheet_transaction.py → sap_timesheet_staging
           → jobs/sap_staging/post_sap_staging.py → SAP CPI → log_timesheet_sap
         (alternate: POST /timesheet SAP posting directly from the API — untransacted)

MACHINE: SQL Server SSB_OEE → jobs/etl/etl_machine_conf.py → mch_productiondata
           → etl_mch_transaction_v2/v3.py → mch_transaction
           → jobs/sap_staging/stage_machinehours.py (hourly md5-keyed bundles) → staging → SAP

KPI/EWS: timesheet_transaction + mch_transaction + machine_heartbeat + ews.shift_roster
           → apps/api/services/ewsCalculator.js + apps/api/jobs/ews*  → ews.kpi_snapshot
```

Per-writer idempotency verdicts (all **READ**, direct or delegated):

| Writer | Key | Verdict |
|---|---|---|
| `sync_machine_heartbeat.py` | `ON CONFLICT (id) DO UPDATE`, incremental by ID | Safe from duplicates |
| `etl_machine_conf.py` → `mch_productiondata` | `ON CONFLICT (proddataid) DO UPDATE` | Safe |
| `etl_mch_transaction_v2.py` → `mch_transaction` | `ON CONFLICT (proddataid) DO UPDATE` | Safe |
| `etl_machinehours.py` (older lineage) | `ON CONFLICT (record_key)`; has `--truncate` flag | Safe, but truncate flag is a blast radius |
| `stage_timesheet_transaction.py` | unique `(source_system, source_key=tsnumber)` + `DO NOTHING` | Safe |
| `stage_machinehours.py` | `source_key = md5(werks|bucket|employee|…)` + `DO NOTHING` | Safe **as long as the md5 component list never changes** — changing it re-keys and re-posts history |
| `post_sap_staging.py` | `FOR UPDATE SKIP LOCKED` + POSTING state | Concurrent double-post prevented; **residual window**: POST succeeds at SAP but local status write fails → replay re-posts (§8 H1) |
| API `postToSap` (`timesheet_transactionController.js:1269-1477`) | per-row autocommit, no transaction, sequential HTTP in request | **Weakest link** — partial batches, no rollback (§4 A-R3) |
| `ewsCalculator.saveSnapshot` | `ON CONFLICT` upsert per (window, grain, scope, shift) | Safe |

**Conclusion:** the batch/queue side of the payroll path is defensible; the two soft spots are the API's direct SAP posting and the replay semantics of `post_sap_staging.py`.

**Verified against production 2026-07-07 (§8):** no double-posts exist in the data today; zero operator-identity orphans; the `text` date columns are consistent with `longdate_*`. **But** the staging queue turned out to be idle in production — the API path is the one actually posting (§8.5 N1) — so A-R3 is a real migration, not a switch-flip.

---

## 3. Database layer

### 3.1 Findings

**D-F1 — FK from timesheets to operators is `NOT VALID`.** READ (delegated): `schema.sql` — `fk_timesheet_user (serialnumber) REFERENCES usernfc(snssb) NOT VALID`. Existing rows were never validated; orphaned/mistyped `serialnumber` values can exist and flow into labour-hour aggregation and EWS adoption. Compounding: `usernfc.snssb` is nullable.

**D-F2 — Labour timestamps partially stored as `text`.** READ (delegated): `timesheet_transaction.date_checkin/date_checkout/hour_checkin/hour_checkout` are `text`; only `longdate_checkin/checkout` are `timestamptz`. Every consumer must pick the right column; the `text` ones are parse/timezone ambiguous. HYPOTHESIS H2 checks whether the two ever disagree.

**D-F3 — No migration runner, no ledger.** READ (delegated): no `schema_migrations` table anywhere; `deploy.sh` has no migrate command; 43 timestamped files in `migrations/api/` + 15 unordered files in `migrations/legacy/` are applied by hand. Nobody can say which environment has which migrations. 22 of the 43 api migrations are not wrapped in `BEGIN/COMMIT` (partial-failure risk); one (`20260705_sow_verification_layer.sql`) does `DROP TABLE` + recreate and is only safe on empty tables.

**D-F4 — Schema drift: two "canonical" dumps disagree.** READ (delegated): `schema.sql` (20 tables) vs `local_schema.sql` (38 tables, includes all `mch_*`, `users`, consumable/receiving). Newer migrations (`rbac_user_permissions` FK → `users`; EWS layer referencing `mch_transaction`, `sap_timesheet_staging`) **fail** if applied on a database built from `schema.sql`. Column-name drift also exists (`operation_text` vs `operationtext`, `opr_no`).

**D-F5 — Missing uniqueness where duplicates cost money.** READ (delegated): `sow_standard` has no unique on `(component_id, operation_no)` — duplicate standard hours would resolve ambiguously into performance/incentive math. `production_operations` has no FK and no unique. `log_timesheet_sap` is fully nullable with PK only. The `fn_delete_dup_sow` AFTER-INSERT dedup trigger papers over a missing constraint by deleting rows post-hoc. **VERIFIED 2026-07-07 (§8 H5): no duplicates exist today — add the unique index while it's clean. `production_operations` is empty in prod (§8.5 N4) — likely dead.**

**D-F6 — Mixed timezone-awareness in machine-hours cache.** READ (delegated): `mch_productiondata_detail` uses naive `timestamp` for `startdatetime/enddatetime` but `timestamptz` for `checkin` — silent-offset risk when joined.

**D-F7 — Unbounded time-series growth.** READ (direct): `machine_heartbeat` receives rows every ~10s per machine with no retention job in the sync script. READ (delegated): `mch_machine_ping_log` *does* have retention (`--retention-days=30`). **VERIFIED 2026-07-07 (§8 H3): `machine_heartbeat` = 1.92M rows / 190 MB accumulated in 6 days (~11 GB/yr) — retention is required, not optional. Ping log and adoption snapshots are fine.** Separate but related prod-only find: `mv_kanban_order_board` bloat, §8.5 N2.

**D-F8 — Housekeeping.** READ (delegated): stray non-SQL file `ssh guide.55 via tailscal` inside `migrations/api/`; `backups/` correctly gitignored (verified READ direct via `git ls-files`); `database/seeds/material.sql` is empty; `import_csv_to_db.py` creates mixed-case `mch_Machines` names (case-folding mismatch risk).

### 3.2 Recommendations

**D-R1 — Adopt a minimal migration ledger, not a framework.** One table (`schema_migrations(filename, applied_at)`) plus a ~40-line Node script (`node database/migrate.js`) that applies un-applied files from `migrations/api/` in filename order inside a transaction each. You already run Node everywhere; avoid Flyway/Liquibase/Prisma — they add a maintenance surface you don't need. Backfill the ledger on each environment by inserting the filenames already applied.

**D-R2 — Declare `local_schema.sql` obsolete-or-canonical, then regenerate.** Pick the production DB as truth: `pg_dump --schema-only` from prod into `database/schema/schema.sql`, delete/archive the other dumps (`local_schema.sql`, `db.sql`, `BEGIN;.sql`, `bpn_schema.sql`) to `docs/archive/`. From then on, schema.sql is regenerated after every migration batch (one line in the migrate script).

**D-R3 — Payroll-path constraint hardening (do after H1/H2 data checks pass):**
- `ALTER TABLE timesheet_transaction VALIDATE CONSTRAINT fk_timesheet_user;` after repairing orphans found by H4.
- `ALTER TABLE usernfc ALTER COLUMN snssb SET NOT NULL;` (after H4 confirms no NULLs).
- `CREATE UNIQUE INDEX ON sow_standard(component_id, operation_no);` after dedup check (H5).
- Deprecate the `text` date/hour columns (D-F2): stop writing them (or keep writing but mark generated/derived), make all readers use `longdate_*`. Full column drop is a later step.
- Add a unique on `production_operations(order_number, operation_number)` if H5 confirms no dupes.

**D-R4 — Retention jobs for time-series tables.** A single SQL file run by an existing daemon (e.g. add a `DELETE FROM machine_heartbeat WHERE createddate < now() - interval '90 days'` cycle inside `sync_machine_heartbeat.py`, which already loops) — no new scheduler.

**D-R5 — Make future migrations transactional and idempotent by convention.** Template header comment + `BEGIN; … COMMIT;` + `IF NOT EXISTS`/`ON CONFLICT`. Delete the stray `ssh guide` file (move the note to `docs/operations/`).

### 3.3 Priority (impact × effort)

| # | Item | Impact | Effort | Order |
|---|---|---|---|---|
| D-R3 | Payroll constraints (FK validate, uniques, text-date deprecation) | Very high (payroll) | Low-med | **1** (after §6 checks) |
| D-R1 | Migration ledger script | High | Low | **2** |
| D-R2 | Single canonical schema dump | High | Low | **3** |
| D-R4 | Retention for heartbeat/bucket tables | Medium | Low | 4 |
| D-R5 | Migration conventions + cleanup | Medium | Trivial | 5 |
| D-F6 | tz-normalize machine-hours cache columns | Medium | Medium | 6 (fold into D-R3 batch if convenient) |

---

## 4. API layer (Express, `apps/api`)

### 4.1 Findings

**A-F1 — Effectively no server-side authentication.** READ (delegated, `authController.js`, `rbac/rbacGuard.js`, `server.js`): no session/JWT issued at login; identity for RBAC comes from client-supplied `x-user-id`/`x-user-role` headers; `rbacGuard` covers **writes only** and is **log-only unless `RBAC_ENFORCE=1`**; reads are never gated; CORS reflects any origin. `authMiddleware.requireToken` references `req.session` but no session middleware is registered — dead code that would always 403 if ever mounted. Frontend `ProtectedRoute` is a sessionStorage boolean (READ delegated) — cosmetic. Net: any device on the LAN can validate timesheets or post to SAP by calling the API directly.

**A-F2 — Password storage: unsalted SHA-256 with plaintext fallback.** READ (delegated, `authController.js:7-20`): `sha256$<hex>` single round, and stored values without the prefix are compared as **plaintext**.

**A-F3 — SAP posting inside the HTTP request, untransacted.** READ (delegated, `timesheet_transactionController.js:1269-1477`): sequential per-row `fetch` to SAP with 100ms sleeps, standalone `UPDATE`s on reject, fire-and-forget audit insert. Partial failure leaves mixed states; a client timeout mid-batch abandons the rest. (The Python `post_sap_staging.py` path does this properly — two competing posting paths exist. Which one is operationally live is business knowledge I don't have — flagged in §8.)

**A-F4 — Dual DB pool footgun.** READ (direct + delegated): every controller does `const db = global.pool || require("../db")`. `global.pool` is set in `server.js` *after* module load; `db.js` builds a second, separately-configured Pool. `machineHoursSqlServerController.js:2-3` captures `global.pool` **at module load** — if required before `server.js:118` sets it, `pgPool` stays null forever and operation-text enrichment silently returns `{}` (load-order fragility, READ delegated).

**A-F5 — Hardcoded SQL Server credentials as in-source defaults.** READ (delegated): `machineHoursSqlServerController.js:33-38` (host `10.169.13.13`, user/password present in source, env-overridable).

**A-F6 — EWS correctness risks (payroll-adjacent).** READ (direct, `ewsCalculator.js` full; delegated, `ewsController.js`):
- **Timezone split:** calculator uses `process.env.TIMEZONE` (currently `Asia/Makassar`, READ direct from `.env`), but `ewsController.getTrend` hardcodes `'Asia/Jakarta'` (lines 123,135) — daily trend buckets can land on the wrong calendar day (1h WITA/WIB offset). CLAUDE.md previously documented Jakarta; now corrected.
- **Threshold evaluated on rounded value:** `round1` then compare vs `normal_min` — a true 94.95% displays and classifies as 95.0 (meets target). If incentives read KPI status, boundary flips are rounding artifacts (HYPOTHESIS H6).
- **Carry-forward on calc error** (`carryForwardErroredKpis`) deliberately re-serves the last good value when a calculation fails — right for a dashboard, wrong if anything downstream treats snapshots as ground truth for pay (§8 B5).
- **Operator identity joined across three different keys**: `timesheet_transaction.serialnumber` ↔ `usernfc.snssb` ↔ `mch_transaction.sn_employee`. A mismatch silently drops operators from adoption (HYPOTHESIS H4).
- **Schema introspection on the hot path:** `tableExists`/`columnExists` run per request (READ direct, lines 75-204) — fragility + latency, symptomatic of the missing migration ledger.
- **Progressive roster adoption** is self-documentedly unstable early in a shift (READ direct, lines 761-765) — fine for a live dashboard, not for any point-in-time payroll read.

**A-F7 — SQL injection surface is small but nonzero.** READ (delegated, exhaustive sweep): everything user-facing is parameterized or allow-listed **except** `generateExport` (`timesheet_transactionController.js:705,717-719`) where a caller-supplied `field` flows into `WHERE ${field}` without the whitelist that `search` uses.

**A-F8 — Operational hygiene.** READ (delegated): graceful shutdown fully commented out (`server.js:273-293`); global error handler leaks `err.message` outside production; `controllers/backup timesheet_transaction.js` (458 lines, stale, contains the old interpolated SQL) ships in the image; stray root scripts (`testantri.js`, `svrtablet.js`, `pcsserver.js`, logs) in the app dir; two unbounded in-process `Map` caches in `ewsController`; per-WebSocket-client MSSQL polling (N clients = N× query load); hardcoded `DATEADD(HOUR,-8,…)` in the MSSQL queries (tz assumption in 6+ places).

**A-F9 — What is genuinely fine.** Multer upload configs are traversal-safe (uuid filenames, MIME allow-lists); `safePathSegment` and the `startsWith(uploadsRoot)` delete guard are correct; parameterization discipline is otherwise good; EWS TTS dedupe (`ON CONFLICT (issue_key) DO NOTHING`) is correct. Don't rewrite these.

### 4.2 Recommendations

**A-R1 — Real authentication, minimal shape.** Issue a signed token at login (a single `jsonwebtoken` dependency, or an HMAC you roll in 30 lines), send it as `Authorization: Bearer`, verify in one middleware that populates `req.user`, and derive RBAC identity from the token instead of `x-user-*` headers. Set `RBAC_ENFORCE=1` after a week of log-only observation. Migrate passwords to bcrypt on next successful login (verify old hash → store bcrypt), then remove the plaintext fallback after a cutoff date. Restrict CORS to the known origins. This is ~2-3 days of work and removes the single biggest exposure.

**A-R2 — One pool module.** Make `db.js` the only pool ( configured from env exactly as `server.js` does today), delete the `global.pool` assignment and the `global.pool || require(...)` idiom everywhere (mechanical find/replace), and have `machineHoursSqlServerController` call the module instead of caching at load. Kills A-F4 in one sweep.

**A-R3 — Retire API-side SAP posting; make the Python queue the only path.** `postToSap` should do nothing but `INSERT` rows into `sap_timesheet_staging` (idempotent, transactional, instant response) and let `post_sap_staging.py` post them. You keep one SAP client implementation, gain retry/audit for free, and the HTTP request path stops depending on SAP latency. If operations require synchronous posting, at minimum wrap each row's state change + audit log in a transaction and move the loop to a background job. **Confirm with §8 B1 first.**

**A-R4 — EWS payroll-adjacent fixes (small, surgical):**
- Replace the hardcoded `'Asia/Jakarta'` in `getTrend` with `process.env.TIMEZONE` (one-line ×2).
- Evaluate KPI status on the unrounded value; round only for display.
- Tag carried-forward snapshots (`carried_forward: true` already exists — ensure any consumer that matters filters it; document that `ews.kpi_snapshot` is *not* a payroll source of record).
- Replace per-request `tableExists` probes with a startup check (once the migration ledger guarantees schema).

**A-R5 — Hygiene batch (½ day):** delete `backup timesheet_transaction.js` + stray root scripts; whitelist `field` in `generateExport` like `search` does; re-enable graceful shutdown; add an `asyncHandler` wrapper + central error middleware (stop leaking `err.message`); move MSSQL defaults out of source (env-only, fail fast if missing); bound the ewsController caches (simple max-size check); share one MSSQL snapshot across WebSocket clients (one interval, broadcast).

### 4.3 Priority

| # | Item | Impact | Effort | Order |
|---|---|---|---|---|
| A-R1 | Token auth + bcrypt + RBAC enforce + CORS | Very high (integrity of validation/posting) | Medium | **1** |
| A-R3 | Single SAP posting path via staging queue | Very high (payroll) | Medium | **2** (after §8 B1) |
| A-R4 | EWS tz/rounding/carry-forward fixes | High (payroll-adjacent) | Low | **3** |
| A-R2 | Pool unification | High (latent bugs) | Low | **4** |
| A-R5 | Hygiene batch | Medium | Low | 5 |

---

## 5. Scripts / jobs layer (Python, shell, VBA, Lambda)

### 5.1 Findings

**S-F1 — Plaintext credentials committed to git (7+ files).** READ (direct for the first; delegated for the rest), values not reproduced here:
- `jobs/etl/sync_machine_heartbeat.py:29-42` (SQL Server + Postgres)
- `jobs/etl/etl_machine_conf.py:27-41` and `etl_machine_conf_ver1.py`
- `jobs/etl/etl_machinehours.py:47-60` (env-overridable but real defaults)
- `jobs/sow/seed_ph3_order.py:25-31`
- `scripts/tabletmonitor.sh:10`, `scripts/updatescript.sh:12` (`PGPASSWORD`)
- `jobs/etl/task_etl.md` and `jobs/sow/.env.example` (passwords in docs/examples)
- Plus API-side A-F5. The same `@dmin*` password family recurs, so one leak compromises everything.

**S-F2 — Version sprawl in the ETL transform.** READ (delegated): `etl_mch_transaction.py`, `_v2.py`, `_v3.py` coexist; `etl_machine_conf.py` + `_ver1.py`; `etl_machinehours.py` is the older lineage of the same data. Which one is live is not derivable from the repo (no scheduler entries) — §8 B2.

**S-F3 — No visible scheduler for the SAP staging trio and several ETLs.** READ (delegated): only `jobs/sow/cron.md` documents a cron (`*/10` sow_exporter). Nothing schedules `stage_timesheet_transaction.py` / `stage_machinehours.py` / `post_sap_staging.py`, `etl_machine_conf.py`, `etl_mch_transaction_v*.py`, `refresh_and_notify.py`. If these are run by hand, the payroll feed depends on someone remembering. (INFERRED — an external Task Scheduler/cron outside the repo may exist; §8 B3.)

**S-F4 — Inconsistent connection topology.** READ (delegated): three different "the Postgres" addresses across scripts — LAN `10.169.1.12`, Tailscale `100.86.231.55`, compose alias `db` — with no single config source.

**S-F5 — Good bones to keep.** READ (delegated): `etl_sync_v2.py` is the reference implementation (env-driven, LISTEN/NOTIFY + poll fallback, per-target backoff, rotating logs, transactional upserts). The SAP staging common layer (unique keys, cursor table, eligibility audit) is well designed. `aws/sap-ph3-order-lambda` is idempotent with a composite unique key (its token compare is not timing-safe — minor).

**S-F6 — VBA is live tooling, not archive.** READ (delegated): `docs/archive/additional/ms project/ms_*.bas` currently drive MS Project ⇄ **Express** `/ms-project` (base URL hardcoded to a Tailscale IP, TLS cert checks disabled in `ms_http.bas`). Only `legacy/*.bas` are dead. Their location under `docs/archive/` is misleading. `apps/fastapi-msproject` is a *separate* SOW/TTS helper — CLAUDE.md previously misdescribed it (now fixed).

**S-F7 — Dead/broken bits.** READ (delegated): `jobs/export/generate_announcement.py` imports from a pre-restructure path (`API/FastAPI`) — likely broken; `etl_order.py` is superseded by v2 with a race-prone read-then-write in `sync_sow`; `jobs/.pycache_legacy/` and `jobs/.venv/` sit in the tree.

### 5.2 Recommendations

**S-R1 — Secrets rotation + env-ification (do first, it's mechanical).**
1. Rotate the exposed DB/SQL Server passwords (they're in git history forever — rotation is the only real fix; scrubbing history is optional afterward and low value for a private repo, your call).
2. Convert the 7 files to `os.environ[...]` / `.env` loading exactly like `etl_sync_v2.py` already does (the pattern exists in-repo; copy it).
3. Replace real-looking passwords in `task_etl.md` and `.env.example` with placeholders.

**S-R2 — Pick one transform version, archive the rest.** After §8 B2 answers "which is live": keep `etl_mch_transaction_v3.py` (or v2), move the others to `docs/archive/` or delete (git keeps history). Same for `etl_machine_conf_ver1.py`, `etl_order.py`, `etl_machinehours.py` if superseded. Target: **one file per pipeline stage.**

**S-R3 — Make scheduling explicit and boring.** Extend the existing compose pattern: the SAP trio and the transform ETLs become compose services with a `--loop --interval` mode (the staging scripts already support `--loop`), `restart: unless-stopped`, like `timesheet_sap_etl` already is. One `docs/operations/SCHEDULING.md` listing every job, its trigger, and its owner. No Airflow, no new orchestrator.

**S-R4 — One connection config.** All jobs read the same root `.env` keys (`DB_*`/`TGT_*`); host differences become env per deployment site, not per script.

**S-R5 — Close the double-post window in `post_sap_staging.py`** (payroll): before POSTing, check `log_timesheet_sap` for the same ZTIMESHEETID with success status and skip; and write a local "attempted at" marker before the HTTP call so a crash between SAP-success and status-write is detectable rather than silently replayable. (~30 lines.) Confirm SAP-side idempotency semantics first — §8 B4.

**S-R6 — Relocate live VBA out of `docs/archive/`** to `tools/msproject-vba/` (or similar), move the base URL into a config cell/file, and delete `legacy/*.bas`. Re-enable TLS verification or pin the cert (WinHttp option) — currently MITM-able.

### 5.3 Priority

| # | Item | Impact | Effort | Order |
|---|---|---|---|---|
| S-R1 | Rotate + env-ify secrets | Very high (security) | Low | **1** |
| S-R5 | post_sap_staging double-post guard | Very high (payroll) | Low | **2** (after B4) |
| S-R3 | Explicit scheduling for SAP trio/ETL | High (payroll continuity) | Medium | **3** (after B3) |
| S-R2 | Kill version sprawl | Medium-high | Low | 4 |
| S-R4 | One connection config | Medium | Low | 5 |
| S-R6 | VBA relocation + TLS | Medium | Low | 6 |

---

## 6. Frontend layer (`apps/web`)

### 6.1 Findings

**F-F1 — Stated architecture didn't match reality (now corrected in CLAUDE.md).** READ (delegated): React **19.2**, Router **v7** (all routes lazy — good), **no React Query** anywhere despite the old doc claiming it; a junk dependency `"18": "^0.0.0"` in package.json; the design-system reference file `TimesheetValidationPageV2.jsx` doesn't exist.

**F-F2 — API base URL chaos.** READ (delegated): four coexisting patterns — `VITE_API_URL || ''`, `|| '/api'`, `|| 'http://localhost:3001'` (4 PE pages **break in prod if env unset**), and literal `fetch('/api/...')` with no env at all (dashboard + EwsControlTower). No shared client for ~59 fetch-using files; a good `request()` wrapper exists in `services/machineTrackingService.js` but is barely used.

**F-F3 — Client-side-only auth (mirror of A-F1).** READ (delegated): `ProtectedRoute` = sessionStorage boolean; RBAC permissions from editable sessionStorage; employee data in plaintext web storage; no Authorization header on any request.

**F-F4 — Monolith pages.** READ (delegated, line counts): `SowCreatePage` 3,568; `EwsDetailPage` 2,232; `ReceivingShipmentPage` 1,754; `SowStandardListPage` 1,711; `BufferTransactionPage` 1,392; 63 page files total, ~39k lines of src. Shared `ui/`/`layout/` primitives exist but pages hand-roll their own headers/modals/shells.

**F-F5 — Variant duplication.** READ (delegated): salvaging/manufacturing page pairs behind `VITE_APP_VARIANT` dispatchers (SelectJobPage, TimesheetMainMenuPage, SowSchedulingPage) — every fix lands twice.

**F-F6 — Dead files & config drift.** READ (delegated): dead: `MPDashboardPage.jsx`, `PPC/kanban_example.jsx`, `DemoComponents.jsx`. Tailwind config still carries the legacy `primary #007bff` (also PWA `theme_color`) competing with the corporate `#0096c7`; the brand palette from CLAUDE.md §5 was never added to `tailwind.config.js`. Zero tests; ESLint minimal; the only error boundary is chart-local.

**F-F7 — What is fine.** Lazy routing, PWA config (SSE correctly excluded from SW cache, SW off in dev), the dashboard's factored chart components, `theme/ewsStatus.js` as a shared token module.

### 6.2 Recommendations

**F-R1 — One API client module (highest value-per-hour on the frontend).** Promote `machineTrackingService.request()` to `src/services/apiClient.js`: single `API_BASE` (`import.meta.env.VITE_API_URL || '/api'`), JSON/error normalization, and — once A-R1 lands — the Authorization header in exactly one place. Migrate pages opportunistically (touch a page → migrate its fetches); force-migrate only the 4 `localhost:3001` pages and the literal-`/api` dashboard files immediately, since those are latent prod bugs.

**F-R2 — Don't adopt React Query wholesale.** For a solo dev the win is small versus the migration cost across 59 files. The shared client + a tiny `useFetch(url)` hook (loading/error/refetch, ~40 lines) covers 90% of the need. Revisit only if caching pain becomes real.

**F-R3 — Split monoliths only when touched.** No big-bang decomposition. Rule of thumb: next time you change `SowCreatePage`/`EwsDetailPage`, extract the section you're editing into a component under `pages/PE/sow-create/`. Add one route-level `errorElement` (Router v7) so a lazy-chunk failure doesn't white-screen.

**F-R4 — Collapse variant pairs behind props, not files**, where the diff is small (compare the pairs first; if a pair diverges >50%, leave it). Keep the dispatcher as the seam.

**F-R5 — Config truth-up (½ day):** remove `"18"` dep; add the brand palette to `tailwind.config.js` and retire `primary #007bff` (update PWA `theme_color` to `#0096c7`); delete the three dead files; align the manifest name/colors.

**F-R6 — Testing: smallest useful setup.** Vitest + a handful of tests for pure logic only (e.g. any client-side duration/aggregation helpers on the timesheet path). Skip component/E2E testing for now — maintenance cost exceeds value for one person. The payroll math lives server-side; test it there (see A-R4/§6 H-tests as SQL).

### 6.3 Priority

| # | Item | Impact | Effort | Order |
|---|---|---|---|---|
| F-R1 | Shared API client + fix localhost/literal-`/api` pages | High (prod correctness) | Low-med | **1** |
| F-R5 | Config truth-up + dead code | Medium | Trivial | **2** |
| F-R3 | errorElement + opportunistic splitting | Medium | Ongoing | 3 |
| F-R4 | Variant collapse (measured) | Medium | Medium | 4 |
| F-R2/6 | useFetch hook, minimal Vitest | Low-med | Low | 5 |

---

## 7. Sequenced roadmap (impact × effort, solo-dev sized)

**Phase 0 — Verify before touching: ✅ DONE 2026-07-07.** All §8 queries ran against prod (verdicts inline there); B1 answered by data; B2–B6 still need your answer. Remaining gates below reflect this.

**Phase 1 — Stop the bleeding (2–4 days):**
1. S-R1 rotate + env-ify secrets (gate: none).
2. A-R4 EWS timezone/rounding fixes (gate: none — two of these are one-liners).
3. S-R5 double-post guard (gate: B4) + dispose of the 431 stale PENDING staging rows (§8.5 N1) before any poster is scheduled.
4. F-R1 fix the four `localhost:3001` pages + literal-`/api` files.
5. **NEW (from prod data):** `REINDEX` `mv_kanban_order_board` (§8.5 N2, reclaims ~440 MB) and fix the one blank `usernfc.snssb` row.

**Phase 2 — Auth + payroll path consolidation (1–2 weeks):**
6. A-R1 token auth, bcrypt, `RBAC_ENFORCE=1`, CORS.
7. A-R3 single SAP posting path (B1 answered: API path is live today; migrate deliberately — backlog first, poster scheduled, then retire `postToSap`).
8. D-R3 payroll constraints — **ungated**: H2/H4/H5 all came back clean, so `VALIDATE CONSTRAINT fk_timesheet_user`, the `sow_standard` unique index, and `snssb` NOT NULL (after the 1-row fix) can be applied now.
9. S-R3 explicit scheduling (gate: B3).

**Phase 3 — Foundations (1 week):**
10. D-R1 migration ledger (now justified by a real incident — §8.5 N3); D-R2 canonical schema (seeded: `schema_prod_20260707.sql`, 92 tables); A-R2 pool unification; A-R5 hygiene batch; D-R4 retention for `machine_heartbeat` (confirmed ~11 GB/yr growth); resolve `production_operations` (§8.5 N4) and set a `backup`-schema policy (§8.5 N5).

**Phase 4 — Debt paydown (ongoing, opportunistic):**
10. S-R2 ETL version pruning; F-R3/F-R4/F-R5; S-R6 VBA relocation; D-R5 conventions.

Deliberately **not** recommended (over-engineering for one maintainer): TypeScript migration, React Query wholesale, microservice splits, Kubernetes, Airflow/Dagster, heavy migration frameworks, full test pyramids, monorepo tooling (nx/turbo).

---

## 8. Hypotheses — VERIFIED against production 2026-07-07

> All checks below were **run read-only against the production DB** (`ptssb` via the root `.env` tunnel, PostgreSQL 15.15, server tz +08 WITA) on 2026-07-07. Verdicts are data, not code inference. A fresh schema-only dump was taken to `database/schema/schema_prod_20260707.sql` — **92 tables**, vs 20 in `schema.sql` and 38 in `local_schema.sql`, so D-F4 (schema drift) is materially worse than the repo suggested. New data-only findings are in §8.5.

**H1 — Double-posted SAP rows exist. → REFUTED (no duplicates today), but see §8.5 N1.**
- `sap_timesheet_staging`: **zero** ztimesheetid with status POSTED more than once. In fact there are **no POSTED/FAILED rows at all** — only `TIMESHEET | PENDING | 431`.
- `log_timesheet_sap` (the API path's audit): 394 rows, **zero** success-duplicates per ztimesheetid.
- Cross-path overlap (staging POSTED ∩ API-log success): zero.
- Verdict: no double-pay evidence in current data. The S-R5 guard remains worth adding *before* the queue goes live, because the window is structural, not yet exercised.

**H2 — `text` date columns disagree with `longdate_*`. → REFUTED.** 116,598 rows carry `date_checkin` (`DD/MM/YYYY`) and **0 mismatches** vs `longdate_checkin AT TIME ZONE 'Asia/Makassar'`. The text columns are redundant but consistent → deprecating them (D-R3) is safe, and this also confirms Makassar as the de-facto stored timezone.

**H3 — Unbounded table growth. → CONFIRMED for `machine_heartbeat`.** 1.92M rows / **190 MB accumulated in 6 days** (oldest row 2026-07-01) ≈ ~11 GB/year at current machine count. `mch_machine_ping_log` is fine (81 MB, retention working). `ews.adoption_bucket_snapshot` tiny (216 kB). D-R4 retention is now a confirmed need, not a precaution.

**H4 — Orphan operators / identity mismatches. → REFUTED (clean).** 0 orphan `serialnumber` in `timesheet_transaction`; 0 `mch_transaction.sn_employee` without a `usernfc` match; `usernfc.snssb` has 0 NULLs and exactly **1 blank-string row** (fix that one row, then add the constraint). **Consequence: `VALIDATE CONSTRAINT fk_timesheet_user` can run today — D-R3 is ungated.**

**H5 — Duplicate standards / production operations. → REFUTED, with a twist.** `sow_standard` (3,198 rows): 0 duplicate `(component_id, operation_no)` — add the unique index now while it's clean. `production_operations`: 0 duplicates because the table is **empty (0 rows)** — see §8.5 N4.

**H6 — Rounding flips KPI status at threshold. → NO EVIDENCE YET (not refuted).** `ews.kpi_snapshot` history only starts 2026-07-01 (~85 rows); no adoption values currently sit in the 94.5–95.5 band. The rounding mechanism in code is unchanged, so keep the A-R4 fix — it's one line and removes the class of problem.

**H7 — `getTrend` tz mis-bucketing. → NO OCCURRENCE YET.** 0 snapshots whose calendar day differs between WITA and WIB — but with 6 days of history and few midnight-adjacent windows this is weak evidence, not absolution. The hardcoded `'Asia/Jakarta'` in `getTrend` is still wrong; fix per A-R4.

### 8.5 New findings from production data (not visible from code)

**N1 — The SAP staging queue has never posted (payroll-operational).** All 431 staging rows are PENDING with the **same `created_at` (2026-07-06 16:45)** — one staging run yesterday, and `post_sap_staging.py` has never run against it. Meanwhile `log_timesheet_sap` has 394 rows → **the API `postToSap` path is the operationally live one; the queue is built but idle.** This answers §9 B1. Action: decide the 431 rows' fate (post them or mark SKIPPED) before enabling any scheduler, otherwise a 2-day-old backlog posts to SAP unannounced the moment S-R3 lands.

**N2 — `mv_kanban_order_board` is pathologically bloated:** 3,194 rows = **2 MB of heap but 443 MB of index+TOAST** (445 MB total, the single largest relation in the DB). Almost certainly repeated `REFRESH MATERIALIZED VIEW CONCURRENTLY` bloating the unique index/TOAST. Fix: `REINDEX MATERIALIZED VIEW` (or drop/recreate) once, then either refresh non-concurrently off-hours or add a periodic reindex. Cheap, reclaims ~440 MB.

**N3 — Migration drift proven by example:** `mch_productiondata_detail` (the cache table from `20260513_create_mch_productiondata_detail_cache.sql`) **does not exist in prod**, while the MV it was meant to replace (`mv_mch_productiondata_detail`, 209 MB) is still live. At least one repo migration was never applied. This upgrades D-R1 (migration ledger) from "good practice" to "known incident".

**N4 — `production_operations` is empty (0 rows)** yet has a mounted API router and a CLAUDE.md entry. Either the feed died or it was superseded by `ph3_order` (62,364 rows). Confirm, then drop the table + `/production-operations` routes, or fix the feed.

**N5 — An ad-hoc `backup` schema lives in prod** (7 tables: `sow_*_20260703_backup`, `mch_user_backup_20260609*`). Fine as a practice, but give it a policy: drop after N days, and never let app code read from it.

**N6 — `ews.kpi_snapshot` is ~25 MB for ~85 rows** (~300 kB of `detail_json` per row — full per-operator breakdown arrays). Bounded growth (daily upsert) so not urgent, but trimming `breakdown` to top-N offenders would keep snapshot reads fast.

---

## 9. Business rules that live only in code — confirm, don't guess

- **B1 — Which SAP posting path is operationally live? → ANSWERED BY DATA (§8.5 N1):** the API `postToSap` path is live (394 audit rows); the Python queue has staged once (431 PENDING, 2026-07-06) and never posted. A-R3 (move to the queue) stands, but the migration must start by disposing of the stale PENDING backlog and scheduling the poster — not by assuming the queue already works in production.
- **B2 — Which ETL transform version is production?** v1/v2/v3 of `etl_mch_transaction`, `etl_machine_conf` vs `_ver1`, `etl_machinehours` vs the conf+transform chain.
- **B3 — What actually schedules the SAP trio and transform ETLs today?** Windows Task Scheduler? Manual? Something on another host? The repo doesn't say.
- **B4 — Is SAP CPI idempotent on ZTIMESHEETID?** If SAP dedupes server-side, S-R5 is belt-and-braces; if not, it's mandatory.
- **B5 — Does anything in payroll read `ews.kpi_snapshot` (or adoption %) directly for incentive calculation**, or is EWS purely a monitoring dashboard? This decides how hard to treat A-F6 (rounding, carry-forward, progressive adoption). Related constants needing confirmation as business rules: shift standard hours Day 8h / Night 7h; shift boundaries 07:00/18:00; night shift end 04:00; Outsource `pernr = 11009413` (`stage_timesheet_transaction.py:56`); the OEE denominator exclusion list (`no job, off, preventive, breakdown, coffee break/lunch, daily pm`); accuracy targets 98/adoption 95/OEE 80/OLE 85.
- **B6 — Timezone ground truth:** `.env` says `Asia/Makassar` (WITA); MSSQL queries hardcode `-8h`. Confirm the plant's legal timezone once, then make it a single constant everywhere.

---

## 10. Not inspected in this pass (explicitly out of evidence)

- **API:** `services/msProjectService.js` (3,173 lines — entirely unread; lock/concurrency behavior unknown), `sowController.js` (~95% unread; its 38 transactions unaudited), `sowScheduleController.js` (mostly unread), `toolsController`, `consumableController`, `dashboardController`, `componentTrackingController`, `mpsDashboardController`, `processControlController`, `machineHoursValidationController`, `kanbanController`, `usernfcController`, `websocket/mpsDashboardSocket.js`, `jobs/ewsSnapshotJob.js`, `jobs/ewsRosterGenerateJob.js`, `kanbanRefreshJob.js`.
- **DB:** `local_schema.sql` bodies (only table list extracted), all 15 legacy migrations, ~30 of 43 api migrations (counted/sized only), all seeds, `machinehours/` CSVs and importers, `toolsmanagement/`, `paket_kumplit/`, `query_use/`, the binary backup dump contents.
- **Jobs/scripts:** `etl_mch_transaction.py` v1 + v3 full bodies, `etl_machine_conf_ver1.py`, `export_csv.py`, `jobs/export/refresh_and_notify.py`, `seed_sow.js` (859 lines, grep only), `seed_sap_staging_manual.py`, `start-postgres-mcp.ps1`, `tts-worker/generate_pending_audio.py` + `tts_announcement.py`, AWS Lambda SQL bodies.
- **VBA:** `ms_fields/ms_serializer/ms_resources/ms_calendars/ms_import.bas`, `JsonConverter.bas`, `httphelper.bas`, all `legacy/*.bas`.
- **Frontend:** internal bodies of ~48 of 63 pages (line counts known, quality INFERRED), `rbac/permissionMatrix.js`, `Can.jsx`, `RequireFeature.jsx` internals, hooks bodies, `index.css`, `public/`.
- **Runtime:** ~~no production DB data was queried~~ **updated 2026-07-07: production data WAS queried read-only** (§8 verdicts, §8.5 findings) and the schema dumped to `schema_prod_20260707.sql`. Still not done: service logs not read; no live scheduler inventory (B3 open); SQL Server SSB_OEE side not queried; the 92-table prod dump not yet diffed table-by-table against the repo migrations (only existence spot-checks).

---

*Prepared from a five-track parallel code exploration + direct reads of the payroll-critical path (ewsCalculator.js in full, ewsController.js head, sync_machine_heartbeat.py in full, .env keys, git tracking status). Companion change made in this pass: CLAUDE.md corrected to match current code (routes, services, versions, timezone, table inventory) — no other code touched.*
