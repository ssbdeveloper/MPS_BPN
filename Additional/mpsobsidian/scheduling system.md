# Codex Task: Daily Machine Scheduling, Overtime Request, Planned Queue vs Actual Queue, and Plan vs Actual Dashboard

## 1. Main Instruction

Read `CLAUDE.md` first before making any code changes.

Use `CLAUDE.md` to understand:

- Existing project structure
- Backend architecture
- Frontend architecture
- Database connection pattern
- Existing route/controller/service pattern
- Existing authentication/session pattern
- Existing role/permission logic
- Existing UI style
- Existing naming convention

Do not rewrite the entire project.

Follow the existing project architecture and add this feature incrementally.
Change local database directly.

---

## 2. Main Goal

Add a **Daily Machine Scheduling System** for SOW activities.

The system must allow users to:

1. Schedule SOW activities to machines by date and shift
2. Manage machine capacity per date and shift
3. Handle shifts that cross midnight
4. Split SOW activity hours across multiple shifts/dates
5. Track planned and unplanned hours
6. Create overtime requests outside normal shift capacity
7. Approve overtime by supervisor
8. Compare planned queue with actual queue from `buffer_transaction`
9. Compare planned working hours with actual working hours from `timesheet_transaction`
10. Provide an interactive drag-and-drop scheduling UI

---

## 3. Important Business Concepts

The existing tables must be treated with clear separation.

```text
sow = master job / activity plan

sow_schedule = planned schedule / planned queue

buffer_transaction = actual queue that happens on the shopfloor after schedule is created

timesheet_transaction = actual working transaction / actual duration

sow_overtime_request = overtime request and approval data
````

Important:

`buffer_transaction` is not a schedule source.

Do not use `buffer_transaction` as the main source to create schedule.

The purpose of `buffer_transaction` integration is to compare:

```text
Planned Queue vs Actual Queue
```

The purpose of `timesheet_transaction` integration is to compare:

```text
Planned Hours vs Actual Hours
```

---

## 4. Required Initial Investigation

Before implementing, inspect these tables and files:

* `sow`
* `users`
* `buffer_transaction`
* `timesheet_transaction`
* Existing machine/workcenter-related tables
* Existing authentication/session middleware
* Existing role/permission logic
* Existing frontend pages and UI patterns
* Existing database migration or SQL structure

Do not assume column names.

Use the actual existing schema.

---

## 5. Naming Convention

For SOW scheduling-related tables, use prefix:

```text
sow_
```

Examples:

```text
sow_schedule
sow_overtime_request
sow_schedule_batch
sow_machine_capacity
```

For generic master data such as shift, the table does not need `sow_`.

Examples:

```text
shift_definition
shift_calendar
```

Use the existing project naming convention if one already exists.

---

# Part A — Daily Machine Scheduling

## 6. Daily Scheduling Requirement

Users must be able to create a daily schedule for each SOW activity.

Each schedule must be assigned to:

* Date
* Machine
* Workcenter if available
* Shift
* Planned hours
* Planned queue number or priority
* Planned start datetime
* Planned end datetime
* Schedule status
* Notes if needed

One SOW activity can be split into multiple schedule rows.

Example:

```text
SOW Activity Plan Hours = 7 hours

Schedule split:
- 3 hours -> Today, Shift 1
- 4 hours -> Today, Shift 2
```

Another example:

```text
SOW Activity Plan Hours = 7 hours

Schedule split:
- 3 hours -> Today, Shift 1
- 4 hours -> Tomorrow, Shift 1
```

---

## 7. Shift Requirement

The system must support shift definitions.

Example:

```text
Shift 1: 08:00 - 17:00
Shift 2: 20:00 - 04:00
```

Important:

* Some shifts can cross midnight
* Shift duration must be calculated correctly
* Shift capacity can be different from clock duration if manually configured
* Actual data after midnight can still belong to the previous schedule date

Suggested table:

```text
shift_definition
```

Suggested columns:

* id
* shift_code
* shift_name
* start_time
* end_time
* crosses_midnight
* default_capacity_hours
* is_active
* created_at
* updated_at

---

## 8. Cross Midnight Handling

Cross-midnight shift must be handled correctly.

Example:

```text
Schedule Date: 2026-05-10
Shift 2: 20:00 - 04:00
```

This means:

```text
planned_start_datetime = 2026-05-10 20:00:00
planned_end_datetime   = 2026-05-11 04:00:00
```

Do not calculate the duration as:

```text
04:00 - 20:00 = -16 hours
```

Correct duration:

```text
20:00 - 24:00 = 4 hours
00:00 - 04:00 = 4 hours
Total = 8 hours
```

The system should store or calculate full datetime windows for schedule rows.

Recommended fields in `sow_schedule`:

* schedule_date
* shift_id
* planned_start_datetime
* planned_end_datetime

For reporting and matching actual data, use datetime windows:

```sql
actual_time >= planned_start_datetime
AND actual_time < planned_end_datetime
```

Do not rely only on calendar date.

---

## 9. Why Cross Midnight Matters

If cross-midnight is ignored, these errors can happen:

1. Shift duration becomes negative or invalid
2. Actual work at 01:00 may be assigned to the wrong date
3. Shift 2 actual data may appear as unplanned actual
4. Planned vs actual report becomes wrong
5. Planned queue vs actual queue comparison becomes wrong
6. Overtime overlap validation becomes wrong
7. Machine capacity usage becomes inaccurate

Example:

```text
Schedule:
2026-05-10 Shift 2
20:00 - 04:00

