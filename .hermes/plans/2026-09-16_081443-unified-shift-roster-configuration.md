# Unified Shift & Roster Configuration Implementation Plan

> **For Hermes:** Implement this plan task-by-task with TDD and review after each phase.

**Goal:** Menyatukan pengaturan definisi shift, standard hours, override tanggal, rotasi, dan override operator dalam satu UI yang tidak membingungkan, dengan `public.shift_definition` sebagai satu-satunya master jadwal/standard shift dan roster historis tetap immutable.

**Architecture:** `public.shift_definition` menjadi sumber master untuk waktu shift dan standard/net work hours per tanggal. `ews.shift_roster` tetap menyimpan snapshot pada saat roster dibuat agar histori tidak berubah. Override individu disimpan pada row roster dan memiliki precedence eksplisit. Halaman `/shift-definition` dialihkan ke tab Shift di `/ews/roster/config`; `ews.operator_shift` dipertahankan sementara hanya untuk kompatibilitas migrasi, lalu tidak lagi dibaca runtime.

**Tech Stack:** React 19/Vite, Express, PostgreSQL, node:test, Vitest.

---

## 1. Temuan dan masalah saat ini

### Dua UI yang tampak mengatur hal yang sama

1. `/shift-definition`
   - UI: `apps/web/src/pages/PPC/ShiftDefinitionPage.jsx`
   - API: `/sow-schedule/shift-rules`
   - Tabel: `public.shift_definition`
   - Mengatur: start/end, cross-midnight, `default_capacity_hours`, default/date override.
   - Dipakai SOW Scheduling; setelah commit `3963cc0`, waktu shift Adoption Labour juga membaca tabel ini.

2. `/ews/roster/config`
   - UI: `apps/web/src/pages/EwsRosterConfigPage.jsx`
   - API: `/ews/roster/config`
   - Tabel shift: `ews.operator_shift`
   - Bagian shift saat ini read-only.
   - Mengatur workday, rotation group, shift lock, dan generate roster.

### Dua master shift berbeda

Contoh live CKP:

- `shift_definition SHIFT-1`: 07:25–16:30, capacity 8h.
- `ews.operator_shift DAY`: 08:00–17:00, standard 8h.

Akibatnya user tidak tahu halaman mana yang benar dan pembaca berbeda dapat memakai jadwal berbeda.

### Snapshot roster memang sengaja immutable

`ews.shift_roster.scheduled_standard_hours` disalin saat generate roster. `rosterGenerator.js` memakai `ON CONFLICT DO NOTHING`, sehingga:

- mengubah master tidak mengubah histori;
- mengubah master juga tidak mengubah future roster yang terlanjur dibuat;
- manual foreman edits tidak tertimpa.

Ini benar untuk audit, tetapi perlu dijelaskan dan diberi aksi terkontrol untuk menerapkan master baru ke future auto-generated rows.

### Override yang tersedia belum lengkap

Saat ini:

- Status harian: tersedia.
- Half-day: tersedia; efektif membagi jam standar menjadi dua.
- Temporary shift lock DAY/NIGHT: tersedia.
- Arbitrary standard-hours override per operator/tanggal: belum tersedia.
- Shift-level date override: ada di `shift_definition`, tetapi belum menjadi sumber roster generator.

---

## 2. Keputusan desain yang direkomendasikan

### 2.1 Satu halaman konfigurasi

Gunakan satu entry point:

```text
/ews/roster/config
```

Tab/section:

1. **Shift & Standard Hours**
2. **Workdays**
3. **Rotation Groups**
4. **Operator Overrides**
5. **Generate & Preview**

Route lama:

```text
/shift-definition
```

menjadi redirect ke:

```text
/ews/roster/config?tab=shifts
```

Jangan pertahankan dua editor aktif.

### 2.2 Satu master shift

Gunakan `public.shift_definition` sebagai single source of truth untuk:

- kode shift;
- label shift;
- roster role (`DAY`/`NIGHT`/tidak dipakai roster);
- start time;
- end time;
- crosses midnight;
- standard/net hours;
- default rule;
- date override;
- active flag.

