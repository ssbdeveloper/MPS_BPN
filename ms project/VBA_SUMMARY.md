# VBA Macro Summary — MS Project Integration (MPS SOW)

> Auto-generated technical summary. Do not edit manually.

---

## 1. Overview

| Module | Description |
|---|---|
| **createReAPI.bas** | Main module: fetches new SOW operations from the FastAPI backend, creates `.mpp` subproject files per order (from a template), links a shared resource pool, inserts subprojects into the master project, and marks synced orders as `"scheduled"` via a follow-up API call. |
| **createresource.bas** | Legacy CSV-based version of the above. Reads `.csv` files from a local folder (`D:\csv project\`), creates `.mpp` subprojects using the same template/resource pool pattern, then consolidates them into the master project. |
| **createwithrresource.bas** | Alias entry point (`CREATEUYE`) that positions the cursor in the task grid and then delegates to `ConvertAPI_To_MPP_And_Inserts2` in createReAPI. Acts as a UI-triggered launcher. |
| **senddata.bas** | Iterates all tasks in the active project and POSTs each task's plan dates and resource assignment individually to the `update-plan` endpoint (one HTTP call per task). |
| **senddatabulk.bas** | Same as senddata but batches all task plan data into a single JSON array and POSTs it to the `update-plan-bulk` endpoint in one call. Includes a `JsonEscape` helper. |
| **getdata.bas** | Pulls actual progress data from the API (`get-actual`), matches response records back to tasks by composite key (`Text1 + Text2`), and updates `PhysicalPercentComplete` and `ActualWork`. Uses the `JsonConverter` library to parse the response. |
| **getmissing2.bas** | Given a selected task, identifies all existing `codenumber` values (order_no + operation_no) for that order, POSTs them to `get-missing`, and inserts any operations missing from MS Project immediately after the last task of the same order. Sorts by `Text2` after insertion. |
| **httphelper.bas** | Shared HTTP utility module. Provides `HttpPost` (fire-and-forget via MSXML2), `HttpPostBulk` (WinHttp, no return value), and `HttpPostBulks` (WinHttp, returns response string). All variants bypass SSL validation for internal self-signed certificates. |
| **JsonConverter.bas** | Third-party library — VBA-JSON v2.3.1 by Tim Hall (MIT). Provides `ParseJson` for full JSON parsing. Used only in `getdata.bas`. |

---

## 2. MS Project Fields Used

| Field | VBA Name | Purpose |
|---|---|---|
| Task Name | `t.Name` / `Task.Name` | Operation description (`operation_text` from API) |
| Text1 | `t.Text1` | `order_no` — SAP order number; primary grouping key |
| Text2 | `t.Text2` | `operation_no` — SAP operation number; used in composite key and for sorting |
| Text3 | `t.Text3` | `ssbr_id` — internal MPS identifier for the order |
| Start | `t.Start` | Planned start date (`plan_start` from API) |
| Finish | `t.Finish` | Planned finish date (`plan_finish` from API) |
| Duration | `t.Duration` | Derived from `planhours` (stored as `Nh` hours) |
| Work | `t.Work` | `planhours × 60` (converted hours → minutes, MS Project unit) |
| Resource Names | `t.ResourceNames` | `workcenter` — SAP work center assigned as resource |
| Physical % Complete | `t.PhysicalPercentComplete` | `actual_progress × 100` from API sync |
| Actual Work | `t.ActualWork` | `actual_hours × 60` from API sync (hours → minutes) |
| Task Type | `t.Type` | Set to `pjFixedWork` for all created tasks |
| Project Title | `subProj.Title` | Composite of `order_no ssbr_id part_name` |

---

## 3. Integration Flow

### API Endpoints

| Endpoint | Method | Module | Direction | Purpose |
|---|---|---|---|---|
| `https://10.169.1.12/fastapi/sow/get-new` | POST | createReAPI | ← receive | Fetch operations with status `"new"` |
| `https://10.169.1.12/fastapi/sow/update-sync` | POST | createReAPI | → send | Mark successfully scheduled orders as `"scheduled"` |
| `https://10.169.1.12/fastapi/sow/update-plan` | POST | senddata | → send | Push plan dates per task (one call per task) |
| `https://10.169.1.12/fastapi/sow/update-plan-bulk` | POST | senddatabulk | → send | Push all plan dates in one batched call |
| `https://10.169.1.12/fastapi/sow/get-actual` | POST | getdata | ← receive | Pull actual progress/hours by composite keys |
| `https://10.169.1.12/fastapi/sow/get-missing` | POST | getmissing2 | ← receive | Diff existing vs API operations for one order |
| `https://100.80.101.53/fastapi/sow/update-plan` | POST | senddata | → send | Alternate server target (older/parallel env) |

> **SSL:** All calls use `http.Option(4) = 13056` to suppress SSL certificate errors (self-signed internal certs).

### createReAPI — Main Flow

```
User runs ConvertAPI_To_MPP_And_Inserts2
  │
  ├─ POST get-new {"order_no": null}
  │     → Response: array of operations grouped by order_no
  │
  ├─ For each order_no:
  │   ├─ Open template (master.mpt) as new project
  │   ├─ Link resource pool (5051_RESOURCES.mpp)
  │   ├─ Insert tasks (one per operation_no)
  │   ├─ Save as D:\mpp\<order_no> <ssbr_id> <part_name>.mpp
  │   ├─ Re-open master project
  │   └─ ConsolidateProjects (insert subproject into master)
  │
  └─ POST update-sync {"order_nos": [...], "sync_status": "scheduled"}
```

### getdata — Actual Sync Flow

```
User runs SyncActualFromAPI
  │
  ├─ Collect all (Text1 + Text2) keys from active project tasks
  ├─ POST get-actual {"keys": ["order+opno", ...]}
  │     → Response: [{codenumber, actual_progress, actual_hours}, ...]
  │
  └─ Match codenumber → task, update:
        t.PhysicalPercentComplete = actual_progress × 100
        t.ActualWork = actual_hours × 60
```

### getmissing2 — Gap Detection Flow

```
User selects a task → runs SyncMissingOperations
  │
  ├─ Read Text1 (order_no) from selected task
  ├─ Collect all existing codenumbers (Text1+Text2) for that order
  ├─ POST get-missing {"order_no": "...", "codenumber": [...]}
  │     → Response: operations NOT yet in MS Project
  │
  ├─ Find last task ID for the order (within ±50 task range)
  └─ Insert missing tasks, set Text1/Text2/Work/ResourceNames
     → Sort all tasks by Text2
```

---

## 4. Key Functions / Subs

| Name | Module | Description |
|---|---|---|
| `ConvertAPI_To_MPP_And_Inserts2` | createReAPI | Main entry: fetch → create MPPs → insert into master → update sync status |
| `CREATEUYE` | createwithrresource | UI launcher: resets cursor position, then calls `ConvertAPI_To_MPP_And_Inserts2` |
| `ConvertCSV_To_MPP_And_Inserts` | createresource | CSV-based equivalent of the API flow; reads from `D:\csv project\` |
| `SendPlanToAPI` | senddata | Posts each task's plan dates to API one by one |
| `SendPlanToAPI_Bulk` | senddatabulk | Batches all task plan data into one JSON array POST |
| `SyncActualFromAPI` | getdata | Pulls actual progress from API and writes back to MS Project tasks |
| `SyncMissingOperations` | getmissing2 | Detects and inserts operations missing from MS Project for a given order |
| `HttpPost` | httphelper | Fire-and-forget POST via MSXML2 (no return value) |
| `HttpPostBulk` | httphelper | POST via WinHttp, prints response to debug, no return value |
| `HttpPostBulks` | httphelper | POST via WinHttp, returns response string; used for read operations |
| `HttpPost` (private) | createReAPI | Self-contained POST returning response string; used only within createReAPI |
| `UpdateSyncScheduled` | createReAPI | Sends batch `update-sync` call for all successfully created orders |
| `ParseNewOperations` | createReAPI | Custom JSON parser: extracts operation objects from `data` array |
| `GroupByOrderNo` | createReAPI | Groups parsed operations into a Dictionary keyed by `order_no` |
| `ExtractValueFromJSON` | createReAPI, getmissing2 | Lightweight field extractor for flat JSON objects (no library dependency) |
| `ParseAPIResponse` | getmissing2 | Parses `get-missing` response, pads `operation_no` to 4 digits |
| `CollectCodenumbers` | getmissing2 | Scans all project tasks and returns unique `Text1+Text2` keys for an order |
| `FindInsertPosition` | getmissing2 | Finds the last task ID for an order within a ±50 task window |
| `InsertMissingOperations` | getmissing2 | Uses `InsertTask`/`SetTaskField` to add missing operations; sorts by Text2 |
| `JsonEscape` | senddatabulk | Escapes backslash, quotes, and newlines for safe JSON string embedding |
| `ToDouble` | createresource | Locale-safe string-to-double conversion (handles decimal comma) |
| `JsonConverter.ParseJson` | JsonConverter | Full JSON parse (VBA-JSON v2.3.1); returns Collection/Dictionary tree |