Actual:
2026-05-11 01:00 - 03:00
```

This actual data should still belong to:

```text
2026-05-10 Shift 2
```

Not:

```text
2026-05-11 Shift unknown
```

---

## 10. Machine Capacity Requirement

Each machine has capacity per date and shift.

Example:

```text
Machine A
Date: 2026-05-10
Shift 1 capacity: 8 hours
Shift 2 capacity: 8 hours
```

Users must be able to configure machine capacity.

The system must show:

* Total capacity
* Used normal planned capacity
* Remaining normal capacity
* Planned hours
* Unplanned hours
* Pending overtime hours
* Approved overtime hours

---

## 11. Special Machine Behavior

Not all machines behave the same way.

### 11.1 Standard Machine

Normal machine capacity is based on shift duration or configured capacity.

Example:

```text
Shift capacity = 8 hours
Scheduled = 5 hours
Remaining = 3 hours
```

### 11.2 General Welding

General Welding capacity depends on manpower.

Example:

```text
Shift duration = 8 hours
Manpower = 3 people
Total capacity = 24 man-hours
```

The system must support manpower-based capacity.

### 11.3 CHROME Machine

CHROME can process multiple components at the same time using batching.

The system must support batch scheduling or grouped scheduling for this kind of machine.

Do not hardcode machine names directly in business logic.

Use configurable capacity type.

Recommended capacity types:

```text
STANDARD
MANPOWER_BASED
BATCH_BASED
CUSTOM
```

---

## 12. Machine Capacity Table

Inspect the existing schema first.

If no suitable table exists, create:

```text
sow_machine_capacity
```

Suggested columns:

* id
* machine_code
* machine_name
* workcenter
* schedule_date
* shift_id
* capacity_type
* base_capacity_hours
* manpower_count
* capacity_multiplier
* total_capacity_hours
* remarks
* is_active
* created_at
* updated_at

Rules:

```text
STANDARD:
total_capacity_hours = configured capacity

MANPOWER_BASED:
total_capacity_hours = base_capacity_hours * manpower_count

BATCH_BASED:
capacity calculation depends on batch rule

CUSTOM:
user-defined capacity
```

---

## 13. Normal Schedule Capacity Rule

When user schedules an activity to a machine/date/shift:

```text
Available Capacity = Total Machine Capacity - Used Normal Planned Hours
```

Where:

```text
Used Normal Planned Hours =
SUM(planned_hours)
from sow_schedule
where machine/date/shift match
and status in PLANNED or PARTIAL
and is_overtime = false
```

Important:

Overtime must not reduce normal shift capacity.

---

## 14. Auto Split Rule

When user schedules an activity and requested hours exceed remaining capacity:

Example:

```text
Machine Shift Capacity = 8 hours
Requested Plan Hours = 10 hours
```

System result:

```text
8 hours -> PLANNED
2 hours -> UNPLANNED
```

Do not force excess hours into the shift.

The excess must become unplanned unless the user explicitly creates overtime.

---

## 15. Manual Split Rule

Users must be able to manually split one SOW activity into multiple schedule rows.

Example:

```text
SOW Activity Plan Hours = 12 hours