Tambahkan mapping eksplisit, jangan hardcode permanen:

```text
SHIFT-1 → DAY
SHIFT-2 → NIGHT
SHIFT-3 → NULL / bukan roster, kecuali nanti dikonfigurasi
```

Kolom yang disarankan:

```sql
ALTER TABLE public.shift_definition
ADD COLUMN roster_shift_code text
CHECK (roster_shift_code IS NULL OR roster_shift_code IN ('DAY', 'NIGHT'));
```

Backfill:

```sql
SHIFT-1 → DAY
SHIFT-2 → NIGHT
```

Alasan: mapping `SHIFT-1 → DAY` tidak boleh tersebar sebagai CASE di kalkulator, generator, controller, dan UI.

### 2.3 Arti “Standard Hours” harus tunggal dan jelas

Pertahankan kolom DB `default_capacity_hours` pada fase awal agar diff kecil, tetapi ubah label UI/API menjadi:

```text
Standard Work Hours (net)
```

Deskripsi operator:

```text
Target jam kerja bersih untuk satu shift. Dipakai oleh Roster, Adoption Labour, dan kapasitas default Scheduling. Waktu istirahat tidak dihitung sebagai target kerja.
```

API boleh memberi alias baru:

```json
{
  "standard_hours": 8,
  "default_capacity_hours": 8
}
```

Setelah semua consumer pindah ke `standard_hours`, migration rename kolom boleh dipertimbangkan terpisah. Jangan rename dalam fase pertama karena risikonya besar dan tidak perlu untuk menyelesaikan kebingungan user.

### 2.4 Tiga jenis override harus dibedakan di UI

#### A. Shift-level date override

Contoh:

```text
17 Sep 2026 — Shift 1: 07:25–12:00, Standard 4h
```

Berlaku ke seluruh operator pada shift itu untuk satu tanggal. Disimpan sebagai row non-default `shift_definition` dengan `effective_date`.

#### B. Operator shift override

Contoh:

```text
Budi → NIGHT selama 2 minggu
```

Menggunakan `ews.operator_shift_lock`. Ini mengubah shift operator, bukan jam kerja arbitrary.

#### C. Operator target-hours override

Contoh:

```text
Budi, 17 Sep 2026 → target 6h
```

Tambahkan kolom nullable:

```sql
ALTER TABLE ews.shift_roster
ADD COLUMN standard_hours_override numeric;
```

Validation:

```text
0 < standard_hours_override <= 24
```

Precedence yang direkomendasikan:

```text
standard_hours_override
  > half-day(base standard / 2)
  > standard snapshot dari shift/date saat roster dibuat
```

Half-day tetap menjadi shortcut yang mudah. Jika exact override diisi, label UI harus menampilkan `Custom 6h`, bukan juga `½ day`.

### 2.5 Histori tidak boleh ikut berubah

Aturan update master:

- Tanggal lampau: tidak mengubah `shift_roster` yang sudah ada.
- Hari ini: default tidak overwrite otomatis; user diberi preview dampak dan aksi eksplisit.
- Masa depan: user dapat memilih menerapkan ke auto-generated roster rows.
- Row `source='manual'`, status manual, half-day, shift lock, atau custom hours tidak boleh ditimpa.

Aksi UI setelah Save Master/Date Override:

```text
Master shift disimpan.
124 future auto-roster rows berbeda dari aturan baru.
[Preview Changes] [Apply to Future Auto Roster]
```

Update harus transaksi dan hanya menyentuh row yang memenuhi semua syarat aman.

### 2.6 Jangan lagi membaca `ews.operator_shift` sebagai runtime master

Fase transisi:

1. `shift_definition` menjadi source untuk kalkulator EWS dan roster generator.
2. `/ews/roster/config` mengembalikan resolved shift dari `shift_definition`.
3. `ews.operator_shift` tidak lagi diedit atau dibaca runtime.
4. Setelah satu release stabil, audit seluruh references.
5. Drop/archive tabel hanya melalui migration terpisah, bukan dalam feature commit pertama.

