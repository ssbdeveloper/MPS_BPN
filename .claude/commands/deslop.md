---
description: Run the design contract and fix what the current diff introduced
argument-hint: [--all | --files <paths>]
---

Design contract check.

## Which mode

- **No argument** — check the staged diff, which is what the gate does:
  ```
  git add -A && node scripts/deslop.mjs --staged
  ```
  Nothing staged means nothing checked. Stage first.
- **`--all`** — the whole-codebase debt report. Never blocks. This is a *reading* task; the
  numbers belong in `docs/planning/UI-DEBT.md`, not in a patch.
- **`--files <paths>`** — full-file audit of named files, including their legacy debt.

## Fixing

Fix findings on **lines this change introduced**. Findings on lines you did not write are debt:
record them in `docs/planning/UI-DEBT.md` and leave them. CLAUDE.md section 11 explains why —
adopting a legacy file's debt turns every small edit into a refactor, and the refactor is how
the gate ends up uninstalled.

Rule by rule, the fix is almost always the same shape:

| Rule | Fix |
|---|---|
| C1 hex outside the token set | Use a token from `docs/standards/design-system.md`. Never add a hex to the token list to make a finding disappear. |
| C2 `#0096c7` | `#0077b6` for a button background or small text. `#0096c7` is icons, large text and borders. |
| C3 `dark:` | Delete it. Light theme only. |
| C4 gradient / C5 `backdrop-blur` | Delete, unless it is a group header, a small badge, or a modal overlay. |
| C6 `z-[...]` | `z-30` / `z-40` / `z-50`. |
| C7 text under 12px | 12px. `text-[11px]` is badges and eyebrows only. |
| C8 button | Add `min-h-[44px]` and `focus-visible:ring-2`. Gloves and keyboards. |
| C9 `onClick` on a `div` | Make it a `<button>`. |
| C11 external URL | Bundle it. Offline-first is a requirement — the factory network drops. |
| C12 emoji | A `lucide-react` icon. |
| C13 file length | Extract a component. If that means five or more files, it is on the STOP list — ask. |
| C14 duplicated `className` | Extract a component. Rule of two. |
| C15 `console.log`, dead comments, bare `TODO` | Delete, or `TODO(docs/planning/x.md)`. |
| C16 marketing copy | Say what happened. This is a tool, not a launch page. |

## Suppression

`deslop-allow C<n>: reason` on the line or the line above, and the reason must be a real reason.
More than three suppressions in one commit is on the STOP list — at that point the code is
wrong, or the rule is, and either way a human decides.

## Finish

```
node scripts/gate.mjs
```

Paste the output. Do not report a clean gate you did not run.
