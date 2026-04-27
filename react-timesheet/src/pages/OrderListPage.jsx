import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';
const PAGE_SIZE_OPTIONS = [25, 50, 100];

// ─── Compress image via canvas (max 1920px, 80% JPEG — ~300–800 KB) ──────────
const compressImage = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1920;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

// ─── Format timestamp ─────────────────────────────────────────────────────────
const fmtTs = (ts) => {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    );
  } catch { return ts || '—'; }
};

// ─── Highlight search term ────────────────────────────────────────────────────
const highlight = (text, term) => {
  if (!term || !text) return text ?? '-';
  const str = String(text);
  const idx = str.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return str;
  return (
    <span>
      {str.slice(0, idx)}
      <mark className="bg-amber-200 text-amber-900 font-semibold px-0.5 rounded-sm">
        {str.slice(idx, idx + term.length)}
      </mark>
      {str.slice(idx + term.length)}
    </span>
  );
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ value }) => {
  if (!value) return <span className="text-gray-300 text-[10px]">—</span>;
  const lower = value.toLowerCase();
  const cls =
    lower.includes('finish') || lower.includes('complete') || lower.includes('done')
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      : lower.includes('progress') || lower.includes('open')
      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
      : lower.includes('hold') || lower.includes('wait')
      ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold leading-4 ${cls}`}>
      {value}
    </span>
  );
};

// ─── Chevron icon ─────────────────────────────────────────────────────────────
const Chevron = ({ open }) => (
  <svg
    viewBox="0 0 20 20" fill="currentColor"
    className={`w-3.5 h-3.5 text-blue-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
  >
    <path fillRule="evenodd" clipRule="evenodd"
      d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" />
  </svg>
);

