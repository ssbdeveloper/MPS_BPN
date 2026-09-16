# EWS Roster Configuration Redesign — Implementation Plan

> **For Hermes:** Use the test-driven-development workflow when implementing this plan.
> This document is planning only; no implementation has been performed.

**Goal:** Redesign `/ews/roster/config` into a clear, modern English-only workflow for
weekly scheduling, date-specific workday exceptions, operator rotation assignment,
permanent shift locks, roster generation, shift hours, and schedule preview.

**Architecture:** Preserve the existing A/B rotation model internally, but never expose A/B
to users. Resolve each internal group to its actual Day Shift or Night Shift for the selected
week. Separate the stable weekly pattern from date-specific exceptions so a holiday on one
Friday never changes every future Friday. Combine workday configuration, exceptions,
preview, and roster generation into one Schedule card.

**Tech Stack:** React 18, Vite, Tailwind, lucide-react, Vitest + Testing Library,
Express, PostgreSQL.

---

## 1. Decisions Locked

### 1.1 Rotation labels

Use dynamic labels based on the actual shift for the selected/current week:

```text
Internal group A or B -> hidden from users
Group working DAY     -> shown as "Day Shift"
Group working NIGHT   -> shown as "Night Shift"
```

The labels swap automatically when the weekly rotation flips. The UI must never claim that
internal group A is Day Shift when the generated schedule says it is Night Shift.

Verified CKP behavior:

```text
Week of 2026-08-31   A=NIGHT  B=DAY
Week of 2026-09-07   A=DAY    B=NIGHT
Week of 2026-09-14   A=NIGHT  B=DAY
Week of 2026-09-21   A=DAY    B=NIGHT
Week of 2026-09-28   A=NIGHT  B=DAY
```

### 1.2 Permanent shift assignment

Remove `Advanced · Temporary Shift Lock` from the UI.

Use only the existing `fixed_shift` mechanism for permanent assignments:

```text
Follow Rotation | Always Day | Always Night
```

These are buttons/segmented controls, not dropdowns. Existing rows in
`ews.operator_shift_lock` remain for audit/history but are no longer managed by this page.
Do not drop the table.

### 1.3 Workday semantics

Separate recurring rules from one-off changes:

```text
Weekly Pattern   recurring default, normally Monday-Friday
Date Exceptions  exact dates/ranges only, e.g. 25 December Off
```

A user setting Friday, 25 December to Off must not alter any other Friday.

### 1.4 Language and copy

Everything visible within `/ews/roster` and `/ews/roster/config` must be English.
Remove internal/technical or over-explanatory copy, including patterns such as:

```text
"(yellow top line)"
"(blue top+bottom line)"
"Only for today. Hours follow the selected shift. Select Follow Schedule to undo."
"Changes apply only to the selected cell."
"override", where a plain operator-facing label is possible
```

Use short labels and rely on hierarchy, selected state, icons, and direct feedback.
Technical details remain in accessible labels or documentation, not visible prose.

---

## 2. Verified Current-State Problems

### 2.1 Weekly rule caused the Friday error

`ews.roster_workday_rule` stores only seven recurring rows:

```text
day_of_week, runs_day, runs_night
```

`rosterGenerator.js` joins every generated date to that table by weekday. Therefore,
turning Friday Off for a December holiday also turns every future Friday Off until someone
manually enables Friday again. This is not a user memory problem; the data model cannot
represent a one-date holiday.

### 2.2 Generated rows do not automatically follow later workday changes

Generator behavior is currently:

```sql
ON CONFLICT (serialnumber, business_date) DO NOTHING
```

This correctly protects manual/history rows, but it means changing a future day to Off after
rows were generated does not remove those existing rows. The new flow therefore needs an
explicit preview/apply synchronization step for eligible future auto-generated rows.

### 2.3 Current page structure

`EwsRosterConfigPage.jsx` is 625 lines with seven separate cards:

