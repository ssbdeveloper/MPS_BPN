// probe/floorProbe.jsx — kontrak Tahap 2 (PLAN §8) untuk layout lantai area.
//
// Kenapa probe terpisah dan bukan unit test: jsdom TIDAK menghitung layout.
// `getBoundingClientRect()` selalu 0 dan container query tidak dievaluasi sama
// sekali, jadi test vitest di FloorMapOverview.test.jsx hanya bisa membuktikan
// STRUKTUR (kelas, atribut, teks). Probe ini membuktikan GEOMETRI di mesin
// render sungguhan: tab benar-benar menyembunyikan pane, kolom tidak bertumpuk,
// dan panel menghormati rasio 71:29.
//
// Jalankan: npx vite --port 5199, lalu
//   chrome --headless=new --dump-dom --virtual-time-budget=8000 \
//          --window-size=<W>,<H> http://localhost:5199/probe/floorProbe.html

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import FloorMapOverview from '../src/features/bayScheduling/FloorMapOverview';
import {
  ALL_AREAS, BLASTING_AREA, LANE_A, LANE_B, buildSchedulesByBay,
  buildAreaReservations, groupAreaProjects,
} from '../src/features/bayScheduling/constants';
import AreaDetailPanel from '../src/features/bayScheduling/AreaDetailPanel';

const CURSOR = '2026-06-15';
const OUT = document.getElementById('out');
const errors = [];

const onError = (e) => errors.push(String(e?.message || e));
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onError);

const laneAArea = LANE_A.find((i) => i.type === 'area').areaCode;
const laneBArea = LANE_B.find((i) => i.type === 'area').areaCode;

const bayOf = (code) => ALL_AREAS.find((a) => a.areaCode === code).bays[0];

// Fixture: AR-1 + AR-2 di bay & zona yang SAMA dari Lane A -> wajib terdeteksi
// overlap. AR-3 di zona lain, AR-4 di Lane B, AR-5 di Blasting.
const SCHEDULES = [
  ['AR-1', laneAArea, `${bayOf(laneAArea)}E`, 'MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7', 'PO-77'],
  ['AR-2', laneAArea, `${bayOf(laneAArea)}E`, 'MPS - JOB INTERDIVE-2026', 'PO-88'],
  ['AR-3', laneAArea, `${bayOf(laneAArea)}C`, 'MPS - JOB INTERDIVE-2026', 'PO-99'],
  ['AR-4', laneBArea, `${bayOf(laneBArea)}E`, 'WDJ - 2x CRANE TRUCK PK41002EHC-rev4', 'PO-11'],
  ['AR-5', BLASTING_AREA.areaCode, 'PT1', 'MPS - 21 Units ISO TANK - ORICA', 'PO-22'],
].map(([id, area, bay, project, order], i) => ({
  schedule_id: i + 1,
  schedule_group_id: id,
  booking_type: 'ORDER',
  order_no: order,
  project_name: project,
  area_code: area,
  bay_codes: [bay],
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'ACTIVE',
}));

const byBay = buildSchedulesByBay(SCHEDULES, CURSOR);

const stage = document.getElementById('stage');
const root = createRoot(stage);

function paint(props, width) {
  stage.style.width = `${width}px`;
  // flushSync, bukan render(): React 18 men-commit secara asinkron, sehingga
  // pengukuran tepat setelah render() membaca DOM lama/kosong (probe pertama
  // crash 'parameter 1 is not of type Element'). flushSync memaksa commit
  // sinkron sebelum kita mengukur.
  flushSync(() => {
    root.render(
      <FloorMapOverview
        schedulesByBay={byBay}
        cursorDate={CURSOR}
        selectedAreaCode={null}
        onSelectArea={() => {}}
        orderFilter=""
        onClearFilter={() => {}}
        {...props}
      />,
    );
  });
  void stage.offsetHeight;   // paksa layout sinkron
}