Split:
- 4 hours -> Machine A, Today, Shift 1
- 4 hours -> Machine A, Today, Shift 2
- 4 hours -> Machine A, Tomorrow, Shift 1
```

Validation:

* Normal scheduled hours should not silently exceed original `sow.planhours`
* If total scheduled hours is less than `sow.planhours`, remaining hours must be visible as unplanned
* If total scheduled hours exceeds `sow.planhours`, show warning

---

## 16. Suggested Normal Schedule Table

Inspect existing schema first.

If no suitable table exists, create:

```text
sow_schedule
```

Suggested columns:

* id
* sow_id nullable
* production_order
* operation_no
* sequence
* ssbr_id
* workcenter
* machine_code
* schedule_date
* shift_id
* planned_start_datetime
* planned_end_datetime
* planned_hours
* planned_queue_no
* priority_no
* schedule_status
* schedule_source_type
* batch_id nullable
* is_overtime boolean default false
* overtime_request_id nullable
* warning_flag boolean default false
* warning_message nullable
* remarks
* created_by_user_id
* created_by_name
* created_at
* updated_at

Possible `schedule_status`:

```text
PLANNED
UNPLANNED
PARTIAL
COMPLETED
CANCELLED
```

Recommended `schedule_source_type`:

```text
SOW
MANUAL
```

Do not use `BUFFER` as schedule source type, because `buffer_transaction` is actual queue, not planning source.

Preferred design:

```text
sow_schedule = normal schedule allocation / planned queue
sow_overtime_request = overtime-specific request and approval
```

---

# Part B — Overtime Request

## 17. Overtime Feature Goal

Add an **Overtime Request** feature.

Users can schedule:

* Remaining planhours
* Partial planhours
* Full planhours
* Additional hours beyond original SOW planhours

outside normal shift capacity.

Overtime must not modify original `sow.planhours`.

---

## 18. Overtime Business Rules

User can create overtime for a SOW activity by setting:

* Machine
* Workcenter
* Overtime date
* Related shift
* Start time
* End time
* Overtime hours
* Note / reason

Example:

```text
SOW Activity Plan Hours = 8 hours

Normal schedule:
- 6 hours -> Shift 1

Remaining:
- 2 hours -> Overtime, 18:00 - 20:00
```

Another example:

```text
SOW Activity Plan Hours = 8 hours

Overtime request:
- 10 hours -> Overtime

System warning:
Total scheduled hours exceed original SOW planhours.
```

This warning must be visible but should not automatically block the request.

---

## 19. Overtime Approval Rule

Overtime must be approved by a user with role:

```text
SUPERVISOR
```

Inspect the `users` table to understand the real role column and role values.

Rules:

1. Only supervisor users can approve overtime
2. Approval must use the currently logged-in user
3. Store approval data in database
4. Pending overtime must not be treated as approved plan
5. Rejected overtime must not be counted as final plan

Possible overtime statuses:

```text
PENDING
APPROVED
REJECTED
CANCELLED
```

---

## 20. Overtime Capacity Rule

Overtime is outside normal shift capacity.

Normal shift capacity must not be reduced by overtime hours.

Example:

```text
Machine A Shift 1 Capacity = 8 hours
Normal planned hours = 8 hours
Overtime approved hours = 2 hours