---

## 3. UX yang disarankan

### Tab 1 — Shift & Standard Hours

Header menampilkan tanggal preview dan timezone plant:

```text
Preview: 17 Sep 2026 · Asia/Jakarta
```

Per shift tampil satu card:

```text
SHIFT 1 · Day
07:25 → 16:30
Standard work: 8h
Clock span: 9h 05m
Break/non-work allowance: 1h 05m
Source: Default
```

Jika date override aktif:

```text
Source: Override for 17 Sep 2026
[Edit Override] [Return to Default]
```

Field form:

- Shift name.
- Roster use: Day / Night / Not used by roster.
- Start.
- End.
- Crosses midnight (auto-derived where possible, editable only if ambiguous).
- Standard Work Hours.
- Default atau Override Date.
- Active.

Validation:

- Standard hours > 0.
- Standard hours <= clock span kecuali user memberi alasan/konfirmasi khusus.
- Satu default aktif per `shift_code`.
- Satu override aktif per `shift_code + effective_date`.
- Hanya satu active default mapped ke DAY dan satu ke NIGHT.
- End/start and cross-midnight menghasilkan clock span > 0 dan <= 24h.

### Tab 2 — Workdays

Pertahankan toggle hari kerja, tetapi beri label sederhana:

```text
Hari apa Shift Day/Night dijadwalkan otomatis?
```

Jangan tampilkan konsep database.

### Tab 3 — Rotation Groups

Pertahankan Group A/B, tetapi tampilkan preview minggu ini dan minggu depan:

```text
Minggu ini: Group A DAY · Group B NIGHT
Minggu depan: Group A NIGHT · Group B DAY
```

### Tab 4 — Operator Overrides

Satukan tiga aksi per operator/tanggal:

- Status: Scheduled / Leave / Sick / Permit / Site Visit / Off.
- Shift sementara: Day / Night + periode.
- Target hours: Default / Half day / Custom hours.

Tampilkan effective result, bukan hanya input:

```text
Effective: NIGHT · 7h
Reason: temporary shift lock
```

atau:

```text
Effective: DAY · 6h
Reason: custom target override
```

### Tab 5 — Generate & Preview

Sebelum generate:

- date range;
- estimated operators × days;
- effective shift rules;
- new rows count;
- existing frozen rows count;
- rows with manual override count.

Actions:

```text
Preview
Generate Missing Rows
Apply Master Changes to Eligible Future Rows
```

Hindari label “Regenerate” jika operasi sebenarnya `ON CONFLICT DO NOTHING`.

---

## 4. Implementation plan

### Task 1: Add unified shift-domain resolver

**Objective:** Semua consumer memakai satu fungsi/query untuk resolve default/date override dan mapping roster.

**Files:**
- Create: `apps/api/services/shiftDefinitionService.js`
- Create: `apps/api/services/shiftDefinitionService.test.js`
- Modify: `apps/api/controllers/sowScheduleController.js`
- Modify: `apps/api/services/ewsCalculator.js`

**Steps:**

1. Tulis failing tests untuk:
   - default rule;
   - exact-date override wins;
   - inactive row ignored;
   - mapping DAY/NIGHT;
   - duplicate/missing mapping fails closed.
2. Implement `getResolvedShiftSql(dateParam)` atau service query tunggal.
3. Ganti duplicate resolver di SOW controller dan EWS calculator.
4. Jalankan:

```bash
cd apps/api
node --test services/shiftDefinitionService.test.js services/ewsAdoptionShift.contract.test.js
```

Expected: all pass.

5. Commit:

```bash
git add apps/api/services/shiftDefinitionService.js apps/api/services/shiftDefinitionService.test.js apps/api/controllers/sowScheduleController.js apps/api/services/ewsCalculator.js
git commit -m "refactor(shifts): centralize resolved shift rules"
```

### Task 2: Add roster mapping migration

**Objective:** Hilangkan hardcoded `SHIFT-1/SHIFT-2 → DAY/NIGHT` dari runtime.