// Penunggu render. rAF TIDAK dipakai: di bawah `--virtual-time-budget` headless
// callback rAF tidak pernah dipanggil (tidak ada compositor), sehingga probe
// berhenti di "running…". Timer tetap maju karena virtual time menggerakkan
// timer, dan `getBoundingClientRect()` memaksa layout sinkron — jadi tidak perlu
// menunggu paint.
const nextFrame = () => new Promise((r) => setTimeout(r, 0));
const q = (sel) => document.querySelector(sel);
const all = (sel) => [...document.querySelectorAll(sel)];
const vis = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
};
const rect = (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

// Tahap 5: panel ASLI, bukan tiruan. Rasio kolom sudah terbukti di Tahap 2;
// yang diuji sekarang adalah panel sebenarnya ikut mematuhi geometri itu dan
// tetap non-modal di mesin layout nyata.
const PANEL_AREA = LANE_A[0];
const panelGroups = groupAreaProjects(buildAreaReservations(byBay, PANEL_AREA));
const panel = (
  <AreaDetailPanel
    area={PANEL_AREA}
    groups={panelGroups}
    cursorDate={CURSOR}
    selection={{ bay: PANEL_AREA.bays[0], zone: 'EDGE' }}
    onClose={() => {}}
    onManage={() => {}}
  />
);

async function run() {
  // Mode screenshot: ?shot=0|1&w=<lebar>. Dipakai untuk BUKTI PIXEL bahwa panel
  // non-modal tidak meredupkan peta (pelajaran bug `syncScrim()` di mockup:
  // scrim lolos cek layout tapi membuat kartu tidak terbaca).
  const qs = new URLSearchParams(location.search);
  if (qs.has('shot')) {
    const width = Number(qs.get('w') || 1280);
    paint(qs.get('shot') === '1' ? { detailPanel: panel } : {}, width);
    await nextFrame();
    document.body.style.background = '#fff';
    document.getElementById('out').remove();
    document.title = 'SHOT-READY';
    return;
  }

  // ── 1440: desktop, dua kolom penuh, tab mati, panel tidak terdok ──────────
  paint({}, 1440);
  await nextFrame();

  check('1440 · tab disembunyikan', !vis(q('.floor-tabs')), `display=${getComputedStyle(q('.floor-tabs')).display}`);
  check('1440 · Blasting/Painting tampil', vis(q('[data-pane="BP"]')), JSON.stringify(rect(q('[data-pane="BP"]'))));
  check('1440 · Lane A tampil', vis(q('.lane-column[data-lane="A"]')), JSON.stringify(rect(q('.lane-column[data-lane="A"]'))));
  check('1440 · Lane B tampil', vis(q('.lane-column[data-lane="B"]')), JSON.stringify(rect(q('.lane-column[data-lane="B"]'))));

  const bp = rect(q('[data-pane="BP"]'));
  const la = rect(q('.lane-column[data-lane="A"]'));
  const lb = rect(q('.lane-column[data-lane="B"]'));
  // Anti-tumpang-tindih: kolom kiri dan kanan tidak boleh beririsan.
  check('1440 · BP tidak menumpuk Lane A', bp.x + bp.w <= la.x + 1, `bp.right=${bp.x + bp.w} laneA.x=${la.x}`);
  // Lane B WAJIB di bawah Lane A, di kolom yang sama (bug auto-placement).
  check('1440 · Lane B di kolom yang sama dengan Lane A', Math.abs(lb.x - la.x) <= 1, `laneA.x=${la.x} laneB.x=${lb.x}`);
  check('1440 · Lane B di bawah Lane A', lb.y >= la.y + la.h - 1, `laneA.bottom=${la.y + la.h} laneB.y=${lb.y}`);
  check('1440 · Lane A dan B berbagi tinggi kolom kanan', Math.abs(la.w - lb.w) <= 2 && la.h > 100 && lb.h > 100, `A=${la.w}x${la.h} B=${lb.w}x${lb.h}`);

  // ── 1280 + panel: overlay berjangkar, area kerja 71% ─────────────────────
  paint({ detailPanel: panel }, 1280);
  await nextFrame();

  const grid = q('.floor-grid');
  const detail = q('.floor-detail-pane');
  const frameRect = rect(q('.floor-frame'));
  check('1280 · panel terdok di grid lantai', vis(detail), `data-detail=${grid.getAttribute('data-detail')}`);
  const dp = rect(detail);
  const ratio = dp.w / frameRect.w;
  check('1280 · rasio panel ≈ 29% dari kontainer', Math.abs(ratio - 0.29) <= 0.04, `${(ratio * 100).toFixed(1)}% (panel ${dp.w}px, kontainer ${frameRect.w}px)`);
  check('1280 · panel TIDAK memakai .floor-pane', !detail.classList.contains('floor-pane'), detail.className);
  // Overlay >1180 (PLAN §4.4) — dan kartu lane tidak boleh tertutup panel.
  check('1280 · panel overlay, bukan kolom grid', getComputedStyle(detail).position === 'absolute', getComputedStyle(detail).position);
  // Diukur dari `.lane-grid` (kotak konten), BUKAN `.lane-column`: bounding rect
  // elemen memasukkan padding, jadi lane-column kanan tetap 1280 walau padding
  // sudah disisipkan untuk panel. Kartu ada di dalam .lane-grid.
  const laneGrid1280 = rect(q('.lane-column[data-lane="A"] .lane-grid'));
  // Padding dibaca dari `.lane-stack` — elemen yang benar-benar menerimanya di
  // >1180 (bukan `.lane-column`, yang bukan lagi anak langsung `.floor-grid`).
  const padRight = parseFloat(getComputedStyle(q('.lane-stack')).paddingRight);
  check('1280 · ruang panel disisipkan sebelum kartu', padRight > 300, `padding-right=${Math.round(padRight)}px`);
  check('1280 · kartu lane tidak tertutup panel', laneGrid1280.x + laneGrid1280.w <= dp.x + 1, `kartu.right=${laneGrid1280.x + laneGrid1280.w} panel.x=${dp.x}`);
  // CATATAN: proporsi 71:29 adalah kontrak mode TABLET BERTAB, bukan desktop.
  // Di desktop >1180 layout-nya tetap dua kolom (BP 20% + lane 80%) dengan panel
  // sebagai overlay, jadi di sini yang benar diuji adalah "kartu tidak tertutup",
  // bukan angka 71%. Angka 71% diverifikasi di 1024 di bawah.
  check('1280 · panel selebar 29% kontainer', Math.abs((dp.w / frameRect.w) - 0.29) <= 0.04, `${((dp.w / frameRect.w) * 100).toFixed(1)}%`);

  // ── Tahap 5: isi panel detail nyata (1280, panel masih terpasang) ───────
  // Kontrak §9 butir 11: footer aksi TETAP terlihat, hanya daftar yang digulir.
  const pHead = q('.detail-head');
  const pList = q('.detail-scroll');
  const pFoot = q('.detail-foot');
  check('panel · tiga bagian ada (kepala/daftar/footer)', Boolean(pHead && pList && pFoot), `${!!pHead}/${!!pList}/${!!pFoot}`);

  const listScrolls = pList && getComputedStyle(pList).overflowY === 'auto';
  check('panel · hanya DAFTAR yang digulir', listScrolls, pList ? getComputedStyle(pList).overflowY : 'tidak ada');

  // Footer harus berada DI DALAM panel, bukan terdorong keluar batas bawah.
  const pr = rect(q('.detail-panel'));
  const fr = pFoot ? rect(pFoot) : null;
  check('panel · footer aksi terlihat di dalam panel', Boolean(fr) && (fr.y + fr.h) <= (pr.y + pr.h + 1), fr ? `footer ${fr.y + fr.h} <= panel ${pr.y + pr.h}` : 'tidak ada footer');

  // NON-MODAL: peta harus tetap TERBACA dan bisa diklik saat panel terbuka
  // (§9 butir 16). Memindai elemen `position:absolute` TIDAK cukup: scrim bisa
  // berupa pseudo-element `::after` yang tak pernah terjaring querySelectorAll
  // (lubang ini nyata — assertion versi lama lulus padahal peta tertutup).
  // Uji yang benar = HIT TEST: titik di atas kartu harus mengenai kartu itu.
  // Kartu dikenali lewat `data-area` (kelas `.area-card` tidak ada di kode).
  // Ambil kartu yang BENAR-BENAR terlihat, bukan kartu lane yang sedang disembunyikan tab.
  const probeCard = all('[data-area]').filter(vis)[0];
  const cr = rect(probeCard);
  const hit = document.elementFromPoint(cr.x + cr.w / 2, cr.y + Math.min(24, cr.h / 2));
  const mapReachable = Boolean(hit) && probeCard.contains(hit);
  check(
    'panel · NON-MODAL, peta tetap terjangkau (hit test)',
    mapReachable,
    mapReachable ? 'kartu tersentuh' : `tertutup oleh .${(hit && hit.className && String(hit.className).split(' ')[0]) || '?'}`,
  );

  // Reservasi overlap harus TERDAFTAR SEMUA, bukan cuma yang pertama.
  const rowCount = document.querySelectorAll('.detail-row').length;
  check('panel · mendaftar semua reservasi sel terpilih', rowCount >= 2, `${rowCount} baris`);

  // Target sentuh tombol aksi panel.
  const actions = [...document.querySelectorAll('.detail-foot button')];
  const actionH = actions.map((b) => Math.round(b.getBoundingClientRect().height));
  check('panel · tombol aksi ≥44px', actions.length >= 2 && actionH.every((h) => h >= 44), actionH.join(',') || 'tidak ada tombol');

  // ── 1024: tablet landscape, tab otoritatif + panel TERDOK 29% ───────────
  paint({ detailPanel: panel }, 1024);
  await nextFrame();

  check('1024 · tab tampil', vis(q('.floor-tabs')), `display=${getComputedStyle(q('.floor-tabs')).display}`);
  const tabA = q('[data-lane-tab="A"]');
  const tabB = q('[data-lane-tab="B"]');
  check('1024 · target sentuh tab ≥44px', tabA.getBoundingClientRect().height >= 44, `${Math.round(tabA.getBoundingClientRect().height)}px`);

  // Tablet = panel TERDOK dalam aliran (bukan overlay).
  const dp1024 = rect(q('.floor-detail-pane'));
  const frame1024 = rect(q('.floor-frame'));
  check('1024 · panel kembali ke aliran normal', getComputedStyle(q('.floor-detail-pane')).position === 'static', getComputedStyle(q('.floor-detail-pane')).position);
  check('1024 · rasio panel ≈ 29% dari kontainer', Math.abs((dp1024.w / frame1024.w) - 0.29) <= 0.05, `${((dp1024.w / frame1024.w) * 100).toFixed(1)}%`);
  // Kontrak rasio 71:29 milik mode tablet bertab: area kerja (kartu) 71%,
  // panel zona 29%. Diukur dari .lane-grid (kotak konten) agar padding tidak
  // ikut terhitung.
  const cards1024 = rect(q('.lane-column:not([hidden]) .lane-grid'));
  check('1024 · area kerja 71% : panel 29%', Math.abs((cards1024.w / frame1024.w) - 0.71) <= 0.06, `kartu ${((cards1024.w / frame1024.w) * 100).toFixed(1)}% · panel ${((dp1024.w / frame1024.w) * 100).toFixed(1)}%`);

  // Tab otoritatif: klik B benar-benar mengubah isi lantai.
  const before = all('.lane-column').filter(vis).map((n) => n.getAttribute('data-lane'));
  tabB.click();
  await nextFrame();
  const after = all('.lane-column').filter(vis).map((n) => n.getAttribute('data-lane'));
  check('1024 · klik tab mengganti pane', before.join() === 'A' && after.join() === 'B', `sebelum=[${before}] sesudah=[${after}]`);
  check('1024 · hanya satu lane tampil', after.length === 1, `[${after}]`);
  check('1024 · BP tersembunyi saat tab B', !vis(q('[data-pane="BP"]')), getComputedStyle(q('[data-pane="BP"]')).display);

  tabA.click();
  await nextFrame();
  const backA = all('.lane-column').filter(vis).map((n) => n.getAttribute('data-lane'));
  check('1024 · kembali ke tab A', backA.join() === 'A', `[${backA}]`);

  // ── 834: tablet potret, panel jadi bottom sheet ──────────────────────────
  paint({ detailPanel: panel }, 834);
  await nextFrame();

  const g834 = rect(q('.floor-grid'));
  const sheet = rect(q('.floor-detail-pane'));
  check('834 · panel terjangkar ke bawah', sheet.y + sheet.h >= g834.y + g834.h - 2, `grid.bottom=${g834.y + g834.h} sheet.bottom=${sheet.y + sheet.h}`);
  check('834 · panel selebar kontainer', Math.abs(sheet.w - g834.w) <= 2, `panel.w=${sheet.w} grid.w=${g834.w}`);
  check('834 · panel mulai di bawah peta', sheet.y > g834.y, `grid.y=${g834.y} panel.y=${sheet.y}`);
  check('834 · panel ≤ 82% tinggi kontainer (PLAN §4.4)', sheet.h <= g834.h * 0.82 + 1, `${((sheet.h / g834.h) * 100).toFixed(1)}%`);

  // ── 402: satu kolom ──────────────────────────────────────────────────────
  paint({}, 402);
  await nextFrame();

  const cols = getComputedStyle(q('.lane-grid')).gridTemplateColumns.split(' ').filter(Boolean).length;
  check('402 · lane satu kolom', cols === 1, `${cols} kolom`);

  // ── Anti-terpotong: TIDAK ADA wadah yang memotong isi tanpa jalan keluar ──
  // Kelas bug yang lolos ke produksi: `.lane-column { overflow: hidden }` dengan
  // isi 634px di kotak 321px. Probe lama hanya memeriksa `.zone-map`/`.lane-grid`
  // sehingga 313px isi yang tak terjangkau tidak pernah terdeteksi.
  // Aturan: setiap wadah yang `overflow` hidden/clip dan isinya lebih besar HARUS
  // tetap bisa digulir (scrollTop/scrollLeft bergerak). Kalau tidak → FAIL.
  for (const [w, label] of [[1440, '1440'], [1280, '1280'], [1024, '1024'], [834, '834'], [402, '402']]) {
    paint(w === 1280 || w === 1024 || w === 834 ? { detailPanel: panel } : {}, w);
    await nextFrame();
    const boxed = [];
    all('.floor-frame *').forEach((el) => {
      if (!vis(el)) return;
      const cs = getComputedStyle(el);
      const dy = el.scrollHeight - el.clientHeight;
      const dx = el.scrollWidth - el.clientWidth;
      if ((dy > 3 || dx > 3)
        && (cs.overflow === 'hidden' || cs.overflow === 'clip'
          || cs.overflowY === 'hidden' || cs.overflowX === 'hidden')) {
        const oy = el.scrollTop; const ox = el.scrollLeft;
        el.scrollTop = 99999; el.scrollLeft = 99999;
        const canV = el.scrollTop > oy + 1; const canH = el.scrollLeft > ox + 1;
        el.scrollTop = oy; el.scrollLeft = ox;
        if ((dy > 3 && !canV) || (dx > 3 && !canH)) {
          boxed.push(`${el.className.split(' ')[0]}(dy${dy},dx${dx})`);
        }
      }
    });
    check(`${label} · tidak ada isi terpotong tanpa jalan keluar`, boxed.length === 0, boxed.slice(0, 4).join(', ') || 'bersih');
  }

  // ── Bagian lantai yang tampil memakai SELURUH tinggi yang tersedia ────────
  // Bug produksi kedua: `.lane-stack` selalu grid dua baris `1fr 1fr`, sehingga di
  // mode bertab satu lane yang tersisa hanya dapat ~50% tinggi lantai (terukur
  // 227px dari 466px di 1024px) — sisa separuh layar kosong.
  for (const w of [1024, 834, 402]) {
    // 834 dirender BERSAMA bottom sheet (panel memang menempati ≤82% tinggi),
    // jadi ambang "lane penuh" di sana adalah sisa ruang setelah sheet — bukan
    // 90%. Memaksa 90% di 834 berarti menuntut panel tidak punya tinggi sama
    // sekali; yang benar-benar dijaga: lane tidak tergencet di bawah 18%.
    const withPanel = w === 834;
    paint(withPanel ? { detailPanel: panel } : {}, w);
    await nextFrame();
    const gridH = rect(q('.floor-grid')).h;
    // 17.5%, bukan 18%: kontraknya panel ≤82%, dan sisa untuk lane masih
    // dikurangi gap grid + border 1px bottom sheet (terukur 17.91% dari 592px).
    // Ambang 18% akan menuntut gap bernilai nol — presisi palsu.
    const floor = withPanel ? 0.175 : 0.9;
    all('.lane-scroll').filter(vis).forEach((sc) => {
      const used = rect(sc).h / gridH;
      check(`${w} · lane tampil penuh tinggi (≥${Math.round(floor * 100)}% ruang lantai${withPanel ? ', panel terbuka' : ''})`, used >= floor, `${(used * 100).toFixed(2)}% dari ${Math.round(gridH)}px`);
    });
  }

  // ── Teks tidak terpotong: label tidak boleh dipangkas ellipsis ────────────
  // Nama project di kartu punya awalan sama ("MPS - ..."), jadi pemangkasan
  // menyembunyikan bagian yang membedakan. Diukur sebagai scrollWidth leaf.
  for (const w of [1440, 1024, 402]) {
    paint({}, w);
    await nextFrame();
    const cut = all('.floor-frame *')
      .filter((el) => vis(el) && el.children.length === 0 && el.clientWidth > 0
        && el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${(el.textContent || '').trim().slice(0, 22)}…(+${el.scrollWidth - el.clientWidth}px)`);
    check(`${w} · tidak ada teks dipangkas`, cut.length === 0, cut.slice(0, 4).join(', ') || 'bersih');
  }

  // ── Peta zona: sel cukup besar untuk dibaca ──────────────────────────────
  paint({}, 1440);
  await nextFrame();
  const cellH = rect(q('.zone-cell')).h;
  check('peta zona · sel ≥16px tinggi (terbaca di tablet)', cellH >= 16, `${Math.round(cellH)}px`);

  // ── Pembuktian overlap terbaca tanpa warna ───────────────────────────────
  // Jumlah overlap ada di badge amber di bawah peta (teks 11px), BUKAN di dalam
  // sel: sel hanya 16px sehingga angka di dalamnya jatuh ke 8px (tak terbaca).
  const overCells = all('.zone-cell[data-over="true"]');
  check('overlap · sel amber ada', overCells.length > 0, `${overCells.length} sel`);
  const badge = all('[data-area] p').find((p) => /Overlap/.test(p.textContent || ''));
  check('overlap · jumlah terbaca sebagai teks', !!badge && /\d+\s*zones?\s*×\s*\d+\s*reservations?/.test(badge.textContent), badge ? badge.textContent.trim() : 'badge tidak ada');
  check('overlap · diumumkan ke AT', overCells.every((c) => (c.getAttribute('aria-label') || c.title || '').length > 0), 'aria/title pada sel overlap');

  // ── Tahap 3: Blasting & Painting vertikal + pita petak bay (PLAN §4.3) ────
  // Diukur di 1440 (pane BP tampil sebagai kolom kiri, tidak bertab).
  const bpHeaders = all('[data-pane="BP"] .bp-group').filter(vis);
  check('BP · kelompok Painting lalu Blasting',
    bpHeaders.map((h) => (h.textContent || '').trim()).join('>') === 'Painting>Blasting',
    bpHeaders.map((h) => (h.textContent || '').trim()).join(' > ') || 'tidak ada header');

  const bpRows = all('[data-pane="BP"] .slot-row').filter(vis);
  check('BP · semua 5 bay AREA-18 tampil', bpRows.length === 5,
    bpRows.map((r) => r.getAttribute('data-bay')).join(',') || 'kosong');

  // Slot wajib tetap target sentuh 44px walau sudah dikelompokkan.
  const shortSlot = bpRows.filter((r) => rect(r).h < 44)
    .map((r) => `${r.getAttribute('data-bay')}=${Math.round(rect(r).h)}px`);
  check('BP · slot ≥44px (target sentuh)', shortSlot.length === 0, shortSlot.join(', ') || `${bpRows.length} slot OK`);

  // Pita petak: batang warna di ::before .slot-code harus BENAR-BENAR punya
  // lebar, bukan sekadar variabel CSS yang diset tapi tidak terlihat.
  const stripeWidths = bpRows.map((r) => {
    const code = r.querySelector('.slot-code');
    if (!code) return -1;
    const before = getComputedStyle(code, '::before');
    return parseFloat(before.width) || 0;
  });
  check('BP · pita petak bay terlihat (≥2px)',
    stripeWidths.length === 5 && stripeWidths.every((w) => w >= 2),
    stripeWidths.map((w) => `${w}px`).join(',') || 'tidak ada slot');

  // Header kelompok sticky: saat daftar digulir, header tidak boleh ikut hilang
  // dari pane (user harus tetap tahu sedang di Painting atau Blasting).
  // `length === 2` wajib ada: every() pada array kosong bernilai true, jadi tanpa
  // ini assertion lolos justru ketika headernya hilang sama sekali.
  check('BP · header kelompok sticky',
    bpHeaders.length === 2 && bpHeaders.every((h) => getComputedStyle(h).position === 'sticky'),
    `${bpHeaders.length} header: ${bpHeaders.map((h) => getComputedStyle(h).position).join(',') || 'tidak ada'}`);

  check('runtime · 0 error JS', errors.length === 0, errors.join(' | ') || 'bersih');

  // ── AUDIT tipografi & target sentuh (PLAN §5.1/§5.2) ──────────────────────
  // Dilaporkan sebagai ANGKA, bukan lulus/gagal: dipakai untuk menetapkan skala
  // berdasar ukuran yang benar-benar dipakai, bukan tebakan.
  paint({ detailPanel: panel }, 1024);
  await nextFrame();
  const fsize = (el) => Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
  const audit = [];
  // Selector memakai token skala (.t-code/.t-pname/.t-meta/.t-btn/.t-title)
  // supaya audit melaporkan peran teks yang SEBENARNYA diatur §5.2, bukan
  // menebak lewat kelas utilitas yang kebetulan mirip.
  const roles = [
    ['kode bay/area (.t-code)', '.t-code, .slot-code'],
    ['judul panel (.t-title)', '.t-title'],
    ['nama project (.t-pname)', '.t-pname'],
    ['metadata (.t-meta)', '.t-meta, .bp-group, .detail-overlap'],
    ['teks tombol (.t-btn)', '.floor-tabs button, .detail-foot button, .t-btn'],
    ['label kolom zona (di luar §5.2)', '.zone-col-label'],
  ];
  for (const [label, sel] of roles) {
    const els = all(sel).filter(vis);
    const sizes = [...new Set(els.map(fsize))].sort((a, b) => a - b);
    audit.push(`  ${label.padEnd(24)} n=${String(els.length).padStart(3)}  ${sizes.join(', ') || '-'}`);
  }
  const taps = all('button, a, input, select, [role="button"], [role="tab"]').filter(vis);
  const tooSmall = taps
    .map((el) => ({ h: Math.round(rect(el).h), cls: String(el.className || '').split(' ')[0] || el.tagName.toLowerCase(), txt: (el.textContent || '').trim().slice(0, 24) }))
    .filter((x) => x.h < 44);
  audit.push(`  target sentuh: ${taps.length} interaktif, ${tooSmall.length} di bawah 44px`);
  for (const t of tooSmall.slice(0, 12)) audit.push(`    ${String(t.h).padStart(3)}px  .${t.cls}  "${t.txt}"`);

  // ── Assertion Tahap 4: skala §5.2 dikunci ────────────────────────────────
  // Angka WAJIB ada di kontrak PLAN §5.2. Tiap peran diuji: elemennya ada
  // (length > 0 — tanpa ini, peran yang hilang lolos diam-diam) DAN semua
  // pemakainya berukuran sama persis.
  const scale = [
    ['kode bay/area 17px', '.t-code, .slot-code', 17],
    ['judul panel 19px', '.t-title', 19],
    ['nama project 14.5px', '.t-pname', 14.5],
    ['metadata 11.5px', '.t-meta, .bp-group, .detail-overlap', 11.5],
    ['teks tombol 15.5px', '.floor-tabs button, .detail-foot button, .t-btn', 15.5],
  ];
  for (const [label, sel, want] of scale) {
    const els = all(sel).filter(vis);
    const sizes = [...new Set(els.map(fsize))];
    check(`§5.2 · ${label}`,
      els.length > 0 && sizes.length === 1 && sizes[0] === want,
      `${els.length} elemen: ${sizes.join(', ') || 'tidak ada'}`);
  }

  // ── Assertion: tombol footer TIDAK boleh melar (regresi nyata) ────────────
  // Dilaporkan user pada AREA-02/AREA-12, terbukti berlaku untuk SEMUA area
  // tanpa banner overlap: `.detail-panel` memakai grid 4 baris tetap
  // (`auto auto minmax(0,1fr) auto`) padahal banner overlap dirender kondisional,
  // sehingga saat banner tidak ada, footer jatuh ke baris `1fr` dan tombolnya
  // melar setinggi sisa panel — terukur 361px. Diuji untuk SETIAP area supaya
  // bentuk panel apa pun (dengan/tanpa banner) ikut terjaga.
  const laras = [];
  for (const a of ALL_AREAS) {
    const g = groupAreaProjects(buildAreaReservations(byBay, a));
    paint({
      detailPanel: (
        <AreaDetailPanel
          area={a}
          groups={g}
          cursorDate={CURSOR}
          selection={{ bay: a.bays[0], zone: 'EDGE' }}
          onClose={() => {}}
          onManage={() => {}}
        />
      ),
    }, 1024);
    await nextFrame();
    const hs = [...document.querySelectorAll('.detail-foot button')].map((b) => Math.round(rect(b).h));
    if (hs.length !== 2 || !hs.every((h) => h >= 44 && h <= 48)) {
      laras.push(`${a.areaCode}=[${hs.join(',')}]`);
    }
  }
  check('panel · tombol footer 44px di SEMUA 18 area (tidak melar)',
    laras.length === 0,
    laras.length ? laras.join(' ') : `18 area ok, 2 tombol masing-masing 44px`);

  check('§5.1 · 0 target sentuh di bawah 44px',
    taps.length > 0 && tooSmall.length === 0,
    `${taps.length} interaktif, ${tooSmall.length} pelanggaran${tooSmall.length ? `: ${tooSmall.map((t) => `${t.h}px .${t.cls}`).join(', ')}` : ''}`);

  // ── DIAGNOSTIK: tinggi tombol "Manage reservations" untuk SETIAP area ────────
  // Keluhan user: AREA-02 & AREA-12 tombolnya terlalu tinggi. Diukur semua area
  // supaya penyebabnya terlihat (bukan menebak dari nama area).
  const footAudit = [];
  for (const a of ALL_AREAS) {
    const g = groupAreaProjects(buildAreaReservations(byBay, a));
    paint({
      detailPanel: (
        <AreaDetailPanel
          area={a}
          groups={g}
          cursorDate={CURSOR}
          selection={{ bay: a.bays[0], zone: 'EDGE' }}
          onClose={() => {}}
          onManage={() => {}}
        />
      ),
    }, 1024);
    await nextFrame();
    const btns = [...document.querySelectorAll('.detail-foot button')];
    const hs = btns.map((b) => Math.round(rect(b).h));
    const foot = q('.detail-foot');
    const over = hs.some((h) => h > 44);
    if (over || a.areaCode === 'AREA-02' || a.areaCode === 'AREA-12') {
      const anak = q('.detail-panel').children.length;
      const bannerAda = Boolean(q('.detail-overlap'));
      footAudit.push(`  ${a.areaCode.padEnd(8)} anakPanel=${anak} bannerOverlap=${bannerAda ? 'ADA' : 'TIDAK'} tinggiTombol=${hs.join(',')} tinggiFooter=${Math.round(rect(foot).h)} tinggiDaftar=${Math.round(rect(q('.detail-scroll')).h)} ${over ? '> TERLALU TINGGI' : 'ok'}`);
    }
  }
  paint({ detailPanel: panel }, 1024);
  await nextFrame();

  const failed = checks.filter((c) => !c.pass);
  const lines = [
    `PROBE LAYOUT LANTAI — ${checks.length - failed.length}/${checks.length} lulus`,
    '',
    ...checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`),
    '',
    failed.length ? `HASIL: ${failed.length} GAGAL` : 'HASIL: SEMUA LULUS',
    '',
    'AUDIT TIPOGRAFI & SENTUH @1024 (px):',
    ...audit,
    '',
    'DIAGNOSTIK TINGGI TOMBOL FOOTER (semua area, @1024):',
    ...(footAudit.length ? footAudit : ['  semua area ok (<=44px)']),
  ];
  OUT.textContent = lines.join('\n');
  document.title = failed.length ? `FAIL ${failed.length}` : 'OK';
}

run().catch((e) => {
  OUT.textContent = `PROBE CRASH: ${e?.stack || e}`;
  document.title = 'CRASH';
});
