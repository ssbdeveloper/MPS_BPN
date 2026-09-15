# Manufacturing Order Progress Dashboard Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Pisahkan tampilan Order Progress Dashboard berdasarkan varian aplikasi; pertahankan Salvaging apa adanya dan bangun dashboard Manufacturing ber-outline `Project → Unit → SAP Operation → Sub-task`, dengan jam SAP yang benar, health, EAC, search/filter, serta preview issue/foto progress.

**Architecture:** Jadikan `OrderProgressDashboardPage.jsx` sebagai router varian tipis seperti `TIMESHEET/SelectJobPage.jsx`. Tampilan Salvaging lama dipindah tanpa perubahan perilaku. Manufacturing memakai endpoint baca baru berbasis struktur CKP (`ms_project*`, canonical SAP operation di `sow`, progress/sub-task/history). **Fase sekarang:** actual memakai `timesheet_transaction` lokal secara eksplisit dan diberi label temporary/non-POSTED. **Fase berikutnya:** satu adapter actual-hours diganti ke AWS `sap_timesheet_staging status='POSTED'` tanpa mengubah response shape atau UI.

**Tech Stack:** React/Vite/Tailwind, Express/node-postgres, PostgreSQL CKP; AWS staging disiapkan sebagai upgrade source berikutnya; Vitest/Testing Library, Node assert-based controller test.

---

## Temuan kode dan data yang sudah diverifikasi

1. Halaman lama berada di `apps/web/src/pages/OrderProgressDashboardPage.jsx` dan dipakai bersama oleh kedua varian.
2. Endpoint lama:
   - `GET /dashboard/order-progress` — ringkasan order dari `mv_order_plan_vs_actual`.
   - `GET /dashboard/order-activity-detail/:orderNo` — operasi dari `mv_order_activity_detail`.
   - Actual lama = seluruh `timesheet_transaction` non-cancelled, **bukan hanya jam yang sudah POSTED ke SAP**.
3. Actual POSTED tersedia di AWS `sap_timesheet_staging`:
   - kunci SAP: `aufnr` (order), `vornr` (operation), `werks` (plant);
   - jam: `total_seconds / 3600`;
   - kelayakan: `status = 'POSTED'`, `posted_at` tersedia;
   - volume saat diperiksa: 3.711 bundle POSTED / 2.002,19 jam (seluruh plant dalam AWS).
4. Sumber SAP lokal untuk operasi/plan:
   - `sow.order_no + sow.operation_no`;
   - `sow.planhours` adalah hasil parse `ph3_order.standard_value`;
   - `sow.progress` nyata tersimpan dalam skala **0–100**, bukan 0–1.
5. Struktur Manufacturing:
   - `ms_project.project_name` = level Project;
   - Unit dicari dari ancestor `ms_project_task` terdekat yang `task_name ILIKE '%unit%'`, sama dengan Select Job;
   - 2.211 task aktif membawa order+operation, 2.021 punya ancestor Unit, 190 tidak punya Unit;
   - 2.211 task menghasilkan 2.210 pasangan order+operation: ada satu duplikat nyata, order `1000122723` op `460`, dipetakan ke `FAB SIDE WALL` dan `QC FAB`.
6. Progress issue/foto sudah tersedia:
   - operation: `progress_update_history`;
   - sub-task: `sow_sub_operation_progress_history`;
   - keduanya punya `issue_description`, `image_path`, `created_at`, `created_by`;
   - preview overlay sudah ada di `features/progress/primitives.jsx::HistoryCard` dan bisa dipakai ulang atau diekstrak minimal.
7. Data progress saat pemeriksaan sangat jarang diisi: `sow.progress` NULL 14.779, 0 sebanyak 239, 100 sebanyak 5, 5 sebanyak 3, 2 sebanyak 1. Dengan actual POSTED, 45 operasi punya actual tetapi progress 0; EAC mereka tidak terdefinisi sampai progress > 0.

---

## Analisis rumus yang diusulkan

Untuk satu SAP operation:

```text
Plan Hours      = sow.planhours
Actual Hours     = FASE SEKARANG: SUM(timesheet_transaction.duration)
                   FASE BERIKUT: SUM(AWS POSTED total_seconds) / 3600
Consume %       = Actual Hours / Plan Hours × 100
Target Progress = clamp(Consume %, 0, 100)
Progress %      = sow.progress (atau rollup weighted sub-task yang sudah disimpan ke sow.progress)
Gap             = Consume % - Progress %
EAC              = Actual Posted / (Progress % / 100)
EAC Variance     = EAC - Plan Hours
```

Health menurut aturan owner:

```text
RED    Gap >= 3 percentage points
YELLOW 0 < Gap < 3 percentage points
GREEN  Gap <= 0 percentage points
UNKNOWN Plan Hours <= 0 atau Progress belum tersedia untuk metrik yang butuh progress
```

### Penilaian

Rumus ini konsisten dan sederhana: bila sudah mengonsumsi 40% jam tetapi progress fisik baru 30%, gap = +10 poin dan merah. `Target Progress` secara matematis sama dengan `Consume %` bila asumsi produksi linear dipakai. Kelebihannya mudah dijelaskan kepada operator/manajemen.

Batasannya:

- Ia mengasumsikan progress linear terhadap jam. Operasi front-loaded/back-loaded bisa tampak merah walau normal.
- `EAC` tidak boleh dihitung saat progress = 0; tampilkan `—`, bukan nol/infinity.
- Saat actual = 0 dan progress > 0, EAC = 0 secara matematika tetapi menyesatkan; rekomendasi tampilkan `—` sampai actual > 0.
- `Consume %` boleh melebihi 100% agar overrun terlihat; bar visual boleh di-cap 100%, angka jangan di-cap.
- `Target Progress` sebaiknya di-cap 100% untuk bahasa “progress seharusnya”, sedangkan `Gap` memakai consume mentah agar overrun >100% tetap merah.
- Health sebaiknya memakai **percentage-point gap**, bukan persen relatif. Contoh 53% consume − 50% progress = 3 poin → merah.

Probe data nyata dengan POSTED plant 5100 menemukan 45 operasi punya actual POSTED; karena progress semuanya 0, health sementara menjadi 37 merah dan 8 kuning, sedangkan EAC belum tersedia. Keputusan owner D2=2c: progress kosong/0 dengan actual >0 adalah RED khusus `Progress belum di-update`; EAC tetap `—`.

## Rollup KPI ke ancestor — keputusan tambahan owner

Progress dan hours harus selalu terakumulasi dari child ke seluruh ancestor:

```text
Operation Progress = sow.progress
Unit Plan           = Σ Plan Hours operasi unik di Unit
Unit Actual         = Σ Actual Hours operasi unik di Unit
Unit Progress       = Σ(Plan Hours × Operation Progress) / Σ Plan Hours
Project Plan        = Σ Plan Hours operasi unik di Project
Project Actual      = Σ Actual Hours operasi unik di Project
Project Progress    = Σ(Plan Hours × Operation Progress) / Σ Plan Hours
Group Consume       = Group Actual / Group Plan × 100
Group Target        = min(Group Consume, 100)
Group EAC           = Group Actual / (Group Progress / 100)
Group Δ EAC         = Group EAC - Group Plan
```

- Gunakan **weighted progress berdasarkan Plan Hours**, bukan average sederhana per operation; operasi 2 jam tidak boleh setara pengaruhnya dengan operasi 200 jam.
- Operation adalah grain dedupe untuk seluruh rollup. Mapping conflict tampil sekali dan tidak boleh menggandakan plan/actual/progress.
- Sub-task → Operation sudah di-rollup backend berdasarkan `standard_hours`; dashboard membaca snapshot `sow.progress`, lalu Operation → Unit → Project menggunakan `sow.planhours`.
- Project dan Unit menampilkan Plan, Actual, Target, Progress, Consume, EAC, dan Δ EAC agregat.
- Health group tetap mengikuti keputusan 7a: **worst child health**, bukan hasil gap agregat. UI wajib berlabel `Worst operation: Red` agar tidak disalahartikan sebagai health agregat.
- Jika denominator plan valid tetapi sebagian child progress NULL, perlakukan child itu sebagai 0% untuk rollup dan tandai group `N operation(s) belum di-update`; jangan keluarkan child dari denominator karena akan menggelembungkan progress.