Result:
Normal capacity used = 8 / 8
Overtime = 2 hours
Total approved plan = 10 hours
```

Keep these separate:

```text
Normal Planned Hours
Unplanned Hours
Pending Overtime Hours
Approved Overtime Hours
Actual Hours
```

---

## 21. Suggested Overtime Table

Inspect existing schema first.

If no suitable table exists, create:

```text
sow_overtime_request
```

Suggested columns:

* id
* sow_id nullable
* production_order
* operation_no
* sequence
* ssbr_id
* workcenter
* machine_code
* overtime_date
* shift_id
* overtime_start_datetime
* overtime_end_datetime
* overtime_hours
* note
* request_status
* requested_by_user_id
* requested_by_name
* approved_by_user_id nullable
* approved_by_name nullable
* approved_at nullable
* rejected_by_user_id nullable
* rejected_by_name nullable
* rejected_at nullable
* rejection_note nullable
* warning_flag boolean default false
* warning_message nullable
* created_at
* updated_at

Important:

Overtime must reference the SOW activity but must not update `sow.planhours`.

---

## 22. Overtime Warning Logic

Calculate total planned hours for one SOW activity:

```text
Total Planned Including Overtime =
Normal Scheduled Hours
+ Pending Overtime Hours
+ Approved Overtime Hours
```

Compare with original `sow.planhours`.

If total exceeds original planhours, show warning:

```text
Warning: Total scheduled hours exceed original SOW planhours.
```

This warning must appear:

* Before saving overtime request
* In overtime request list
* In supervisor approval section

---

## 23. Overtime Cross Midnight Handling

Overtime can also cross midnight.

Example:

```text
Overtime Date: 2026-05-10
Start: 23:00
End: 02:00
```

This means:

```text
overtime_start_datetime = 2026-05-10 23:00:00
overtime_end_datetime   = 2026-05-11 02:00:00
```

Do not calculate it as negative duration.

---

# Part C — Planned Queue vs Actual Queue

## 24. Buffer Transaction Context

The `buffer_transaction` table is not a schedule table.

It represents the actual queue that happens on the shopfloor after the schedule has been created.

Conceptually:

```text
sow = master job / activity plan
sow_schedule = planned schedule / planned queue
buffer_transaction = actual queue on shopfloor
timesheet_transaction = actual working transaction / actual duration
```

Do not treat `buffer_transaction` as the source of schedule.

The purpose of integrating `buffer_transaction` is to compare:

```text
Planned Queue vs Actual Queue
```

---

## 25. Planned Queue Requirement

The planned queue comes from `sow_schedule`.

The system should be able to show planned activity order by:

* schedule_date
* shift
* machine
* workcenter
* planned_queue_no
* priority_no
* planned_start_datetime
* planned_end_datetime
* production_order
* operation_no
* ssbr_id
* planned_hours

Consider these fields in `sow_schedule`:

* planned_queue_no
* planned_start_datetime
* planned_end_datetime
* priority_no
* queue_note

These fields are used only for planned scheduling.

---

## 26. Actual Queue Requirement

The actual queue comes from `buffer_transaction`.

Inspect the existing `buffer_transaction` table first.

Use it to show the real queue that happened in the field.

Possible actual queue fields may include:

* production_order
* operation_no
* ssbr_id
* serial_number
* workcenter
* machine
* queue_time
* created_at
* status
* transaction_time

Do not assume column names.

Inspect the table first.

---

## 27. Planned vs Actual Queue Comparison

Create API/query support to compare:

```text
sow_schedule planned queue
vs
buffer_transaction actual queue
```

The dashboard should show:

* Planned activity
* Planned machine
* Planned shift
* Planned date
* Planned queue number
* Actual queue position
* Actual queue time
* Difference between planned queue and actual queue
* Whether actual queue followed the plan or not

Possible comparison status:

```text
ON_PLAN
EARLY
LATE
UNPLANNED_ACTUAL
PLANNED_NOT_YET_ACTUAL
MACHINE_CHANGED
SHIFT_CHANGED
DATE_CHANGED
```

---

## 28. Matching Rule for Planned Queue vs Actual Queue

Do not force direct foreign key relationship unless the existing data supports it.

Use business keys carefully.

Possible matching keys:

* production_order
* operation_no
* sequence
* ssbr_id
* workcenter
* machine
* serial_number
* planned_start_datetime
* planned_end_datetime
* actual queue timestamp

Codex must inspect actual columns from:

* `sow`
* `sow_schedule`
* `buffer_transaction`
* `timesheet_transaction`

Then choose the safest matching strategy.

For cross-midnight shift, actual queue at `01:00` should still be matched to previous schedule date if it falls inside the planned datetime window.

Example:

```text
Planned:
2026-05-10 Shift 2
20:00 - 04:00

Actual Queue:
2026-05-11 01:00

Correct result:
Actual queue belongs to 2026-05-10 Shift 2
```

---

## 29. Important Buffer Rule

`buffer_transaction` must not create or overwrite schedule automatically unless explicitly required.

The schedule is the plan.

The buffer transaction is actual shopfloor queue evidence.

The dashboard should compare them, not mix them.

Do not add `buffer_transaction_id` to `sow_schedule` unless the existing business process already provides a valid relationship.

---

# Part D — Batch Scheduling

## 30. Batch Scheduling Requirement

For machines like CHROME, multiple components can be processed together.

Create batch support only if it fits the existing data model.

Suggested table:

```text
sow_schedule_batch
```

Suggested columns:

* id
* batch_code
* machine_code
* workcenter
* schedule_date
* shift_id
* batch_start_datetime
* batch_end_datetime
* batch_capacity_hours
* batch_status
* remarks
* created_by_user_id
* created_at
* updated_at

Multiple `sow_schedule` rows can reference one `batch_id`.

Possible batch statuses:

```text
OPEN
PLANNED
RUNNING
COMPLETED
CANCELLED
```

Do not hardcode CHROME logic.

Make batch behavior configurable.

---

# Part E — Backend API

## 31. Required API Endpoints

Follow the existing backend route/controller/service pattern.

Suggested endpoints:

```text
GET    /sow-schedule
GET    /sow-schedule/capacity
POST   /sow-schedule
PUT    /sow-schedule/:id
DELETE /sow-schedule/:id

GET    /sow-schedule/unplanned
GET    /sow-schedule/planned

