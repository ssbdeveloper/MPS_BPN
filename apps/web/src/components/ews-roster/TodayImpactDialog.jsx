import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, Users, X } from 'lucide-react';

const LABEL_CLS = 'text-xs font-bold uppercase text-slate-500';
const ERROR_BOX_CLS = 'rounded-xl border border-red-300 bg-red-50 p-3 text-red-900';

export default function TodayImpactDialog({
  isOpen, onClose, onConfirm, previewData, busy, errorMessage, onRefreshPreview, isStale,
}) {
  const [reason, setReason] = useState('');
  const [confirmedToken, setConfirmedToken] = useState(null);
  const dialogRef = useRef(null);
  const reasonRef = useRef(null);

  const confirmed = Boolean(previewData?.preview_token && confirmedToken === previewData.preview_token);

  const handleClose = useCallback(() => {
    if (busy) return;
    setReason('');
    setConfirmedToken(null);
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (isOpen) setTimeout(() => reasonRef.current?.focus(), 50);
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen || !previewData) return null;

  const isDeleteMode = previewData.mode === 'delete' || previewData.operation === 'DELETE_OVERRIDE';
  const todayItem = isDeleteMode
    ? null
    : (previewData.items || []).find((it) => it.date === previewData.plant_today);
  const isStarted = isDeleteMode ? false : todayItem?.today?.started;

  const todayStats = isDeleteMode ? previewData.today : todayItem?.today;
  const statsStatus = todayStats?.stats_status;
  const operatorCount = todayStats?.scheduled_operators;
  const operatorsWithRecords = todayStats?.operators_with_records || 0;

  const isReasonValid = reason.trim().length >= 10 && reason.trim().length <= 200;
  const canSubmit = confirmed && isReasonValid && !busy && !isStale;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const reasonText = reason.trim();
    // PERHATIAN: JANGAN hapus reason di sini! Biarkan tetap tersimpan
    // jika request gagal (misal 409 PREVIEW_STALE / network error).
    onConfirm({ reason: reasonText, confirm_today_impact: true, preview_token: previewData.preview_token });
  };

  const renderOperatorDisplay = () => {
    if (statsStatus === 'unavailable' || operatorCount === null || operatorCount === undefined) {
      return <span className="font-extrabold text-red-600">Data Tidak Tersedia (Error)</span>;
    }
    if (operatorCount === 0) {
      return <span className="text-slate-800">0 Orang</span>;
    }
    return (
      <span className="text-slate-800">
        {operatorCount} Orang {operatorsWithRecords > 0 ? `(${operatorsWithRecords} aktif)` : ''}
      </span>
    );
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="today-impact-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div ref={dialogRef} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2 text-amber-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs"><AlertTriangle size={18} /></span>
            <div>
              <h2 id="today-impact-title" className="text-base font-extrabold text-slate-900">
                {isDeleteMode ? 'Konfirmasi Hapus Jam Khusus Hari Ini' : 'Konfirmasi Perubahan Hari Ini'}
              </h2>
              <p className="text-xs font-semibold text-amber-800">Tanggal: {previewData.plant_today} (Waktu Plant)</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} disabled={busy} aria-label="Tutup dialog" className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"><X size={18} /></button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto p-5 text-xs text-slate-700">
          <div className="space-y-3">
            {errorMessage && (
              <div className={ERROR_BOX_CLS}>
                <p className="flex items-center gap-1.5 font-bold"><AlertTriangle size={15} className="text-red-600" /> {errorMessage}</p>
                {isStale && onRefreshPreview && (
                  <button type="button" onClick={onRefreshPreview} disabled={busy} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                    <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Muat Ulang Preview
                  </button>
                )}
              </div>
            )}

            {isStarted && (
              <div className={ERROR_BOX_CLS}>
                <p className="flex items-center gap-1.5 font-extrabold"><AlertTriangle size={15} className="text-red-600" /> Perhatian: Shift hari ini sudah atau sedang berjalan!</p>
                <p className="mt-1 font-semibold text-red-800 text-xs">Perubahan window jam dapat mempengaruhi status kehadiran seketika saat halaman dimuat ulang.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2"><Users size={16} className="text-slate-500" /><div><span className={LABEL_CLS}>Operator</span><p className="text-sm font-extrabold">{renderOperatorDisplay()}</p></div></div>
              <div className="flex items-center gap-2"><Clock size={16} className="text-slate-500" /><div><span className={LABEL_CLS}>Jam Shift</span><p className="text-xs font-bold text-slate-800">
                {isDeleteMode ? (
                  <span>Kembali ke Default ({previewData.today?.fallback_to ? `${previewData.today.fallback_to.start_time.slice(0,5)}-${previewData.today.fallback_to.end_time.slice(0,5)}` : 'Default'})</span>
                ) : (
                  <span>{todayItem?.before ? `${todayItem.before.start_time.slice(0,5)}-${todayItem.before.end_time.slice(0,5)}` : 'Default'}{' ➔ '}<span className="text-[#0077b6]">{todayItem?.after?.start_time.slice(0,5)}-{todayItem?.after?.end_time.slice(0,5)}</span></span>
                )}
              </p></div></div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600">
              <p className="font-bold text-slate-800 text-xs">Perilaku Sistem:</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs font-medium">
                <li><strong>Timesheet:</strong> Checkout setelah aksi ini memakai window baru untuk RG/OV.</li>
                <li><strong>Roster:</strong> Tampilan roster mengikuti jadwal baru setelah halaman dimuat ulang.</li>
                <li><strong>KPI Dashboard:</strong> Diperbarui pada siklus snapshot EWS berikutnya.</li>
              </ul>
            </div>

            <div>
              <label htmlFor="impact-reason" className="block font-bold text-slate-800 text-xs">
                {isDeleteMode ? 'Alasan Pembatalan / Penghapusan Khusus' : 'Alasan Perubahan Operasional'} <span className="text-red-500">*</span>
              </label>
              <textarea id="impact-reason" ref={reasonRef} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajib diisi manual minimal 10 karakter..." maxLength={200} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
              <div className="mt-1 flex justify-between text-xs font-medium text-slate-500">
                <span>Minimal 10 karakter</span>
                <span className={reason.trim().length < 10 ? 'text-amber-600' : 'text-slate-500'}>{reason.trim().length} / 200</span>
              </div>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 pt-1 text-slate-700">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmedToken(e.target.checked ? previewData?.preview_token : null)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0077b6] focus:ring-[#00b4d8]" />
              <span className="text-xs font-semibold leading-relaxed">
                {isDeleteMode
                  ? 'Saya memahami penghapusan jadwal hari ini akan mengembalikan jam shift ke default untuk checkout berikutnya.'
                  : 'Saya memahami dampak perubahan jam shift hari ini terhadap pembagian lembur (RG/OV) dan kehadiran operator.'}
              </span>
            </label>
          </div>

          <footer className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={handleClose} disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 px-4 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95">Batal</button>
            <button type="submit" disabled={!canSubmit} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-amber-600 px-5 text-xs font-extrabold text-white shadow-xs hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? 'Menyimpan...' : (isDeleteMode ? 'Konfirmasi & Hapus' : 'Konfirmasi & Terapkan')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
