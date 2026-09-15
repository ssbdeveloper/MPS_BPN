---
description: Track A phase F1 — build or refactor one foundation component, with a test
argument-hint: <ComponentName>
---

Foundation component: **$ARGUMENTS**

One component, one PR. This is Track A: `apps/web/` and `docs/` only.

## 1. Before writing anything

- `apps/web/src/components/` — does this already exist under another name? A near-duplicate is
  worse than no component. If it exists, this task is a refactor of that one, not a new file.
- `docs/standards/component-architecture.md` — props, composition, and where the file goes.
- `docs/standards/design-system.md` — every colour, spacing, radius and state comes from there.
  No new token. No ad-hoc hex.
- Rule of two: if this pattern has exactly one consumer today, do not extract it. Say so and
  stop.

## 2. Build it

- Under 200 lines (C13). If it does not fit, it is two components.
- Buttons: `min-h-[44px]` and `focus-visible:` — C8 checks both.
- No `dark:`, no gradient outside a group header or badge, no `backdrop-blur` outside a modal
  overlay, no emoji, no external URL.
- `className` prop is layout-only. Variants are explicit props, not a `className` that overrides
  colour.
- No data fetching inside a foundation component. It receives data; the page owns the fetch.

## 3. Test it — this is required, not optional

Write `<ComponentName>.test.jsx` next to it, in the style of the existing tests in
`apps/web/src/components/ui/`. At minimum: it renders with required props, each variant renders
its distinguishing mark, and the interactive path (click, keyboard) does what it claims. Then:

```
npm --prefix apps/web run test
```

## 4. Ship it

```
git add <files>
node scripts/gate.mjs --track-a
```

Paste the gate output — do not summarise it. Then record the session per CLAUDE.md section 7:
`docs/log/`, a line in `docs/PLANNING.md`, and update the concept note if the component changed
how something in the system actually works.