GET    /sow-schedule/report/plan-vs-actual
GET    /sow-schedule/report/planned-queue-vs-actual-queue
```

Overtime endpoints:

```text
GET    /sow-schedule/overtime
POST   /sow-schedule/overtime
PUT    /sow-schedule/overtime/:id
POST   /sow-schedule/overtime/:id/approve
POST   /sow-schedule/overtime/:id/reject
```

Batch endpoints if needed:

```text
GET    /sow-schedule/batch
POST   /sow-schedule/batch
PUT    /sow-schedule/batch/:id
DELETE /sow-schedule/batch/:id
```

---

## 32. Backend Logic Requirements

Implement logic for:

### Capacity Calculation

```text
Available Capacity =
Machine Shift Capacity - Used Normal Scheduled Hours
```

### Schedule Creation

1. Get SOW activity
2. Get requested planned hours
3. Get machine/date/shift capacity
4. Calculate `planned_start_datetime`
5. Calculate `planned_end_datetime`
6. Check available capacity
7. Insert planned portion
8. Insert unplanned portion if exceeding capacity
9. Use database transaction

### Manual Split

1. Validate total scheduled hours
2. Allow split across date/shift/machine
3. Calculate datetime window for every split row
4. Show warning if exceeding original planhours
5. Use database transaction

### Overtime Request

1. Validate SOW activity
2. Validate overtime date/time
3. Calculate `overtime_start_datetime`
4. Calculate `overtime_end_datetime`
5. Calculate overtime hours
6. Compare total planned hours with original planhours
7. Store warning if exceeded
8. Insert request as `PENDING`

### Overtime Approval

1. Check current logged-in user
2. Validate role is supervisor
3. Approve or reject overtime
4. Store approved_by or rejected_by
5. Store timestamp
6. Do not approve twice
7. Use database transaction

### Planned Queue vs Actual Queue Report

1. Use `sow_schedule` as planned queue
2. Use `buffer_transaction` as actual queue
3. Match by safest business keys
4. Use datetime window, not only calendar date
5. Return comparison status

### Plan vs Actual Hours Report

1. Use `sow_schedule` as normal planned hours
2. Use approved `sow_overtime_request` as approved overtime hours
3. Use `timesheet_transaction` as actual hours
4. Use datetime window for shift matching
5. Separate pending overtime from approved overtime

---

## 33. Role Validation

Do not hardcode user ID.

Use current authenticated user.

Pseudo-rule:

```text
if currentUser.role !== 'SUPERVISOR':
    return 403 Forbidden
```

But inspect actual `users` table and authentication middleware first.

Use real column names and real role values.

---

# Part F — Frontend UI

## 34. Main Scheduling Page

Create or update scheduling page with interactive UI.

The page must show:

* Date selector
* Shift selector
* Machine/workcenter selector
* Machine capacity
* Used capacity
* Remaining capacity
* Planned activity list
* Unplanned activity list
* Actual queue from `buffer_transaction`
* Pending overtime list
* Approved overtime list
* Planned queue vs actual queue summary
* Plan vs actual hours summary if possible

---

## 35. Drag and Drop Requirement

UI should support drag and drop scheduling.

Users should be able to drag activity cards from:

```text
Unplanned List
Planned List
SOW Activity List
```

Into:

```text
Machine schedule slot
Shift schedule slot
Overtime slot
```

Do not treat `buffer_transaction` as a drag source for creating planned schedule, unless the existing business process explicitly requires it.

`buffer_transaction` should be shown as actual queue evidence, not planning source.

When a card is dropped, user should be able to set:

* Planned hours
* Date
* Shift
* Machine
* Notes
* Overtime start/end time if overtime

---

## 36. Schedule Card Information

Each activity card should show:

* Production order
* Operation
* SSBR ID if available
* Workcenter
* Machine
* Original planhours
* Scheduled hours
* Remaining hours
* Planned start datetime
* Planned end datetime
* Planned queue number
* Status
* Source type
* Warning if exceeded
* Overtime status if overtime

Example card:

```text
Production Order: 123456
Operation: 0020
Plan Hours: 8
Scheduled: 6
Remaining: 2
Queue: 3
Status: PARTIAL
```

---

## 37. Overtime UI Requirement

Overtime approval must be available on the same scheduling page.

For pending overtime, show:

* Activity information
* Machine
* Date
* Time range
* Overtime hours
* Note
* Requested by
* Warning if exceeding original planhours
* Approve button
* Reject button

Only supervisor users can see approve/reject buttons.

Non-supervisor users can only:

* Create overtime request
* View request status
* View warning

---

## 38. UI Grouping

The UI should clearly separate:

```text
Planned Schedule
Unplanned Schedule
Actual Queue from Buffer Transaction
Overtime Pending
Overtime Approved
Overtime Rejected
```

Do not visually mix pending overtime with approved plan.

Do not visually mix planned queue with actual queue.

---

# Part G — Reporting and Dashboard

## 39. Plan vs Actual Hours Report

Create API/query support to compare planned hours vs actual hours.

Planned data source:

```text
sow_schedule
sow_overtime_request
```

Actual data source:

```text
timesheet_transaction
```

The report should support grouping by:

* Date
* Shift
* Machine
* Workcenter
* Production order
* Operation
* SOW activity

---

Tambahkan section ini ke prompt final, paling cocok setelah **Part G — Reporting and Dashboard** atau sebelum **Part E — Backend API**.

````md
# Additional Requirement — Lightweight API Using Database Views

## Database View / Materialized View Requirement

Do not put complex reporting queries directly inside API controllers.

For heavy dashboard/reporting logic, create database views or materialized views so the API stays lightweight and easier to maintain.

The API should only query from prepared database objects such as:

```text
VIEW
MATERIALIZED VIEW
````

