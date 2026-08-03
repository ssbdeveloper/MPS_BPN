// features/bayScheduling/useBaySchedules.js
//
// Sumber data reservasi bay untuk peta dua tingkat + kursor tanggal (A-08).
//
// Kursor tanggal WAJIB: tanpa "as-of day", dua reservasi BERURUTAN pada satu bay
// tampak menumpuk persis seperti dua reservasi yang benar-benar barengan. `byBay`
// karena itu dihitung dari cursorDate, bukan dari seluruh window fetch.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBaySchedules } from '../../services/msProjectService';
import { buildSchedulesByBay, dateKey, todayText } from './constants';

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

  const [result, setResult] = useState({ key: null, rows: [], error: '' });

  const cursorDate = useMemo(
    () => clampCursor(rawCursor, rangeStart, rangeEnd),
    [rawCursor, rangeStart, rangeEnd],
  );

  useEffect(() => {
    if (!requestKey) return undefined;

    const controller = new AbortController();

    fetchBaySchedules(
      { start_date: rangeStart, end_date: rangeEnd },
      { signal: controller.signal },
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, rows: Array.isArray(rows) ? rows : [], error: '' });
      })
      .catch((err) => {
        // Request yang dibatalkan bukan kegagalan — jangan tampilkan error untuk
        // rentang yang sudah tidak diminta lagi.
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        // Baris lama dipertahankan supaya peta tidak berubah kosong saat gagal;
        // halaman menampilkan error inline + tombol coba lagi di atasnya.
        setResult((prev) => ({
          key: requestKey,
          rows: prev.rows,
          error: err?.message || 'Gagal memuat jadwal bay.',
        }));
      });

    return () => controller.abort();
  }, [requestKey, rangeStart, rangeEnd]);

  const schedules = result.rows;
  const loading = result.key !== requestKey;
  const error = loading ? '' : result.error;

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
  };
}
