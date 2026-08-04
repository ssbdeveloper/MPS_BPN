// features/bayScheduling/constants.js
//
// Konstanta + helper MURNI (tanpa React) untuk peta reservasi bay. Dipindah dari
// pages/PPC/manufacturing/SchedulingAreaPage.jsx supaya hook, peta tingkat 1,
// detail tingkat 2, panel order, dan modal berbagi SATU sumber kebenaran.
//
// Aturan file ini: tidak boleh meng-import React dan tidak boleh melakukan fetch.
// Semuanya deterministik dari argumen -> aman dipakai di dalam useMemo.

import { areaDef } from '../../config/manufacturingAreas';

/* ── Topologi lantai ─────────────────────────────────────────────────────────
   Nama area + daftar bay berasal dari config/manufacturingAreas.js (satu sumber
   bersama dengan SelectJobPage timesheet). Yang lokal di sini HANYA metadata
   layout: penempatan lane, spacer lorong, gudang, dan label atas/bawah.        */

const areaItem = (code, label) => ({ type: 'area', ...areaDef(code), label });

// Gudang B1-B8: KOSMETIK. Dirender sebagai blok statis, tidak bisa dipilih dan
// tidak bisa dibooking (keputusan owner). Sengaja BUKAN entri `area`.
export const WAREHOUSE_BAYS = ['B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'];

// Entri `road` adalah spacer 1 kolom supaya bay atas & bawah tetap sejajar.
// Dirender sebagai pembatas lorong tipis, bukan teks marka jalan.
export const LANE_A = [
  areaItem('AREA-01', 'top'),
  areaItem('AREA-02', 'top'),
  { type: 'road', code: 'A31', label: 'top' },
  areaItem('AREA-03', 'top'),
  areaItem('AREA-04', 'top'),
  areaItem('AREA-05', 'top'),
  areaItem('AREA-06', 'top'),
  areaItem('AREA-07', 'top'),
  { type: 'road', code: 'A10', label: 'top' },
  areaItem('AREA-08', 'top'),
  areaItem('AREA-09', 'top'),
  areaItem('AREA-10', 'top'),
];

export const LANE_B = [
  areaItem('AREA-11', 'bottom'),
  areaItem('AREA-12', 'bottom'),
  { type: 'road', code: 'B31', label: 'bottom' },
  areaItem('AREA-13', 'bottom'),
  areaItem('AREA-14', 'bottom'),
  areaItem('AREA-15', 'bottom'),
  { type: 'road', code: 'B18', label: 'bottom' },
  areaItem('AREA-16', 'bottom'),
  areaItem('AREA-17', 'bottom'),
  { type: 'road', code: 'B9', label: 'bottom' },
  { type: 'warehouse', bays: WAREHOUSE_BAYS },
];

// AREA-18 (Blasting & Prime) berdiri sendiri di samping kedua lane.
export const BLASTING_AREA = { type: 'area', ...areaDef('AREA-18'), label: 'top' };

// Seluruh area yang BISA dipilih/dibooking (gudang & lorong tidak termasuk).
export const ALL_AREAS = [...LANE_A, ...LANE_B, BLASTING_AREA].filter((item) => item.type === 'area');

// Lookup areaCode -> definisi area, untuk tingkat 2 (peta detail satu area).
export const AREA_BY_CODE = ALL_AREAS.reduce((acc, area) => {
  acc[area.areaCode] = area;
  return acc;
}, {});

/* ── Status & jenis booking ──────────────────────────────────────────────── */