**Files:**
- Create: `database/migrations/api/20260916_shift_definition_roster_mapping.sql`
- Modify: `database/schema/schema_prod.sql` through the repository’s schema refresh workflow, not manual drift.

**Steps:**

1. Tambahkan nullable `roster_shift_code`.
2. Backfill SHIFT-1 DAY dan SHIFT-2 NIGHT only when unambiguous.
3. Tambahkan validation/partial unique constraints yang mencegah dua active defaults memetakan roster code yang sama.
4. Query preflight untuk duplicate default/date overrides.
5. Jalankan migration dalam transaction pada test/local DB first.
6. Verify:

```sql
SELECT shift_code, roster_shift_code, is_default, effective_date
FROM shift_definition
ORDER BY shift_code, is_default DESC, effective_date;
```

7. Commit migration separately.

### Task 3: Move roster generator to shift_definition

**Objective:** Future roster snapshots mengambil standard hours dari master yang sama dengan Scheduling/EWS.

**Files:**
- Modify: `apps/api/services/rosterGenerator.js`
- Create: `apps/api/services/rosterGenerator.test.js`

**Steps:**

1. Failing test: date override 4h must generate `scheduled_standard_hours=4`, while default day generates 8h.
2. Replace join `ews.operator_shift` with resolved `shift_definition` by date and `roster_shift_code`.
3. Keep `ON CONFLICT DO NOTHING` unchanged.
4. Test that existing rows/manual edits are not overwritten.
5. Test DAY/NIGHT workday rules remain correct.
6. Commit.

### Task 4: Add safe future-roster impact preview and apply endpoint

**Objective:** User can intentionally propagate master changes without corrupting history/manual rows.

**Files:**
- Modify: `apps/api/controllers/ewsRosterController.js`
- Modify: `apps/api/routes/ews.js` or actual EWS route file
- Modify: `apps/api/rbac/manifest.js`
- Create: `apps/api/controllers/ewsRosterShiftImpact.test.js`

**Endpoints:**

```text
GET  /ews/roster/config/shift-impact?from=...&to=...
POST /ews/roster/config/apply-shifts
```

**Safe scope:**

- future/today only;
- `source='auto'` only;
- no manual status/half-day/custom hours;
- preserve historical rows;
- preview count and IDs before write;
- transaction;
- return updated/skipped breakdown.

Do not silently trigger this endpoint on Save Shift.

### Task 5: Add exact operator standard-hours override

**Objective:** Mendukung target custom per operator/date tanpa menyalahgunakan shift master.

**Files:**
- Create: `database/migrations/api/20260916_roster_standard_hours_override.sql`
- Modify: `apps/api/controllers/ewsRosterController.js`
- Modify: `apps/api/routes/ews.js`
- Modify: `apps/api/rbac/manifest.js`
- Modify: roster effective view migration.
- Create: controller/view tests.

**View precedence:**

```sql
COALESCE(
  r.standard_hours_override,
  CASE WHEN r.half_day THEN base_standard / 2 END,
  base_standard
) AS eff_std
```

**Endpoint:**

```text
PUT /ews/roster/standard-hours
{
  "serialnumber": "...",
  "business_date": "YYYY-MM-DD",
  "standard_hours_override": 6 | null,
  "updated_by": "..."
}
```

Validation and audit fields are mandatory.

### Task 6: Expand unified roster config API

**Objective:** Satu API memberikan semua data yang diperlukan unified UI.

**Files:**
- Modify: `apps/api/controllers/ewsRosterController.js:getConfig`
- Add tests.

Return:

```json
{
  "resolved_shifts": [],
  "shift_rules": [],
  "workday_rules": [],
  "rotation_config": {},
  "group_counts": [],
  "group_members": [],
  "operators": [],
  "timezone": "Asia/Jakarta",
  "legacy_shift_source_active": false
}
```

Stop returning `ews.operator_shift` as authoritative `shifts` after consumers migrate.

### Task 7: Build Shift & Standard Hours tab inside EWS Roster Config

**Objective:** User edits all global/date shift settings from one location.

