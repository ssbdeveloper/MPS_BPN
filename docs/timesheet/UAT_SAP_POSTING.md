---
status: approved
tags: [uat, timesheet, sap]
---

# UAT Scenarios — Timesheet Validation: SAP Posting

> Diselamatkan dari arsip 2026-07-11 (file lama `Untitled.md`; referensi halaman "V2"
> diperbaiki — halaman aktif: `TimesheetValidationPage.jsx`).

**Module:** Timesheet Validation — SAP Inbound Post

**Feature:** `POST /timesheet/post-to-sap`

**Prepared by:** ___________________

**Test Date:** ___________________

**Environment:** ___________________

  

---

  

## Quick Reference

  

| ID       | Title                                       | Status             |
| -------- | ------------------------------------------- | ------------------ |
| UAT-001  | Happy Path — Successful SAP Post            | [ ] Pass [ ] Fail  |
| UAT-002  | TECO Order Rejection                        | [ ] Pass [ ] Fail  |
| UAT-003  | Invalid Time Range                          | [ ] Pass [ ] Fail  |
| UAT-004  | Wrong Workcenter                            | [ ] Pass [ ] Fail  |
| UAT-005  | Wrong Serial Number (SN)                    | [ ] Pass [ ] Fail  |
| UAT-006  | Duplicate Confirmation (Re-post)            | [ ] Pass [ ] Fail  |
| UAT-007  | Unproductive Entry                          | [ ] Pass [ ] Fail  |
| UAT-008  | Overtime Workcenter (ends with "OT")        | [ ] Pass [ ] Fail  |
| UAT-009  | Operation No > 5000 → ZCONF_TYPE = RW       | [ ] Pass [ ] Fail  |
| UAT-010  | Missing or Inactive Order in SAP            | [ ] Pass [ ] Fail  |
| UAT-011  | SAP System Unreachable                      | [ ] Pass [ ] Fail  |
| UAT-012  | Partial Batch — Mixed Valid and Invalid     | [ ] Pass [ ] Fail  |

  

---

  

## Scenarios

  

---

  

### UAT-001 — Happy Path: Successful SAP Post

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-001 |

| **Title** | Happy Path — valid timesheet posted successfully to SAP |

| **Precondition** | - A timesheet record exists with `state_flag = 2` (Validated) <br> - `order_no` is active in SAP <br> - `operation_no` matches the operation assigned to the workcenter in SAP <br> - `serialnumber` is a valid, active SAP employee number <br> - `longdate_checkin` and `longdate_checkout` are within a valid window <br> - `activitytype` is NULL (productive) |

| **Steps** | 1. Log in to the validation page <br> 2. Locate the validated timesheet record <br> 3. Click **Post to SAP** for the record <br> 4. Observe the response |

| **Expected SAP Response** | `STATUS: "S"` <br> `MESSAGE: "Confirmation of order XXXXXXXXXXXX saved"` |

| **Expected System Behavior** | - Record remains at `state_flag = 2` <br> - UI shows a success indicator for the record <br> - `successCount` increments by 1 <br> - Log entry in `log_timesheet_sap` shows `SUCCESS : Confirmation of order ... saved` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-002 — TECO Order Rejection

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-002 |

| **Title** | Posting to a technically completed (TECO) order is rejected by SAP |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - The `order_no` in the record has been set to TECO status in SAP |

| **Steps** | 1. Locate the validated timesheet record whose order is TECO <br> 2. Click **Post to SAP** <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains wording such as "Order ... has status TECO" or similar SAP rejection message |

| **Expected System Behavior** | - Record `state_flag` is reverted to `3` (SAP Reject) <br> - `validation_date` is cleared <br> - UI shows a failure/reject indicator for the record <br> - A retry button becomes visible <br> - `failCount` increments by 1 <br> - Log entry shows `ERROR : <SAP message>` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-003 — Invalid Time Range

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-003 |

| **Title** | SAP rejects posting when the time range is outside the allowed operation window |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - The `longdate_checkin` or `longdate_checkout` falls outside the allowed confirmation window in SAP (e.g., date is in the future, or exceeds the posting period) |