---

## Target UI Manufacturing

### Desktop outline table

```text
PROJECT  [worst-health badge] [summary]
  UNIT 01 [operation count]
    SAP OPERATION ROW
      Order | Op | Operation text | WC | Plan h | Posted h | Target % |
      Progress % | Consume % | Health | EAC | Δ EAC vs Plan | Evidence
      SUB-TASK ROW
        Title | Standard h | Progress | Status | Latest issue | Photo
```

- Project dan Unit berupa collapsible group row, default collapsed agar daftar besar tetap ringan.
- Operation row adalah level KPI utama; klik expand menampilkan sub-task.
- Sub-task **tidak** menampilkan Actual SAP, Consume %, EAC, atau health; jam SAP hanya sah pada level operation.
- Evidence menampilkan badge issue dan thumbnail/photo icon dari update terbaru; klik membuka modal history operation + sub-task terkait.
- Project diurutkan berdasarkan child terburuk: RED → YELLOW → GREEN → UNKNOWN; tie-break terbesar `Gap`, lalu nama project.
- Unit dan operation di dalamnya memakai urutan health yang sama; sub-task tetap `sort_order, id`.
- Mobile tidak memakai horizontal scroll: operation berubah menjadi stacked card dengan label/value; Project/Unit tetap accordion. Desktop boleh table lebar dengan sticky header/kolom identitas.
- Salvaging mempertahankan halaman lama 1:1 tanpa perubahan visual atau API.

### Toolbar

- Search server-side: project name, unit name, order number, operation number/text, workcenter, active sub-task title, dan **latest issue snapshot saja**. Jangan scan seluruh history pada setiap ketikan; full history tetap lazy saat modal dibuka.
- Date range: keputusan semantik masih diperlukan (lihat Gate D4).
- Health multi-filter: Red / Yellow / Green / Unknown.
- Refresh manual; auto-refresh lama 5 detik direkomendasikan dihapus atau dinaikkan karena endpoint akan membaca AWS + tree data.
- Footer `Showing X of Y projects`; pagination di level project agar satu project tidak terpotong antarhalaman.

---

## API contract yang diusulkan

### Endpoint baru

`GET /dashboard/manufacturing-order-progress`

Query:

```text
page=1
limit=20                  # jumlah project, bukan operation
q=
health=red,yellow,green,unknown
date_from=YYYY-MM-DD
date_to=YYYY-MM-DD
plant=5100                # server-controlled dari config, bukan input bebas UI
```

Response ringkas berbentuk tree agar UI tidak melakukan N+1 fetch:

```json
{
  "data": [
    {
      "project_id": "uuid",
      "project_name": "...",
      "plan_hours": 500,
      "actual_hours": 210,
      "progress_pct": 35,
      "target_progress_pct": 42,
      "consume_hours_pct": 42,
      "eac_hours": 600,
      "eac_variance_hours": 100,
      "health": "red",
      "health_basis": "WORST_CHILD",
      "worst_gap_pct_point": 10.2,
      "units": [
        {
          "unit_key": "task uuid atau no-unit",
          "unit_name": "UNIT 01",
          "health": "red",
          "operations": [
            {
              "idsow": 123,
              "order_no": "1000...",
              "operation_no": 160,
              "operation_text": "FINISH PAINTING",
              "workcenter": "C5100BPP",
              "plan_hours": 14,
              "actual_hours": 7.78,
              "target_progress_pct": 55.57,
              "progress_pct": 40,
              "consume_hours_pct": 55.57,
              "health": "red",
              "health_gap_pct_point": 15.57,
              "eac_hours": 19.45,
              "eac_variance_hours": 5.45,
              "latest_issue": null,
              "latest_image_path": null,
              "subtasks": []
            }
          ]
        }
      ]
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total_projects": 20 },
  "summary": { "red": 0, "yellow": 0, "green": 0, "unknown": 0 },
  "meta": {
    "actual_source": "LOCAL_TIMESHEET_TEMPORARY",
    "actual_is_posted": false,
    "actual_note": "Temporary: actual hours are local timesheet records; switch to AWS POSTED bundles in the next phase"
  }
}
```

### Query plan fase sekarang — robust dan efisien