instead of building long SQL joins directly inside backend code.

---

## Reporting Query Design Rule

For reports such as:

```text
Plan vs Actual Hours
Planned Queue vs Actual Queue
Machine Capacity Summary
Overtime Summary
```

create database views or materialized views.

Recommended database objects:

```text
vw_sow_schedule_capacity
vw_sow_plan_vs_actual_hours
vw_sow_planned_queue_vs_actual_queue
vw_sow_overtime_summary
```

For heavier reports, use materialized views:

```text
mv_sow_plan_vs_actual_hours
mv_sow_planned_queue_vs_actual_queue
mv_sow_machine_daily_capacity
```

Use normal `VIEW` when:

* Data must always be real-time
* Query is not too heavy
* Dataset is still small or medium

Use `MATERIALIZED VIEW` when:

* Query is heavy
* Report joins multiple large tables
* Dashboard is accessed frequently
* Slightly delayed data is acceptable

---

## API Rule

API endpoints should not contain complex SQL joins for dashboards.

Bad example:

```text
API controller contains long query joining:
sow_schedule
sow_overtime_request
timesheet_transaction
buffer_transaction
shift_definition
sow_machine_capacity
```

Preferred design:

```text
Database view handles complex query
API only does simple SELECT from the view
```

Example:

```sql
SELECT *
FROM vw_sow_plan_vs_actual_hours
WHERE schedule_date BETWEEN $1 AND $2
  AND machine_code = COALESCE($3, machine_code)
ORDER BY schedule_date, shift_id, machine_code;
```

The API should mainly handle:

* Request validation
* User authorization
* Simple filters
* Pagination
* Sorting
* Calling refresh process if needed
* Returning JSON response

---

## Required Views

Create or propose views for these reporting needs.

### 1. `vw_sow_schedule_capacity`

Purpose:

Show daily machine capacity usage.

Should include:

* schedule_date
* shift_id
* shift_name
* machine_code
* workcenter
* total_capacity_hours
* used_normal_planned_hours
* remaining_capacity_hours
* unplanned_hours
* pending_overtime_hours
* approved_overtime_hours

---

### 2. `vw_sow_plan_vs_actual_hours`

Purpose:

Compare planned hours with actual working hours.

Planned source:

```text
sow_schedule
sow_overtime_request
```

Actual source:

```text
timesheet_transaction
```

Should include:

* schedule_date
* shift_id
* shift_name
* machine_code
* workcenter
* production_order
* operation_no
* normal_planned_hours
* unplanned_hours
* overtime_pending_hours
* overtime_approved_hours
* total_approved_planned_hours
* actual_hours
* variance_hours

Formula:

```text
total_approved_planned_hours =
normal_planned_hours + overtime_approved_hours
```

```text
variance_hours =
actual_hours - total_approved_planned_hours
```

Pending overtime must be shown separately and must not be counted as approved plan.

---

### 3. `vw_sow_planned_queue_vs_actual_queue`

Purpose:

Compare planned queue with actual shopfloor queue.

Planned source:

```text
sow_schedule
```

Actual queue source:

```text
buffer_transaction
```

Should include:

* schedule_date
* shift_id
* shift_name
* machine_code
* workcenter
* production_order
* operation_no
* planned_queue_no
* planned_start_datetime
* planned_end_datetime
* actual_queue_no
* actual_queue_datetime
* queue_variance
* comparison_status

Possible `comparison_status`:

```text
ON_PLAN
EARLY
LATE
UNPLANNED_ACTUAL
PLANNED_NOT_YET_ACTUAL
MACHINE_CHANGED
SHIFT_CHANGED
DATE_CHANGED
```

Important:

Use `planned_start_datetime` and `planned_end_datetime` for cross-midnight matching.

Do not match only by calendar date.

---

### 4. `vw_sow_overtime_summary`

Purpose:

Show overtime request and approval summary.

Should include:

* overtime_date
* shift_id
* machine_code
* workcenter
* production_order
* operation_no
* overtime_start_datetime
* overtime_end_datetime
* overtime_hours
* request_status
* requested_by
* approved_by
* approved_at
* rejected_by
* rejected_at
* warning_flag
* warning_message

---

## Materialized View Refresh Rule

If using materialized views, implement a safe refresh strategy.

