// Single source of truth for the manufacturing (Cikupa) area <-> bay topology.
//
// Both the PPC bay-reservation map (SchedulingAreaPage) and the timesheet
// job-selection filter (manufacturing SelectJobPage) derive their area/bay
// lists from here so the codes can no longer drift.
//
// The canonical blasting code is 'AREA-18' (what SchedulingAreaPage already
// writes to ms_project_bay_schedule.area_code). SelectJobPage historically used
// 'BLASTING', which never matched those reservation rows — that was the blasting
// bug. Keeping one canonical code here permanently fixes it.

// Ordered list = layout order left-to-right. Each entry is the FULL area
// definition; layout-only metadata (lane, road markers, warehouse, top/bottom
// label) lives in the pages that render the map, not here.
export const AREA_OPTIONS = [
  { areaCode: 'AREA-01', areaName: 'Area 1',  bays: ['A38', 'A37', 'A36', 'A35'] },
  { areaCode: 'AREA-02', areaName: 'Area 2',  bays: ['A34', 'A33', 'A32'] },
  { areaCode: 'AREA-03', areaName: 'Area 3',  bays: ['A30', 'A29', 'A28', 'A27'] },
  { areaCode: 'AREA-04', areaName: 'Area 4',  bays: ['A26', 'A25', 'A24', 'A23'] },
  { areaCode: 'AREA-05', areaName: 'Area 5',  bays: ['A22', 'A21', 'A20', 'A19'] },
  { areaCode: 'AREA-06', areaName: 'Area 6',  bays: ['A18', 'A17', 'A16', 'A15'] },
  { areaCode: 'AREA-07', areaName: 'Area 7',  bays: ['A14', 'A13', 'A12', 'A11'] },
  { areaCode: 'AREA-08', areaName: 'Area 8',  bays: ['A9', 'A8', 'A7', 'A6'] },
  { areaCode: 'AREA-09', areaName: 'Area 9',  bays: ['A5', 'A4', 'A3', 'A2'] },
  { areaCode: 'AREA-10', areaName: 'Area 10', bays: ['A1'] },
  { areaCode: 'AREA-11', areaName: 'Area 11', bays: ['B38', 'B37', 'B36', 'B35'] },
  { areaCode: 'AREA-12', areaName: 'Area 12', bays: ['B34', 'B33', 'B32'] },
  { areaCode: 'AREA-13', areaName: 'Area 13', bays: ['B30', 'B29', 'B28', 'B27'] },
  { areaCode: 'AREA-14', areaName: 'Area 14', bays: ['B26', 'B25', 'B24', 'B23'] },
  { areaCode: 'AREA-15', areaName: 'Area 15', bays: ['B22', 'B21', 'B20', 'B19'] },
  { areaCode: 'AREA-16', areaName: 'Area 16', bays: ['B17', 'B16', 'B15', 'B14'] },
  { areaCode: 'AREA-17', areaName: 'Area 17', bays: ['B13', 'B12', 'B11', 'B10'] },
  { areaCode: 'AREA-18', areaName: 'Blasting & Prime', bays: ['BP4', 'BP3', 'BP2', 'BP1'] },
];

// Map: areaCode -> { areaName, bays }. Derived from AREA_OPTIONS.
export const MANUFACTURING_AREAS = AREA_OPTIONS.reduce((acc, { areaCode, areaName, bays }) => {
  acc[areaCode] = { areaName, bays };
  return acc;
}, {});

// Canonical blasting area code. SelectJobPage's old value was 'BLASTING'.
export const BLASTING_AREA_CODE = 'AREA-18';

// Full area definition ({ areaCode, areaName, bays }) for a code, or null.
export function areaDef(code) {
  const area = MANUFACTURING_AREAS[code];
  if (!area) return null;
  return { areaCode: code, areaName: area.areaName, bays: area.bays };
}
