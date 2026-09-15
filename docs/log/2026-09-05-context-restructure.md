---
type: log
status: done
tags: [domain/vault]
---

# 2026-09-05 — Agent context restructure

## What changed

The single 1,348-line Indonesian `CLAUDE.md` was split into a hub plus four loadable documents,
translated to English, and re-scoped from "timesheet app" to **MPS — Master Production System**.

| File | Role |
|---|---|
| `CLAUDE.md` | Hub. What the system is, rule tiers, STOP list, spec-first, Definition of Done, one-line commands, non-negotiables, Track A/B. Everything binding, nothing else. |
| `AGENTS.md` | Thin pointer for non-Claude agents. Four gate facts duplicated on purpose. |
| `docs/standards/design-system.md` | Design point of view, tokens, contrast, layout, states, charts. |
| `docs/standards/component-architecture.md` | Extraction rules, component API design, limits, reference implementation. |
| `docs/standards/anti-slop.md` | Code, copy and visual review checklist. |
| `docs/reference/architecture.md` | Stack, routes, database, services, env, vault and graph conventions. |
| `scripts/deslop.mjs` | Machine gate for rules C1–C16 plus the Track A guard. |
| `scripts/gate.mjs` | One command that runs every T0 check. |
| `.claude/commands/*.md` | One-sentence workflows: `/ui-audit`, `/ui-component`, `/ui-page`, `/deslop`, `/api-perf`, `/spec`. |

## Why

The old file was accurate and unusually good, and that was the problem: at 1,348 lines it
exceeded what an agent reliably keeps in working attention, so its rules degraded into
suggestions. Rules that matter were moved into a gate that rejects commits; the rest were split
so a task loads only what it needs. Nothing was deleted — everything that was fact is now in
`docs/reference/architecture.md`.

## Install

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
node scripts/deslop.mjs --all > docs/planning/deslop-baseline.txt
```

Do **not** install husky: it repoints `core.hooksPath` and silently disables the graphify
post-commit hook.

## Known trade-offs, recorded honestly

1. **Translation provenance.** `docs/reference/architecture.md` was translated from the
   Indonesian original and condensed. Facts were carried across, not re-verified against running
   code. Treat every line as a lead, not proof.
2. **Deliberate duplication.** Four gate facts appear in both `CLAUDE.md` and `AGENTS.md`. That
   is a drift risk, accepted because Codex-style agents often read only `AGENTS.md`. Change
   `CLAUDE.md` first, then mirror.
3. **Regex, not AST.** `deslop.mjs` is pattern matching. `C9` and `C14` in particular will miss
   cases expressed through variables, and may occasionally fire on something legitimate. The
   correct long-term home for those two is a custom ESLint rule — which needs a dependency, so
   it is on the STOP list.
4. **Hooks are bypassable.** `git commit --no-verify` defeats the gate entirely. The gate is
   only real once `node scripts/gate.mjs` runs in CI on every pull request. Until then this is
   a discipline aid, not enforcement.
5. **No tests.** There is no automated test suite and no visual regression tooling, so "verified"
   still means a human exercised the page. Playwright smoke tests plus an axe pass over the top
   ten routes is the obvious next investment.
6. **The `#0096c7` migration is unfinished.** Roughly 364 uses across 62 files. The gate only
   checks staged files precisely so this legacy debt does not block unrelated work.