Possible refresh approaches:

1. Manual refresh endpoint for admin/supervisor
2. Refresh after schedule/overtime approval changes
3. Scheduled refresh using cron or existing backend scheduler
4. PostgreSQL `REFRESH MATERIALIZED VIEW CONCURRENTLY` if supported by the view design

Important:

If using `REFRESH MATERIALIZED VIEW CONCURRENTLY`, make sure the materialized view has a unique index.

Example:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sow_plan_vs_actual_hours
ON mv_sow_plan_vs_actual_hours (
    schedule_date,
    shift_id,
    machine_code,
    production_order,
    operation_no
);
```

Then refresh:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sow_plan_vs_actual_hours;
```

If concurrent refresh is not possible, use:

```sql
REFRESH MATERIALIZED VIEW mv_sow_plan_vs_actual_hours;
```

But document that it may lock the materialized view during refresh.

---

## API Endpoints for Reports

Report endpoints should query views or materialized views.

Suggested endpoints:

```text
GET /sow-schedule/report/capacity
GET /sow-schedule/report/plan-vs-actual
GET /sow-schedule/report/planned-queue-vs-actual-queue
GET /sow-schedule/report/overtime-summary
```

Optional refresh endpoint if using materialized views:

```text
POST /sow-schedule/report/refresh
```

Only authorized users should be able to refresh materialized views.

---

## Backend Restriction

Do not write complex dashboard SQL directly in API controller.

Keep SQL logic in:

```text
database view
materialized view
migration SQL
repository query file
```

Controller should remain thin.

Controller responsibilities:

* Parse request filter
* Validate user
* Call service/repository
* Return response

Repository responsibilities:

* Query view/materialized view
* Apply simple filters
* Apply pagination
* Apply sorting

Database responsibilities:

* Complex joins
* Aggregation
* Planned vs actual calculation
* Queue comparison logic
* Cross-midnight matching logic

````

````

## 40. Plan vs Actual Hours Output Fields

Suggested output:

* schedule_date
* shift
* machine_code
* workcenter
* production_order
* operation_no
* normal_planned_hours
* unplanned_hours
* overtime_pending_hours
* overtime_approved_hours
* total_approved_planned_hours
* actual_hours
* variance_hours
* planned_status
* overtime_status
* approved_by
* approved_at

Formula:

```text
total_approved_planned_hours =
normal_planned_hours + overtime_approved_hours
```

```text
variance_hours =
actual_hours - total_approved_planned_hours
```

Pending overtime should be shown separately and must not be counted as approved plan.

---

## 41. Planned Queue vs Actual Queue Report

Create API/query support to compare:

```text
Planned queue from sow_schedule
vs
Actual queue from buffer_transaction
```

Suggested output:

* schedule_date
* shift
* machine_code
* workcenter
* production_order
* operation_no
* planned_queue_no
* planned_start_datetime
* planned_end_datetime
* actual_queue_no
* actual_queue_datetime
* queue_variance
* comparison_status

Possible comparison statuses:

```text
ON_PLAN
EARLY
LATE
UNPLANNED_ACTUAL
PLANNED_NOT_YET_ACTUAL
MACHINE_CHANGED
SHIFT_CHANGED
DATE_CHANGED
```

---

## 42. Join Key Investigation

Do not assume the join keys.

Inspect actual columns from:

* `sow`
* `sow_schedule`
* `buffer_transaction`
* `timesheet_transaction`

Possible business keys:

* production_order
* operation_no
* sequence
* ssbr_id / ssbr_ident
* workcenter
* machine
* serial_number
* datetime window

Choose the safest join strategy and document it.

---

# Part H — Validation and Edge Cases

## 43. Required Validation

Handle these cases:

1. Shift crosses midnight
2. Overtime crosses midnight
3. Machine capacity is manually changed
4. General Welding uses manpower-based capacity
5. CHROME or similar machine supports batching
6. One SOW activity split across multiple dates/shifts
7. Normal scheduled hours exceed capacity
8. Remaining hours become unplanned
9. Overtime does not reduce normal shift capacity
10. Overtime can exceed original SOW planhours but must show warning
11. Overtime must be approved by supervisor
12. Pending overtime must not be counted as approved plan
13. Actual timesheet may exist without planned schedule
14. Planned schedule may exist without actual timesheet
15. Actual queue may exist without planned queue
16. Planned queue may exist without actual queue
17. Actual queue after midnight may still belong to previous schedule date
18. `planhours` may be text and must be safely converted to numeric
19. Approval must use logged-in user
20. Rejected overtime must not be counted in final plan
21. Do not update original `sow.planhours`
22. Do not treat `buffer_transaction` as schedule source
23. Do not mix planned queue and actual queue

---

# Part I — Implementation Phases

