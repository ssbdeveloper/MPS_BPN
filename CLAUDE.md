# CLAUDE.md — MPS (Master Production System)

> Agent context file. Read this before writing or changing any code in this repository.
>
> **This file is the contract. It is deliberately short.** Everything binding lives here;
> everything detailed lives in the linked standards and reference documents, which you load
> **only when the task needs them**. Do not paste those documents back into this one — a long
> context file is an ignored context file, and this repo has already been burned once by a
> duplicated context file that drifted for months.
>
> Sections 3–7 are the working rules: tiers, STOP list, spec-first, Definition of Done, and how
> to report what you did. If you read nothing else, read those.

## 1. What this system is

MPS is the shop-floor execution system for a manufacturing plant. It is **not** a timesheet app;
timesheets are one module. Production, labour, machine time and material movement are all
recorded here and pushed to SAP.

| Domain | What it does |
|---|---|
| Timesheet | Operator check-in/out via NFC, validation, SAP posting, operator performance |
| SOW | Scope-of-work orders, standards, revisions, scheduling, verification |
| PPC | Kanban board, component tracking, buffer transactions, receiving/shipment |
| Machine hours | SQL Server (SSB_OEE) ingest, validation, live machine streaming |
| EWS | Early-warning KPIs, adoption, shift roster, alerts, TTS announcements |
| Warehouse | Consumable requests/stock/tickets, tools reservation and handover |
| Integrations | SAP CPI inbound/outbound, AWS Lambda order feed, MS Project (.mpp) sync |

Operating reality that drives most of the rules below:

- **Runs on shop-floor tablets**, portrait and landscape, often behind gloves, in glare, on a
  factory network that drops. Offline-first is a requirement, not a preference.
- **Multi-plant, single codebase.** Plant identity and `variant` (`salvaging` | `manufacturing`)
  come from the database row `plant_config`, resolved at runtime — not from a build flag.
- **Data is operational, not decorative.** A wrong number here becomes a wrong SAP posting.

## 2. Document map — load on demand, not by default

| Document | Load it when |
|---|---|
| `AGENTS.md` | You are an agent whose harness reads `AGENTS.md` instead of this file — it points back here |
| `docs/standards/design-system.md` | Any visual change: colour, spacing, typography, states, charts, responsive |
| `docs/standards/component-architecture.md` | Creating, extending or refactoring a component |
| `docs/standards/anti-slop.md` | Any code you write — it is the review checklist |
| `docs/reference/architecture.md` | You need routes, DB tables, services, env vars, folder ownership |
| `docs/KONVENSI.md` | You are writing anything into `docs/` — it owns frontmatter, linking and the vault layers |
| `docs/00-INDEX.md`, `docs/PLANNING.md`, `docs/STATUS.md` | You need to find an existing plan, or record that one moved |
| `docs/concepts/`, `docs/log/` | **Before** designing anything — do not relitigate settled decisions |
| `docs/planning/UI-DEBT.md`, `docs/planning/API-PERF-BACKLOG.md` | You found debt you are not fixing now — write it down there |

**Division of authority.** This file governs code, gates and workflow. `docs/KONVENSI.md`
governs the `docs/` vault: frontmatter, the four layers, linking rules. Where they overlap —
what to record after a session — this file states the obligation and KONVENSI states the format.
Neither one may contradict the other; if they do, that is a bug, and this file wins until it is
fixed.

## 3. Rule tiers — every rule has exactly one

| Tier | Meaning | Enforced by |
|---|---|---|
| **T0 — hard gate** | Non-negotiable. The commit is rejected. | `node scripts/gate.mjs` in `.git/hooks/pre-commit` and in `.github/workflows/gate.yml` |
| **T1 — approval gate** | Allowed, but **stop and ask a human first**. | Agent discipline + review |
| **T2 — standard** | The written standards. Deviating is allowed, but the reason goes in `docs/log/`. | Review |

An unenforced rule is a suggestion. When adding a rule, assign its tier first; if it cannot be
machine-checked and is not worth stopping a human for, do not add it.

