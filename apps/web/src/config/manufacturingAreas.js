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
  // AREA-18: 3 Painting (PT1-3) + 2 Blasting (BL1-2). Kode dibedakan PT vs BL biar
  // scheduler tahu painting vs blasting — bukan 'BP' seragam seperti dulu.
  { areaCode: 'AREA-18', areaName: 'Blasting & Painting', bays: ['PT1', 'PT2', 'PT3', 'BL1', 'BL2'] },
];

// Canonical blasting area code. SelectJobPage's old value was 'BLASTING'.
export const BLASTING_AREA_CODE = 'AREA-18';

/* ── Zona bay: Edge & Center ──────────────────────────────────────────────────
   Tiap bay strip di lane dibelah JALAN sungguhan jadi dua zona. Edge = sisi
   terluar (menempel dinding), Center = sisi yang menghadap aisle utama. Karena
   LANE_A di atas dan LANE_B di bawah, urutan visualnya bercermin:

     ═════════ dinding ═════════
       LANE_A  EDGE
       ──────── jalan ────────
       LANE_A  CENTER
     ═════ aisle utama ═════
       LANE_B  CENTER
       ──────── jalan ────────
       LANE_B  EDGE
     ═════════ dinding ═════════

   Pembagian ini VERTIKAL: jumlah KOLOM peta tidak berubah (tetap 38 per lane),
   yang bertambah adalah baris di dalam tiap kolom. Peta tingkat 1 tetap muat
   tanpa scroll horizontal.

   SUFIKS TANPA SPASI ('A38C', bukan 'A38 Center') disengaja. Kode ini masuk ke
   ms_project_bay_schedule.bay_codes (text[]), query `bay_codes && $1::text[]`,
   dan CSV timesheet_transaction.ms_bay_codes. Identifier berspasi mengundang
   kelas bug yang sama dengan operation_text: 91 baris prod pernah gagal cocok
   hanya karena spasi ganda. Label tampilan tetap 'A38 Center'.

   AREA-18 (Blasting & Prime) TIDAK dibagi — booth adalah ruang tertutup, bukan
   strip lantai yang dilewati jalan (keputusan owner 2026-08-04).             */

export const BAY_ZONES = [
  { key: 'EDGE', suffix: 'E', label: 'Edge' },
  { key: 'CENTER', suffix: 'C', label: 'Center' },
];

export const ZONE_BY_KEY = BAY_ZONES.reduce((acc, zone) => {
  acc[zone.key] = zone;
  return acc;
}, {});

export function isZonedArea(areaCode) {
  return areaCode !== BLASTING_AREA_CODE;
}

// Kode bay lengkap dari kode kolom + zona. Area tak berzona mengembalikan kode apa adanya.
export function bayCode(base, zoneKey) {
  const zone = ZONE_BY_KEY[zoneKey];
  return zone ? `${base}${zone.suffix}` : base;
}

// 'A38C' -> { base: 'A38', zoneKey: 'CENTER' }. Kode tak berzona -> zoneKey null.
export function splitBayCode(code) {
  const text = String(code || '').trim().toUpperCase();
  const match = /^([A-Z]{1,3}[0-9]{1,3})([CE])$/.exec(text);
  if (!match) return { base: text, zoneKey: null };
  const zone = BAY_ZONES.find((z) => z.suffix === match[2]);
  return { base: match[1], zoneKey: zone ? zone.key : null };
}

// Label manusia: 'A38C' -> 'A38 Center'. Dipakai UI, JANGAN disimpan ke database.
export function bayLabel(code) {
  const { base, zoneKey } = splitBayCode(code);
  return zoneKey ? `${base} ${ZONE_BY_KEY[zoneKey].label}` : base;
}

// Urutan zona dari ATAS ke BAWAH untuk sebuah lane. Lane bawah bercermin supaya
// Edge selalu berada di sisi dinding, bukan sekadar "yang di atas".
export function zoneOrderFor(laneLabel) {
  return laneLabel === 'bottom' ? ['CENTER', 'EDGE'] : ['EDGE', 'CENTER'];
}

// Seluruh kode bay yang sah untuk satu area (sudah berzona bila areanya berzona).
export function bayCodesOf(areaCode) {
  const area = MANUFACTURING_AREAS[areaCode];
  if (!area) return [];
  if (!isZonedArea(areaCode)) return [...area.bays];
  return area.bays.flatMap((base) => BAY_ZONES.map((zone) => bayCode(base, zone.key)));
}

// Map: areaCode -> { areaName, bays }. `bays` = kode KOLOM (tanpa zona);
// pakai bayCodesOf() kalau butuh daftar kode bay yang sebenarnya.
export const MANUFACTURING_AREAS = AREA_OPTIONS.reduce((acc, { areaCode, areaName, bays }) => {
  acc[areaCode] = { areaName, bays };
  return acc;
}, {});

// Seluruh kode bay sah di pabrik — dipakai validasi dan pengecekan drift.
export const ALL_BAY_CODES = AREA_OPTIONS.flatMap((area) => bayCodesOf(area.areaCode));

// Full area definition untuk sebuah kode, atau null. `bays` tetap kode kolom;
// `zoned` memberi tahu pemanggil apakah kolomnya perlu dibelah dua.
export function areaDef(code) {
  const area = MANUFACTURING_AREAS[code];
  if (!area) return null;
  return { areaCode: code, areaName: area.areaName, bays: area.bays, zoned: isZonedArea(code) };
}