1. `mapped_ops MATERIALIZED`: ambil task aktif yang punya canonical `sow` operation, resolve ancestor Unit terdekat dengan recursive CTE, lalu dedupe menjadi satu row per `(project_id, normalized order_no, integer operation_no)`.
2. `actual_by_op MATERIALIZED`: agregasi `timesheet_transaction` **hanya untuk pasangan dalam mapped_ops**, memakai index nyata `idx_timesheet_transaction_order_key_operation_checkin`; filter `state_flag <> 5`, `duration > 0`, dan productive order-work sesuai keputusan 3a-sementara.
3. `latest operation evidence`: `DISTINCT ON (operation_id)` hanya untuk idsow dalam page, didukung `idx_puh_operation_id` + `idx_puh_created_at`.
4. `subtasks + latest evidence`: satu bulk query hanya untuk idsow dalam current project page; tidak ada fetch per operation saat initial render.
5. Hitung metrics + ancestor rollup dengan helper murni JS setelah operasi didedupe; total maksimal saat ini kecil (20 project, 2.210 canonical operation pairs).
6. Filter search/date di CKP sebelum payload tree; sort concern dan pagination pada grain Project agar project tidak terpotong.
7. Cache response final 30–60 detik keyed by normalized filter params; manual Refresh mengirim cache-bypass atau invalidasi terkontrol.
8. Full evidence history **lazy-load saat modal dibuka** melalui endpoint history yang sudah ada; initial list hanya membawa latest issue/image. Ini menghindari payload besar dan scan history yang tidak dilihat user.

**Jangan** refresh kedua materialized view lama, jangan poll 5 detik, jangan membuat N+1 query, jangan membuat FDW/matview baru, dan jangan scan seluruh timesheet untuk setiap row.

### Adapter upgrade actual-hours

Response selalu memakai nama netral `actual_hours`. Implementasi fase sekarang adalah fungsi/query adapter lokal `loadActualHoursFromTimesheet(keys)`. Upgrade berikutnya menggantinya dengan `loadActualHoursFromAwsPosted(keys, plant)` menggunakan `sapPool`, `status='POSTED'`, `SUM(total_seconds)/3600`, tanpa perubahan komponen FE atau rumus KPI. UI saat fase sekarang wajib menampilkan note `Actual hours sementara dari timesheet lokal — belum dibatasi hanya yang sudah POSTED ke SAP`.

---

## Implementation Tasks

### Task 1: Kunci definisi KPI dan edge cases

**Objective:** Ubah keputusan D1–D9 di bawah menjadi acceptance criteria final sebelum coding.

**Files:**
- Modify plan only: `.hermes/plans/2026-09-14_094404-manufacturing-order-progress-dashboard.md`

**Verification:** Semua keputusan terjawab format `1a 2b ...`; tidak ada arti tanggal/POSTED/dedupe yang implisit.

### Task 2: Extract dan uji helper KPI murni

**Objective:** Satu sumber rumus Target, Consume, Health, EAC, dan sort priority.

**Files:**
- Create: `apps/api/utils/manufacturingProgressMetrics.js`
- Create: `apps/api/utils/manufacturingProgressMetrics.test.js`

**Failing tests:**
- plan 100, actual 40, progress 30 → target 40, consume 40, gap 10, red, EAC 133.33, variance 33.33.
- plan 100, actual 52, progress 50 → gap 2, yellow.
- plan 100, actual 50, progress 50 → gap 0, green.
- plan 100, actual 120, progress 100 → consume 120, target 100, gap 20, red, EAC 120.
- progress 0 / NULL → EAC null.
- plan 0 / NULL → consume, target, gap, EAC, variance null; health unknown.
- exact boundary gap 3 → red; exact 0 → green.

**Run:** `node --test apps/api/utils/manufacturingProgressMetrics.test.js`

**Expected:** RED before implementation, PASS after minimal helper.

### Task 3: Tambah endpoint tree Manufacturing

**Objective:** Bulk-load CKP tree + AWS POSTED actual, merge, calculate, filter, and sort.

**Files:**
- Modify: `apps/api/controllers/dashboardController.js`
- Modify: `apps/api/routes/dashboard.js`
- Create: `apps/api/controllers/manufacturingOrderProgress.test.js` (pool + sapPool stubs)

