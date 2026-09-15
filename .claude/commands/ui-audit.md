---
description: Track A phase F0 — read-only audit of the frontend against the design contract
argument-hint: [path under apps/web/src, optional]
---

Track A phase F0 audit of: **${ARGUMENTS:-apps/web/src}**

**Read-only. Change nothing.** F0 exists to decide what to do; deciding and doing in one pass is
how a 400-line PR becomes a 4,000-line one.

## 1. Machine findings

```
node scripts/deslop.mjs --all
```

If a path was given, also run `node scripts/deslop.mjs --files <the files under it>` for the
full per-file picture.

Cross-check against `docs/planning/UI-DEBT.md` — most of what you find is already recorded
there. New findings get added to that table; do not restate the whole file back to the user.

## 2. Human findings

Read `docs/standards/anti-slop.md` section 4 (visual tells) and section 2 (code), then look for
what the machine cannot see:

- Pages with a fetch but no loading, empty or error state — or an error that is only a toast.
- Duplicated markup that should be a component (`className` repeated across *files*, which C14
  cannot see because it works per file).
- Effects that compute instead of synchronising.
- Touch targets and contrast on tablet, not on your monitor.
- Screens that would be unreadable in glare or through gloves.

## 3. Output

A report, not a patch. For each finding: file, what is wrong, which rule or standard it breaks,
and the size of the fix. Rank by **operator impact first, count second** — 200 hex-token
violations on an admin page matter less than one unreadable number on the shop floor.

End with a proposed order of work as F2/F3 units: one page or one foundation component each,
roughly 400 diff lines maximum. Then stop and wait for a human to pick.