| **Steps** | 1. Locate the validated timesheet with an out-of-range timestamp <br> 2. Click **Post to SAP** <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains wording such as "Date ... is in the future" or "Posting period not open" |

| **Expected System Behavior** | - Record `state_flag` reverts to `3` <br> - `validation_date` is cleared <br> - Retry button shown <br> - `failCount` increments by 1 <br> - Log shows `ERROR : <SAP message>` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-004 — Wrong Workcenter

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-004 |

| **Title** | SAP rejects posting when the workcenter does not match the operation's assigned workcenter |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - The `workcentercode` in the record does not match the workcenter assigned to `operation_no` in SAP |

| **Steps** | 1. Locate the timesheet record with a mismatched workcenter <br> 2. Click **Post to SAP** <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains workcenter mismatch or invalid work center error |

| **Expected System Behavior** | - Record `state_flag` reverts to `3` <br> - `validation_date` is cleared <br> - Retry button shown <br> - `failCount` increments by 1 <br> - Log shows `ERROR : <SAP message>` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-005 — Wrong Serial Number (SN)

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-005 |

| **Title** | SAP rejects posting when the employee serial number is invalid or unassigned |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - The `serialnumber` (PERNR) does not exist in SAP, is inactive, or is not authorized for the operation |

| **Steps** | 1. Locate the timesheet record with the invalid SN <br> 2. Click **Post to SAP** <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains employee/PERNR not found or not authorized |

| **Expected System Behavior** | - Record `state_flag` reverts to `3` <br> - `validation_date` is cleared <br> - Retry button shown <br> - `failCount` increments by 1 <br> - Log shows `ERROR : <SAP message>` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-006 — Duplicate Confirmation (Re-post)

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-006 |

| **Title** | SAP rejects a timesheet that has already been successfully posted |

| **Precondition** | - A timesheet record has already been successfully posted to SAP (UAT-001 completed) <br> - The record still has `state_flag = 2` |

| **Steps** | 1. Locate the previously successful timesheet record <br> 2. Click **Post to SAP** again <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains "already confirmed", "duplicate", or equivalent rejection |

| **Expected System Behavior** | - Record `state_flag` reverts to `3` <br> - `validation_date` is cleared <br> - Retry button shown <br> - Log records the duplicate error <br> - `failCount` increments by 1 |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-007 — Unproductive Entry

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-007 |

| **Title** | Unproductive timesheet sends correct payload to SAP (RUECK, AUFNR, VORNR empty; LSTAR filled) |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - `activitytype` is NOT NULL (e.g., `"IDLE"`, `"TRAINING"`, etc.) <br> - `order_no` may or may not be filled |

| **Steps** | 1. Locate the unproductive timesheet record <br> 2. Click **Post to SAP** <br> 3. Check the server log for the payload sent <br> 4. Observe the SAP response |

| **Expected SAP Response** | SAP processes the unproductive record and returns `STATUS: "S"` |

| **Expected System Behavior** | - Payload sent to SAP has: `RUECK = ""`, `AUFNR = ""`, `VORNR = ""`, `FLGAT = ""`, `PLNFL = ""`, `VORNR_B = ""`, `VORNR_R = ""`, `ZCONF_TYPE = ""` <br> - `LSTAR` is filled with the `activitytype` value <br> - On `STATUS = "S"`: record remains at `state_flag = 2` <br> - Log entry reflects the result |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-008 — Overtime Workcenter (ZCONF_TYPE = "OV")

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-008 |

| **Title** | Workcenter ending with "OT" results in ZCONF_TYPE = "OV" in the SAP payload |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - `activitytype` is NULL (productive) <br> - `workcentercode` ends with `"OT"` (e.g., `"WC01OT"`) |

| **Steps** | 1. Locate the timesheet record with an OT workcenter <br> 2. Click **Post to SAP** <br> 3. Check the server log for the payload sent <br> 4. Observe the SAP response |

| **Expected SAP Response** | SAP returns `STATUS: "S"` if all other fields are valid |

| **Expected System Behavior** | - Payload contains `ZCONF_TYPE = "OV"` <br> - Record remains at `state_flag = 2` on success <br> - Log entry shows `SUCCESS : ...` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-009 — Operation No > 5000 (ZCONF_TYPE = "RW")

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-009 |