**This tier table is a claim about reality, and it is checkable.** If `.git/hooks/pre-commit` is
missing, or no CI workflow runs the gate, then T0 does not exist and this table is lying. Verify
before relying on it:

```powershell
Test-Path .git/hooks/pre-commit          # must be True
node scripts/gate.mjs --fast             # must run, with your work staged
git ls-files scripts | Measure-Object    # must not be 0 - see the warning below
```

If the hook is missing, install it — see section 8 — and say so in your session log.

### Known blocker as of 2026-09-05: the enforcement machinery is not committed

`scripts/` was dropped from the git index in commit `65e5afc` and never restored, and most of
`docs/` — including every standard this file links to — has never been committed at all. At
`HEAD` the repository contains **4 files under `docs/` and 0 under `scripts/`**.

The practical meaning: `gate.mjs`, `deslop.mjs`, `lint-gate.mjs`, `mirror.mjs`, `migrate.js`'s
companions, `deploy.sh`, `docs/standards/*` and `docs/concepts/*` exist on this machine and
nowhere else. A fresh clone has no gate. CI cannot run one. Every rule in this file currently
points at a file that only one developer has.

Until a human decides what may be published to a public GitHub remote and commits it, T0 is
enforced by the local pre-commit hook only, and `.github/workflows/gate.yml` will fail on its
first run. Do not paper over this by rewriting the tier table; it is a real gap with a real fix,
and the fix is a human's call because it publishes documents to a public repository.

## 4. STOP list (T1) — ask before doing, never apologise after

<!-- MIRROR:stop-list -->
1. Touching `apps/api/**`, `apps/fastapi-msproject/**`, `apps/tts-worker/**`, `apps/mobile/**`,
   `jobs/**`, `database/migrations/**`.
2. Changing an API contract — path, query param, response shape. "Just adding a field" counts.
3. Adding, removing or major-upgrading an npm dependency.
4. Changing `tailwind.config.js`, the `:root` block in `index.css`, `vite.config.js`,
   `router/index.jsx`, `eslint.config.js`, or anything in `scripts/`.
5. Deleting files, renaming a component used by more than one page, or any refactor spanning
   five or more files.
6. Changing business behaviour — validation, hour arithmetic, SAP eligibility — while the task
   is "change the UI".
7. Anything touching `.env`, docker compose, or nginx.
8. Weakening a gate: editing `scripts/lint-baseline.json` upward, adding `deslop-allow` to more
   than three lines in one commit, or committing with `--no-verify`.
<!-- /MIRROR:stop-list -->

"Ask first" means stop and wait for an answer. It does not mean do it and mention it afterwards,
and it does not mean ask a question and then answer it yourself in the same message.

## 5. Spec first — no code until the plan exists

<!-- MIRROR:spec-first -->
For any change spanning more than one file:

**Investigate → Spec (`docs/planning/<topic>.md`) → Plan → Approval → Implement → Verify →
Record (`docs/log/`)**

A single obvious fix — a typo, one wrong class — skips this.
<!-- /MIRROR:spec-first -->

1. **Investigate (read-only).** Read the actual code. Check `docs/concepts/` and `docs/log/`
   first. Any negative claim — "nothing calls this", "safe to delete" — must be backed by grep
   output, not by the code graph alone; the graph under-reports callers (see
   `docs/concepts/codebase-memory-graph-accuracy.md`).
2. **Spec** — one page at `docs/planning/<topic>.md`: the problem, the scope, **what is
   explicitly out of scope**, the blast radius, and how the result will be verified.
3. **Plan** — numbered steps, files touched per step, commit order.
4. **Approval** — wait for anything on the STOP list. Otherwise continue.
5. **Implement** — one step, one commit. Never mix a refactor and a behaviour change in one
   commit; if it regresses, the two cannot be separated at revert time.
6. **Verify** — the Definition of Done below.
7. **Record** — see section 7.

## 6. Definition of Done — all of it, not a selection

- [ ] **Work is staged.** `node scripts/gate.mjs` reads the staged diff. Run it on an empty
      index and it checks nothing and prints `gate passed` — true, and worthless.
