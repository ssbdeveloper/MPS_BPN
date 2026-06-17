Before writing any code:
1. Read and understand the existing project folder structure
2. Check existing database config/connection files — do not create a new one
3. Identify existing component patterns, hooks, and utilities already in use
4. Check package.json to see what libraries are already installed
5. Follow the existing code style, naming conventions, and folder structure

Only after understanding the codebase, proceed step by step:
- Step 1: Backend API endpoints with parameterized SQL queries
- Step 2: React chart components, one at a time
- Step 3: Main dashboard layout combining all components

Do not install new packages without asking me first.
Do not modify existing files unless absolutely necessary — create new files instead.
If something is unclear, ask before assuming.

---

## PROJECT STACK
- Frontend: React + Vite
- Chart library: Recharts
- Backend: [Express.js / Fastify — use whichever already exists in the project]
- Database: PostgreSQL

---

## DATABASE SCHEMA SUMMARY

Key tables:
- `sow` — production operations per order: order_no, operation_no, workcenter,
  wct_group, planhours, actual_hours, progress (0-100), plan_start, plan_finish,
  actual_start, actual_finish, status, systemstatus, customer, model, part_name,
  category, type, group
- `timesheet_transaction` — operator attendance: full_name, serialnumber, order_no,
  workcentercode, longdate_checkin, longdate_checkout, duration, planhours,
  std_foreman_hours, state_flag, validation_date
- `progress_update_history` — progress update history: operation_id, order_no,
  progress, created_at, created_by, issue_description
- `usernfc` — operator master data: full_name, snssb, workcenter, roles
- `workcenter` — workcenter master data: workcenterot, groupname, machineid,
  workcenter_description, categoryhours, condition
- `processcontroldata` — quality check data: production_order, operation_no,
  workcenter, validation_status, validation_date, validation_by
- VIEW `vw_sow_orders` — pre-aggregated per order_no with:
  avg_progress, total_planhours, operation_count

---

## DASHBOARD REQUIREMENTS

### KPI Cards (top row)
1. Total active orders — systemstatus NOT IN ('TECO', 'CLSD')
2. Overdue orders — plan_finish < TODAY AND progress < 100
3. Total working hours today — from timesheet_transaction WHERE DATE(longdate_checkin) = TODAY
4. Overall average progress — from vw_sow_orders

### Chart 1 — Order Status Distribution (Donut Chart)
- Query: COUNT per status from sow, distinct per order_no
- Show status label and count
- Insight: how many orders are in each status stage

### Chart 2 — Workload per Workcenter (Horizontal Bar Chart)
- Query: GROUP BY workcenter WHERE systemstatus NOT IN ('TECO', 'CLSD')
- Show: total planhours vs actual_hours side by side
- Insight: which workcenters are overloaded vs underutilized

### Chart 3 — Daily Working Hours Trend (Line Chart)
- Query: timesheet_transaction GROUP BY DATE(longdate_checkin), last 30 days
- Show: total duration per day
- Filter: dropdown to select specific workcenter

### Chart 4 — Operator Efficiency (Bar Chart)
- Query: timesheet_transaction GROUP BY full_name
- Calculate: SUM(duration) / SUM(planhours) * 100 as efficiency %
- Show top 10 operators
- Filter: date range picker

### Chart 5 — On-Time vs Overdue Orders per Month (Stacked Bar Chart)
- Query: sow GROUP BY DATE_TRUNC('month', plan_finish)
- Categories:
  - on_time: actual_finish <= plan_finish OR progress = 100
  - overdue: plan_finish < NOW() AND progress < 100
  - in_progress: everything else

### Chart 6 — Progress Distribution (Histogram)
- Query: sow, bucket progress into ranges: 0-20, 21-40, 41-60, 61-80, 81-99, 100
- Show count of operations per bucket
- Use gradient coloring from red (low) to green (complete)

### Chart 7 — Process Control Validation Rate (Bar Chart per Workcenter)
- Query: processcontroldata GROUP BY workcenter
- Calculate: validated / total * 100 as pass rate %
- Show pass rate per workcenter

### Chart 8 — Operator Activity Heatmap (optional, implement last)
- Query: timesheet_transaction GROUP BY full_name, EXTRACT(hour FROM longdate_checkin)
- Show which hours each operator is most active

---

## GLOBAL FILTERS (apply to all charts)
- Date range picker — default: last 30 days
- Workcenter dropdown — populated from workcenter table

---

## TECHNICAL REQUIREMENTS
1. Create one REST GET endpoint per chart in the backend
2. All SQL queries must use parameterized queries — no string concatenation
3. Each chart must be a separate, reusable React component
4. Show loading skeleton while data is being fetched
5. Wrap each chart in an error boundary — one chart failing must not crash the entire dashboard
6. Responsive layout: 2-column grid on desktop, 1-column on mobile
7. Keep API response shapes consistent: always return `{ data: [...], meta: {} }`

---

## DELIVERY ORDER
1. First, show me the SQL queries for each endpoint and ask for my approval
2. Then implement the backend API endpoints
3. Then build the React components one by one
4. Finally, assemble the main dashboard layout

Do not proceed to the next step without confirming the previous one is working.