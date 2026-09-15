# Component Architecture — MPS

> How UI is built, so that it stays flexible, reusable and cheap to maintain.
> Tier T2 unless marked with a `C<n>` code, which is a T0 gate.

---

## 1. The rule of two

1. **Look in `apps/web/src/components/` first.** If it exists, use it or extend it.
2. If it does not exist and the pattern is used — or will obviously be used — in **two or more**
   places, build the component first, then use it.
3. When you see the same markup a second time while editing, **extract it**. Do not add a third
   copy. `C14` warns on an identical 40+ character `className` used twice in one file and fails the commit at three.

The inverse matters just as much: **do not abstract on first use.** A wrapper with one consumer
is indirection with no payoff. Write it inline, extract it when the second consumer appears.

---

## 2. Component API design

A component is flexible when callers can express *intent*; it is brittle when callers can
express *styling*. Design for the first.

### Variants over booleans

```jsx
// ✅ one axis, one prop, closed set
<Button variant="danger" size="sm" />

// ❌ boolean explosion — 2^n invalid states, and nobody knows which wins
<Button isPrimary isDanger isSmall isGhost />
```

### The variant map is the component

Keep the styling decisions in one lookup object at the top of the file. Adding a variant is one
line, and every variant is visible at a glance.

```jsx
// apps/web/src/components/ui/Button.jsx
const BASE =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg font-semibold ' +
  'transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none ' +
  'motion-reduce:transition-none motion-reduce:transform-none';

const VARIANT = {
  primary: 'bg-[#0077b6] hover:bg-[#023e8a] text-white',
  outline: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300',
  danger:  'bg-red-600 hover:bg-red-500 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  ghost:   'bg-white/20 hover:bg-white/35 text-white rounded-full',
};

const SIZE = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[BASE, VARIANT[variant], SIZE[size], className].filter(Boolean).join(' ')}
      {...props}
    >
      {loading ? <Spinner size={14} /> : Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
```

Read it as a template, not as a file to paste: it shows the five things every shared component
in this codebase does — a `BASE` string, closed variant maps, a safe default, an accessibility
floor baked in, and a single `className` seam.

### The `className` seam

`className` from the caller is **layout only** — margin, width, grid placement, `flex-1`.
It must never override colour, radius or elevation. Two consequences:

- If a page needs a different colour, that is a new **variant**, decided here, not a one-off
  override there.
- Put the layout classes last in the merge order, as above, so a caller's `w-full` wins over an
  internal `w-auto` without needing a merge library.

### Composition beats configuration

When a component starts growing props like `showHeader`, `headerRight`, `footerLeft`, stop and
switch to slots or compound components.

```jsx
// ❌ prop soup
<Card title="Order" showBadge badgeText="Late" showFooter footerAction={<Button/>} />

// ✅ slots — the caller composes, the component owns spacing and surface
<Card>
  <Card.Header title="Order" right={<StatusPill tone="late">Late</StatusPill>} />
  <Card.Body>…</Card.Body>
  <Card.Footer><Button size="sm">Validate</Button></Card.Footer>
</Card>
```

Rule of thumb: **more than seven props, or any prop that takes JSX and is named `*Content`,
means a slot is missing.**

### Presentational, always

Shared components hold no fetch, no route access, no global state. Data and effects live in the
page; the component receives values and callbacks. This keeps them testable by eye, reusable
across the salvaging and manufacturing variants, and safe to move.

### Controlled by default

Inputs take `value` + `onChange`. If an uncontrolled mode is genuinely needed, add
`defaultValue` — never both semantics in the same prop.

### State goes on `data-*`, not in class soup

`data-state="loading"`, `data-tone="late"` gives styling hooks and debugging visibility without
callers passing conditional class strings around.

---

## 3. File and folder layout

```
apps/web/src/components/
├─ ui/        Button, Modal, Card, Badge/StatusPill, Skeleton, Spinner, EmptyState, Switch
├─ forms/     Input, Select, SearchInput, FormField
├─ tables/    Table, TableEmpty, Pagination
├─ layout/    PageContainer, PageHeader, FilterBar, OfflineIndicator
└─ dashboard/ KpiCard, *Chart, ChartErrorBoundary
```

- One component per file, named exactly like the file, default export.
- **No barrel `index.js` files** that only re-export — they hide the dependency graph, defeat
  tree-shaking and make dead-code detection unreliable.
- Component-private helpers live in the same file. Shared helpers live in a themed module
  (`format/date.js`, `timesheet/hours.js`) — never a `utils.js` dumping ground.
- Page-specific hooks live next to the page (`pages/TIMESHEET/useTimesheetFilters.js`), not in
  `components/`.

---

## 4. Maintainability limits (hard)

| Limit | Value | Gate |
|---|---|---|
| Page file | ≤ 400 lines | `C13` |
| Component file | ≤ 200 lines | `C13` |
| Identical `className` in one file | 2 warns, 3 fails | `C14` |
| Props on a shared component | ≤ 7 before switching to slots | review |
| Prop drilling depth | ≤ 2 levels before lifting or composing | review |

A page over 400 lines is not a style problem, it is an extraction that has not happened yet.
The usual split is: page (data + orchestration) → section components (layout) → shared
components (`components/`) → pure helpers (`format/`, domain modules).

---

## 5. Current inventory — verify before assuming

| Component | Status |
|---|---|
| `ui/Button`, `forms/Input`, `ui/Switch`, `tables/Table` | ⚠️ exist in the **old** style (`shadow-3d`, `primary #007bff`). Not a visual reference. Migrate them in place when touched — do **not** create `ButtonV2` |
| `ui/Modal`, `ui/ConfirmationModal`, `ui/Card`, `layout/PageContainer` | ✅ use these; never build an inline modal or card |
| `dashboard/KpiCard`, `dashboard/ChartErrorBoundary`, `dashboard/*Chart` | ✅ follow these plus the dataviz rules |

**To build, in this order** (final order comes from the F0 audit's real usage counts):
`Button` → `PageHeader` → `StatusPill` → `SearchInput` / `Input` → `EmptyState` → `Skeleton` →
`StatCard` → `FilterBar` → `Modal` (migrate) → `Table` (migrate) → `OfflineIndicator`.

`Select` already exists in the old `forms/Input.jsx` — migrate it, do not create a new one.

---

## 6. Modals, keyboard and focus

Always `ui/Modal`. It owns: focus moves into the dialog on open, `Escape` closes, focus returns
to the trigger on close, `role="dialog" aria-modal="true"`, and scroll locking. A page that
builds its own overlay will get these wrong.

---

## 7. Deleting code

Deletion is on the STOP list, and the evidence bar is grep, not the code graph — the graph
under-reports callers. Before proposing a deletion, show: the grep for the import, the grep for
the symbol, and the check against `router/index.jsx`. Both variant folders (`salvaging/`,
`manufacturing/`) must be checked; the dispatcher resolves them at runtime.

---

## 8. Verification, honestly

There is no automated test suite and no visual regression tooling in this repo today. Until
there is, "verified" means: the gate passes, the page was exercised in both tablet orientations,
the keyboard path works, and the network panel shows the same requests as before. Say which of
those you actually did. Claiming a component "works" without exercising it is the single most
expensive lie an agent can tell here.

A worthwhile next investment, when someone has the budget for it: Playwright smoke tests over
the ten highest-traffic routes plus an axe accessibility pass. That is a dependency decision, so
it is on the STOP list.
