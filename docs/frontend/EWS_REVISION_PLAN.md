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

## LOCKED DECISIONS (agreed before Phase 1 — override anything below that conflicts)

D1. overall() — RETIRE overall_score as the headline. Keep overall_status only
    (any-critical -> CRITICAL, else any-watch -> WATCH, else NORMAL) as the driver.
    Do NOT flat-average 8 KPIs. If a score is still surfaced, split it into two sub-scores:
      performance_score = mean(min(value/target,1)) over {oee, ole}
      health_score      = mean(min(value/target,1)) over {uptime_*, accuracy_*, adoption_*}
    Default output: status-only; overall_score column written as NULL, sub-scores in detail_json.

D2. adoption_labour — NO "completed-shift only". Use PRO-RATE:
    for a shift still running, scale the standard down to elapsed time in-shift, with a
    30–60 min grace at shift start. A running shift is STILL scored (not no_data), flagged
    "berjalan/in-progress". Only fully-elapsed shifts use the full SHIFT_STANDARD_HOURS.
      elapsed_standard = LEAST(standard_hours, GREATEST(0, elapsed_in_shift_hours - grace_hours))
      (completed shift => elapsed_in_shift >= shift length => elapsed_standard = standard_hours)
    This supersedes the "# DECIDE (in-progress shift handling)" block below.

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

## Phase 5 — Issue Log & Action: plain-language rewrite (backend + UI text only)
GOAL: make issue log readable by foremen/supervisors (non-engineers), in plain Bahasa Indonesia.
This is a PRESENTATION change. Do NOT change how issues are detected, keyed, or deduped.

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
GOAL: from an issue in the log, click through to see the SPECIFIC source records causing it.

Constraints (read carefully):
- READ-ONLY. This drill creates NO new issue rows and does NOT alter action_table. It is a lookup.
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