## 44. Work in This Order

### Phase 1 — Project Understanding

1. Read `CLAUDE.md`
2. Inspect backend structure
3. Inspect frontend structure
4. Inspect database schema
5. Identify existing route/controller/service conventions

### Phase 2 — Schema Design

1. Inspect `sow`
2. Inspect `users`
3. Inspect `buffer_transaction`
4. Inspect `timesheet_transaction`
5. Design required tables
6. Create migration SQL
7. Avoid breaking existing data

### Phase 3 — Backend Implementation

1. Add shift/capacity logic
2. Add schedule APIs
3. Add capacity calculation
4. Add cross-midnight datetime calculation
5. Add manual split logic
6. Add overtime request API
7. Add overtime approval/rejection API
8. Add supervisor validation
9. Add planned queue vs actual queue report API
10. Add plan vs actual hours report API

### Phase 4 — Frontend Implementation

1. Add scheduling page
2. Add drag and drop UI
3. Add machine capacity display
4. Add planned/unplanned list
5. Add actual queue list from `buffer_transaction`
6. Add overtime request UI
7. Add overtime approval UI
8. Add warning display
9. Add planned queue vs actual queue viewt

## Frontend Display Requirement

This page should be optimized for desktop usage only.

Do not prioritize mobile layout for this scheduling page.

Unlike other pages in the application, this feature requires a wide and flexible desktop interface because users need to manage drag-and-drop scheduling, machine capacity, planned queue, actual queue, and overtime approval in one screen.

Recommended layout:

- Left panel: SOW activity / unplanned list
- Center panel: machine schedule board by date and shift
- Right panel: capacity summary, actual queue, and overtime approval
- Top section: date, shift, machine, and filter controls

The UI should remain flexible for different desktop screen sizes, but mobile responsiveness is not mandatory.

### Phase 5 — Testing and Documentation

1. Test normal scheduling
2. Test split scheduling
3. Test over-capacity scheduling
4. Test cross-midnight shift
5. Test overtime request
6. Test overtime crossing midnight
7. Test supervisor approval
8. Test non-supervisor restriction
9. Test planned queue vs actual queue
10. Test plan vs actual hours report
11. Document changed files

---

# Part J — Acceptance Criteria

## 45. Feature is Complete When

The implementation is acceptable only if:

1. User can schedule SOW activity by date, shift, and machine
2. User can see machine capacity, used capacity, and remaining capacity
3. User can split one activity into multiple schedule rows
4. Excess normal schedule hours become unplanned
5. Cross-midnight shift is calculated correctly
6. Schedule rows store or calculate full planned datetime windows
7. User can create overtime request outside normal shift capacity
8. Overtime can cross midnight safely
9. Overtime does not modify `sow.planhours`
10. Overtime shows warning when total planned hours exceeds original planhours
11. Supervisor can approve/reject overtime
12. Non-supervisor cannot approve/reject overtime
13. Approval stores approved by and approved at
14. UI shows planned, unplanned, actual queue, pending overtime, and approved overtime separately
15. Drag and drop scheduling works
16. `buffer_transaction` is shown as actual queue, not schedule source
17. Planned queue vs actual queue report works
18. Plan vs actual hours report separates normal planned, overtime pending, overtime approved, and actual hours
19. Existing features are not broken
20. Heavy reporting APIs query database views or materialized views, not long complex SQL directly inside controllers.

---

# Part K — Do Not Do

## 46. Restrictions

Do not:

* Rewrite the whole project
* Hardcode machine names like `GENERAL WELDING` or `CHROME` in business logic
* Hardcode supervisor user ID
* Assume all machines have 8 hours capacity
* Assume all shifts are same-day shifts
* Ignore shifts crossing midnight
* Ignore overtime crossing midnight
* Mix pending overtime with approved plan
* Reduce normal capacity when overtime is created
* Update original `sow.planhours`
* Treat `buffer_transaction` as schedule source
* Mix planned queue with actual queue
* Create direct foreign key to `buffer_transaction` unless the existing business process supports it
* Ignore existing project conventions
* Break existing APIs or UI pages
* Skip database transaction for multi-row insert/update
* Do not put complex reporting SQL directly inside API controllers. Use database views or materialized views for heavy dashboard queries.

---

# Part L — Final Output Required From Codex

After implementation, explain:

1. Files changed
2. Tables created or modified
3. API endpoints added
4. Frontend pages/components added
5. How capacity calculation works
6. How cross-midnight shift is handled
7. How split scheduling works
8. How overtime request works
9. How supervisor approval works
10. How `buffer_transaction` is used as actual queue
11. How planned queue vs actual queue report works
12. How plan vs actual hours report works
13. Any assumptions made
14. Any remaining limitations

````
