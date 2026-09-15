# Design System — MPS

> Status: **approved and active**. Binding for every new page and every page you touch.
> Tier T2 unless a rule carries a `C<n>` marker — those are T0 and enforced by
> `node scripts/deslop.mjs`.
> Structural reference implementation: `apps/web/src/pages/TIMESHEET/TimesheetValidationPage.jsx`
> (its primary buttons still use the old `#0096c7`; the current standard is `#0077b6`).

---

## 1. Point of view — how this product should feel

This is the part that keeps the UI from looking machine-generated. Generic AI interfaces are
generic because they have no point of view; they reach for the statistical average — gradient
hero, three identical cards, everything `rounded-2xl`, decorative icons, a soft shadow under
every box. This product has a point of view, and it is the opposite of that.

**MPS reads as an instrument panel, not a web app.** Five commitments:

1. **Density is a feature.** An operator validating 80 timesheet rows needs them on one screen,
   not spread across airy cards. Prefer tables and tight rows over card grids. White space
   separates *groups*, not every element.
2. **The data is the design.** Numbers, statuses and identifiers are the loudest things on the
   screen. Chrome — headers, labels, borders — stays quiet: slate, thin, small.
3. **Every structural device carries information.** A border means a boundary; a colour means a
   state; a number means a sequence. If a divider, badge, icon or eyebrow is not encoding
   something, delete it.
4. **Colour is a signal, not a mood.** Roughly 80% neutral surface, 20% brand and status colour
   used only where it means something. Brand blue is an accent, never a page background.
5. **Motion answers actions.** Something moves because the user did something. No entrance
   animations, no ambient pulsing, no hover effect on every card.

Restraint test before shipping a screen: remove one visual element. If nothing is harder to
read or to do, it should not have been there.

---

## 2. Colour tokens

Declared in `apps/web/src/index.css` `:root` and mapped in `tailwind.config.js`
(`colors.brand.*`, `colors.canvas`, `colors.status.*`). **Hex values outside this table are
rejected by `C1`.**

### Brand blues

| Token | CSS variable | Hex | Use |
|---|---|---|---|
| deep-twilight | `--deep-twilight` | `#03045e` | Deepest text contrast, active borders |
| french-blue | `--french-blue` | `#023e8a` | Brand primary; primary button hover; group headers |
| bright-teal-blue | `--bright-teal-blue` | `#0077b6` | **Primary action** — button background, links (4.9:1 on white, AA) |
| blue-green | `--blue-green` | `#0096c7` | Large accents, icons, active borders only — **3.4:1, fails AA for small text** |
| turquoise-surf | `--turquoise-surf` | `#00b4d8` | Focus ring, spinner, highlight |
| sky-aqua | `--sky-aqua` | `#48cae4` | Subtle icon accent — never text |
| frosted-blue | `--frosted-blue` | `#90e0ef` | Light borders, dividers |
| frosted-blue-2 | `--frosted-blue-2` | `#ade8f4` | Secondary surface |
| light-cyan | `--light-cyan` | `#caf0f8` | Table header rows, stat cards |

### Surface and semantic accents

| Token | Hex | Contrast note |
|---|---|---|
| `--canvas` | `#eef2f6` | **Background only.** `#0077b6` on it is 4.33:1 and `#b45309` is 4.46:1 — both fail AA. Canvas vs white is only 1.12:1, so card separation must come from border + shadow, never from the tint alone |
| `--status-late` | `#b45309` | 5.02:1 on white |
| `--status-running` | `#0077b6` | 4.87:1 on white |
| `--status-ok` | `#047857` | 5.48:1 on white |

**Binding rule:** accent text and labels always sit on a **white** surface, never directly on
`--canvas`. The two most-used accents fail AA on canvas and pass on white.

### Neutrals (Tailwind built-ins, use directly)

| Role | Class |
|---|---|
| Page background | `bg-slate-50` |
| Surface (card, panel, modal, input) | `bg-white` |
| Border | `border-slate-200`, hover `border-slate-300` |
| Heading and body text | `text-slate-800` |
| Secondary text | `text-slate-500` |
| Placeholder | `placeholder-slate-400` |

### Where each background belongs

| Context | Correct | Wrong |
|---|---|---|
| Page root | `bg-slate-50` — except `/sow-scheduling`, which uses `bg-canvas` | Dark gradient |
| App header | `bg-white border-b border-slate-200 shadow-sm` | `bg-blue-900`, dark rgba |
| Filter panel / sidebar | `bg-white border-b border-slate-200` | Translucent dark |
| Card | `bg-white shadow-sm border border-slate-200 rounded-xl` | Blue background |
| Stat card accent | `#fffbeb`, `#f0fdf4`, `#caf0f8`, `#eef2ff` | Saturated fills |
| Table header row | `#caf0f8` | Dark blue |
| Group header (the one place a dark blue fill is allowed) | `linear-gradient(135deg, #023e8a, #0077b6)` | Anywhere else |