- [ ] `node scripts/gate.mjs` passes. UI work runs `node scripts/gate.mjs --track-a`.
- [ ] `npm --prefix apps/web run test` passes, and **behaviour you changed has a test**. A new
      component gets a render test; changed hour arithmetic, validation or SAP eligibility gets
      a unit test with the boundary case that motivated the change. "It is only UI" is not an
      exemption for logic that produces a number.
- [ ] Exercised at **768×1024** (tablet portrait) and **≈960×600** (tablet landscape).
- [ ] Loading, empty and error states are present and correct.
- [ ] Keyboard: every action reachable by Tab, focus ring visible, `Escape` closes modals.
- [ ] **Network behaviour unchanged** for UI work — same requests, same order, same count.
      `node scripts/deslop.mjs --track-a` proves it; see section 10 for exactly what it catches.
- [ ] The diff removes more than it adds, or removes duplication. If a "tidy-up" grows the file,
      the commit message explains why.
- [ ] Recorded per section 7 — log, `PLANNING.md` line, and any concept note the work changed.

## 7. Recording and reporting

**Record (T2, every session that changed anything):**

1. `docs/log/YYYY-MM-DD-topic.md` — what was decided, what was executed, what is still pending
   on a human. Frontmatter and linking rules are in `docs/KONVENSI.md`.
2. A line in `docs/PLANNING.md`.
3. **Update the concept note the work changed.** If the session altered how the system actually
   works — not just what happened today — the durable knowledge belongs in `docs/concepts/`, not
   buried in a log nobody rereads. New durable knowledge means a new concept note.

**Report (T0 in spirit — this is the rule most easily broken and hardest to detect):**

- Never claim a check you did not run. Paste the gate output; do not summarise it from memory.
- If the build failed, say it failed. If a page could not be exercised, say which one and why.
- If you skipped part of the task, say which part and why, in the same message where you report
  the rest as done. Scaling the work down is the human's decision, not yours.
- An agent that reports success it did not verify is worse than one that reports failure,
  because the failure surfaces later, in production, attached to an SAP posting.

**When something you shipped regresses:** revert first, diagnose second. `git revert <sha>` of
the single commit — this is why section 5 forbids mixing a refactor with a behaviour change.
Then write the log entry: what broke, what the revert restored, what the fix will need. Do not
fix forward on a broken shop floor.

## 8. Commands

<!-- MIRROR:gate -->
**The gate, before every commit, with your work staged:**

```
node scripts/gate.mjs          # UI work: node scripts/gate.mjs --track-a
```

It runs, in order: context mirror → design contract (`deslop`, changed lines only) → eslint
ratchet → tests → production build. The last three are skipped when the diff does not touch
`apps/web`. **Nothing staged means nothing checked** — `git add` first, or the gate passes
vacuously.
<!-- /MIRROR:gate -->

| Command | What it does |
|---|---|
| `node scripts/gate.mjs` | Every T0 check on the staged diff. Run before every commit. |
| `node scripts/gate.mjs --fast` | Same, without the production build. What the pre-commit hook runs. |
| `node scripts/gate.mjs --track-a` | Adds the Track A guard. UI work uses this. |
| `node scripts/deslop.mjs --staged` | Design contract on the staged diff — changed lines only. |
| `node scripts/deslop.mjs --all` | Whole-codebase debt report. Never blocks. |
| `node scripts/deslop.mjs --files <a> <b>` | Full-file audit of named files. Blocking. |
| `node scripts/lint-gate.mjs` | ESLint ratchet — fails only on **new** errors. |
| `node scripts/lint-gate.mjs --all` | Whole-app ESLint count. Never blocks. |
| `node scripts/mirror.mjs` | Verifies the duplicated blocks in `AGENTS.md`. `--fix` rewrites them. |
| `npm --prefix apps/web run test` | Vitest, once. |
| `npm --prefix apps/web run test:watch` | Vitest, watching. |
| `npm --prefix apps/web run dev` | Frontend dev server on :5173. |
| `npm --prefix apps/web run build` | Production build. |
| `npm --prefix apps/web run lint` | Raw ESLint. Reports the debt too — use `lint-gate.mjs` to decide. |
| `node apps/api/server.js` | Express API on :3001. |
| `node database/migrate.js` | Apply migrations through the `schema_migrations` ledger. |
| `scripts/deploy.sh build\|start\|stop\|status\|logs api` | Docker lifecycle. |

