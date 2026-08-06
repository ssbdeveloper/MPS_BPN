// features/bayScheduling/useSowOrders.js
//
// Pool order SOW untuk panel kiri tingkat 2: pencarian ter-debounce, paginasi
// nyata, dan empat tab per D6.
//
// Dua hal yang diperbaiki dari halaman lama:
//   1. Tidak ada AbortController — mengetik cepat membuat respons lama datang
//      belakangan dan menimpa hasil query terbaru.
//   2. Meta paginasi dibuang, jadi 35 dari 115 order terpotong DIAM-DIAM (A-10).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSowOrdersPage } from '../../services/msProjectService';
import { weekEndText } from './constants';

// = MAX_LIMIT di apps/api/services/msProjectService.js. Meminta lebih besar akan
// dijepit server dan membuat perhitungan "sudah habis" meleset.
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;

export const ORDER_TABS = [
  { id: 'perlu', label: 'To schedule' },
  { id: 'belum_jadwal', label: 'No MSP task' },
  { id: 'terjadwal', label: 'Scheduled' },
  { id: 'selesai', label: 'Completed' },
];

export const DEFAULT_ORDER_TAB = 'perlu';

// Filter kasar yang BISA dikerjakan server. `completion` undefined = semua.
// Endpoint tidak punya parameter untuk has_msp_task maupun active_reservations,
// jadi dua sumbu itu terpaksa disaring di klien (lihat TAB_PREDICATE).
const TAB_COMPLETION = {
  perlu: 'unfinished',
  belum_jadwal: 'unfinished',
  terjadwal: undefined,
  selesai: 'finished',
};

// Definisi tab yang mengikat (kontrak). Ini yang berlaku; filter server di atas
// hanya pengurang jumlah baris yang perlu diambil.
const TAB_PREDICATE = {
  perlu: (order) => Boolean(order.is_unfinished) && Boolean(order.has_msp_task),
  belum_jadwal: (order) => Boolean(order.is_unfinished) && !order.has_msp_task,
  terjadwal: (order) => Number(order.active_reservations || 0) > 0,
  selesai: (order) => !order.is_unfinished,
};

// exclude_unknown selalu 'true': order yang tidak ada di SAP tidak boleh masuk
// POOL (D7). Yang tetap ditampilkan di PETA adalah reservasinya, bukan ordernya.
function buildParams(tab, search, offset) {
  const params = {
    exclude_unknown: 'true',
    limit: PAGE_SIZE,
    offset,
    // Badge jumlah SEMUA tab dihitung server (query.counts). counts_due_by
    // memakai batas jadwal sendiri supaya badge 'perlu' benar walau tab aktif
    // bukan 'perlu' — param ini tidak pernah memfilter baris.
    counts: 'true',
    counts_due_by: weekEndText(),
  };
  const completion = TAB_COMPLETION[tab];
  if (completion) params.completion = completion;
  // Tab 'perlu' (To schedule) = unfinished + jatuh tempo <= akhir minggu ini
  // (termasuk overdue dari kapan pun — server tanpa batas bawah). due_by dihitung
  // dari hari ini, jadi filter bergeser otomatis tiap minggu.
  if (tab === 'perlu') params.due_by = weekEndText();
  const q = String(search || '').trim();
  if (q) params.q = q;
  return params;
}

// Batas halaman saat menghitung badge di KLIEN (fallback server lama). 20 halaman
// x 100 = 2000 baris per tab; lewat itu angka jadi batas bawah (praktis tak terjadi).
const COUNT_PAGE_CAP = 20;

// Badge jumlah SEMUA tab harus muncul sejak awal tanpa perlu klik. Server baru
// mengembalikannya sekaligus (page.counts). Kalau server belum punya (deploy
// lama), hitung di KLIEN: tarik semua halaman tiap tab dan terapkan predicate
// yang sama dengan daftar (TAB_PREDICATE) — hasilnya EXACT, tanpa menunggu klik.
async function fetchTabCounts(search, signal) {
  const counts = {};
  for (const tab of ORDER_TABS) {
    const predicate = TAB_PREDICATE[tab.id];
    let matched = 0;
    let offset = 0;
    for (let pageIndex = 0; pageIndex < COUNT_PAGE_CAP; pageIndex += 1) {
      const params = buildParams(tab.id, search, offset);
      delete params.counts;   // hitungan klien tidak butuh subquery counts server
      delete params.counts_due_by;
      const page = await fetchSowOrdersPage(params, { signal });
      const rows = Array.isArray(page.rows) ? page.rows : [];
      matched += predicate ? rows.filter(predicate).length : rows.length;
      offset += rows.length;
      if (offset >= Number(page.total)) break;
    }
    counts[tab.id] = matched;
  }
  return counts;
}

