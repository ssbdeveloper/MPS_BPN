# AGENTS.md — MPS (Master Production System)

> **Single source of truth: [CLAUDE.md](./CLAUDE.md).** Read it before writing or changing any
> code, starting with sections 3–7 (rule tiers, STOP list, spec-first, Definition of Done,
> recording and reporting).
>
> **Do not add content to this file.** It is deliberately thin so that two context documents
> cannot drift apart. Everything below the next heading is a verbatim copy of CLAUDE.md, checked
> by `node scripts/mirror.mjs` on every commit — edit CLAUDE.md, then run
> `node scripts/mirror.mjs --fix`. Editing the copy by hand fails the gate.

## If this file is all you read, you are not ready to write code

The four blocks below are **deliberately duplicated** because they are gates, and because some
harnesses read `AGENTS.md` and never open `CLAUDE.md`. They are the minimum that keeps an agent
from doing damage before it finds the real contract. Nothing else gets copied.

### The gate

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

### STOP — ask a human first

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

### Spec first

<!-- MIRROR:spec-first -->
For any change spanning more than one file:

**Investigate → Spec (`docs/planning/<topic>.md`) → Plan → Approval → Implement → Verify →
Record (`docs/log/`)**

A single obvious fix — a typo, one wrong class — skips this.
<!-- /MIRROR:spec-first -->

### Track A ≠ Track B

<!-- MIRROR:track-split -->
**Track A ≠ Track B.** UI work never changes `apps/api/**` or the shape of any request or
response — and that includes polling intervals, which change server load from inside frontend
code. Backend performance findings are written to `docs/planning/API-PERF-BACKLOG.md` and
scheduled separately; they are never fixed opportunistically inside a UI commit.
<!-- /MIRROR:track-split -->

## Where the rules actually live

| Document | Load it when |
|---|---|
| `CLAUDE.md` | Always, first |
| `docs/standards/design-system.md` | Any visual change |
| `docs/standards/component-architecture.md` | Building or refactoring a component |
| `docs/standards/anti-slop.md` | Every diff — it is the review checklist |
| `docs/reference/architecture.md` | You need routes, tables, services, env vars |
| `docs/KONVENSI.md` | You are writing anything into `docs/` |

## Minimum orientation

- **Monorepo:** React 19 + Vite 7 + Tailwind v3 in `apps/web`; Express (CommonJS) in `apps/api`;
  FastAPI in `apps/fastapi-msproject`; TTS worker in `apps/tts-worker`; Android heartbeat app
  (Gradle/Kotlin) in `apps/mobile`; ETL and SAP jobs in `jobs/`; SQL migrations only in
  `database/migrations/`. Also present and rarely yours to touch: `infra/`, `aws/`, `tools/`,
  `scripts/`.
- **The gate is a ratchet, not a clean bill of health.** ~1,700 pre-existing design findings and
  65 ESLint errors are recorded as debt; the gate checks the lines you changed. Do not adopt a
  legacy file's debt as your commit's problem, and do not suppress your way past a finding —
  CLAUDE.md section 11.
- **Non-negotiable UI rules:** light theme only; offline-first, so no CDN, fonts or external
  assets; component-first, so never paste a long `className` between pages.
- **Anti-slop:** no decorative gradients, no emoji, no marketing tone, no `XxxPageV2.jsx`, no
  comments that restate the code.
- **Single `.env` at the repo root**, read by backend and frontend, never committed. Timezone
  comes from `TIMEZONE` — never hard-coded.
- **Language:** English for code and contracts, Indonesian for the `docs/` vault. CLAUDE.md
  section 12.
- Frontend commands run with `npm --prefix apps/web run <script>`. New routes are registered in
  `apps/web/src/router/index.jsx`, which is on the STOP list.

## History

An earlier version of this file was a full copy of CLAUDE.md and drifted badly — it claimed
React 18, React Router v6, TanStack Query, and a `TimesheetValidationPageV2.jsx` that did not
exist. It was replaced by a thin pointer plus four hand-mirrored gates. That policy failed too,
quietly: an audit on 2026-09-05 found the copied STOP list had lost two of its seven items,
including "do not change business behaviour while the task is UI".

The lesson is not "duplicate less". It is that **a rule nobody can check is a rule that decays**
— the same principle as the tier table in CLAUDE.md section 3. The duplication is now
machine-checked by `scripts/mirror.mjs`, which is a step in the gate. New information goes into
CLAUDE.md or a standards document, never into a second copy here.
