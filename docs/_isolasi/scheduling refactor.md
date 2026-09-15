# Codex Revision Task: Simplify Daily Scheduling Feature

## 1. Problem

The current implementation is too complex and difficult to use.

Please simplify the feature.

The main focus right now is:

```text
Create a simple daily schedule with basic machine capacity.
````

Do not focus too much on advanced reporting, complex tables, complex dashboards, or overly detailed UI.

---

## 2. Main Goal

Refactor the Daily Scheduling feature to be simpler, clearer, and easier to use.

The page should mainly support:

1. View SOW activity list
2. Search SOW activities
3. Drag SOW activity into machine schedule
4. Schedule by machine, shift, and overtime
5. Show simple capacity usage
6. Show planned and unplanned hours
7. Request and approve overtime in a visible and simple way

---

## 3. Current Issues to Fix

### 3.1 SOW List Issue

The SOW list does not show all records.

Please check why not all SOW activities are displayed.

Fix the issue so users can properly browse SOW activities.

Also add a search/filter column or search input.

Search should support at least:

* Production order
* Operation
* SSBR ID
* Workcenter
* Part name if available
* Machine if available

Expected UI:

```text
[Search SOW activity...]
```

The search must be visible and easy to use.

---

### 3.2 Overtime Approval Panel Issue

The overtime approval section is currently hidden or overlapped by another panel.

Fix the layout so overtime approval is always visible.

Do not allow panels to overlap each other.

The overtime approval panel can be placed on the right side or bottom section.

Make it simple:

```text
Pending Overtime
- Activity
- Machine
- Date
- Time
- Hours
- Note
- Approve button
- Reject button
```

Only supervisor users should see approve/reject actions.

---

### 3.3 UI Too Complex

Remove or hide tables that are too complex for the current version.

The current page should not feel like a complicated reporting dashboard.

Focus on the daily scheduling workflow only.

Do not show too many technical columns.

Only show important information needed by the user.

---

## 4. New Simplified Layout

Use this simpler layout.

### Left Panel — SOW Activity List

Show SOW activities as a searchable list or cards.

Each item should show:

* Production order
* Operation
* SSBR ID
* Workcenter
* Plan hours
* Remaining hours

User can drag an item from this list into a machine card.

Add search input at the top.

Example:

```text
Left Panel:
[Search SOW...]

SOW Activity Card
Production Order: 123456
Operation: 0020
Plan Hours: 8
Remaining: 8
```

---

### Center Panel — Machine Cards

The center area should show all machines as cards.

Each machine is one card.

Example:

```text
Machine A
Capacity: 8 hours
Used: 3 hours
Remaining: 5 hours

[Shift 1 Drop Zone]
[Shift 2 Drop Zone]
[Overtime Drop Zone]
```

Each machine card must have 3 simple drop zones:

1. Shift 1
2. Shift 2
3. Overtime

Do not use complicated nested tables.

Do not use complex schedule grids for now.

The goal is to make daily scheduling simple.

---

### Right Panel — Summary and Overtime Approval

Use the right panel for simple summary and approval.

Show:

* Selected date
* Total planned hours
* Total remaining capacity
* Pending overtime approval
* Approved overtime

Overtime approval must be clearly visible and not overlapped.

---

## 5. Scheduling Behavior

When user drops a SOW activity into:

### Shift 1 or Shift 2

Ask or allow user to input:

* Planned hours
* Note optional

Then reduce machine capacity based on planned hours.

Example:

```text
Machine capacity = 8 hours
Dropped activity = 3 hours
Remaining capacity = 5 hours
```

If planned hours exceed remaining capacity:

```text
Show warning:
"Planned hours exceed remaining capacity."
```

For now, keep the logic simple.

Do not create overly complex auto-splitting UI unless already implemented cleanly.

---

### Overtime Drop Zone

When user drops activity into overtime zone, show simple overtime request form:

* Start time
* End time
* Overtime hours
* Note

Save as overtime request with status:

```text
PENDING
```

Supervisor can approve it from the same page.

---

## 6. Capacity Requirement

For this revision, use simple capacity display.

Each machine card should show:

* Capacity
* Used
* Remaining

Formula:

```text
Remaining = Capacity - Used
```

Do not overcomplicate capacity calculation in frontend.

If backend already supports advanced capacity, keep it in backend but show only simple values in UI.

---

## 7. What to Remove or Simplify

Remove, hide, or postpone:

* Complex reporting table
* Complex dashboard table
* Too many technical columns
* Complicated split schedule table
* Overly nested panels
* UI sections that overlap
* Any feature that makes daily scheduling difficult to understand

Keep only what is needed for:

```text
Daily schedule by machine + shift + overtime
```

---

## 8. Frontend Priority

Focus on desktop layout only.

Mobile responsiveness is not required for this page.

The UI should be clean for desktop users.

Recommended layout:

```text
Left: SOW list
Center: Machine cards with Shift 1, Shift 2, Overtime drop zones
Right: Summary and overtime approval
```

---

## 9. Acceptance Criteria

The revision is complete when:

1. SOW list shows records correctly
2. SOW list has visible search input
3. User can drag SOW activity into machine card
4. Each machine card has Shift 1, Shift 2, and Overtime drop zones
5. Machine capacity is shown simply
6. Used and remaining capacity are easy to understand
7. Overtime request can be created from overtime drop zone
8. Overtime approval panel is visible and not overlapped
9. Complex tables are removed or hidden
10. The page feels simpler and easier to use
11. The main workflow is daily scheduling, not reporting dashboard

---

## 10. Do Not Do

Do not make the UI more complex.

Do not add more dashboard tables for now.

Do not hide the SOW search.

Do not let overtime approval overlap with other panels.

Do not treat this page as a full reporting dashboard.

Do not prioritize mobile layout.

Do not rewrite unrelated features.

---

## 11. Final Output Required

After changes, explain:

1. What UI components were simplified
2. Why the SOW list was not showing all records
3. How the SOW search works
4. How the new machine card drop zones work
5. How overtime approval visibility was fixed
6. What complex tables were removed or hidden
7. Any remaining limitation

```