```text
Workdays per Shift
Generate Roster
Operator Group Assignment
Advanced · Temporary Shift Lock
Shift Composition Preview
Shift & Standard Hours
Rotation
```

Workday and Generate are shown separately even though generation directly consumes the
workday rule.

---

## 3. Proposed Page Structure

Reduce seven cards to four:

```text
1. Schedule
   - Weekly Pattern
   - Date Exceptions
   - Generation Range
   - Preview Changes
   - Apply Schedule

2. Operators
   - Unassigned / Day Shift / Night Shift / All
   - Search
   - Rotation assignment
   - Follow Rotation / Always Day / Always Night

3. Shift Hours
   - Start, end, overnight, standard hours
   - Dated shift-definition exceptions
   - Existing impact/resync controls

4. 7-Day Preview
   - Day / Night operator totals
   - Off dates and manual changes
```

Remove the separate Rotation card. Rotation context is displayed only where needed, for
example the week selector in Operators and Preview.

---

## 4. Schedule Card Design

### 4.1 Weekly Pattern

Default recurring pattern shown as a compact seven-day row:

```text
Mon  Tue  Wed  Thu  Fri  Sat  Sun
Both Both Both Both Both Off  Off
```

Each day button cycles through:

```text
Both Shifts -> Day Only -> Night Only -> Off
```

No color-description legend. Each button contains its explicit state text or D/N markers.
Color supports the state but is never the only signal.

Weekly Pattern is a persistent global rule, so it must not autosave on every click.
Use a local draft and one explicit button:

```text
Save Weekly Pattern
```

Before saving, show a compact impact confirmation:

```text
Changes 6 future dates and 834 auto-generated rows.
```

If the edit disables a normally active weekday, require a second confirmation. This is the
high-risk path that caused the Friday incident.

### 4.2 Date Exceptions

Primary mechanism for holidays, overtime Saturdays, shutdowns, or one-off shift changes.

Controls:

```text
Date / Date Range
Both Shifts | Day Only | Night Only | Off
Add Exception
```

Below it, show upcoming exceptions as removable rows:

```text
25 Dec 2026   Off          Christmas Holiday    Remove
26 Dec 2026   Day Only     Saturday Production  Remove
```

Reason is optional and short (maximum 120 characters). The UI defaults to a single date;
range mode is an explicit toggle to avoid accidental long-range changes.

### 4.3 Generate and synchronize

The same card contains:

```text
From [date]   To [date]   Preview
```

Preview returns:

```text
Rows to add
Auto-generated rows to update
Auto-generated rows to remove because date is Off
Rows protected from change
```

Protected rows include any row that is historical or has manual evidence, including:

```text
business_date < today
source = manual
status changed from SCHEDULED
shift_override is not null
standard_hours_override is not null
half_day = true
```

Only after preview does the primary button become available:

```text
Apply Schedule
```

The operation must run in one DB transaction and return exact counts. Do not silently delete
or overwrite protected rows.

---

## 5. Operators Card Design

### 5.1 Week context

Add a week selector at the top. Default to current week.

The backend resolves which internal group works each shift for that week. UI filters show:

```text
Unassigned 12 | Day Shift 64 | Night Shift 75 | All 151
```

Never display Group A, Group B, rotation_group, or anchor parity in visible UI.

### 5.2 Assignment without A/B

Each operator row shows two assignment actions:

```text
Assign to Day Shift | Assign to Night Shift
```

The selected week determines which internal group is written:

```text
selected week: A=NIGHT, B=DAY
Assign to Day Shift   -> write rotation_group B
Assign to Night Shift -> write rotation_group A
```

This mapping must be provided by the backend, not duplicated in React.

### 5.3 Permanent lock without dropdown

Each assigned operator has a three-way segmented control:

```text
Follow Rotation | Always Day | Always Night
```

No separate Advanced card and no operator dropdown. Clicking a choice saves immediately
with optimistic UI and rollback on API failure.