**Files:**
- Modify: `apps/web/src/pages/EwsRosterConfigPage.jsx`
- Extract only if needed to stay maintainable:
  - Create: `apps/web/src/features/ewsRoster/ShiftRulesPanel.jsx`
  - Create: `apps/web/src/features/ewsRoster/OperatorOverridesPanel.jsx`
  - Create: `apps/web/src/features/ewsRoster/GenerateRosterPanel.jsx`
- Add Vitest tests.

**Acceptance:**

- Preview date changes effective cards.
- User can edit default and create date override.
- UI says `Standard Work Hours`, not ambiguous `Capacity Hours` in roster context.
- UI shows clock span vs net standard hours.
- UI shows impact preview before applying to future roster.
- UI never claims master changes automatically updated frozen roster rows.

### Task 8: Consolidate navigation and retire duplicate editor

**Objective:** User sees one configuration entry point.

**Files:**
- Modify: `apps/web/src/router/index.jsx`
- Modify menu/navigation component that links `/shift-definition`.
- Replace `ShiftDefinitionPage.jsx` with redirect or remove after route redirect is verified.

**Behavior:**

```text
/shift-definition → /ews/roster/config?tab=shifts
```

Keep redirect for bookmarks. Do not leave a second editable page.

### Task 9: Align all roster readers with resolved shift times

**Objective:** Roster screen, monthly view, EWS detail, issue generator, and snapshot job use identical effective shift boundaries.

**Files likely:**
- `apps/api/controllers/ewsRosterController.js`
- `apps/api/services/ewsCalculator.js`
- `apps/api/services/ewsIssueGenerator.js`
- `apps/api/jobs/ewsSnapshotJob.js`
- `apps/api/jobs/ewsRosterGenerateJob.js`

Audit and replace direct `ews.operator_shift` reads. Leave no runtime read except migration/compatibility diagnostics.

Verification search:

```bash
rg "ews\.operator_shift" apps/api database/migrations
```

Every remaining match must be explicitly classified as historical migration, compatibility, or intentionally pending removal.

### Task 10: Data migration and CKP/BPN rollout

**Objective:** Migrate safely per plant without silently changing history.

For each environment separately:

1. Backup current `shift_definition`, `ews.operator_shift`, and future `shift_roster` rows.
2. Preflight duplicates/missing DAY/NIGHT mapping.
3. Apply schema migrations.
4. Compare resolved shifts to legacy values.
5. Do not update historical roster rows.
6. Preview differences in future auto-generated rows.
7. User/admin approves counts.
8. Apply eligible future rows only.
9. Recompute today/future EWS snapshots after deploy.
10. Verify at shift start, mid-shift, shift end, and cross-midnight.

CKP and BPN must be signed off independently.

### Task 11: Remove runtime dependency on ews.operator_shift

**Objective:** Prevent future drift from a hidden second master.

Only after one stable release:

1. Make table read-only or rename to `operator_shift_legacy`.
2. Remove seed/update paths.
3. Keep rollback migration.
4. Drop only after no code/query/dashboard references remain.

---

## 5. Test matrix

### Backend unit/contract

- Default shift resolves.
- Exact date override wins.
- Override standard hours reaches roster snapshot.
- Existing frozen row unchanged.
- Manual row unchanged.
- Half-day precedence correct.
- Custom hours precedence correct.
- Shift lock changes shift base standard unless custom hours override exists.
- Cross-midnight expected-hours progression correct.
- Missing/duplicate DAY/NIGHT mapping fails closed.
- Inactive shift not scheduled.

### API/RBAC

- Read users can view.
- `roster_operator:write` required for shift/roster edits.
- Invalid time/hour/date rejected.
- Historical propagation rejected.
- Preview and apply counts match.

### Frontend

- One navigation entry only.
- Old route redirects.
- Effective source label Default/Override correct.
- `expected_hours=0` remains 0.
- Master save does not claim roster rows changed.
- Impact confirmation required.
- Mobile/tablet forms remain usable.
- Input labels are operator-friendly Indonesian/English consistent with existing UI.