// ─── Info row (read-only label+value) ─────────────────────────────────────────
const InfoRow = ({ label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-[10px] font-semibold text-slate-500 w-24 flex-shrink-0 pt-0.5 uppercase tracking-wide">{label}</span>
    <span className="text-xs text-slate-800 flex-1 leading-snug">{value || '—'}</span>
  </div>
);

// ─── Inline progress bar ──────────────────────────────────────────────────────
const ProgBar = ({ value, className = '' }) => {
  const pct = value == null ? null : Math.min(100, Math.max(0, Number(value)));
  if (pct == null) return <span className="text-slate-300 text-[10px]">—</span>;
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-blue-500' : pct >= 40 ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold tabular-nums w-8 text-right flex-shrink-0
        ${pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-blue-600' : pct >= 40 ? 'text-amber-600' : 'text-slate-500'}`}>
        {pct}%
      </span>
    </div>
  );
};

// ─── History card ─────────────────────────────────────────────────────────────
const HistoryCard = ({ item, isLatest }) => {
  const [imgOpen, setImgOpen] = useState(false);
  const imgUrl = item.image_path ? `${API_BASE}/${item.image_path}` : null;

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${isLatest ? 'border-blue-200 bg-blue-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isLatest && (
            <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
              Latest
            </span>
          )}
          <span className={`text-xl font-black tabular-nums ${
            item.progress >= 100 ? 'text-emerald-600' :
            item.progress >= 70  ? 'text-blue-600'    :
            item.progress >= 40  ? 'text-amber-600'   : 'text-slate-600'
          }`}>
            {item.progress}%
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {imgUrl && (
            <button
              onClick={() => setImgOpen(true)}
              title="Lihat foto"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-700 transition-colors text-[10px] font-semibold"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Foto
            </button>
          )}
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-medium leading-tight">{fmtTs(item.created_at)}</p>
            {item.created_by && (
              <p className="text-[9px] text-slate-400 italic">{item.created_by}</p>
            )}
          </div>
        </div>
      </div>

      <ProgBar value={item.progress} />

      {item.issue_description && (
        <p className="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-2">
          {item.issue_description}
        </p>
      )}

      {/* Image preview overlay */}
      {imgOpen && imgUrl && (
        <div
          className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setImgOpen(false)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={imgUrl}
              alt="Dokumentasi"
              className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            />
            <button
              onClick={() => setImgOpen(false)}
              className="absolute top-2 right-2 w-9 h-9 bg-black/60 text-white rounded-full
                         flex items-center justify-center hover:bg-black/80 transition-colors text-lg font-bold"
            >
              ×
            </button>
            <p className="text-center text-white/60 text-xs mt-3">
              {fmtTs(item.created_at)}{item.created_by ? ` · ${item.created_by}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Progress Modal ───────────────────────────────────────────────────────────
const ProgressModal = ({ op, onClose }) => {
  const [progress, setProgress]         = useState('');
  const [issue, setIssue]               = useState('');
  const [imageData, setImageData]       = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [history, setHistory]           = useState([]);
  const [histLoading, setHistLoading]   = useState(true);
  const [submitting, setSubmitting]     = useState(false);
  const [submitOk, setSubmitOk]         = useState(false);
  const [error, setError]               = useState('');
  const [warn, setWarn]                 = useState('');
  const fileInputRef = useRef(null);

  const lastProgress = history.length > 0 ? history[0].progress : null;

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/sow/progress-history/${op.idsow}`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, [op.idsow]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ESC closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleProgressChange = (val) => {
    setProgress(val);
    setError('');
    const n = parseInt(val, 10);
    if (val === '') { setWarn(''); return; }
    if (isNaN(n) || n < 1 || n > 100) {
      setWarn('Masukkan angka antara 1 – 100');
    } else if (lastProgress !== null && n < lastProgress) {
      setWarn(`Tidak boleh kurang dari progress terakhir (${lastProgress}%)`);
    } else {
      setWarn('');
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setImageData(compressed);
    setImagePreview(compressed);
    e.target.value = '';
  };

  const handleSubmit = async () => {
    const prog = parseInt(progress, 10);
    if (!progress || isNaN(prog) || prog < 1 || prog > 100) {
      setError('Masukkan progress yang valid (1 – 100)');
      return;
    }
    if (warn) { setError(warn); return; }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/sow/progress-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_id:      op.idsow,
          order_no:          op.order_no,
          progress:          prog,
          issue_description: issue.trim() || null,
          image_data:        imageData || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error || 'Gagal menyimpan');
        return;
      }
      setProgress('');
      setIssue('');
      setImageData(null);
      setImagePreview(null);
      setWarn('');
      setSubmitOk(true);
      setTimeout(() => setSubmitOk(false), 2500);
      await loadHistory();
    } catch (err) {
      setError('Gagal: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = progress !== '' && !warn && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full bg-white flex flex-col overflow-hidden">

        {/* Header */}
        <header className="flex items-center justify-between bg-blue-900 px-4 py-3 flex-shrink-0 border-b border-blue-800">
          <div>
            <h2 className="text-sm font-bold text-white">Update Progress Operasi</h2>
            <p className="text-[11px] text-blue-300 mt-0.5 font-medium">
              {op.order_no}
              <span className="mx-1.5 text-blue-500">·</span>
              Op {op.operation_no}
              {op.workcenter && <span className="ml-1.5 text-blue-400">/ {op.workcenter}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/70
                       hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" clipRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
            </svg>
          </button>
        </header>

        {/* Two-panel body */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

          {/* ── Left: form ─────────────────────────────────────── */}
          <div className="lg:w-[400px] flex-shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-200">
            <div className="p-5 space-y-4">

              {/* Read-only info */}
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 space-y-2.5">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-widest mb-1">Informasi Operasi</p>
                <InfoRow label="Order No"   value={op.order_no} />
                <InfoRow label="Op No"      value={op.operation_no} />
                <InfoRow label="Deskripsi"  value={op.operationtext} />
                <InfoRow label="Workcenter" value={[op.workcenter, op.workcenterdescription].filter(Boolean).join(' – ')} />
                <InfoRow label="Plan Hrs"   value={op.planhours != null ? `${Number(op.planhours).toFixed(2)} hrs` : null} />
                <InfoRow label="Status"     value={<StatusBadge value={op.status} />} />
                {lastProgress !== null && (
                  <InfoRow
                    label="Last Progress"
                    value={<span className="font-bold text-blue-700 text-sm">{lastProgress}%</span>}
                  />
                )}
              </div>

              {/* Progress input */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1.5">
                  Progress (1 – 100) <span className="text-orange-500">*</span>
                  <span className="ml-2 font-normal text-slate-400 normal-case">Update progress operasi ini</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1} max={100}
                    value={progress}
                    onChange={(e) => handleProgressChange(e.target.value)}
                    placeholder={lastProgress !== null ? `Terakhir: ${lastProgress}%` : '1 – 100'}
                    className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-all
                      ${warn
                        ? 'border-amber-400 focus:ring-amber-400 bg-amber-50'
                        : 'border-blue-300 focus:ring-blue-500 bg-white'
                      }`}
                  />
                  {progress !== '' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-blue-500 pointer-events-none">
                      %
                    </span>
                  )}
                </div>
                {warn && (
                  <p className="mt-1.5 text-xs text-amber-600 font-medium flex items-center gap-1">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                      <path fillRule="evenodd" clipRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"/>
                    </svg>
                    {warn}
                  </p>
                )}
              </div>

              {/* Issue / notes */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1.5">
                  Issue / Catatan <span className="font-normal text-slate-400">(opsional)</span>
                </label>
                <textarea
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  rows={3}
                  placeholder="Deskripsi masalah, kendala, atau catatan tambahan..."
                  className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none transition-all"
                />
              </div>

              {/* Photo */}
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1.5">
                  Foto <span className="font-normal text-slate-400">(opsional)</span>
                </label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                {imagePreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200">
                    <img src={imagePreview} alt="Preview" className="w-full h-44 object-cover" />
                    <button
                      onClick={() => { setImageData(null); setImagePreview(null); }}
                      className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full
                                 flex items-center justify-center hover:bg-black/80 transition-colors text-sm font-bold"
                    >
                      ×
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/40 to-transparent px-3 py-2">
                      <p className="text-[10px] text-white/80">Ketuk × untuk hapus foto</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-24 border-2 border-dashed border-slate-300 rounded-xl
                               flex flex-col items-center justify-center gap-1.5
                               text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/40
                               transition-all active:bg-blue-100/60"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                    <span className="text-xs font-medium">Ambil Foto / Pilih Gambar</span>
                  </button>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-500 flex-shrink-0">
                    <path fillRule="evenodd" clipRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"/>
                  </svg>
                  <span className="text-xs text-red-700 font-medium">{error}</span>
                </div>
              )}

              {/* Success */}
              {submitOk && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-emerald-500 flex-shrink-0">
                    <path fillRule="evenodd" clipRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                  </svg>
                  <span className="text-xs text-emerald-700 font-semibold">Progress berhasil disimpan!</span>
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full py-3 text-sm font-bold rounded-xl transition-all
                  ${canSubmit
                    ? 'bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 active:translate-y-px'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                style={canSubmit ? { boxShadow: '0 4px 0 #c2410c, 0 6px 14px rgba(234,88,12,0.25)' } : {}}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                    </svg>
                    Menyimpan...
                  </span>
                ) : 'Submit Update'}
              </button>
            </div>
          </div>

          {/* ── Right: history ─────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Riwayat Update</span>
              {history.length > 0 && (
                <span className="text-[9px] bg-blue-600 text-white rounded-full px-2 py-0.5 font-bold">
                  {history.length} catatan
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {histLoading ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-400 font-medium">Memuat riwayat...</span>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300 gap-3">
                  <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                  </svg>
                  <p className="text-xs font-medium text-slate-400">Belum ada riwayat update</p>
                  <p className="text-[11px] text-slate-300">Submit progress pertama di panel kiri</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {history.map((h, i) => (
                    <HistoryCard key={h.id} item={h} isLatest={i === 0} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Operations sub-table ─────────────────────────────────────────────────────
const OperationsPanel = React.memo(({ orderNo, onSelectOp }) => {
  const [ops, setOps]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/sow/${encodeURIComponent(orderNo)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setOps(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Gagal memuat operations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderNo]);

  if (loading)
    return (
      <div className="flex items-center gap-2.5 px-6 py-4 bg-slate-50">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-slate-500 font-medium">Memuat operations...</span>
      </div>
    );

  if (error)
    return <div className="px-6 py-3 bg-red-50 text-xs text-red-600 font-medium">{error}</div>;

  if (!ops.length)
    return (
      <div className="px-6 py-4 bg-slate-50 text-xs text-slate-400 italic">
        Tidak ada operations untuk order ini.
      </div>
    );

  return (
    <div className="bg-slate-50 border-t border-blue-100">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-200">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Operations</span>
        <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded bg-blue-600 text-white text-[9px] font-bold">
          {ops.length}
        </span>
      </div>

      <div className="px-4 pb-3 pt-1.5">
        <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gradient-to-r from-blue-700 to-blue-600 text-white">
                <th className="px-3 py-2 text-left w-14 font-semibold tracking-wide">Op No</th>
                <th className="px-3 py-2 text-left font-semibold tracking-wide">Deskripsi Operasi</th>
                <th className="px-3 py-2 text-left w-40 font-semibold tracking-wide">Workcenter</th>
                <th className="px-3 py-2 text-right w-20 font-semibold tracking-wide">Plan Hrs</th>
                <th className="px-3 py-2 text-center w-28 font-semibold tracking-wide">Status</th>
                <th className="px-3 py-2 text-center w-20 font-semibold tracking-wide">Update</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op, i) => (
                <tr
                  key={op.idsow}
                  className={`border-b border-slate-100 last:border-0
                    ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-blue-100 text-blue-800 font-bold text-[10px]">
                      {op.operation_no}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700 leading-snug">{op.operationtext || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-blue-800 block">{op.workcenter || '—'}</span>
                    {op.workcenterdescription && (
                      <span className="text-[10px] text-slate-400 block leading-tight">{op.workcenterdescription}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-semibold text-slate-700">
                      {op.planhours != null ? Number(op.planhours).toFixed(2) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge value={op.status} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => onSelectOp(op)}
                      className="px-3 py-1 text-[10px] font-bold bg-gradient-to-b from-orange-500 to-orange-600 text-white rounded-md transition-all active:translate-y-px"
                      style={{ boxShadow: '0 3px 0 #c2410c, 0 4px 8px rgba(234,88,12,0.3)' }}
                    >
                      Update
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
OperationsPanel.displayName = 'OperationsPanel';

// ─── Pagination ───────────────────────────────────────────────────────────────
const Pagination = ({ page, totalPages, total, limit, onPageChange, onLimitChange, loading }) => {
  const [jumpInput, setJumpInput] = useState('');

  const navBtn = (disabled) =>
    `w-8 h-8 flex items-center justify-center rounded-md text-sm font-medium border transition-all ${
      disabled
        ? 'text-slate-300 border-slate-200 bg-slate-50 cursor-not-allowed'
        : 'text-blue-700 border-blue-200 bg-white hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100 cursor-pointer shadow-sm'
    }`;

  const pages = [];
  const delta = 2;
  const left  = Math.max(2, page - delta);
  const right = Math.min(totalPages - 1, page + delta);
  pages.push(1);
  if (left > 2)  pages.push('...');
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < totalPages - 1) pages.push('...');
  if (totalPages > 1) pages.push(totalPages);

  const handleJump = (e) => {
    e.preventDefault();
    const n = parseInt(jumpInput, 10);
    if (n >= 1 && n <= totalPages) { onPageChange(n); setJumpInput(''); }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white border-t border-slate-200 flex-shrink-0">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-500">
          {total === 0 ? 'Tidak ada data' : (
            <>
              <span className="font-semibold text-slate-800">{((page - 1) * limit + 1).toLocaleString()}</span>
              <span className="mx-0.5 text-slate-400">–</span>
              <span className="font-semibold text-slate-800">{Math.min(page * limit, total).toLocaleString()}</span>
              <span className="text-slate-400 mx-1">dari</span>
              <span className="font-semibold text-blue-700">{total.toLocaleString()}</span>
              <span className="text-slate-400 ml-1">orders</span>
            </>
          )}
        </span>
        <div className="h-4 w-px bg-slate-200" />
        <label className="text-slate-400">Tampilkan</label>
        <select
          value={limit}
          onChange={e => onLimitChange(Number(e.target.value))}
          disabled={loading}
          className="border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 text-xs
                     focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400
                     disabled:opacity-50 shadow-sm"
        >
          {PAGE_SIZE_OPTIONS.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-slate-400">/ hal</span>
      </div>

      <div className="flex items-center gap-1">
        <button className={navBtn(page === 1 || loading)} disabled={page === 1 || loading}
          onClick={() => onPageChange(1)} title="Halaman pertama">«</button>
        <button className={navBtn(page === 1 || loading)} disabled={page === 1 || loading}
          onClick={() => onPageChange(page - 1)} title="Sebelumnya">‹</button>

        <div className="flex items-center gap-0.5 mx-1">
          {pages.map((p, i) =>
            p === '...'
              ? <span key={`e${i}`} className="w-6 text-center text-slate-400 text-xs select-none">…</span>
              : (
                <button
                  key={p}
                  disabled={loading}
                  onClick={() => onPageChange(p)}
                  className={`w-8 h-8 rounded-md text-xs font-semibold border transition-all
                    ${p === page
                      ? 'bg-blue-700 text-white border-blue-700 shadow-md'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50 hover:border-blue-300 shadow-sm'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {p}
                </button>
              )
          )}
        </div>

        <button className={navBtn(page === totalPages || loading)} disabled={page === totalPages || loading}
          onClick={() => onPageChange(page + 1)} title="Berikutnya">›</button>
        <button className={navBtn(page === totalPages || loading)} disabled={page === totalPages || loading}
          onClick={() => onPageChange(totalPages)} title="Halaman terakhir">»</button>

        {totalPages > 5 && (
          <>
            <div className="h-5 w-px bg-slate-200 mx-1.5" />
            <form onSubmit={handleJump} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Hal.</span>
              <input
                type="number" min={1} max={totalPages}
                value={jumpInput}
                onChange={e => setJumpInput(e.target.value)}
                className="w-14 h-8 px-2 border border-slate-200 rounded-md text-xs text-center
                           focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 shadow-sm"
                placeholder={`1–${totalPages}`}
              />
              <button
                type="submit"
                className="h-8 px-3 bg-blue-700 text-white rounded-md text-xs font-semibold
                           hover:bg-blue-800 active:bg-blue-900 transition-colors shadow-sm"
              >
                Go
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const OrderListPage = () => {
  const navigate = useNavigate();

  const [orders, setOrders]         = useState([]);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const [search, setSearch]             = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [page, setPage]                 = useState(1);
  const [limit, setLimit]               = useState(50);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [modalOp, setModalOp]           = useState(null);

  const abortRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setActiveSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchPage(activeSearch, page, limit);
  }, [activeSearch, page, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = async (term, p, lim) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: p, limit: lim });
      if (term.trim()) params.set('search', term.trim());
      const res = await fetch(`${API_BASE}/sow/grouped?${params}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error('Server error');
      const json = await res.json();
      setOrders(json.data ?? []);
      setTotal(json.total ?? 0);
      setTotalPages(json.totalPages ?? 1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError('Gagal memuat data. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = useCallback((orderNo) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(orderNo) ? next.delete(orderNo) : next.add(orderNo);
      return next;
    });
  }, []);

  const handleSelectOp    = useCallback((op) => setModalOp(op), []);
  const handleLimitChange = (v) => { setLimit(v); setPage(1); setExpandedRows(new Set()); };
  const handlePageChange  = (v) => { setPage(v); setExpandedRows(new Set()); };

  return (
    <div className="h-dvh w-screen bg-slate-100 flex flex-col overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="flex items-center justify-between bg-blue-900 px-4 py-2.5 shadow-lg flex-shrink-0 border-b border-blue-800">
        <button
          onClick={() => navigate('/operations-hub')}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white
                     rounded-lg transition-all hover:bg-blue-600 active:translate-y-px"
          style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.25), 0 6px 12px rgba(0,0,0,0.2)' }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" clipRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"/>
          </svg>
          Back
        </button>

        <div className="text-center">
          <h1 className="text-sm font-bold text-white tracking-wide">Order List</h1>
          <p className="text-[10px] text-blue-300 font-medium mt-px">
            {loading ? 'Memuat...' : `${total.toLocaleString()} orders`}
          </p>
        </div>

        <button
          onClick={() => fetchPage(activeSearch, page, limit)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white
                     rounded-lg transition-all hover:bg-blue-600 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.25), 0 6px 12px rgba(0,0,0,0.2)' }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor"
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}>
            <path fillRule="evenodd" clipRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"/>
          </svg>
          Refresh
        </button>
      </header>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col gap-2.5 p-3 overflow-hidden">

        {/* Search bar */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari Order No, SSBR ID, Part Number, Part Name..."
                className="w-full pl-10 pr-9 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg
                           placeholder-slate-400 text-slate-800
                           focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 focus:bg-white
                           transition-all"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
              {!loading && search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center
                             rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors text-xs font-bold"
                >×</button>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {['Order No','SSBR ID','Part Number','Part Name'].map(f => (
                <span key={f}
                  className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100 font-medium">
                  {f}
                </span>
              ))}
            </div>
            {activeSearch && !loading && (
              <span className="text-[11px] text-slate-500">
                <strong className="text-blue-700">{total.toLocaleString()}</strong> hasil untuk
                {' '}<em className="text-slate-600">"{activeSearch}"</em>
              </span>
            )}
            {activeSearch && loading && (
              <span className="text-[11px] text-slate-400 italic">Mencari...</span>
            )}
          </div>
        </section>

        {/* Table card */}
        <section className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">

          {error && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 flex-shrink-0">
              <div className="flex items-center gap-2 text-xs text-red-700 font-medium">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-500 flex-shrink-0">
                  <path fillRule="evenodd" clipRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"/>
                </svg>
                {error}
              </div>
              <button onClick={() => fetchPage(activeSearch, page, limit)}
                className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2">
                Coba lagi
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto min-h-0 relative">

            {loading && orders.length > 0 && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-700 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-blue-700 font-medium">Memuat...</span>
                </div>
              </div>
            )}

            {loading && orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 border-4 border-blue-700 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-500 font-medium">Memuat data orders...</p>
              </div>

            ) : !loading && orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                <svg className="w-16 h-16 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-semibold text-slate-500">
                  {activeSearch ? 'Tidak ada hasil' : 'Tidak ada data'}
                </p>
                {activeSearch && (
                  <p className="text-xs text-slate-400">
                    Pencarian "{activeSearch}" tidak ditemukan —{' '}
                    <button onClick={() => setSearch('')}
                      className="text-blue-500 hover:text-blue-700 underline underline-offset-2 font-medium">
                      hapus filter
                    </button>
                  </p>
                )}
              </div>

            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-r from-blue-900 to-blue-800 text-white">
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[130px]">Order No</th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[100px]">SSBR ID</th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[110px]">Part Number</th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[170px]">Part Name</th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[100px]">Model</th>
                    <th className="px-3 py-3 text-center font-semibold tracking-wide w-14">Ops</th>
                    <th className="px-3 py-3 text-right font-semibold tracking-wide w-24">Plan Hrs</th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide w-36">Progress</th>
                    <th className="px-3 py-3 text-center font-semibold tracking-wide min-w-[96px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, i) => {
                    const isExpanded = expandedRows.has(order.order_no);
                    return (
                      <React.Fragment key={order.order_no}>
                        <tr
                          onClick={() => toggleExpand(order.order_no)}
                          className={`border-b cursor-pointer select-none transition-colors duration-100
                            ${isExpanded
                              ? 'bg-blue-50 border-blue-200 border-l-4 border-l-orange-400'
                              : i % 2 === 0
                              ? 'bg-white border-slate-100 hover:bg-slate-50'
                              : 'bg-slate-50/60 border-slate-100 hover:bg-slate-100/70'
                            }`}
                        >
                          <td className="px-3 py-3 text-center w-10">
                            <Chevron open={isExpanded} />
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-bold text-blue-900">
                              {highlight(order.order_no, activeSearch)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-600 font-medium">
                            {highlight(order.ssbr_id, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {highlight(order.part_number, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {highlight(order.part_name, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-500">{order.model || '—'}</td>
                          <td className="px-3 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full
                                            bg-blue-600 text-white text-[10px] font-bold shadow-sm">
                              {order.operation_count}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-700 tabular-nums">
                            {Number(order.total_planhours).toFixed(1)}
                          </td>
                          <td className="px-3 py-3">
                            <ProgBar value={order.avg_progress} />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge value={order.status} />
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td colSpan={10} className="p-0">
                              <OperationsPanel orderNo={order.order_no} onSelectOp={handleSelectOp} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {(total > 0 || loading) && (
            <Pagination
              page={page} totalPages={totalPages} total={total} limit={limit}
              loading={loading} onPageChange={handlePageChange} onLimitChange={handleLimitChange}
            />
          )}
        </section>
      </main>

      {/* ── Progress Modal ───────────────────────────────────────── */}
      {modalOp && (
        <ProgressModal
          op={modalOp}
          onClose={() => setModalOp(null)}
        />
      )}
    </div>
  );
};

export default OrderListPage;