export default function useSowOrders() {
  const [rows, setRows] = useState([]);          // baris mentah dari server (akumulatif)
  const [serverTotal, setServerTotal] = useState(0);
  // Badge jumlah per tab (server menghitungnya sekaligus, lihat query.counts).
  const [tabCounts, setTabCounts] = useState(null);
  // Mulai dari true: halaman pertama sudah dijadwalkan sejak render pertama, jadi
  // panel harus menampilkan skeleton — bukan EmptyState "tidak ada order".
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(DEFAULT_ORDER_TAB);
  const [reloadToken, setReloadToken] = useState(0);

  // Dua controller TERPISAH. Kalau keduanya berbagi satu ref, request "muat lagi"
  // yang dibatalkan oleh ketikan baru tidak akan pernah mematikan flag-nya sendiri
  // dan tombol muat lagi mati permanen.
  const listAbortRef = useRef(null);
  const moreAbortRef = useRef(null);
  // Cermin state untuk loadMore supaya identitasnya stabil (kartu order di-memo;
  // handler yang berganti tiap render membatalkan memo itu).
  const stateRef = useRef({ rows: [], serverTotal: 0, search: '', tab: DEFAULT_ORDER_TAB, busy: true });

  useEffect(() => {
    stateRef.current = { rows, serverTotal, search, tab, busy: loading };
  }, [rows, serverTotal, search, tab, loading]);

  // Muat halaman pertama tiap kali query berubah. Debounce 250ms berlaku untuk
  // FETCH-nya, bukan untuk state input: mengetik tetap terasa instan.
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      listAbortRef.current?.abort();
      listAbortRef.current = controller;
      // Halaman berikutnya milik query LAMA — hasilnya tidak boleh ditempel ke
      // daftar query baru.
      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
      setLoadingMore(false);
      setLoading(true);
      setError('');

      fetchSowOrdersPage(buildParams(tab, search, 0), { signal: controller.signal })
        .then((page) => {
          if (controller.signal.aborted) return;
          // Baris lama sengaja tidak dikosongkan lebih awal supaya daftar tidak
          // berkedip kosong selama debounce.
          setRows(page.rows);
          setServerTotal(page.total);
          // Badge: server baru kirim counts sekaligus; server lama dihitung
          // klien (paralel, non-blocking) supaya angka muncul tanpa perlu klik.
          if (page.counts) {
            setTabCounts(page.counts);
            return;
          }
          fetchTabCounts(search, controller.signal)
            .then((counts) => {
              if (!controller.signal.aborted) setTabCounts(counts);
            })
            .catch(() => {
              // Abort/error: biarkan tabCounts lama (atau null) — badge opsional.
            });
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          setError(err?.message || 'Failed to load orders.');
        })
        .finally(() => {
          // Hanya request TERBARU yang boleh mematikan flag; request lama yang
          // baru selesai tidak boleh mengaku daftar sudah siap.
          if (listAbortRef.current === controller) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, tab, reloadToken]);

  // Batalkan request yang masih jalan saat komponen dilepas.
  useEffect(() => () => {
    listAbortRef.current?.abort();
    moreAbortRef.current?.abort();
  }, []);

  const loadMore = useCallback(async () => {
    const snapshot = stateRef.current;
    if (snapshot.busy || moreAbortRef.current) return;
    if (snapshot.rows.length >= snapshot.serverTotal) return;

    const controller = new AbortController();
    moreAbortRef.current = controller;
    setLoadingMore(true);
    setError('');

    try {
      const page = await fetchSowOrdersPage(
        buildParams(snapshot.tab, snapshot.search, snapshot.rows.length),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      // Dedupe defensif: order_no adalah kunci grup di server, tapi baris bisa
      // bergeser antar-halaman kalau ETL menulis di sela dua permintaan.
      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.order_no));
        return [...prev, ...page.rows.filter((row) => !seen.has(row.order_no))];
      });
      setServerTotal(page.total);
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'Failed to load more orders.');
    } finally {
      if (moreAbortRef.current === controller) {
        moreAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  }, []);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const orders = useMemo(() => {
    const predicate = TAB_PREDICATE[tab];
    return predicate ? rows.filter(predicate) : rows;
  }, [rows, tab]);

  // `total` harus jujur. Dua sumbu tab (has_msp_task, active_reservations) tidak
  // bisa difilter di server, jadi selama masih ada halaman yang belum diambil
  // angka server hanyalah BATAS ATAS. Begitu semua halaman terkumpul, jumlah
  // hasil saring sudah pasti dan itulah total yang benar — sekaligus membuat
  // `shown >= total` jadi syarat yang tepat untuk menyembunyikan tombol muat lagi.
  const exhausted = rows.length >= serverTotal;
  const shown = orders.length;
  const total = exhausted ? shown : serverTotal;

  return {
    orders,
    total,
    shown,
    loading,
    error,
    reload,
    search,
    setSearch,
    tab,
    setTab,
    loadMore,
    tabCounts,
    // Tambahan di luar kontrak: `loadingMore` untuk membedakan spinner tombol
    // "muat lagi" dari skeleton awal, `hasMore` bila panel tidak mau memakai
    // aturan `shown >= total`.
    loadingMore,
    hasMore: !exhausted,
  };
}