---

## 3. Accessibility floor

- Normal text ≥ 4.5:1; large text (≥24px, or bold ≥18.66px) ≥ 3:1.
- `text-slate-800` on white ≈ 14:1. `text-white` on `#0077b6` = 4.9:1. `text-white` on `#0096c7`
  = 3.4:1 — **fails**, so `#0096c7` is never a button background or small-text colour.
- Minimum readable size 12px (`text-xs`). `text-[11px]` is reserved for uppercase badge and
  eyebrow labels. Below 11px is forbidden (`C7`).
- Focus is always visible: `focus-visible:ring-2 focus-visible:ring-[#00b4d8]
  focus-visible:outline-none` on buttons and links, `focus:ring-2` on inputs (`C8`). Never
  `outline-none` without a replacement.
- Status is never colour alone — pair it with a text label.
- Touch targets ≥ 44×44px (`C8`). Clickable rows ≥ 52px.
- Clickable elements are `<button>`, not `<div onClick>` (`C9`). If a div is unavoidable:
  `role="button" tabIndex={0}` plus Enter/Space handlers.

---

## 4. Typography

- Font stack is the system stack — zero network, instant render:
  `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
  A brand font, if ever needed, is self-hosted via `@fontsource/*`, never a CDN link.
- **Numeric columns require `tabular-nums`** (`C10`) — hours, quantities, durations, order
  numbers. Without it digits do not line up and the column cannot be scanned.
- Identifiers (TS numbers, operation codes) use `font-mono text-xs`.

| Role | Classes |
|---|---|
| Page title | `text-sm md:text-base font-extrabold text-slate-800` |
| Section title | `text-xs md:text-sm font-bold text-slate-700 uppercase tracking-wide` |
| Body / label | `text-xs md:text-sm text-slate-700` |
| Hint | `text-[11px] md:text-xs text-slate-500` |

---

## 5. Spacing, radius, elevation, motion

| Scale | Values |
|---|---|
| Padding | card body `p-4`; card header `px-4 py-3`; table cell `px-3 py-2`; input `px-3 py-2`; button `px-4 py-2` (compact `px-3 py-1.5`); badge `px-2 py-0.5`; modal `p-6`; page section `px-4 py-3` / `md:px-6 md:py-4` |
| Gap | cards in a grid `gap-3`; list items `gap-2`; form fields `gap-4`; button group `gap-2`; sections `gap-6`; icon+label `gap-1.5` |
| Radius | card/panel/modal `rounded-xl`; input/button `rounded-lg`; badge/avatar `rounded-full`; table wrapper `rounded-xl overflow-hidden` |
| Elevation | card on `bg-slate-50` → `shadow-sm`; card on `bg-canvas` → `shadow-card` **plus a border**; panel/drawer `shadow-md`; modal `shadow-xl`; header `shadow-sm` + `border-b`; buttons and inputs get **no** shadow |
| Motion | press/hover 150ms; dropdown/panel 200ms; modal/drawer 250–300ms. Enter `ease-out`, exit `ease-in`. Tokens: `--dur-press/panel/route/modal`, `--ease-enter/exit` |

Motion rules: framer-motion only for meaningful transitions (modal, reorder, route). Tailwind
`transition-*` covers hover and press. Always honour reduced motion —
`motion-reduce:transition-none motion-reduce:transform-none`, or `useReducedMotion()`.
Continuous animation only ever means "something is actually loading".

**Z-index scale** (`C6` rejects arbitrary values): dropdown/popover `z-30`, sticky header
`z-40`, modal overlay and modal `z-50`, toasts keep sonner's default above modals.

---

## 6. Element recipes

```jsx
// Primary action
<button className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold text-white
                   bg-[#0077b6] hover:bg-[#023e8a] disabled:opacity-50 disabled:cursor-not-allowed
                   focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:outline-none
                   transition-all duration-150 active:scale-95">

// Outline action
className="... bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
// Danger: bg-red-600 hover:bg-red-500 · Success: bg-emerald-600 hover:bg-emerald-500
// Ghost on blue: bg-white/20 hover:bg-white/35 text-white rounded-full

// Input, select, textarea
<input className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-slate-200
                  text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2
                  focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all duration-150" />
// Error state: border-red-400 ring-2 ring-red-200 · Disabled: opacity-50 bg-slate-50

// Status pill — same shape, swap the colour family (amber / emerald / red / purple)
<span className="px-2 py-0.5 rounded-full text-[11px] font-bold
                 bg-amber-100 text-amber-700 border border-amber-200">Pending</span>
```

These are recipes for **building the component once**, not strings to paste into pages. The
duplicate-className check (`C14`) exists specifically to stop that: twice is a warning, three
times fails the commit.

---

## 7. Page shell and responsiveness

Tablets are the target: landscape ≈800–960px, portrait 768×1024. `md:` (768px) is the primary
breakpoint. Mobile-first: write the base classes, then override with `md:`. No fixed pixel
widths on containers — `w-full`, `max-w-*`, `flex-1`.

```jsx
<div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50">
  <header className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-2.5
                     bg-white border-b border-slate-200 shadow-sm">
    {/* back · title · primary action */}
  </header>

  <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
    <aside className="flex-shrink-0 bg-white px-4 py-3
                      border-b border-slate-200 md:border-b-0 md:border-r md:w-72 md:overflow-y-auto">
      {/* filters */}
    </aside>

    <main className="flex-1 overflow-y-auto px-4 md:px-6 py-3 md:py-4">
      {/* content */}
    </main>
  </div>
