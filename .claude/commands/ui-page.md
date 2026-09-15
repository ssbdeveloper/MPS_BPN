---
description: Track A phase F2/F3 — bring one page up to the design contract without touching the API
argument-hint: <path to the page under apps/web/src>
---

Bring this page up to standard: **$ARGUMENTS**

One page, one PR, roughly 400 diff lines maximum. If it will not fit, split it and say where.

## 1. Read before editing

```
node scripts/deslop.mjs --files $ARGUMENTS
```

That is the **whole-file** report, so it includes legacy debt that is not yours. Separate it:

- **Yours to fix now:** anything on a line you are going to change anyway, plus the states,
  accessibility and responsiveness items below.
- **Not yours:** the rest. Add it to `docs/planning/UI-DEBT.md` and leave it alone. Do not turn
  a page pass into a rewrite; do not blanket the file with `deslop-allow`.

Also read the page's fetch calls and write down, before you start, the exact list of requests it
makes and in what order. That list must be identical when you finish.

## 2. Fix, in this order

1. **States** — loading, empty, and error. The error is inline with a retry, not only a toast.
2. **Accessibility** — Tab reaches every action, focus ring visible, `Escape` closes modals,
   touch targets ≥ 44px, text ≥ 12px, `#0077b6` for primary action and links on white.
3. **Tablet** — 768×1024 portrait and ≈960×600 landscape. Both, actually opened.
4. **Extraction** — a pattern used twice becomes a component; a long `className` repeated
   between pages becomes a component. New components follow `/ui-component`, including its test.
5. **Deletion** — dead code goes. Deleting a *file* is on the STOP list; ask.

Forbidden here, this is Track B: new or changed endpoints, new response fields, moving
aggregation into SQL, and **changing a polling interval**.

## 3. Verify and ship

```
git add <files>
node scripts/gate.mjs --track-a
npm --prefix apps/web run test
```

Then walk the Definition of Done in CLAUDE.md section 6 item by item. Report each one as done or
not done — do not report the list as "passed" in aggregate. State explicitly that the request
list you wrote down in step 1 is unchanged, and record the session per section 7.