**CKP query responsibilities:**
- `ms_project` + `ms_project_task` aktif;
- ancestor Unit terdekat via recursive CTE yang sama semantiknya dengan Select Job;
- `sow` sebagai canonical SAP operation (`order_no + operation_no`) dan plan/progress;
- active `sow_sub_operation`;
- latest evidence operation dan sub-task via lateral/window (`row_number`) tanpa N+1;
- only operations that exist in SAP (`sow`/`ph3_order` contract).

**AWS query responsibilities:**
- `status='POSTED'`;
- plant-scoped;
- matching canonical order+operation;
- aggregate `total_seconds / 3600`;
- apply date predicate according to D4.

**Tests:**
- operation with pending but no posted bundle has 0 posted hours;
- leading-zero normalization (`0120` matches SAP `120`);
- posted bundle from another plant excluded;
- sub-task actual omitted;
- No Unit behavior;
- issue/image newest wins;
- duplicate mapping policy D6;
- project and operation sort RED first;
- page boundary never splits a project.

### Task 4: Pisahkan halaman berdasarkan variant

**Objective:** Salvaging tetap identik; Manufacturing punya implementation sendiri.

**Files:**
- Move/copy old UI to: `apps/web/src/pages/salvaging/OrderProgressDashboardPage.jsx`
- Create: `apps/web/src/pages/manufacturing/OrderProgressDashboardPage.jsx`
- Replace with thin router: `apps/web/src/pages/OrderProgressDashboardPage.jsx`

**Pattern:**

```jsx
return isManufacturing()
  ? <ManufacturingOrderProgressDashboardPage />
  : <SalvagingOrderProgressDashboardPage />;
```

**Test:** render wrapper under both variants and assert correct title/landmark; snapshot or semantic queries prove salvaging content unchanged.

### Task 5: Build Manufacturing toolbar and project/unit outline

**Objective:** Search, date range, health filter, pagination, collapsible project/unit groups.

**Files:**
- Modify: `apps/web/src/pages/manufacturing/OrderProgressDashboardPage.jsx`
- Create only if page crosses manageable limit: `apps/web/src/features/manufacturingProgress/HealthBadge.jsx`

**Behavior:**
- URL query params preserve filters/shareable state;
- debounced search 300–400 ms;
- abort stale requests;
- default sort fixed to concern-first (not user-overridable);
- Project/Unit default collapse;
- clear empty/error/loading states;
- desktop sticky header, mobile cards without horizontal scroll.

### Task 6: Build SAP Operation row metrics

**Objective:** Render all requested fields with clear unit/format and health explanation.

**Fields:** Order No, Operation No, Operation Text, Workcenter, Plan Hours, Actual Posted Hours, Target Progress, Progress, Consume Hours %, Health, EAC, Δ EAC vs Plan.

**Rules:**
- raw consume number may exceed 100%; bar caps visually;
- EAC/variance `—` when not computable;
- tooltip explains formulas in plain language;
- health icon has text label/aria-label, never color-only;
- Δ EAC shows `+5.4 h over plan` / `−2.1 h under plan`, not an unexplained raw number.

### Task 7: Render sub-task final outline

**Objective:** Expand an operation into its active sub-tasks without falsely allocating SAP hours.

**Fields:** Title, Standard Hours, Progress, Status, latest Issue, latest Photo.

**Explicitly omit:** Actual Posted Hours, Consume %, Target based on posted hours, Health, EAC.

**Ordering:** `sort_order ASC, id ASC`.

### Task 8: Add evidence preview and history

**Objective:** Make issue/photo entered on Progress Update visible without duplicating upload/edit logic.

**Files:**
- Reuse/extract from `apps/web/src/features/progress/primitives.jsx` only if necessary.
- Modify Manufacturing dashboard page.

**Behavior:**
- latest issue snippet + photo icon/thumbnail on row;
- click opens accessible modal;
- modal shows operation update history plus sub-task history, newest first, labeled by level;
- image opens contain-fit preview, ESC/backdrop close, alt text includes order/op/sub-task context;
- read-only: dashboard cannot edit progress/issues/photos.

### Task 9: Integration validation against real read-only data