### Live verification

At CKP shift 07:25:

- 07:24 → expected 0h.
- 07:41 → expected approximately 0.23h for an 8h standard over a 9h05 clock span.
- 16:30 → expected 8h.

At night cross-midnight:

- before start → 0h;
- after midnight → same business date and progressing;
- at end → full standard.

---

## 6. Risks and mitigations

### Risk: “Capacity” and “standard hours” are not always identical

Mitigation: validate business intent before eventual DB column rename. Phase 1 uses one operational value but displays both clock span and net standard clearly. If PPC later needs machine capacity distinct from operator target, add a separate explicitly named field then—not another hidden table now.

### Risk: existing future roster remains stale

Mitigation: impact preview + explicit safe apply. Never automatic overwrite.

### Risk: historical KPI drift

Mitigation: snapshot rows remain immutable; date overrides only affect generation/evaluation for their date. Past snapshots are not bulk recomputed without a separate approved operation.

### Risk: SHIFT-3 semantics unknown

Mitigation: `roster_shift_code=NULL` by default. Do not guess DAY/NIGHT mapping.

### Risk: permissions broaden accidentally

Mitigation: use `roster_operator` read/write gates for unified page/actions and add manifest tests. Redirect old route but do not bypass RBAC.

---

## 7. Recommended delivery sequence

1. Central resolver + mapping migration.
2. Roster generator uses `shift_definition`.
3. Unified read API.
4. Shift tab in `/ews/roster/config`.
5. Old route redirect.
6. Safe impact preview/apply.
7. Custom per-operator hours override.
8. Migrate CKP and BPN separately.
9. Remove legacy runtime reads.

Do not start by deleting `ews.operator_shift`; first remove all runtime readers and prove parity.

---

## 8. UI overhaul additions (approved scope)

### Operator Group Assignment

Replace the current search-only assignment flow with a searchable operator directory that has explicit filters and counts:

- `Unassigned` (default tab), `Group A`, `Group B`, `All`;
- name/SN search across the selected tab;
- each row shows current group and effective shift this week;
- unassigned operators are visible immediately without requiring the user to know a name;
- bulk-select and assign to A/B;
- optimistic UI with rollback on API error.

### Permanent Day/Night assignment

The existing Shift Lock form is for temporary week-based locks and its operator text input is not usable. Add a permanent rotation exception:

- assignment mode: `Follow Rotation`, `Always Day`, `Always Night`;
- searchable combobox with operator name, SN, current group, and current effective shift;
- permanent assignment stored explicitly and audited as `fixed_shift + fixed_shift_effective_from`, not represented as a fake multi-year temporary lock;
- `fixed_shift_effective_from` is forward-only (minimum today), so historical roster never changes;
- effective precedence: per-day heatmap override > temporary dated lock > permanent Always Day/Night since its effective date > A/B rotation;
- permanent assignment therefore escapes rotation but can still be intentionally overridden for a specific date/range;
- temporary lock remains available only under an Advanced/Temporary section if still needed.

### Heatmap overrides

Move daily operational overrides to `/ews/roster` heatmap:

- select one cell, drag a rectangle, or multi-select dates/operators;
- bulk action bar supports status, half-day, custom standard hours, and DAY/NIGHT per-day override;
- show a preview count before applying;
- forward-only guard for shift/hour changes; historical attendance corrections follow existing permission/audit rules;
- every cell tooltip shows base shift, effective shift, standard target, override source, attendance, and recorded hours.

### Heatmap performance

Benchmark first. Optimize the monthly endpoint so it does not run repeated/correlated work per cell:

- filter the operator/date population before joins;
- aggregate timesheet once by operator/business date;
- resolve shift definitions once per date/shift, not per row;
- add only evidence-backed indexes;
- return compact rows required by the viewport;
- avoid rebuilding large nested arrays in React on every selection/mouse move;
- memoize row/cell components and use Set/Map indexes;
- if the rendered cell count is still large, render only the visible month/table section rather than adding a new dependency.

Measured CKP baseline (September 2026):

