# Kanban Plan for Workshop Salvaging / Manufacturing

## Objective

Design a workshop kanban structure that supports:

- machine utilization monitoring
- queue and buffer visibility
- WIP visibility between processes
- bottleneck detection
- real-time component progress monitoring

This structure is intended for industrial workshop operations, not generic task-management boards.

---

## Design Principle

The kanban should be `flow-based`, not just `machine-name based` and not just `department based`.

Primary grouping should follow:

- production flow
- machine capability
- routing behavior
- workload pattern
- physical workshop area
- queue behavior

Recommended structure:

- Level-1: main production process area
- Level-2: machine capability group / work cell
- Level-3: actual machine

This gives enough visibility for supervisors and planners without making the board too noisy.

---

## 1. Level-1 Kanban Structure

Recommended main lanes:

1. `Incoming / Pre-Process`
2. `Cutting / Weld Repair`
3. `Rough Machining`
4. `Precision Machining`
5. `Surface Treatment / Coating`
6. `Inspection / Test`
7. `Packing / Ready Dispatch`

### 1. Incoming / Pre-Process

Purpose:

- receiving internal job
- disassembly or prep
- initial cleaning
- initial assessment
- workbench preparation

Typical entries from workcenter:

- Cleaning
- some bench / preparation areas

### 2. Cutting / Weld Repair

Purpose:

- cutting
- gouging
- welding
- heat treatment after weld repair

Typical entries from workcenter:

- LINCOLN DC 400 / 600
- Miller weld units
- Tig Weld
- Plasma Cutting
- PWHT

### 3. Rough Machining

Purpose:

- heavy stock removal
- conventional turning
- line boring
- heavy boring / facing

Typical entries from workcenter:

- STL Lathe
- Colchester
- Goodway
- Deckel Horizontal Lathe
- Takang
- Webster Bennet
- Ryazan
- Okuma
- Sanghai
- Shibaura
- Flange Facer
- Line Boring

### 4. Precision Machining

Purpose:

- dimensional finishing
- milling
- machining center work
- honing
- grinding
- portable machining

Typical entries from workcenter:

- DT1000
- DT3000
- Mitseiki
- GUT Milling
- Joysung Portable Milling
- Sunnen Hone
- PROTH Surface Grinding
- Rotler

### 5. Surface Treatment / Coating

Purpose:

- blasting
- plating
- spray
- polishing
- coating tank process

Typical entries from workcenter:

- Sandblast
- Brush Plating
- Cold Spray
- Metal Spray
- Polisher
- Tank

### 6. Inspection / Test

Purpose:

- QC gate
- inspection hold/release
- test verification

Typical entries from workcenter:

- QC Pre
- QC Final
- QC Post
- QC CCR
- QC Testing
- Eithel if used as inspection/test station

### 7. Packing / Ready Dispatch

Purpose:

- final painting if treated as final release stage
- packing
- dispatch readiness

Typical entries from workcenter:

- Painting
- Packing

Note:

- If painting behaves as a technical coating process in your routing, it can be placed under `Surface Treatment / Coating` instead.

---

## 2. Level-2 Structure

Within each main lane, use capability-based grouping.

### Incoming / Pre-Process

- Cleaning
- Preparation / Bench
- Initial Assessment

### Cutting / Weld Repair

- Plasma / Cutting
- Gouging
- Welding Cell
- PWHT

### Rough Machining

- Conventional Lathe
- Vertical Lathe
- Line Boring
- Horizontal Boring
- Facing

### Precision Machining

- Milling Manual
- Machining Center / CNC
- Grinding
- Honing
- Portable Machining

### Surface Treatment / Coating

- Blasting
- Plating
- Thermal Spray
- Polishing
- Coating Tank

### Inspection / Test

- QC Pre
- QC In-Process
- QC Final
- Testing

### Packing / Ready Dispatch

- Painting
- Packing
- Release

This level is the most important operational view for queue management and bottleneck detection.

---

## 3. Level-3 Structure

Level-3 should display actual machine assets.

Examples:

### Rough Machining > Conventional Lathe

- STL01
- STL02
- CLS01
- GDW01
- GDW02
- FAT03
- FAT04

### Rough Machining > Line Boring

- LBR01

### Rough Machining > Horizontal Boring

- SHB01
- SHB02
- SHB03
- SHB04

### Precision Machining > Milling Manual

- GUT01
- JYS01

### Precision Machining > Machining Center / CNC

- BBL01
- BBL03
- BBL04
- MIT01

### Surface Treatment / Coating > Thermal Spray

- MTS01
- MTS02
- CSP01

### Inspection / Test

- QCP11
- QCP21
- QCP22
- QCF31
- QCT41
- QCR01

Level-3 should be shown in drill-down view, not as the default main board.

---

## 4. Card Status Model

Recommended shop-floor status model:

1. `Buffer In`
2. `Ready`
3. `Setup`
4. `Running`
5. `Hold`
6. `Buffer Out`
7. `Transferred`
8. `Completed`