// Status reservasi -> gaya pill + warna aksen bar. Warna status (amber/emerald/
// slate/red) di sini memang untuk MAKNA status, bukan seri data biasa.
export const RESERVATION_STATUS = {
  RESERVED: { label: 'Reserved', bar: '#f59e0b', pill: 'bg-amber-100 text-amber-700 border-amber-200' },
  CONFIRMED: { label: 'Confirmed', bar: '#10b981', pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  DONE: { label: 'Done', bar: '#94a3b8', pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  CANCELLED: { label: 'Cancelled', bar: '#ef4444', pill: 'bg-red-100 text-red-700 border-red-200' },
};

export function statusStyle(status) {
  return RESERVATION_STATUS[String(status || '').toUpperCase()] || RESERVATION_STATUS.RESERVED;
}

// Jenis booking (kolom `booking_type`, Fase 2). ORDER = job internal; sisanya
// booking non-job yang TIDAK punya order_no maupun task dan WAJIB punya `purpose`.
// Non-job sengaja memakai aksen slate (netral), bukan biru brand, supaya di peta
// langsung terbaca beda dari reservasi job.
export const BOOKING_TYPES = {
  ORDER: {
    code: 'ORDER',
    label: 'Job order',
    isJob: true,
    requiresPurpose: false,
    pill: 'bg-[#caf0f8] text-[#0077b6] border-[#90e0ef]',
  },
  PARKING: {
    code: 'PARKING',
    label: 'Parking',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  STORAGE: {
    code: 'STORAGE',
    label: 'Storage',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  MAINTENANCE: {
    code: 'MAINTENANCE',
    label: 'Maintenance',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  OTHER: {
    code: 'OTHER',
    label: 'Other',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

// Daftar berurutan untuk <select> mode NONJOB (ORDER sengaja tidak ikut: mode
// non-job memang tidak boleh memilih ORDER).
export const NONJOB_BOOKING_TYPES = Object.values(BOOKING_TYPES).filter((type) => !type.isJob);

// Baris warisan sebelum migrasi Fase 2 tidak punya kolom booking_type -> ORDER.
export function bookingTypeOf(schedule) {
  const code = String(schedule?.booking_type || 'ORDER').toUpperCase();
  return BOOKING_TYPES[code] || BOOKING_TYPES.OTHER;
}

export function isNonJob(schedule) {
  return !bookingTypeOf(schedule).isJob;
}

/* ── Tanggal & angka ─────────────────────────────────────────────────────────
   Semua tanggal di lapisan ini adalah STRING 'YYYY-MM-DD'. API mengirimnya
   memang sebagai string (apps/api/server.js memasang setTypeParser untuk OID
   1082/1114/1184), jadi tidak ada konversi Date di jalur data.                */

const pad2 = (value) => String(value).padStart(2, '0');

export function dateKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

function parseDateText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey(value));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

// PERBAIKAN dari versi lama di SchedulingAreaPage: dulu memakai
// `new Date().toISOString().slice(0,10)`, yang di Asia/Jakarta (UTC+7)
// mengembalikan tanggal KEMARIN untuk setiap jam sebelum 07:00 pagi — persis jam
// masuk shift. Sekarang dibaca dari komponen tanggal LOKAL.
export function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// PERBAIKAN dari versi lama: `new Date(`${t}T00:00:00`)` diparse sebagai tengah
// malam LOKAL lalu dipotong dari toISOString() (UTC) — di UTC+7 hasilnya mundur
// satu hari, sehingga addDaysText(today, 14) sebenarnya memberi 13 hari.
// Aritmetika di sini murni UTC pada nilai tanggal-saja, jadi bebas DST/zona.
export function addDaysText(dateText, days) {
  const base = parseDateText(dateText);
  if (!base) return dateKey(dateText);
  const shifted = new Date(Date.UTC(base.y, base.m - 1, base.d) + Number(days || 0) * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

// Penjamakan Inggris untuk angka yang TAMPIL. Tanpa satu helper bersama, sebagian tempat
// memberi penjaga tunggal dan sebagian tidak — di layar yang sama muncul "1 reservation"
// di sel bay dan "1 reservations" di header area. AREA-10 memang hanya punya satu bay,
// jadi kasus n === 1 bukan teori.
export function plural(count, singular, pluralForm) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : pluralForm || `${singular}s`}`;
}

export function formatDate(value) {
  if (!value) return '-';
  const text = dateKey(value);
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// Berbeda tipis dari versi lama: null / '' sekarang jadi '-', bukan '0h'.
// Number(null) dan Number('') sama-sama 0 sehingga versi lama menampilkan "0 jam"
// untuk data yang sebenarnya TIDAK ADA. Nol yang sungguhan tetap "0h".
export function formatHours(value) {
  if (value == null || value === '') return '-';
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('en-GB', { maximumFractionDigits: 2 })}h`;
}

/* ── Kursor tanggal (A-08) ───────────────────────────────────────────────── */

// Apakah reservasi mencakup tanggal kursor? Perbandingan string 'YYYY-MM-DD'
// setara dengan perbandingan kronologis, jadi tidak perlu objek Date sama sekali.
//
// Tanpa kursor -> true (jangan menyembunyikan apa pun). Reservasi tanpa kedua
// tanggal juga -> true: bay yang terpakai tidak boleh tampak kosong hanya karena
// datanya cacat (semangat yang sama dengan D7).
export function isActiveOn(schedule, dateText) {
  if (!schedule) return false;
  const cursor = dateKey(dateText);
  if (!cursor) return true;
  const start = dateKey(schedule.start_date);
  const end = dateKey(schedule.end_date);
  if (!start && !end) return true;
  const from = start || end;
  const to = end || start;
  return from <= cursor && cursor <= to;
}

/* ── Pengelompokan reservasi ─────────────────────────────────────────────── */

// Satu RESERVASI = satu `schedule_group_id` dengan N baris (satu per task).
// Baris warisan sebelum migrasi Fase 2 belum punya kolom itu -> jatuh ke kunci
// lama (order_no | bay tersortir | start | end), persis reservationKey lama.
//
// Batas fallback: dua booking NON-JOB dengan bay+tanggal identik akan bertabrakan
// karena keduanya tidak punya order_no. Itu tidak bisa terjadi dalam praktik —
// kolom booking_type dan schedule_group_id datang dari migrasi yang SAMA, jadi
// setiap baris non-job pasti sudah punya schedule_group_id.
export function groupKeyOf(schedule) {
  if (!schedule) return '';
  if (schedule.schedule_group_id) return `grp:${schedule.schedule_group_id}`;
  const bays = Array.isArray(schedule.bay_codes)
    ? [...schedule.bay_codes].sort().join('|')
    : String(schedule.bay_codes || '');
  return ['legacy', schedule.order_no ?? '', dateKey(schedule.start_date), dateKey(schedule.end_date), bays].join('__');
}

// Kolom tingkat-RESERVASI dari GET /ms-project/bay-schedules. Kolom tingkat-TASK
// (task_id, task_name, operation_no, workcenter, planhours, people_required)
// sengaja TIDAK disalin ke entri grup: menyalinnya berarti komponen bisa tanpa
// sadar menampilkan "task pertama" seolah-olah itu milik seluruh reservasi.
// Task lengkapnya ada di `entry.tasks`.
const RESERVATION_FIELDS = [
  'schedule_group_id', 'booking_type', 'purpose', 'order_no', 'project_id', 'project_name',
  'area_code', 'area_name', 'bay_codes', 'start_date', 'end_date', 'status', 'notes',
  'created_by', 'updated_by', 'created_at', 'updated_at', 'part_name', 'customer',
];

// Headcount hidup di OPERASI SOW, bukan di task: beberapa task bisa berbagi satu
// operation_no dan menjumlahkannya per task akan menghitung orang yang sama
// berkali-kali. Task tanpa operation_no dikunci ke task_id-nya sendiri.
function peopleKeyOf(task) {
  const op = task.operation_no;
  return op != null && op !== '' ? `op:${op}` : `task:${task.task_id}`;
}

// N baris jadwal -> satu entri per reservasi. Peta menampilkan SATU badge per
// reservasi, bukan satu badge per task.
export function dedupeByGroup(schedules) {
  const byKey = new Map();

  (schedules || []).forEach((row) => {
    if (!row) return;
    const key = groupKeyOf(row);
    let entry = byKey.get(key);

    if (!entry) {
      entry = {
        group_key: key,
        schedule_group_id: row.schedule_group_id || null,
        schedule_ids: [],
        tasks: [],
        task_count: 0,
        people_total: null,
      };
      RESERVATION_FIELDS.forEach((field) => { entry[field] = row[field] ?? null; });
      byKey.set(key, entry);
    } else {
      // Isi kolom yang kebetulan null di baris pertama (mis. part_name/customer
      // yang berasal dari join sow lewat task) dari baris berikutnya.
      RESERVATION_FIELDS.forEach((field) => {
        if (entry[field] == null && row[field] != null) entry[field] = row[field];
      });
    }

    if (row.schedule_id) entry.schedule_ids.push(row.schedule_id);
    if (row.task_id) {
      entry.tasks.push({
        schedule_id: row.schedule_id,
        task_id: row.task_id,
        project_id: row.project_id,
        operation_no: row.operation_no,
        task_name: row.task_name,
        workcenter: row.workcenter,
        planhours: row.planhours,
        people_required: row.people_required,
      });
    }
  });

  return [...byKey.values()].map((entry) => {
    const seen = new Set();
    let people = null;
    entry.tasks.forEach((task) => {
      const key = peopleKeyOf(task);
      if (seen.has(key)) return;
      seen.add(key);
      const value = Number(task.people_required);
      if (!Number.isFinite(value)) return;
      people = (people ?? 0) + value;
    });
    entry.task_count = entry.tasks.length;
    entry.people_total = people;
    return entry;
  });
}

// Map bayCode -> baris jadwal yang AKTIF pada tanggal kursor.
//
// Ini inti perbaikan A-08: versi lama memasukkan semua reservasi yang beririsan
// dengan window FETCH ke sel yang sama, sehingga dua reservasi BERURUTAN tampak
// menumpuk dan tak bisa dibedakan dari dua reservasi yang benar-benar barengan.
// Yang berubah di sini HANYA sumbu waktu.
//
// PENTING (lintas-agen): isi Map adalah BARIS MENTAH (satu baris per task), bukan
// entri hasil dedupe. Pengelompokan per reservasi dilakukan di tempat render lewat
// dedupeByGroup()/groupKeyOf(), karena kedua konsumen memang membutuhkan baris
// task-nya: FloorMapOverview menghitung "jumlah aktivitas" dari task_id unik dan
// BayAreaDetail menyusun badge + daftar task dari baris yang sama. Kalau Map ini
// dibuat sudah ter-dedupe, kolom tingkat-task hilang dan angka aktivitas jatuh ke
// 0 tanpa error apa pun.
export function buildSchedulesByBay(schedules, cursorDate) {
  const grouped = new Map();

  (schedules || []).forEach((row) => {
    if (!row) return;
    if (!isActiveOn(row, cursorDate)) return;
    const bays = Array.isArray(row.bay_codes) ? row.bay_codes : [];
    bays.forEach((bayCode) => {
      if (!bayCode) return;
      const list = grouped.get(bayCode);
      if (list) list.push(row);
      else grouped.set(bayCode, [row]);
    });
  });

  return grouped;
}

/* ── Order yatim (D7) ────────────────────────────────────────────────────── */

// Normalisasi nomor order agar cocok dengan `ltrim(order_no,'0')` di backend.
export function orderKeyOf(value) {
  const text = String(value ?? '').trim();
  return text.replace(/^0+/, '');
}

// D7: reservasi yang order_no-nya tidak dikenal TETAP tampil, dengan badge
// "order tidak dikenal".
//
// PERINGATAN: `GET /ms-project/bay-schedules` TIDAK mengembalikan flag apa pun
// untuk ini, jadi penilaiannya harus datang dari luar — pemanggil menyediakan
// Set berisi kunci order yang dikenal. Tanpa Set itu fungsi ini mengembalikan
// false (tidak pernah memasang badge palsu). Jangan menebak dari part_name yang
// null: baris order-level warisan juga null di situ.
export function isUnknownOrder(schedule, knownOrderKeys) {
  if (!schedule || isNonJob(schedule)) return false;
  const key = orderKeyOf(schedule.order_no);
  if (!key) return false;
  if (!knownOrderKeys || typeof knownOrderKeys.has !== 'function') return false;
  return !knownOrderKeys.has(key);
}

/* ── Aksen visual ────────────────────────────────────────────────────────── */

// Titik warna kecil per area — aksen halus, deterministik dari kode area supaya
// stabil antar-render. Semua nilai berasal dari palet biru korporat.
const AREA_DOTS = ['#90e0ef', '#48cae4', '#00b4d8'];

export function areaDot(code) {
  const text = String(code || '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i);
  return AREA_DOTS[sum % AREA_DOTS.length];
}