Show a small `Fixed` badge only when Always Day or Always Night is active. Avoid explanatory
paragraphs beneath every row.

---

## 6. English-Only Scope

Audit and convert visible text in:

```text
apps/web/src/pages/EwsRosterPage.jsx
apps/web/src/pages/EwsRosterConfigPage.jsx
apps/web/src/components/ews-roster/BulkPanel.jsx
apps/web/src/components/ews-roster/ShiftSettingsCard.jsx
all new EWS roster components
```

Examples:

```text
Setengah hari                  -> Half Day
Ganti shift                    -> Change Shift
Pindah ke SHIFT PAGI           -> Day Shift
Pindah ke SHIFT MALAM          -> Night Shift
Ikut jadwal                    -> Follow Schedule
Target jam khusus              -> Target Hours
Ikut shift                     -> Shift Default
Terapkan ke N sel              -> Apply to N Cells
Tanggal sudah lewat...         -> Past dates are locked
Hapus jadwal hari ini          -> Delete Day
Jadwal Kerja                   -> Schedule
Belum diatur                   -> Unassigned
Selalu pagi / malam            -> Always Day / Always Night
```

Do not translate database/API fields; only user-visible labels and messages.

Add an automated test that scans the roster files for a maintained deny-list of retired
Indonesian labels and obsolete copy. This is a guard, not the primary behavior test.

---

## 7. Database Design

### 7.1 New table: date-specific exceptions

Create migration:

```text
database/migrations/api/20260916c_ews_roster_calendar_exception.sql
```

Minimal schema:

```sql
CREATE TABLE ews.roster_calendar_exception (
  business_date date PRIMARY KEY,
  runs_day boolean NOT NULL,
  runs_night boolean NOT NULL,
  reason text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reason IS NULL OR char_length(reason) <= 120)
);
```

One row per date is sufficient; a range is expanded into individual dates by the API in one
transaction. No separate range model or recurrence engine.

### 7.2 Effective workday resolution

Add one shared SQL resolver used by preview and generator:

```text
exact-date exception > recurring weekday rule
```

Do not duplicate this precedence in multiple queries. Implement it as one SQL fragment or
one view/function and test the exact-date behavior.

### 7.3 Existing data correction

Do not mutate existing weekly rules automatically during migration. Preflight CKP and BPN,
then explicitly confirm the intended recurring baseline. Current CKP is Mon-Fri Both, Sat-Sun
Off. The migration itself only adds capability.

---

## 8. API Changes

### 8.1 Read config

Modify `GET /ews/roster/config` to return:

```json
{
  "weekly_pattern": [],
  "calendar_exceptions": [],
  "week_context": {
    "week_start": "2026-09-14",
    "day_group": "B",
    "night_group": "A"
  },
  "operators": []
}
```

`day_group` and `night_group` are transport details; React uses them to write assignments but
must not render A/B.

Support `?week_start=YYYY-MM-DD` so filters and assignment mapping match the selected week.

### 8.2 Exception endpoints

Add:

```text
PUT    /ews/roster/config/exceptions
DELETE /ews/roster/config/exceptions/:businessDate
```

PUT accepts one date or an inclusive date range, state (`BOTH`, `DAY`, `NIGHT`, `OFF`),
optional reason, and updated_by. Validate range length with a reasonable ceiling (62 days).

### 8.3 Preview/apply endpoints

Add:

```text
POST /ews/roster/generate/preview
POST /ews/roster/generate/apply
```

Preview is read-only. Apply accepts the same range plus an opaque preview token or repeats
server-side calculation inside its transaction. Do not trust client-supplied row counts.

### 8.4 Weekly pattern endpoint

Keep `PUT /ews/roster/config/workday`, but allow saving all seven rows in one transaction.
Do not issue seven separate requests or autosave individual clicks.

### 8.5 RBAC

Add every new write route to `apps/api/rbac/manifest.js` under `roster_operator` write access.
Add read routes if manifest policy requires explicit reads.