</div>
```

- Grids: `grid-cols-1 md:grid-cols-3` for cards, `grid-cols-2 md:grid-cols-4` for stat cards.
- Tables: wrap in `overflow-x-auto` rather than collapsing columns; hide secondary columns with
  `hidden md:table-cell`; keep identifier, operator and status always visible.
- Modals: bottom sheet in portrait, centred in landscape —
  `fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30` with
  `w-full md:max-w-lg rounded-t-2xl md:rounded-2xl max-h-[90vh] overflow-y-auto`.
- Prefer CSS breakpoints over JavaScript orientation detection; use a hook only when the
  *behaviour*, not the layout, differs.

---

## 8. Required states on every fetching page

| State | Pattern |
|---|---|
| Content loading | Skeleton blocks shaped like the content (`animate-pulse`) — not a full-screen spinner |
| Action loading | Small spinner inside the button plus `disabled` — never block the screen |
| Empty | Icon + one sentence + the primary action ("No timesheets today" + create button) |
| Fetch error | Inline message in the content area + a retry button. A toast alone leaves a blank page |
| Form error | Inline under the field (`border-red-400`, `text-red-600 text-xs`), focus moves to the first invalid field |

Toasts (sonner) report the **result of an async action** only: "Saved", "SAP posting failed:
<reason>". Never for form validation, never for page fetch errors. Toast wording matches the
button that triggered it — "Save" produces "Saved".

---

## 9. Charts and dataviz (ECharts + Recharts)

Categorical palette — **fixed order**, colourblind-safe (ΔE CVD ≥ 19) and ≥ 3:1 on white.
Series 1 always takes colour 1:

| # | Hex | Name |
|---|---|---|
| 1 | `#0077b6` | brand blue |
| 2 | `#b45309` | dark amber |
| 3 | `#7c3aed` | violet |
| 4 | `#0d9488` | teal |
| 5 | `#be185d` | magenta |
| 6 | `#4d7c0f` | olive |

- More than six series: collapse the tail into "Other" (`#94a3b8`) or split into small
  multiples. Never generate new hues.
- **Colour follows the entity, not the render order.** A filter that changes the series count
  must not recolour the survivors.
- Sequential (magnitude, heatmap): one blue hue, light → dark:
  `#caf0f8 → #90e0ef → #00b4d8 → #0077b6 → #023e8a`. Never a rainbow.
- Diverging (above/below target): `#0077b6` ↔ `#b45309`, neutral midpoint `#e2e8f0`.
- Status colours (emerald/amber/red) mean status only — never a plain series colour.
- **One Y axis per chart.** Two different scales means two stacked charts.
- Two or more series require a legend. Label points selectively, not all of them. Axis and label
  text uses slate, not the series colour. Gridlines `#e2e8f0`, hairline.
- Tooltips are always enabled.

---

## 10. Offline and PWA behaviour

- A global offline indicator (`OfflineIndicator`, listening to `online`/`offline`) must tell the
  user they are offline **before** they lose input.
- Cached data displayed offline is labelled: "Saved data — last updated HH:mm".
- Writes while offline are refused immediately with a clear message, unless a real offline queue
  exists for that feature.

---

## 11. Implementation status — verify, do not assume

| Item | Reality in the code |
|---|---|
| `:root` CSS variables | ✅ shipped 2026-09-04 — verified in `apps/web/src/index.css` (canvas, three `--status-*`, four `--dur-*`, two `--ease-*`) |
| Brand palette in `tailwind.config.js` | ✅ shipped 2026-09-04 — `colors.brand.*` (9), `colors.canvas`, `colors.status.*`. Legacy `primary #007bff` and `shadow-3d-*` are **still present** and still used by old components |
| System font stack | ✅ shipped 2026-09-04 on `html, body, #root` |
| `ui/Button`, `forms/Input`, `ui/Switch`, `tables/Table` | ⚠️ exist but in the old style — migrate when touched, do not copy them |
| Primary colour `#0077b6` | ⚠️ roughly 364 uses of the old `#0096c7` across 62 files. Migrate per page: when you edit a page, convert **all** of its primary buttons at once — never leave two primaries on one screen |
| Offline-first | ⚠️ `apps/web/src/templates/backuptc.html` still links Google Fonts; `vite.config.js` still carries a dead `google-fonts-cache` entry |
