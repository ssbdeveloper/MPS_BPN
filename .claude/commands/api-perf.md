---
description: Track B — investigate a backend performance suspicion and write it up. No code.
argument-hint: <endpoint or page>
---

Track B investigation: **$ARGUMENTS**

**The output of this command is a row in `docs/planning/API-PERF-BACKLOG.md`. Not a patch.**
Changing `apps/api/**` is on the STOP list. If you end this command having edited backend code,
you have done the wrong thing regardless of how good the change was.

## 1. Measure before you theorise

`docs/concepts/ukur-dulu-baru-refactor.md` exists because performance guesses in this repo have
already been wrong once. So:

- What does the endpoint actually return? Row count, payload size, response time — measured,
  not estimated.
- What does the consuming page do with it? Filtering 5,000 rows in the browser to show 20 is a
  finding about the endpoint, not about the page.
- `EXPLAIN (ANALYZE, BUFFERS)` for every query on the path. Paste the real plan. Connect with
  the PowerShell snippet in CLAUDE.md section 13.
- How often is it called? A cheap endpoint on a 5-second interval is a load problem that no
  query plan will show you.

## 2. Common causes, in rough order of likelihood

Whole tables returned then filtered client-side · `SELECT *` on wide tables · N+1 inside a JS
loop · non-sargable date filters (`DATE(col) = …`) · full `COUNT(*)` for pagination · joins to
expensive views · missing indexes on hot filter columns (this repo has two trigram indexes and
none on `full_name` / `part_name`) · short polling intervals · synchronous materialized-view
refresh inside a request · pool starvation from `DB_POOL_MAX=5` behind pgbouncer transaction
pooling.

Treat these as hypotheses to test, not as conclusions to report.

## 3. Write the row

Append to the table in `docs/planning/API-PERF-BACKLOG.md`:

`endpoint · consuming page · symptom · evidence · suspected cause · proposal · risk · effort · status`

`evidence` must contain a number you measured. `suspected cause` stays labelled as suspected
until a plan proves it. `status` starts at `open`.

## 4. Stop

Report the finding and the proposal, then wait. If the human approves work later, the rules are
in CLAUDE.md section 10: numbers before and after, `EXPLAIN` in the document, indexes via
migration with `CREATE INDEX CONCURRENTLY`, API changes additive and opt-in, one PR improves one
number.