**Objective:** Prove numbers and hierarchy, not merely render components.

**Checks:**
- Compare 5 sampled operation actuals with direct AWS `SUM(total_seconds)/3600 WHERE status='POSTED'`.
- Compare Plan Hours with `sow.planhours`/`ph3_order.standard_value`.
- Compare Progress with `sow.progress` and latest progress history.
- Verify one project with Unit hierarchy and one of the 190 No Unit tasks.
- Verify order `1000122723` op `460` according to chosen duplicate policy.
- Verify operation with progress 0 and posted actual renders EAC `—` and appropriate health/no-progress warning.
- Verify filter date semantics using one bundle just inside and outside range.
- Verify Salvaging page before/after DOM equivalence for primary table/filter labels.

**Commands:**
- `node --test apps/api/utils/manufacturingProgressMetrics.test.js apps/api/controllers/manufacturingOrderProgress.test.js`
- `cd apps/web && npx --no-install eslint src/pages/OrderProgressDashboardPage.jsx src/pages/manufacturing/OrderProgressDashboardPage.jsx src/pages/salvaging/OrderProgressDashboardPage.jsx`
- `cd apps/web && npm test -- --run`
- `cd apps/web && npm run build`
- repo gate before commit.

### Task 10: Commit discipline

**Objective:** Commit only files belonging to this feature on branch `2b` as Javanian.

**Guard:** Working tree already contains unrelated modifications. Never run `git add -A`.

**Identity:** `Javanian <teesanfajar@gmail.com>`.

**Suggested commits:**
1. `feat(order-progress): add manufacturing progress metrics and API`
2. `feat(order-progress): add project-unit operation dashboard`
3. `test(order-progress): verify SAP posted hours and health hierarchy`

---

## Files likely to change

- `apps/api/controllers/dashboardController.js`
- `apps/api/routes/dashboard.js`
- `apps/api/utils/manufacturingProgressMetrics.js` (new)
- `apps/api/utils/manufacturingProgressMetrics.test.js` (new)
- `apps/api/controllers/manufacturingOrderProgress.test.js` (new)
- `apps/web/src/pages/OrderProgressDashboardPage.jsx` (thin variant router)
- `apps/web/src/pages/salvaging/OrderProgressDashboardPage.jsx` (old UI preserved)
- `apps/web/src/pages/manufacturing/OrderProgressDashboardPage.jsx` (new)
- optional minimal components under `apps/web/src/features/manufacturingProgress/` only if needed to keep page manageable

No schema migration is expected: all required tables/columns already exist. Avoid altering old materialized views because Salvaging still depends on their current behavior.

---

## Risks and mitigations

1. **Cross-DB latency/failure:** bulk two-query merge; timeout/error state distinguishes AWS actual unavailable from zero hours. Never silently display 0 when AWS query failed.
2. **Progress mostly empty:** explicit `No progress update`; EAC remains `—`; dashboard naturally makes stale progress visible as concern.
3. **Duplicate operation mapping:** resolve via D6; never silently count one SAP actual twice in project totals.
4. **No Unit tasks (190):** resolve via D5; do not hide manufacturing process projects.
5. **Search across tree:** server-side query and project-level pagination; ensure child match keeps ancestor context.
6. **Health dominated by tiny plan hours:** show exact gap/consume and optionally add minimum-actual rule only if owner decides; do not invent smoothing.
7. **Posted source definition:** AWS is centralized and plant-scoped; never fall back silently to local timesheet actual.
8. **Existing dirty working tree:** stage exact paths only; never include unrelated SAP staging/EWS/docs changes.

---

## Decisions locked — owner 2026-09-14

`1a 2c 3a-temporary-timesheet 4a 5a 6a 7a 8a 9c 10a 11a`

