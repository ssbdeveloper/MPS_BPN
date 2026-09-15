# Anti-Slop — MPS

> The review checklist. A diff should read as if one person who understands the system wrote it.
> Rules marked `C<n>` are enforced by `node scripts/deslop.mjs` (T0); the rest are judged at
> review (T2).
>
> **The `C<n>` rules are checked on the lines your diff added or changed, not on whole files.**
> This codebase predates its own standards and carries about 1,700 findings; the gate is a
> ratchet. What that means for a diff is in section 7 below and in CLAUDE.md section 11.

---

## 1. Why this document exists

Generated code fails in a recognisable way. It is not wrong so much as *averaged*: defensive
where nothing threatens it, verbose where nothing is unclear, decorative where nothing needs
attention, and enthusiastic where a machine operator needs a fact. The point of this list is not
style policing — it is that averaged code hides real bugs inside plausible noise, and this
system posts hours to SAP.

---

## 2. Code

| ❌ Slop | ✅ Instead |
|---|---|
| Comments that restate the code (`// set loading to true`) | No comment. Comments explain **why**, never **what** |
| `catch (e) { console.error(e) }` then carrying on as if it succeeded | Surface it to the user (inline + retry) or rethrow. Swallowing an error is how a blank screen ships |
| Deep optional chaining on data whose shape is guaranteed (`a?.b?.c?.d`) | Validate once at the fetch boundary, then access directly |
| `useEffect` computing a value derived from state | Compute during render; `useMemo` only if it is measurably expensive |
| `useEffect` with a stale or padded dependency array | Correct dependencies, or restructure so the effect is not needed |
| A wrapper component with exactly one consumer | Inline it; extract on the second consumer |
| `utils.js` as a landfill | Themed modules: `format/date.js`, `timesheet/hours.js` |
| Pass-through props (`...rest` plus a `className` that overrides colour) | Explicit variants; `className` is layout-only |
| `data2`, `handleClick2`, `newFunction`, `helper`, `temp` | Names that say what they hold |
| Barrel `index.js` that only re-exports | Import from the component file |
| Copying a page to `XxxPageV2.jsx` | Change it in place behind a revertable commit. This repo already lost months to a ghost `TimesheetValidationPageV2.jsx` that lived only in the docs |
| Abstraction "for later" | Rule of two — the second use creates the abstraction |
| Re-wrapping `fetch` in a new client layer | Use the existing fetch pattern from a comparable page |
| Renaming things while doing something else | One concern per commit |
| `console.log` left behind (`C15`), commented-out code (`C15`), `TODO` with no reference (`C15`) | Delete it; git keeps the history. `TODO(docs/planning/x.md)` if it must stay |

**Error handling, specifically.** Three legitimate options: show it to the user, retry it, or
rethrow it. "Log and continue" is not one of them.

**Effects, specifically.** Every `useEffect` in a page should answer: what external system is
this synchronising with? If the answer is "nothing, it just computes something", delete it.

---

## 3. Copy

Banned words and phrases (`C16`): *elevate, seamless, unleash, empower, revolutionary,
game-changer, supercharge, dive in, unlock the power, effortless, cutting-edge, next-level*.
Also banned: exclamation marks in system messages, and emoji anywhere in the UI (`C12`) — use
`lucide-react` icons, which render identically on every device.

| Rule | Example |
|---|---|
| Sentence case, active verbs, no filler | "Save changes", not "Submit Your Changes!" |
| The button label survives into the result | "Save" → toast "Saved". Never "Submission successful" |
| Errors say what failed **and** what to do | "Could not load timesheets — check the connection and retry", not "An error occurred" |
| Empty states invite an action | "No timesheets today" + a create button |
| Name things the way the operator does | Operators manage *work hours*, not *transaction records* |
| One language per screen | Operator-facing labels stay in the language the plant uses; system terms (SAP, work center, TS number) stay verbatim. Never half and half |
| No apologies, no personality | The interface reports; it does not have feelings about it |

---

## 4. Visual tells

Beyond what the machine checks (`C1`–`C7`), these are the patterns that make a screen look
generated. None of them belong in an operations tool:

- Decorative gradients (`C4` allows them only on group headers and small badges).
- A "hero section" in an internal tool.
- Three identical cards in a row used as decoration rather than as three real things.
- One border radius on everything regardless of hierarchy; the same soft grey shadow under
  every box.
- Glassmorphism and `backdrop-blur` outside a modal overlay (`C5`) — unreadable under glare.
- A large decorative icon centred in a panel that has nothing to say.
- Entrance animations on every section; a hover transition on every card.
- A trailing `→` glued to button text.
- An ALL-CAPS tracked-out eyebrow above every heading. (Small uppercase labels are part of this
  system, but as *badges and column headers* — that is information, not garnish.)
- Colour used to make the page look designed rather than to encode a state.

---

## 5. Diff hygiene

- One concern per commit; refactors never ride along with behaviour changes.
- No progress reports inside source files — no `// === REFACTORED BY AI ===`, no ASCII banners,
  no changelog blocks. Reports go to `docs/log/`.
- No reformatting of untouched lines; a diff full of whitespace churn cannot be reviewed.
- If a "cleanup" makes the file longer, the commit message explains why.
- Do not restate the diff in the PR description. State what changed behaviourally, what was
  verified, and what was deliberately left alone.

---

## 6. Tests

A test is part of the change, not a follow-up. The Definition of Done requires one for behaviour
you changed, and "it is only UI" is not an exemption for logic that produces a number.

| ❌ Slop | ✅ Instead |
|---|---|
| A test that asserts the component rendered without throwing, and nothing else | Assert the thing the component is *for*: the variant's distinguishing mark, the disabled state, the number that comes out |
| Snapshot tests of markup | Assert behaviour. A snapshot fails on every legitimate change and gets regenerated without being read |
| Mocking the function under test | Mock the boundary — `fetch`, the clock, the timezone. Never the logic you are checking |
| Tests written after the fact to cover the code that exists | The boundary case that motivated the change is the test. Hour arithmetic, validation and SAP eligibility get the off-by-one, the midnight crossing, the empty shift |
| `expect(true).toBe(true)` left in a skipped block | Delete it. A skipped test is a lie told slowly |

Existing tests live in `apps/web/src/components/ui/` and `apps/web/src/test/` — match their
shape. Run with `npm --prefix apps/web run test`.

## 7. Debt that is not yours

Touching a legacy file surfaces findings you did not create. They are not your commit's problem.

- **Fix** findings on lines you added or changed.
- **Record** the rest in `docs/planning/UI-DEBT.md` and move on.
- **Never** blanket a file with `deslop-allow`, and never raise `scripts/lint-baseline.json` to
  get a commit through. Both are on the STOP list.

The temptation runs the other way — an agent sees 68 findings in a file it touched and "fixes"
all of them, and now a two-line change is a 600-line diff that mixes a refactor with a behaviour
change and cannot be reverted cleanly. Scope discipline is the rule; the ratchet is what makes
it affordable.

Paying debt down is real work and gets its own commit: one file, before-and-after numbers in the
message, `docs/planning/UI-DEBT.md` updated.

## 8. Reporting, honestly

Never claim a check that was not run. `node scripts/gate.mjs` output is pasted, not summarised
from memory. If the build failed, say it failed. If a page could not be exercised, say which one
and why. An agent that reports success it did not verify is worse than one that reports failure,
because the failure will surface later, in production, attached to an SAP posting.