| **Title** | Operation number greater than 5000 results in ZCONF_TYPE = "RW" in the SAP payload |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - `activitytype` is NULL (productive) <br> - `operation_no` > 5000 (e.g., `5010`) <br> - `workcentercode` does NOT end with `"OT"` |

| **Steps** | 1. Locate the timesheet record with `operation_no > 5000` <br> 2. Click **Post to SAP** <br> 3. Check the server log for the payload sent <br> 4. Observe the SAP response |

| **Expected SAP Response** | SAP returns `STATUS: "S"` if all other fields are valid |

| **Expected System Behavior** | - Payload contains `ZCONF_TYPE = "RW"` <br> - Payload does NOT contain `"OV"` for this record <br> - Record remains at `state_flag = 2` on success <br> - Log entry shows `SUCCESS : ...` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-010 — Missing or Inactive Order in SAP

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-010 |

| **Title** | SAP rejects posting when the production order does not exist or is inactive |

| **Precondition** | - A timesheet record exists with `state_flag = 2` <br> - The `order_no` does not exist in SAP, or the order has been deleted/locked |

| **Steps** | 1. Locate the timesheet record with a non-existent order number <br> 2. Click **Post to SAP** <br> 3. Observe the response |

| **Expected SAP Response** | `STATUS: "E"` <br> `MESSAGE:` contains "Order does not exist", "Order is locked", or equivalent |

| **Expected System Behavior** | - Record `state_flag` reverts to `3` <br> - `validation_date` is cleared <br> - Retry button shown <br> - `failCount` increments by 1 <br> - Log shows `ERROR : <SAP message>` |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-011 — SAP System Unreachable

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-011 |

| **Title** | System handles SAP downtime gracefully — state reverted and error logged |

| **Precondition** | - One or more timesheet records exist with `state_flag = 2` <br> - SAP endpoint is unreachable (network failure, SAP downtime, or wrong URL configured) |

| **Steps** | 1. Simulate SAP unavailability (e.g., disconnect network, or temporarily set a wrong `SAP_INBOUND_URL` in `.env`) <br> 2. Restart the API if `.env` was changed <br> 3. Click **Post to SAP** for a validated record <br> 4. Observe the UI and server console |

| **Expected SAP Response** | No SAP response — network/fetch error thrown |

| **Expected System Behavior** | - Record `state_flag` is set to `3` (SAP Reject) <br> - `validation_date` is cleared <br> - Retry button is shown in the UI <br> - Server console logs: `[SAP] tsnumber=XXX → ERROR: <network error message>` <br> - `failCount` increments by 1 <br> - Log entry in `log_timesheet_sap` records the error message <br> - Application does NOT crash; other records in the batch continue to be processed |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

### UAT-012 — Partial Batch: Mixed Valid and Invalid Records

  

| Field | Content |

|---|---|

| **Scenario ID** | UAT-012 |

| **Title** | Batch post with a mix of valid and invalid tsnumbers — each record processed independently |

| **Precondition** | - At least 2 timesheet records exist with `state_flag = 2` <br> - Record A: valid in all fields → expected to succeed <br> - Record B: has a known rejection condition (e.g., TECO order, future date, wrong SN) → expected to fail |

| **Steps** | 1. Select both Record A and Record B in the validation page <br> 2. Click **Post to SAP** (batch) <br> 3. Observe the per-record results and the summary counts |

| **Expected SAP Response** | - Record A: `STATUS: "S"` <br> - Record B: `STATUS: "E"` |

| **Expected System Behavior** | - Record A: remains at `state_flag = 2` <br> - Record B: reverted to `state_flag = 3`, `validation_date` cleared <br> - API response contains: `successCount: 1`, `failCount: 1` <br> - UI shows a success indicator for Record A and a failure/retry indicator for Record B <br> - Both entries are logged separately in `log_timesheet_sap` with their respective responses <br> - The batch does not stop on first failure — all records are attempted |

| **Status** | [ ] Pass / [ ] Fail |

  

---

  

## Sign-off

  

| Role | Name | Signature | Date |

|---|---|---|---|

| Tester | | | |

| Supervisor / Admin | | | |

| IT / Developer | | | |