- 2,708 roster cells, 139 scheduled operators, 20 generated dates;
- database execution 39 ms; end-to-end query 147–389 ms; payload ~396 KB;
- therefore the multi-second freeze is primarily React rerender work during drag, not a slow database plan;
- the old query also groups logged hours by operator for the whole month and repeats that monthly total on every day (example operator 11266: monthly 122.01h vs daily 8.53/9.76/9.30h);
- correct per-operator/per-business-date aggregation benchmarked at 42 ms DB execution, 128–306 ms end-to-end, ~299 KB payload;
- active operator assignment inventory: 151 active, 12 unassigned, 75 Group A, 64 Group B.

Performance acceptance on CKP representative month:

- API p95 target under 1.5 seconds;
- UI interaction after load should not block the main thread for more than 100 ms;
- selection and opening override actions should feel immediate;
- no repeated fetch for local selection changes.

### Day/Night visual distinction

Use low-contrast corporate surfaces, reserving strong colors for alerts:

- DAY: warm amber top stripe / `amber-50` selected surface / `amber-500` marker;
- NIGHT: cool indigo top stripe / `indigo-50` selected surface / `indigo-500` marker;
- OFF/leave: neutral slate;
- attendance health remains a separate compact status mark so shift color is never confused with present/absent severity;
- include `DAY`/`NIGHT` text or sun/moon icon; never rely on color alone.

### Additional implementation tasks

1. Add permanent shift assignment storage and effective-roster precedence tests.
2. Extend config API with assigned/unassigned counts and effective shift summaries.
3. Replace Shift Lock text input with an accessible searchable combobox.
4. Add per-day shift and custom-hours fields/endpoints to bulk roster updates.
5. Benchmark and optimize `getRosterMonth` before changing frontend rendering.
6. Refactor `EwsRosterPage.jsx` into testable heatmap/data-index/action components only where it reduces rerenders.
7. Add UI tests for unassigned discovery, permanent shift selection, multi-day heatmap override, and accessible Day/Night distinction.

## 9. Definition of done

- User has one obvious page for shift/roster settings.
- Start/end and standard hours come from one master.
- Date override is visible and predictable.
- Operator override types are clearly separated.
- Historical roster and audit identity remain immutable.
- Future roster propagation requires preview and explicit approval.
- EWS Adoption Labour, Roster UI, and Scheduling resolve the same shift for the same date.
- `/shift-definition` cannot create a second divergent configuration.
- CKP and BPN tests pass independently.
- No unexplained runtime `ews.operator_shift` references remain.


## Verification log (2026-09-16, CKP, read-only + rolled-back transactions)

Live controller calls against CKP inside a transaction that applied the migration and was then rolled back:

- `getRosterMonth` month=2026-09 → 200, 2,708 rows, all rows carry `shift_override`, `standard_hours_override`, `fixed_shift`;
- daily aggregation fixed: operator 16502 shows 12 distinct daily hour values (previously the monthly total was repeated on every day, e.g. 122.01h);
- `getConfig` → 151 active operators: 139 rotation, 12 unassigned (drives the new Unassigned filter default);
- exact-cell bulk update with `cells[]` → 200, `rows_updated: 2`; only the two chosen operator/date pairs changed (no Cartesian cross-contamination);
- per-day override beats permanent assignment: cell with `fixed_shift = NIGHT` returned `eff_shift = DAY`, `eff_std = 5` when a per-day override was set;
- clearing both overrides falls back to the permanent shift (`NIGHT`, 7h);
- permanent assignment: past date kept `DAY` with `fixed_shift = NULL`, future date became `NIGHT` → history protected by `fixed_shift_effective_from`;
- guards: past date → 400 "Past dates are frozen"; `standard_hours_override = 99` → 400; `shift_override = 'MID'` → 400.

Not yet done (needs approval, production write): applying the migration on CKP/BPN and restarting the API.

Frontend perf note: drag no longer stores a rectangle in React state (ref only) and cells are memoised, so pointer movement no longer re-renders all 2,708 cells; the selection appears on release.