- D1: Target Progress cap 100; health gap memakai Consume mentah.
- D2: actual >0 + progress kosong/0 = RED khusus `Progress belum di-update`; EAC `—`.
- D3: tujuan final semua AWS bundle POSTED; fase sekarang pakai `timesheet_transaction` dengan note eksplisit dan adapter replaceable.
- D4: filter tanggal berdasarkan overlap jadwal MS Project; actual tetap lifetime cumulative.
- D5: task tanpa ancestor Unit masuk `No Unit`.
- D6: duplicate operation masuk `Mapping Conflict`, tampil sekali, tidak double-count.
- D7: Project/Unit health = worst child; RED selalu paling atas.
- D8: latest evidence pada row + full operation/sub-task history pada modal.
- D9: icon berbeda (AlertCircle / AlertTriangle / CheckCircle), disertai label teks.
- D10: Salvaging tidak berubah.
- D11: manual refresh + cache; tidak ada auto-poll 5 detik.
- Tambahan: progress/plan/actual/target/consume/EAC selalu rollup operation → Unit → Project dengan Plan Hours-weighted progress.

## Superseded option reference (keputusan sudah dikunci; hanya audit trail)

### D1. Target Progress
- **1a (recommended):** `min(Actual Posted / Plan Hours × 100, 100)`; gap health tetap memakai Consume % mentah.
- **1b:** Target Progress boleh >100%, sama persis dengan Consume %.
- **1c:** Definisi lain.

### D2. Health saat Progress kosong/0 tetapi actual sudah POSTED
- **2a (recommended):** tetap RED/YELLOW menurut gap, tambah badge `Progress belum di-update`; EAC `—`.
- **2b:** health UNKNOWN sampai progress pertama diinput; tidak ikut antrean merah.
- **2c:** health RED khusus karena progress stale, tanpa memakai threshold 3%.

### D3. Actual Posted yang dihitung
- **3a (recommended):** semua bundle `status='POSTED'` yang punya pasangan order+operation dan plant Manufacturing.
- **3b:** hanya produktif `zconf_type IN ('M1','M2')`.
- **3c:** hanya source `TIMESHEET` (abaikan MCH_HOURS).

### D4. Arti filter tanggal
- **4a (recommended):** filter operasi berdasarkan overlap jadwal MS Project (`plan_start/plan_finish`); actual POSTED tetap kumulatif lifetime agar Consume/EAC benar.
- **4b:** filter actual menurut `posted_at`; hierarchy tetap semua project.
- **4c:** filter actual menurut tanggal kerja (`bucket_start`/`synthetic_start`), bukan tanggal posting.
- **4d:** filter dua dimensi: Schedule Date dan Posted/Work Date terpisah.

### D5. Task tanpa ancestor bernama Unit (190 task)
- **5a (recommended):** tampilkan bucket `No Unit` di bawah project.
- **5b:** letakkan langsung di bawah project tanpa group Unit.
- **5c:** sembunyikan sampai struktur MS Project diperbaiki.

### D6. Satu SAP operation dipetakan ke lebih dari satu task
Kasus nyata: order `1000122723`, op `460` → `FAB SIDE WALL` dan `QC FAB`.
- **6a (recommended):** anggap data conflict; tampilkan sekali dalam bucket `Mapping Conflict`, badge merah administratif, jangan double-count.
- **6b:** tampilkan di kedua Unit tetapi total project dedupe; raw rows tampak ganda.
- **6c:** pilih mapping task dengan `sow_id`/mapping PPC resmi; jika belum ada, fallback deterministik dan badge warning.

### D7. Sort concern
- **7a (recommended):** project = worst child health; Unit = worst operation; operation = RED→YELLOW→GREEN→UNKNOWN lalu gap terbesar.
- **7b:** project health dihitung agregat total plan/actual/progress project, bukan worst child.
- **7c:** hanya operation yang health-sorted; project/unit tetap alfabet/outline.

### D8. Preview issue/foto
- **8a (recommended):** row menampilkan latest issue/photo; modal menampilkan seluruh history operation + sub-task.
- **8b:** hanya latest evidence, tanpa full history.
- **8c:** operation evidence saja; sub-task evidence hanya terlihat di Progress Update page.

### D9. Tampilan “icon bulan”
- **9a:** maksudnya icon berbentuk bulan/moon untuk health.
- **9b (recommended jika typo “bulat”):** dot bulat merah/kuning/hijau + label teks.
- **9c:** gunakan icon berbeda per status (AlertCircle / AlertTriangle / CheckCircle).

