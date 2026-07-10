# TASK: Restructure EWS from 5 KPIs to 8 KPIs (split Labour vs Machine)

## Context (read before changing anything)
This is the EWS real-time monitoring module. Key files:
- Calc:        apps/api/services/ewsCalculator.js  (KPI_DEFS, DEFAULT_THRESHOLDS, calculate* fns, overall())
- Controller:  apps/api/controllers/ewsController.js (per-KPI detail builders, actions)
- Snapshot:    apps/api/jobs/ewsSnapshotJob.js
- Adoption:    apps/api/jobs/ewsAdoptionBucketJob.js
- SSE:         apps/api/services/ewsRealtimeHub.js  (KPI_FALLBACK)
- Cards UI:    apps/web/src/components/ews/EwsControlTower.jsx
- Detail UI:   apps/web/src/pages/EwsDetailPage.jsx

CONSTRAINTS:
- Additive. Do NOT break existing snapshot readers (getLatestSnapshotForQuery, getTrend, SSE broadcast).
- Do NOT change the machine-side math. OEE, OLE, and machine Adoption keep their existing formulas.
- Before editing the snapshot, INSPECT the ews.kpi_snapshot schema and how calculateSystemSummary()
  serializes KPIs. Report back how it stores KPIs (JSON blob vs per-KPI rows) BEFORE you extend it.
- No new comments beyond what's needed. Production-ready, tight scope.
- Commit after each phase and STOP for my review. Do not proceed to the next phase automatically.

---

## STATUS UPDATE (2026-07-10) — READ FIRST, SUPERSEDES Phase 5/6 BELOW

**Phase 1–4 = DONE.** The 5→8 KPI split is live in backend *and* frontend:
- `KPI_DEFS` (ewsCalculator.js) = 8 KPIs; `calculateSystemSummary` computes all 8.
- `EwsControlTower.jsx` renders 8 cards (2 rows × 4); `EwsDetailPage.jsx` `KPI_CONFIG` has
  `accuracy_labour/accuracy_machine/adoption_labour/adoption_machine/uptime_tablet/uptime_hmi`.
- Route `/ews/:type/detail` already serves each 8-KPI key.
- NOTE: `VALID_KPIS` (5) in ewsController is a **stale** list used only by the old
  `syncActions` endpoint — it is NOT the source of truth. Clean it up when action_table retires.
- `uptime_hmi` is now REAL (reads `ews.machine_heartbeat_daily`). `uptime_tablet` still no_data.

**Direction change for Issue Log (supersedes Phase 5 "presentation-only on action_table"):**
The issue log moves to a **backend-generated central table `ews.issue_log`**, so issues are
recorded autonomously (independent of anyone opening the UI — fixes the old "only when viewed"
flaw). Migration `database/migrations/api/20260710_ews_issue_log.sql`. The old FE-generated
`ews.action_table` flow (`syncActions`/`getActions`) is DEPRECATED and retired once the FE reads
`issue_log`.

### ews.issue_log — architecture
- **Table:** `id, issue_key (unik/dedup), category, business_date, scope_type, entity_id,
  entity_name, severity(warning|critical), title, description, metric_value, detail(jsonb),
  status(open|resolved), created_at, updated_at, resolved_at`.
- **category = the 8-KPI key** (`accuracy_machine`, `accuracy_labour`, `oee`, …). A detail page
  reads only its own category: `GET /ews/issue-log?category=<type>&status=open`.
- **Generation:** `apps/api/services/ewsIssueGenerator.js` → one `generate<Kpi>()` per category;
  `generateAll()` runs them for the current **business day (shift-aware, EWS_DAY_START_HOUR)**.
  Hooked into `ewsSnapshotJob` (~1 min) so it is autonomous.
- **Dedup / grain:** `issue_key = "<category>:<business_date>:<scope>:<entity_id>"` → one row per
  (KPI, business day, entity). Re-generation **UPSERTs while `status='open'`** (never duplicates,
  never overwrites a `resolved` row). Same shift-aware business-date rule as the KPIs.