---

## 9. Safe Apply Rules

### Add missing rows

Use generator logic with effective workday resolution and `ON CONFLICT DO NOTHING`.

### Remove rows for an Off exception

Delete only rows satisfying all safe conditions:

```text
business_date >= today
source = auto
status = SCHEDULED
no half-day
no shift override
no standard-hours override
```

### Update existing future auto rows

Update only safe rows when an exception changes Day/Night availability or resolved master
hours. Never update historical or manual rows.

### Audit

Return and log:

```text
rows_added
rows_updated
rows_removed
rows_protected
```

If protected rows conflict with the requested exception, preview lists the dates/counts and
apply leaves them untouched.

---

## 10. Component Structure

Create:

```text
apps/web/src/components/ews-roster/ScheduleCard.jsx
apps/web/src/components/ews-roster/WeeklyPattern.jsx
apps/web/src/components/ews-roster/DateExceptions.jsx
apps/web/src/components/ews-roster/OperatorShiftCard.jsx
apps/web/src/components/ews-roster/RosterPreviewCard.jsx
```

Each gets a matching `.test.jsx` file.

Keep API state, loading, toasts, and mutations in `EwsRosterConfigPage.jsx`. Components are
presentational and emit intent callbacks. Target page size: below 300 lines.

Do not move heatmap drag/selection state from `EwsRosterPage.jsx`.

---

## 11. TDD Implementation Sequence

### Task 1 — Calendar exception migration and resolver

**Files:**
- Create `database/migrations/api/20260916c_ews_roster_calendar_exception.sql`
- Modify `apps/api/services/rosterGenerator.js`
- Create `apps/api/services/rosterCalendar.contract.test.js`

Tests:
1. Exact-date exception overrides weekday default only on that date.
2. Friday Off exception does not affect the following Friday.
3. DAY-only and NIGHT-only exceptions filter the correct shift.
4. No exception falls back to `roster_workday_rule`.

Dry-run migration against CKP and BPN in transactions, then rollback.

### Task 2 — Config week context and hidden A/B mapping

**Files:**
- Modify `apps/api/controllers/ewsRosterController.js`
- Create `apps/api/controllers/ewsRosterConfig.contract.test.js`

Tests:
1. Week 2026-09-14 resolves Day group B / Night group A in CKP.
2. Week 2026-09-21 resolves Day group A / Night group B.
3. Assignment by UI shift writes the correct hidden rotation group.
4. Invalid/non-week-start dates are normalized or rejected consistently.

### Task 3 — Exception CRUD API

**Files:**
- Modify `apps/api/controllers/ewsRosterController.js`
- Modify `apps/api/routes/ews.js`
- Modify `apps/api/rbac/manifest.js`
- Add controller behavior tests

Tests include single date, range expansion, 62-day cap, reason length, deletion, and
transaction rollback on partial failure.

### Task 4 — Preview and safe apply

**Files:**
- Modify `apps/api/services/rosterGenerator.js`
- Modify controller/routes/RBAC
- Add `apps/api/services/rosterGeneratePreview.test.js`

Tests:
1. Preview count equals apply result in an unchanged transaction.
2. OFF removes only safe future auto rows.
3. Manual status/half-day/shift/hour overrides are protected.
4. Historical rows are never changed.
5. Repeating apply is idempotent.

### Task 5 — WeeklyPattern and DateExceptions components

Write failing render/interaction tests first, then components.

Required tests:
- seven days render with explicit state text;
- edits remain draft until Save Weekly Pattern;
- high-risk weekday disable opens confirmation;
- a one-day exception defaults to one date;
- range mode is opt-in;
- upcoming exception can be removed;
- no explanatory color legend is rendered.

### Task 6 — ScheduleCard

Required tests:
- combines weekly pattern, exceptions, date range, preview, and apply;
- Apply Schedule disabled until successful preview;
- changing any input invalidates old preview;
- protected-row warning displays exact count;
- results display added/updated/removed/protected counts.