### D10. Salvaging
- **10a (recommended):** Salvaging dipertahankan pixel/behavior-equivalent; hanya dipindah ke file varian.
- **10b:** Salvaging juga mendapat rumus/toolbar baru, tetapi tanpa Project→Unit hierarchy.

### D11. Auto refresh
- **11a (recommended):** hapus auto 5 detik; manual Refresh + cache 30–60 detik.
- **11b:** auto refresh 30 detik.
- **11c:** tetap 5 detik meski membaca AWS.

---

## Final decisions — owner 2026-09-14

- **D12 = 12a:** filter tanggal menentukan isi operation yang tampil; ringkasan Project tetap overall seluruh canonical operation project.
- **D13 = 13a + TECO override:** default active/non-TECO; filter Completed tersedia; seluruh operation pada order TECO diperlakukan Progress 100% untuk rollup/dashboard. Verified CKP: 354 order = 82 all-TECO + 272 active, 0 mixed TECO/non-TECO, jadi override per-order aman.
- **D14 = 14a:** actual sementara memakai semua `timesheet_transaction` non-cancelled (`state_flag <> 5`, duration > 0), dengan note eksplisit bahwa angka belum dibatasi POSTED SAP.

## Superseded D12–D14 option reference (audit trail)

### D12. Scope rollup saat filter tanggal aktif

Contoh filter 1–30 September dan project berjalan Juli–November.

- **12a (recommended):** filter menentukan Project/Unit/operation yang tampil, tetapi card Project `Overall Progress` tetap menghitung **seluruh canonical operation dalam project**. Tambahkan summary `Visible window` terpisah bila diperlukan. Ini paling cocok dengan permintaan “progress secara keseluruhan”.
- **12b:** semua angka Project/Unit hanya menghitung operation yang overlap tanggal filter. Lebih konsisten sebagai laporan periode, tetapi bukan overall project.
- **12c:** tampilkan dua angka sekaligus: `Overall Project` dan `Selected Window`; paling lengkap tetapi UI lebih padat dan query/response lebih besar.

### D13. Project/order selesai (TECO / progress 100)

- **13a (recommended):** default hanya aktif/non-TECO; filter `Completed` dapat menampilkan TECO/100%.
- **13b:** semua termasuk completed selalu tampil, health sort tetap berlaku.
- **13c:** completed disembunyikan permanen dari dashboard Manufacturing.

### D14. Definisi actual sementara dari timesheet_transaction

- **14a (recommended, sama dengan dashboard lama):** `state_flag <> 5`, duration >0, canonical order+operation; termasuk record yang belum divalidasi/POSTED. Note UI wajib menyebut `Temporary local hours — may include records not yet posted to SAP`.
- **14b:** hanya record tervalidasi (`validation_date IS NOT NULL` dan bukan cancelled), lebih dekat ke eligible posting tetapi masih bukan bukti POSTED.
- **14c:** seluruh non-cancelled, tetapi tampilkan dua kolom `Local Recorded` dan `Validated`; lebih transparan, UI lebih lebar.

## Acceptance criteria

- Salvaging tidak berubah secara terlihat maupun perilaku.
- Manufacturing hierarchy selalu `Project → Unit/No Unit → canonical SAP operation → sub-task`.
- Fase sekarang: Actual operation dari `timesheet_transaction` non-cancelled dan UI/meta menyatakannya sebagai sumber lokal sementara, bukan SAP POSTED.
- Kontrak `actual_hours` dan adapter query siap diganti ke AWS staging POSTED tanpa perubahan FE/rumus.
- Plan Hours, operation identity, text, workcenter berasal dari SAP (`sow/ph3_order`), bukan MS Project.
- Sub-task tidak pernah menerima atau menampilkan alokasi Actual SAP.
- Target/Consume/Health/EAC mematuhi keputusan final dan boundary test 0 serta 3 poin.
- EAC tidak menampilkan infinity/angka palsu saat progress 0/NULL.
- Project merah selalu muncul lebih dulu.
- Search/date/health filters server-side dan pagination tidak memotong project.
- Latest issue/photo dari Progress Update bisa dipreview secara read-only.
- Mobile tanpa horizontal scroll; status tidak bergantung pada warna saja.
- Semua tests/build/gate lolos; commit hanya file fitur pada branch `2b` sebagai Javanian.