### Meaning

- `Buffer In`: job waiting in front of process
- `Ready`: all prerequisites available, waiting execution
- `Setup`: machine setup / chucking / alignment in progress
- `Running`: active processing
- `Hold`: blocked by QC, drawing, tool, material, machine, or decision
- `Buffer Out`: process finished, waiting move to next process
- `Transferred`: physically moved to next lane
- `Completed`: finished and released

### Important status flags

- Hot Job
- Overdue
- Waiting QC
- Waiting Material
- Waiting Tool
- Waiting Machine
- Machine Down
- Operator Unavailable

These flags should be visible without opening card detail.

---

## 5. UI/UX Recommendation

The UI should resemble an industrial control board or airport-style operations board, not a Trello/Jira board.

### Recommended board behavior

- large lane summary
- strong visual hierarchy
- high readability from distance
- auto refresh
- drill-down from process to group to machine

### Header section

Recommended top metrics:

- current shift
- live timestamp
- total WIP
- total queued jobs
- total running jobs
- total blocked jobs
- bottleneck now
- machine utilization

### Lane summary

Each level-1 lane should show:

- WIP count
- queue count
- running count
- blocked count
- average waiting time
- overload indicator

### Card content

Each card should display:

- component / order ID
- operation name
- current process
- current machine or target group
- queue position
- aging
- due date / priority
- planned vs actual hours
- status / block reason

### Recommended color usage

- Blue: queued / ready / buffer
- Green: running / completed process
- Amber: setup / waiting short
- Red: blocked / overdue / bottleneck
- Gray: closed / transferred / inactive

### Recommended display modes

- Supervisor mode
- Planner mode
- Big-screen monitoring mode

Supervisor mode should focus on:

- machine state
- queue
- blocked jobs
- shop-floor action

Planner mode should focus on:

- load vs capacity
- routing imbalance
- WIP between processes
- downstream bottleneck impact

Big-screen monitoring should use:

- larger font
- minimal interaction
- strong alert color
- auto refresh interval

---

## 6. Which Processes Should Be Combined

### Good to combine

- QC Pre / QC Post / QC Final / QC Testing into one main lane `Inspection / Test`
- all welding units into `Welding Cell`
- all coating-related process into `Surface Treatment / Coating`
- similar lathe families into `Conventional Lathe`
- heavy boring assets into `Boring`

### Should not be combined

- Rough Machining with Precision Machining
- Welding with Machining
- Inspection with Packing
- Surface Treatment with Inspection
- Incoming / Cleaning with QC gate

### Ambiguous/support processes

These should not dominate the main structure:

- Workbench
- Giant Workbench
- PPC
- Packing admin-like support areas

They should be treated as support areas or exception flow unless they truly act as production bottlenecks.

---

## 7. Scalability Structure

To support future machine growth, do not hardcode layout by machine list.

Recommended master mapping structure:

- `machineid`
- `workcenternew`
- `workcenter_description`
- `level1_process_area`
- `level2_machine_group`
- `level3_machine_name`
- `sequence_order`
- `physical_zone`
- `is_capacity_constraint`
- `default_buffer_limit`
- `active_flag`

With this structure:

- new machine can be added without redesigning board
- lane behavior remains stable
- aggregation remains consistent
- queue metrics remain comparable over time

---

## 8. Practical Initial Mapping Recommendation

Recommended implementation starting point:

- `Incoming / Pre-Process`
  - Cleaning
  - Preparation

- `Cutting / Weld Repair`
  - Plasma
  - Gouging
  - Welding
  - PWHT

- `Rough Machining`
  - Lathe
  - Vertical Lathe
  - Line Boring
  - Horizontal Boring
  - Facing

- `Precision Machining`
  - Milling
  - Machining Center
  - Grinding
  - Honing
  - Portable Machining

- `Surface Treatment / Coating`
  - Blasting
  - Plating
  - Thermal Spray
  - Polishing
  - Tank Coating

- `Inspection / Test`
  - QC Pre
  - QC In-Process
  - QC Final
  - Testing

- `Packing / Ready Dispatch`
  - Painting
  - Packing

This is a realistic starting structure for workshop salvaging/manufacturing.

---

## 9. Key Operational Metrics

To make the kanban actually useful, prioritize these metrics:

- queue count per level-2 group
- queue aging oldest item
- running vs available machine count
- blocked card count by reason
- WIP between level-1 lanes
- load vs capacity by group
- machine utilization by shift
- output per shift

Without these, the board will become only a display board, not a decision-support board.

---

## Final Recommendation

Use a `flow-based, 3-level kanban`:

- Level-1 for process area
- Level-2 for capability group
- Level-3 for actual machine

Keep the board optimized for:

- supervisor action
- planner visibility
- bottleneck detection
- queue control
- WIP control

Do not model it like a software ticket board. Model it like a production control board.