- **Reuse the KPI predicate:** each generator MUST use the SAME predicate/join as its KPI calc
  (or the KPI's `source_detail` breakdown) so the issue set reconciles with the card value.
- **Endpoints:** `GET /ews/issue-log`, `PUT /ews/issue-log/:id/resolve`, `POST /ews/issue-log/generate`.

### Per-KPI generation spec (implement one generator at a time, commit + STOP each)

| category | scope | issue = (predikat, reuse calc) | gate default (tunable) | severity | source_detail |
|----------|-------|--------------------------------|------------------------|----------|---------------|
| **accuracy_machine** ✅DONE | machine | `mch_transaction` rows with `status_record = false`, per machine. (ETL now mirrors ALL `mch_productiondata` rows; `status_record` GENERATED col flags completeness: TRUE if statusid∈(0,3,4) OR order_no+operation_no+sn_employee+confirmation_number all present.) | `bad ≥ 5` (`EWS_ACC_MACHINE_MIN_MISSING`) | `bad% ≥ 50 → critical` (`EWS_ACC_MACHINE_CRITICAL_PCT`) | `by_machine` |
| **accuracy_labour** ✅DONE | operator | productive `timesheet_transaction` rows (no `activitytype`) that are invalid: missing order/operation/workcenter/serialnumber OR order+operation has no `ph3_order` match — per operator. Referential, so NO generated column (lives in generator). | `bad ≥ 3` (`EWS_ACC_LABOUR_MIN_BAD`) | `bad% ≥ 30 → critical` (`EWS_ACC_LABOUR_CRITICAL_PCT`) | `by_operator` |
| **adoption_labour** ✅DONE | operator | COMPLETED shift where recorded < standard, per (operator, shift) — **reuses snapshot** `adoption_labour.detail.breakdown` (computed in-main). Excused roster statuses (LEAVE/SICK/PERMIT/OFF) skipped; in-progress shifts skipped. Roster breakdown extended with `completed`+`gap_hours` to match the logs variant. | `gap ≥ 1h` (`EWS_ADOPTION_LABOUR_MIN_GAP_H`) | `recorded% ≤ 50 → critical` (`EWS_ADOPTION_LABOUR_CRITICAL_PCT`) | `by_operator` |
| **adoption_machine** ✅DONE | machine | machine gap segments (statusid 5 unidentified / statusid 2 idle >5min), per machine — **reuses snapshot** (no re-query): the adoption bucket job persists a `per_machine` breakdown into `adoption_summary_snapshot.detail_json`, surfaced via `getCachedAdoptionCalculation`, read back by the generator. Works for both `EWS_ADOPTION_SOURCE=machine` (duration) & `all` (bucket-coverage). | `gap ≥ 15 min` (`EWS_ADOPTION_MACHINE_MIN_GAP_MIN`) | `cover% ≤ 50 → critical` (`EWS_ADOPTION_MACHINE_CRITICAL_COVER_PCT`) | `by_machine` |
| **oee** ✅DONE | machine | machine in OEE CRITICAL band, per machine — **reuses snapshot** `oee.detail.per_machine`. **Critical-only** (warning band shows on gauge, not as issue) to keep the log actionable. | `denom ≥ 2h` & `oee < 65` (`EWS_OEE_MACHINE_*`) | always `critical` | `by_machine` (oee_pct, loss_hours) |
| **ole** ✅DONE | operator | operator in OLE CRITICAL band, per operator — **reuses snapshot** `ole.detail.per_operator`. **Critical-only** (decided vs warn<85 flooding 56/85). Still 38/85 on a systemically-low day (real signal). | `avail ≥ 2h` & `ole < 70` (`EWS_OLE_OPERATOR_*`) | always `critical` | `by_operator` (ole_pct, nva_hours) |
| **uptime_hmi** ✅DONE | machine | machine network uptime% below band, per machine — **reuses snapshot** `uptime_hmi.detail.machines` (from `ews.machine_heartbeat_daily`). 0% = down all day = critical. Ping floor skips low-data machines (early day). | `pings ≥ 100` & `uptime < 99` (`EWS_UPTIME_HMI_*`) | `uptime < 98 → critical`, else warning | `by_machine` (uptime_pct, pings) |
| uptime_tablet | — | **skip** (no_data until tablet uptime calc lands) | — | — | — |

> `title`/`description` = plain Bahasa Indonesia, SPECIFIC (WHO/WHAT/HOW MANY/WHAT TO DO) — carry
> over the Phase-5 message rules below. Keep a machine-readable `category` + (optional) `error_code`
> in `detail` for filtering; humans read `title`/`description`.

**Revised phase order (issue log):**
- **IL-1** ✅ table + `accuracy_machine` generator + endpoints + snapshot hook (DONE, uncommitted).
- **IL-1b** ✅ `accuracy_machine` redesign: `status_record` GENERATED col + ETL no-filter recreate,
  calc + generator switched to `status_record` (DONE, uncommitted).
- **IL-1c** ✅ `accuracy_labour` generator (`generateAccuracyLabour`, referential ph3 check, per
  operator) wired into `generateAll` (DONE, uncommitted).
- **IL-1d** ✅ `adoption_machine` generator (`generateAdoptionMachine`, reuses snapshot per-machine
  breakdown from `adoption_summary_snapshot`, no heavy re-query) wired into `generateAll`
  (DONE, uncommitted). NOTE: full live chain needs the shift-aware bounds deployed to prod — the
  live prod job still runs old bounds so its snapshot `window_start` date won't match until deploy.
- **IL-2** ✅ `EwsDetailPage` → new `AutoIssueLogCard` reads `GET /ews/issue-log?category=<type>`
  (all categories, open+resolved) + `PUT /ews/issue-log/:id/resolve` with optimistic update.
  Self-contained, placed above the legacy action_table section (which IL-last retires).
  Also fixed a dedup bug: `getBizBounds` now returns `business_date` as **text** (`::date::text`)
  so the `issue_key` stays `2026-07-09` regardless of the caller's pg date parser (the API path
  was emitting a full `Date.toString()` → duplicate rows vs the snapshot job's clean key).
- **IL-1e** ✅ `adoption_labour` generator (`generateAdoptionLabour`, reuses snapshot breakdown,
  completed shifts only, excused statuses skipped) wired into `generateAll` (DONE, uncommitted).
- **IL-1f** ✅ `oee` + `ole` generators (`generateOee`/`generateOle`, reuse snapshot per-machine/
  per-operator breakdown, CRITICAL-only) wired into `generateAll` (DONE, uncommitted).
- **IL-1g** ✅ `uptime_hmi` generator (`generateUptimeHmi`, reuses snapshot per-machine list,
  ping floor, <98 critical / 98–99 warning) wired into `generateAll` (DONE, uncommitted).
- **All KPIs with a calc now have a generator.** Only `uptime_tablet` remains (no calc yet).
- **IL-last** retire `action_table`/`syncActions`/`getActions`, clean `VALID_KPIS`.
- Phase 6 (drill-through) below still applies — just source the issue from `ews.issue_log` and reuse
  the same per-KPI predicate for the culprit records.

---

## LOCKED DECISIONS (agreed before Phase 1 — override anything below that conflicts)

D1. overall() — RETIRE overall_score as the headline. Keep overall_status only
    (any-critical -> CRITICAL, else any-watch -> WATCH, else NORMAL) as the driver.
    Do NOT flat-average 8 KPIs. If a score is still surfaced, split it into two sub-scores:
      performance_score = mean(min(value/target,1)) over {oee, ole}
      health_score      = mean(min(value/target,1)) over {uptime_*, accuracy_*, adoption_*}
    Default output: status-only; overall_score column written as NULL, sub-scores in detail_json.

D2. adoption_labour — REVERSED after diagnostics (pro-rate is DEAD). The elapsed-based
    pro-rate false-flagged 68% (11:00) / 94% (14:00) of operators who DID meet standard by
    shift end; no denominator (fixed / elapsed-grace / break-corrected) rescued it. ACCEPTED:
      - In-progress shifts are NOT banded: counted (in_progress_count) but excluded from the
        ratio. No pro-rate, no grace.
      - COMPLETED shifts only: adoption = SUM(LEAST(recorded, full_standard)) / SUM(full_standard),
        Day 8h / Night 7h. shift completed when shift_end <= now() (Day end 17:00, Night end 04:00 next day).
      - Windowed by BUSINESS_DATE, not raw check-in day, so a night shift (20:00-04:00) stays
        whole on its start date (ISSUE 1 fix; also removes the cross-run double-count).
    IMPLEMENTED in Phase 0 (calculateAdoptionLabour). Verified code == independent SQL, exact,
    for business_dates 2026-07-01..04. Roster/attendance (absentees) is a later phase (R1/R2).

D3. getTrend — read KPI series from detail_json.kpis, NOT the fixed *_pct columns, so all
    8 KPIs trend without new columns. STILL fill legacy accuracy_pct/adoption_pct columns on
    write for backward-compat readers. If the jsonb read slows the trend query, add an
    expression index on the jsonb path (do not pre-optimize before measuring).

PERF NOTE (settles Risk 3): calculateAccuracy() already runs the timesheet and machine
halves as TWO separate queries combined in JS; adoption_machine is a cache read. Splitting
them into Labour/Machine cards adds ZERO new queries. The ONLY genuinely new query is
adoption_labour. Do not pre-optimize the accuracy/adoption split.

kpi_snapshot storage (verified): hybrid — fixed columns uptime_pct/accuracy_pct/adoption_pct/
oee_pct/ole_pct + overall_score/overall_status, PLUS a detail_json jsonb holding the full
kpis[] array. Unique key (window_start, window_end, grain, scope_type, scope_key, shift_id).
SSE (getLatestSnapshotForQuery) already prefers detail_json.kpis; getTrend still reads the
fixed columns (that is why D3 is needed).

## Target KPI set (8 cards, 2 rows)
Row LABOUR:   uptime_tablet | accuracy_labour | adoption_labour | ole
Row MACHINE:  uptime_hmi    | accuracy_machine| adoption_machine| oee

Mapping to existing logic:
- uptime_tablet / uptime_hmi : DISPLAY-ONLY placeholders. Do NOT compute. Show card with value=null / "—"
  and status=no_data. Keep the KPI registered so the layout renders. (Uptime calc comes later.)
- accuracy_labour  : the TIMESHEET half of the current calculateAccuracy() only
                     (timesheet_ready / timesheet_total). ready = is_sap_staged;
                     error = missing_order OR missing_operation OR sow_no_match. exclude state_flag=5.
- accuracy_machine : the MACHINE half of the current calculateAccuracy() only
                     (machine_ready / machine_total from mch_productiondata LEFT JOIN mch_transaction).
- adoption_machine : the EXISTING machine adoption (duration-based path). No change, just its own card.
- adoption_labour  : NEW. Spec below.
- ole / oee        : EXISTING. No math change. Relabel into their cards.
Each accuracy side keeps its own minimum_sample_met (total >= 50) flag independently.

## NEW METRIC: adoption_labour (this is the only new logic — get it right)
Purpose: among operators active in the window, measure whether they logged their standard shift hours.
Source: public.timesheet_transaction, exclude state_flag=5, duration>0, window by longdate_checkin.

Shift + business-date derivation, per row, from check-in local time (use project TZ from env =
Asia/Makassar on this server, NOT hardcoded). CONFIRMED shift definition (owner, supersedes any
earlier ranges):
  Shift 1 (Day)   : work 08:00-17:00 (8h work + 1h break), standard = 8h, shift starts 08:00
  Shift 2 (Night) : work 20:00-04:00 (7h work + 1h break), standard = 7h, shift starts 20:00
  Long shift (~12h span, e.g. 08:00-20:00 or the reverse): KEEPS the day/night standard
    (8h / 7h) — "what matters is the standard is met" — so it collapses into Day/Night, no
    separate standard. Break time is never logged as a task, so recorded already excludes it.
  shift = CASE
    WHEN checkin_time >= '07:00' AND checkin_time < '18:00' THEN 1   -- Day
    ELSE 2                                                           -- Night (everything else)
  END
  business_date = CASE
    WHEN checkin_time < '07:00' THEN (checkin_date - 1)  -- before 07:00 = prev day's night shift
    ELSE checkin_date
  END
  -- No excluded window: every check-in classifies as Day or Night.

# DECIDE (shift anchor for operators spanning both ranges, e.g. overtime 15:00–23:00):
# DEFAULT = assign the whole (operator, business_date) group to the shift of the operator's FIRST check-in row that day.
# Do NOT split one operator across two shifts on the same business_date.

Standard hours (single source of truth — put in one constants object, do NOT scatter):
  SHIFT_STANDARD_HOURS = { 1: 8, 2: 7 }

Aggregate per (operator, business_date, shift):
  recorded_hours = SUM(duration in hours)
  standard_hours = SHIFT_STANDARD_HOURS[shift]
  gap_hours      = GREATEST(standard_hours - recorded_hours, 0)

adoption_labour% = SUM( LEAST(recorded_hours, standard_hours) ) / SUM( standard_hours ) * 100
  (capping at standard so overtime never inflates the number)

# DECIDE (in-progress shift handling) — DEFAULT = (a) evaluate COMPLETED shifts only:
# A shift is included ONLY if now() is past its end time (shift1 end 17:00 same day; shift2 end 06:00 next day).
# The currently-running shift is shown as "in progress" and EXCLUDED from the ratio, not counted as gap.

# KNOWN LIMITATION — document it in the detail payload, do not silently hide it:
# operators who logged ZERO rows are invisible here (no attendance/roster source wired in).
# This metric therefore means "of operators who logged anything, % meeting standard hours",
# NOT true attendance-based adoption. Label the card/detail accordingly.

adoption_labour detail (buildAdoptionLabourSourceDetail): one row per (operator, shift) with
recorded_hours, standard_hours, gap_hours, shift, business_date, is_in_progress. isIssue when gap_hours>0
on a completed shift and KPI status critical/watch.

## Thresholds
Register all 8 in DEFAULT_THRESHOLDS (and KPI_FALLBACK in the SSE hub) so nothing reads a missing target.
Reuse existing bands: accuracy_labour/accuracy_machine = accuracy band; oee/ole unchanged; adoption_machine
unchanged. For adoption_labour start with the same band as existing adoption (critical<90, watch<95) — mark
it as provisional. uptime_tablet/uptime_hmi: no_data, no threshold enforcement yet.
Resolve the existing 98-vs-97 accuracy target inconsistency into a single value while you're here.

## Phases (commit + STOP after each)
Phase 1  Backend calc: register 8 KPI_DEFS, split accuracy into labour/machine, split adoption machine out,
         add uptime placeholders (no_data). adoption_labour registered as a no_data placeholder (real calc = Phase 2).
         NO frontend. Apply D1 to overall() (status-only + performance/health sub-scores). Resolve accuracy
         target to a single value (98, matching the existing normal band). Verify calculateSystemSummary()
         returns 8 KPIs and overall() still works.
Phase 2  Implement adoption_labour (calc + detail builder) per spec above. Backend only.
Phase 3  Snapshot + SSE + trend: extend storage/broadcast/getTrend to carry 8 KPIs without breaking readers.
Phase 4  Frontend: EwsControlTower 2-row × 4-card layout, sparklines per new KPI, detail pages/status bands
         for the new cards. Wire adoption_labour "in progress" + limitation note into the UI.
         UI LABELS (locked): label health_score as "Kesehatan Sistem/Data" (data/system integrity),
         NOT production health — it must not be read as OEE/OLE. Mark accuracy target 98 (both sides)
         and the adoption_labour band as "provisional" in the UI. performance_score = oee/ole only.

## Phase 5 — Issue Log & Action: plain-language rewrite
> ⚠️ SUPERSEDED by "STATUS UPDATE / ews.issue_log" above. The issue log is now
> **backend-generated into `ews.issue_log`** (not FE-generated on `action_table`). The
> **plain-language message rules below STILL APPLY** — they become the `title`/`description`
> templates for each generator (IL-2/IL-3). Read "presentation" as: write the human text
> right in the generator; store it on `ews.issue_log`, not `action_table`.

GOAL: make issue log readable by foremen/supervisors (non-engineers), in plain Bahasa Indonesia.
Do NOT change how issues are detected, keyed, or deduped (dedup rule = `issue_key` in §STATUS).

Rules:
- Keep a stable machine-readable `error_code` on every issue (e.g. MISSING_ORDER, SOW_NO_MATCH,
  ADOPTION_GAP, UNIDENTIFIED_TIME, ...). All logic/filter/dedup uses error_code, NOT the human text.
- Add/repurpose a human `message` field: plain Indonesian, NO jargon, but SPECIFIC. Template it from
  data — must name WHO/WHAT/HOW MANY/WHAT TO DO. Examples of the required style:
    ADOPTION_GAP  -> "Operator {nama} shift {n} hanya mencatat {x} jam dari standar {y} jam. Selisih {gap} jam."
    MISSING_ORDER -> "{count} timesheet {nama} belum bisa masuk SAP karena nomor order kosong. Minta operator melengkapi."
    SOW_NO_MATCH  -> "{count} timesheet {nama} tidak cocok dengan data SOW. Cek nomor order & operasi."
  Forbid vague phrasing like "terjadi ketidaksesuaian data". If you can't be specific, the message is wrong.
- `pic` and escalation labels also in plain Indonesian (e.g. "Supervisor/Foreman", "Manajer Plant").
- Store the plain `message` in ews.action_table (that's what gets displayed), keep `error_code` alongside.
  Existing open issues: backfill error_code where derivable; leave message as-is (do not mass-rewrite history).
- Do NOT touch issue_key format, sync idempotency, or the aggregation level.

## Phase 6 — Drill-through to culprit records (NEW read-only page)
> Source of the issue = **`ews.issue_log`** (each row already carries `category`, `entity_id`,
> `business_date`, and `detail`). Use the issue's business_date window for the culprit query.

GOAL: from an issue in the log, click through to see the SPECIFIC source records causing it.

Constraints (read carefully):
- READ-ONLY. This drill creates NO new issue rows and does NOT alter ews.issue_log. It is a lookup.
- The culprit query MUST reuse the EXACT predicates/joins of the corresponding KPI calc in
  ewsCalculator.js. Do not redefine "error"/"gap". The row count here must reconcile with the card value.
- Store window_start/window_end on the issue (if not already) and run the culprit query against THAT
  window, not now(), so numbers reconcile with the snapshot the issue came from.
- Scope tight: filter by entity + window + error_code predicate. Add LIMIT (e.g. 500) + pagination.
  No SELECT *. Return only columns the user needs. (Perf matters — this module already had a 66s->665ms
  join fix; do not regress.)

New route/endpoint:
  GET /api/ews/issue/:issueKey/records   (or /kpi/:type/records?entity=&code=&ws=&we=)
  -> returns { issue_summary, columns, rows[], total, truncated }

New page (create it, deep-linkable via route param, survives refresh):
  /ews/issue/:issueKey   -> shows the plain-language issue at top, then the culprit records table below.
  Link from each Issue Log row in EwsDetailPage.jsx to this page.

Culprit definition per KPI (reuse existing predicates — DO NOT reinvent):
  accuracy_labour  : timesheet_transaction rows that are error (missing_order | missing_operation |
                     sow_no_match) + SAP staging rows FAILED/PENDING. Show row id, operator, order_no,
                     operation_no, and a plain "kenapa gagal" per row (mapped from error_code).
  accuracy_machine : mch_productiondata rows with no matching mch_transaction (proddataid NULL).
  adoption_labour  : the (operator, shift) with gap -> list that operator's timesheet rows for that
                     shift so the foreman sees logged-vs-standard. Show recorded vs standard vs gap.
  adoption_machine : mch_productiondata segments counted as gap (status 5 / status 2 >5min). Show machine,
                     segment time, duration, why counted as gap.
  oee              : mch_transaction rows in the non-productive buckets for that machine (NVA/NNVA/NoJob).
  ole              : timesheet_transaction non-productive rows for that operator.
  uptime_*         : skip (no_data, no drill yet) — but keep the card clickable path graceful (empty state).

Commit + STOP after Phase 5, and again after Phase 6.

Start with Phase 1 only. Report the kpi_snapshot schema finding before Phase 3.