Agent workflows live in `.claude/commands/`: `/spec`, `/ui-audit`, `/ui-component`, `/ui-page`,
`/deslop`, `/api-perf`. Each one encodes a workflow from this file; read the command file rather
than reconstructing the workflow from memory.

**Install the pre-commit hook once**, per clone:

```powershell
Copy-Item scripts/hooks/pre-commit .git/hooks/pre-commit -Force
```

```sh
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

Do **not** install husky — it repoints `core.hooksPath` and silently kills the graphify
post-commit hook already installed in `.git/hooks/`.

## 9. Non-negotiables

1. **Design system is not optional.** Colour, spacing, radius, elevation, motion and states come
   from `docs/standards/design-system.md`. No new palette, no new scale, no ad-hoc value.
2. **Light theme only.** No `dark:` prefix, no dark surface as a page background.
3. **Offline-first — no external assets.** No CDN, no Google Fonts, no hot-linked images. Every
   library through npm and bundled by Vite; fonts are the system stack.
4. **Component-first.** Check `apps/web/src/components/` before writing markup. A pattern used
   twice becomes a component. Never copy a long `className` string between pages.
5. **Logic stays in components.** No Redux/Zustand/MobX. `useState` + `useCallback` + native
   `fetch`. Never Axios for FormData — its transform corrupts the payload.
6. **Accessibility is measured, not assumed.** Primary action and links on white: `#0077b6`
   (4.9:1). `#0096c7` fails AA for small text (3.4:1) — icons, large text and borders only.
   Minimum text size 12px. Touch targets ≥ 44px. `focus-visible:` on buttons and links.
7. **Every fetch page has loading, empty and error states.** An error must be inline with a
   retry, not only a toast; a toast disappears and leaves a blank screen behind.
8. **`.env` is single, at the repo root**, read by both backend and frontend, and never
   committed. Timezone comes from `TIMEZONE` (currently `Asia/Makassar`) — never hard-coded.
9. **New routes are registered in `apps/web/src/router/index.jsx`** — and that file is on the
   STOP list.
10. **Migrations only in `database/migrations/`**, applied through the ledger. Never inline DDL
    in application code.
11. **Track A ≠ Track B** — section 10.
12. **No progress reports inside source files.** No `// === REFACTORED ===` banners, no
    changelogs in JSX. Reports belong in `docs/log/`.
13. **Do not weaken a gate to make a commit pass.** Fix the code, or stop and ask. Suppressions
    (`deslop-allow C<n>: reason`) are for real exceptions, one at a time, with the reason
    written out — not for clearing a backlog of findings.

## 10. Track A and Track B

<!-- MIRROR:track-split -->
**Track A ≠ Track B.** UI work never changes `apps/api/**` or the shape of any request or
response — and that includes polling intervals, which change server load from inside frontend
code. Backend performance findings are written to `docs/planning/API-PERF-BACKLOG.md` and
scheduled separately; they are never fixed opportunistically inside a UI commit.
<!-- /MIRROR:track-split -->

**Track A allows:** component extraction; colour/spacing/radius normalisation;
loading/empty/error states; accessibility and touch targets; tablet responsiveness; memoisation;
debounced search inputs; `AbortController` for stale requests; removing duplicate frontend
fetches; list virtualisation; deleting dead code; tests.

**Track A forbids (this is Track B):** new or changed endpoints; new response fields;
server-side pagination changes; moving aggregation into SQL; changing a polling interval.

**What `--track-a` actually enforces**, so a block is never a surprise:

