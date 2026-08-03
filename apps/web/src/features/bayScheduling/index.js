// features/bayScheduling — peta reservasi bay dua tingkat (D5) + pool order (D6).
//
// Satu konsumen: pages/PPC/manufacturing/SchedulingAreaPage.jsx, yang setelah
// pemecahan ini tinggal jadi orkestrator (state terpilih + submit + toast).
//
// Pembagian tanggung jawab:
//   constants.js             topologi lantai, status/jenis booking, helper tanggal,
//                            dedupe reservasi, dan filter kursor tanggal (A-08)
//   useBaySchedules.js       fetch reservasi + kursor tanggal + Map bay -> reservasi
//   useSowOrders.js          pool order: tab, pencarian ter-debounce, paginasi
//   FloorMapOverview.jsx     tingkat 1 — seluruh bay, fit-width, isi sel angka saja
//   BayAreaDetail.jsx        tingkat 2 — satu area, badge kaya, drop-zone drag & drop
//   OrderPanel.jsx           daftar order yang bisa ditarik ke bay
//   ReservationPanel.jsx     form reservasi (mode ORDER & NONJOB)
//   ReservationDetailModal   detail + pembatalan satu reservasi

export {
  // Topologi
  LANE_A,
  LANE_B,
  BLASTING_AREA,
  ALL_AREAS,
  AREA_BY_CODE,
  WAREHOUSE_BAYS,
  // Status & jenis booking
  RESERVATION_STATUS,
  BOOKING_TYPES,
  NONJOB_BOOKING_TYPES,
  statusStyle,
  bookingTypeOf,
  isNonJob,
  // Tanggal & angka
  todayText,
  addDaysText,
  formatDate,
  formatHours,
  dateKey,
  // Kursor tanggal & pengelompokan reservasi
  isActiveOn,
  buildSchedulesByBay,
  groupKeyOf,
  dedupeByGroup,
  // Order yatim (D7) & aksen visual
  orderKeyOf,
  isUnknownOrder,
  areaDot,
} from './constants';

export { default as useBaySchedules } from './useBaySchedules';
export { default as useSowOrders, ORDER_TABS, DEFAULT_ORDER_TAB } from './useSowOrders';
export { default as useDialogA11y, FOCUSABLE } from './useDialogA11y';

export { default as FloorMapOverview } from './FloorMapOverview';
export { default as BayAreaDetail } from './BayAreaDetail';
export { default as OrderPanel } from './OrderPanel';
export { default as ReservationPanel } from './ReservationPanel';
export { default as ReservationDetailModal } from './ReservationDetailModal';
