// features/bayScheduling/useBaySchedules.js
//
// Sumber data reservasi bay untuk peta dua tingkat + kursor tanggal (A-08).
//
// Kursor tanggal WAJIB: tanpa "as-of day", dua reservasi BERURUTAN pada satu bay
// tampak menumpuk persis seperti dua reservasi yang benar-benar barengan. `byBay`
// karena itu dihitung dari cursorDate, bukan dari seluruh window fetch.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBaySchedulesPage } from '../../services/msProjectService';
import { buildSchedulesByBay, dateKey, todayText } from './constants';

// Peta boleh meminta lanjutan sampai rentangnya benar-benar habis. `next_cursor` datang dari
// server, jadi jumlah halaman tidak ditebak. Batas ini hanya jaring pengaman supaya satu loop
// yang tidak pernah selesai tidak mengunci tab.
const MAX_PAGES = 50;
// Batas keras akumulasi baris di klien. Server sudah membatasi per halaman; ini mencegah
// rentang yang sangat lebar (mis. beberapa bulan) menghabiskan memori tanpa batas.
const MAX_ROWS = 50000;
// Ukuran halaman yang diminta ke server. Ini default server juga, jadi angka eksplisit di
// sini hanya membuat niat terbaca jelas (dan mencegah default server berubah diam-diam).
const PAGE_LIMIT = 2000;

// Kursor dijepit ke [rangeStart, rangeEnd]. Data di luar rentang itu memang tidak
// pernah di-fetch, jadi kursor di luar rentang akan selalu menghasilkan peta kosong
// dan terlihat seperti bug.
function clampCursor(value, rangeStart, rangeEnd) {
  let cursor = dateKey(value) || todayText();
  const from = dateKey(rangeStart);
  const to = dateKey(rangeEnd);
  if (from && cursor < from) cursor = from;
  if (to && cursor > to) cursor = to;
  // Rentang terbalik (end < start) datang dari dua <input type="date"> yang berdiri
  // sendiri. Awal rentang yang menang — bukan nilai mustahil di antara keduanya.
  if (from && to && to < from) cursor = from;
  return cursor;
}

export default function useBaySchedules({ rangeStart, rangeEnd } = {}) {
  const [reloadToken, setReloadToken] = useState(0);
  // Kursor mentah disimpan apa adanya; nilai yang dipakai selalu hasil clamp.
  // Dengan begitu mengubah rentang tidak butuh useEffect penyelaras (yang mudah
  // berubah jadi loop set-state).
  const [rawCursor, setRawCursor] = useState(todayText);

  // Kunci permintaan = seluruh input yang menentukan isi data. `loading` DITURUNKAN
  // dari perbandingan kunci, bukan di-set di badan effect: begitu rentang berubah,
  // data yang dipegang otomatis dianggap basi tanpa render tambahan.
  const requestKey = rangeStart && rangeEnd
    ? `${dateKey(rangeStart)}|${dateKey(rangeEnd)}|${reloadToken}`
    : null;

  const [result, setResult] = useState({ key: null, rows: [], error: '', readComplete: true, pagesLoaded: 0 });

  const cursorDate = useMemo(
    () => clampCursor(rawCursor, rangeStart, rangeEnd),
    [rawCursor, rangeStart, rangeEnd],
  );

  useEffect(() => {
    if (!requestKey) return undefined;

    const controller = new AbortController();

    // Membaca SELURUH rentang lewat cursor, bukan satu halaman. Kelengkapan adalah inti
    // insiden B29E: satu halaman terpotong membuat sel tampil kosong, dan peta yang tampak
    // wajar tetapi berbeda dari DB lebih berbahaya daripada peta yang mengaku gagal.
    (async () => {
      let after = null;
      const acc = [];
      let pages = 0;
      let hasMore = false;
      try {
        do {
          const page = await fetchBaySchedulesPage(
            {
              start_date: rangeStart,
              end_date: rangeEnd,
              limit: PAGE_LIMIT,
              ...(after ? { after } : {}),
              // Halaman lanjutan wajib membawa penanda batasnya supaya server bisa membuktikan
              // baris batas belum berubah di tengah rangkaian pembacaan.
              ...(after ? { if_first: 1 } : {}),
            },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          pages += 1;
          acc.push(...page.rows);
          hasMore = page.hasMore;
          after = page.nextCursor;
          // Lanjut hanya bila server masih menandai ada lanjutan DAN kita belum menyentuh
          // batas apa pun.
          if (!hasMore || acc.length >= MAX_ROWS || pages >= MAX_PAGES) break;
        } while (after);

        // Kalau loop berhenti karena batas (bukan karena server bilang habis), tandai belum
        // lengkap — jangan pernah menampilkan truncation sebagai peta yang sah.
        const complete = !hasMore;
        setResult({ key: requestKey, rows: acc, error: '', readComplete: complete, pagesLoaded: pages });
      } catch (err) {
        // Request yang dibatalkan bukan kegagalan — jangan tampilkan error untuk
        // rentang yang sudah tidak diminta lagi.
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        // Baris lama dipertahankan supaya peta tidak berubah kosong saat gagal;
        // halaman menampilkan error inline + tombol coba lagi di atasnya.
        setResult((prev) => ({
          key: requestKey,
          rows: prev.rows,
          error: err?.message || 'Failed to load bay schedules.',
          // Sebuah error di tengah rangkaian berarti kita tidak tahu apa yang hilang.
          // `readComplete: false` mencegah sel kosong disimpulkan "free".
          readComplete: false,
          pagesLoaded: prev.pagesLoaded,
        }));
      }
    })();

    return () => controller.abort();
  }, [requestKey, rangeStart, rangeEnd]);

  const schedules = result.rows;
  const loading = result.key !== requestKey;
  const error = loading ? '' : result.error;
  // Hanya bermakna saat data sudah termuat penuh; selama memuat, `true` akan menyesatkan.
  const readComplete = loading ? false : result.readComplete !== false;
  const pagesLoaded = result.pagesLoaded || 0;

  const byBay = useMemo(() => buildSchedulesByBay(schedules, cursorDate), [schedules, cursorDate]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    schedules,
    byBay,
    loading,
    error,
    reload,
    cursorDate,
    setCursorDate: setRawCursor,
    // Penanda kelengkapan: pemanggil WAJIB memeriksanya sebelum menyimpulkan "bay kosong".
    readComplete,
    pagesLoaded,
  };
}