- The staged diff may only touch `apps/web/` and `docs/`. Anything else fails, including
  `scripts/`, `infra/` and `apps/mobile/`.
- Inside `apps/web/`, no added or removed line may match `fetch(`, `axios`, `new WebSocket`,
  `new EventSource`, **`setInterval(`**, or a `'/api/…'` string. `setInterval` is in that list
  deliberately: a polling interval is server load expressed in frontend code.

**Phases, in order.** F0 audit (read-only) → F1 foundation components → F2 pilot page →
F3 module-by-module rollout → F4 legacy cleanup. One PR is one page **or** one foundation
component; a diff beyond roughly 400 lines must be split.

**Track B output is a document, not code.** Findings go in `docs/planning/API-PERF-BACKLOG.md`,
one row each:
`endpoint · consuming page · symptom · evidence · suspected cause · proposal · risk · effort · status`.

Look for, in rough order of likelihood: endpoints returning whole tables that the frontend then
filters; `SELECT *` on wide tables; N+1 queries inside JavaScript loops; non-sargable date
filters (`DATE(col) = …`) that skip indexes; full `COUNT(*)` for pagination; joins to expensive
views; missing indexes on hot filter columns — this repo has only two trigram indexes and no
index at all on `full_name` / `part_name`; short frontend polling intervals against expensive
endpoints; synchronous materialized-view refresh inside a request; and pool starvation from
`DB_POOL_MAX=5` behind pgbouncer transaction pooling.

Rules if a change is later approved: numbers before and after, or no change.
`EXPLAIN (ANALYZE, BUFFERS)` in the document for every query touched. New indexes via migration,
`CREATE INDEX CONCURRENTLY` in production. API changes are additive and opt-in (`?fields=`,
`?limit=`) — never a redefinition of an existing field. One performance PR improves one number.

## 11. The gate is a ratchet, not a clean bill of health

This codebase predates its own standards. As of 2026-09-05:

| Check | Debt | Where |
|---|---|---|
| `deslop --all` | ~1,722 errors across 115 of 177 files under `apps/web/src` | `docs/planning/UI-DEBT.md` |
| `lint-gate --all` | 65 errors across 29 files | `scripts/lint-baseline.json` |

So the gates are **diff-scoped on purpose**:

- `deslop --staged` checks the **lines your diff added or changed**, not the whole file. A file
  your diff creates is checked in full — it has no legacy. File-level rules (C13 length, C14
  duplicated `className`) are warnings on an existing file and errors on a new one.
- `lint-gate.mjs` fails only when a file gains ESLint errors it did not have in
  `scripts/lint-baseline.json`. The count per (file, rule) is the unit, so it survives line
  shifts.

**Why this matters for how you behave.** A whole-file gate on this codebase would block edits to
two thirds of the frontend, and the first thing anyone would do is uninstall the hook — which is
exactly what had happened before this was written. So: do not treat a legacy finding in a file
you touched as your problem to fix in this commit. Fix your lines, note the rest in
`docs/planning/UI-DEBT.md`, move on. And do not mass-apply `deslop-allow` or raise the lint
baseline to get a commit through — both are on the STOP list.

Paying debt down is deliberate work: a commit that only pays debt, with the baseline regenerated
(`node scripts/lint-gate.mjs --update-baseline`) and the reduction stated in the message.

## 12. Language

- **Code, comments, commit messages, `CLAUDE.md`, `AGENTS.md`, `docs/standards/`,
  `docs/reference/`, `.claude/commands/`: English.** These are read by tooling and by agents.
- **`docs/` vault content — concepts, logs, plans, PRDs, UAT checklists: Indonesian**, matching
  `docs/00-INDEX.md` and `docs/KONVENSI.md`.
- **Operator-facing UI copy:** the language the plant uses. System terms (SAP, work center, TS
  number) stay verbatim. Never half and half on one screen — see `docs/standards/anti-slop.md`.
- Match the document you are editing. Never switch a document's language as a side effect of
  another change.

## 13. Local database access (Windows dev box)

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\Program Files\PostgreSQL\15\bin"
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -d ptssb
```