### Task 7 — OperatorShiftCard

Required tests:
- A/B never appears in visible text;
- current week displays Day Shift/Night Shift counts from backend mapping;
- changing week swaps labels/mapping correctly;
- assignment emits the hidden backend group supplied by `week_context`;
- permanent shift is three buttons, not a select;
- no temporary-lock UI exists.

### Task 8 — Rebuild Config page

Replace seven cards with four. Delete temporary-lock state, fetches, handlers, imports, and
markup from the page. Preserve the backend legacy routes/table for compatibility.

### Task 9 — English-only roster sweep

Convert all visible strings in both roster pages and components. Add a deny-list contract
test for retired Indonesian text and the removed verbose phrases.

### Task 10 — Full verification

Run:

```bash
cd apps/api && npm test
cd apps/web && npx vitest run
cd apps/web && npx eslint .
cd apps/web && npm run build
node scripts/deslop.mjs --staged
```

Live verification (transaction rollback first):

1. Add `2026-12-25 OFF`; prove `2027-01-01` and other Fridays still use the weekly pattern.
2. Preview a range spanning both dates; verify only 25 Dec is Off.
3. Apply in rollback; prove safe auto rows are removed and manual rows remain.
4. Verify week labels for 14 Sep and 21 Sep swap correctly while A/B never appears in UI.
5. Verify Always Day/Always Night changes only dates from `fixed_shift_effective_from` onward.

---

## 12. Migration and Deployment

Deployment order for each plant:

```text
1. Apply 20260916c_ews_roster_calendar_exception.sql explicitly.
2. Record its filename in schema_migrations.
3. Deploy api, frontend, ews-roster-job, and ews-snapshot-job images.
4. Smoke-test config read, exception preview, and operator week mapping.
5. Add a harmless future exception in a transaction or test environment, verify, rollback.
```

Do not run `node database/migrate.js` indiscriminately because production migration ledgers
have known historical mismatches.

---

## 13. Risks and Guards

```text
Mislabeling rotation       Backend supplies per-week mapping; A/B hidden, never hardcoded.
Holiday changes all weeks  Date exception table, exact-date precedence, regression test.
Off change leaves rows     Preview/apply safely removes only eligible future auto rows.
Manual work lost           Protected-row predicate + transaction + exact counts.
Stale preview              Any form change invalidates preview; server recalculates on apply.
Accidental long range      Single date default; range is opt-in; 62-day API cap.
UI over-explains           English microcopy budget; no visual-implementation prose.
Refactor runtime errors    Every extracted component has actual render tests plus JSX import guard.
Accessibility              Buttons >=44px, focus rings, state text/icons beyond color.
```

## 14. Acceptance Criteria

- No visible Group A/Group B text anywhere in EWS Roster UI.
- Day Shift/Night Shift labels match the selected week's generated rotation.
- No Temporary Shift Lock section or dropdown remains.
- Permanent shift uses three direct buttons.
- A Friday holiday is stored as an exact-date exception and cannot disable future Fridays.
- Weekly Pattern changes are draft + explicit save, never per-click autosave.
- Generate requires preview and reports exact effects before apply.
- Existing manual/history rows remain immutable.
- `/ews/roster` and `/ews/roster/config` visible copy is English only.
- Removed verbose phrases do not appear in source or rendered tests.
- API tests, web tests, ESLint, production build, and pre-commit gate pass.
- CKP and BPN live verification succeeds before deployment.

---

## 15. Explicitly Skipped

```text
Drop ews.operator_shift_lock     Keep for historical audit; remove only UI usage.
Rename A/B in database           Internal rotation identifiers stay stable.
Calendar recurrence engine       Exact dates/ranges are sufficient; no RRULE dependency.
New frontend dependency          Existing React/Tailwind/lucide stack is enough.
```

`[plan] -> skipped: implementation; proceed only after user approves this revised plan.`
