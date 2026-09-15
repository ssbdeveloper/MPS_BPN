import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Clock3, FileText, Image, Loader2, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function imageUrl(path) {
  if (!path) return null;
  if (path.startsWith('/uploads/')) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

function historyRows(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

function HistoryEntry({ entry, onPhoto }) {
  const photo = imageUrl(entry.image_path);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums text-slate-900">{entry.progress ?? '—'}%</span>
          <span className="text-xs font-medium text-slate-500">{entry.level}</span>
        </div>
        <time className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={13} />{entry.created_at ? new Date(entry.created_at).toLocaleString('id-ID') : '—'}</time>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><FileText size={12} />Issue note</p>
          <p className={`mt-1 text-sm ${entry.issue_description ? 'text-slate-700' : 'text-slate-400'}`}>{entry.issue_description || 'No issue note'}</p>
          {entry.created_by && <p className="mt-2 text-xs text-slate-400">Updated by {entry.created_by}</p>}
        </div>
        {photo ? (
          <button type="button" onClick={() => onPhoto({ src: photo, alt: `Progress photo for ${entry.context}` })} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
            <Camera size={16} aria-hidden="true" /> View image
          </button>
        ) : <span className="flex items-center gap-1.5 text-xs text-slate-400"><Image size={14} />No image</span>}
      </div>
    </article>
  );
}

export default function EvidenceHistoryModal({ operation, onClose }) {
  const [rows, setRows] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [
        ...(operation.history_scope === 'subtask' ? [] : [fetch(`${API_BASE}/sow/progress-history/${operation.idsow}`).then((response) => {
          if (!response.ok) throw new Error();
          return response.json();
        }).then((data) => historyRows(data).map((entry) => ({ ...entry, level: 'Operation', context: `order ${operation.order_no} operation ${operation.operation_no}` })))]),
        ...(operation.subtasks || []).map((subtask) => fetch(`${API_BASE}/sow/subtasks/${subtask.id}/progress-history`).then((response) => {
          if (!response.ok) throw new Error();
          return response.json();
        }).then((data) => historyRows(data).map((entry) => ({ ...entry, level: subtask.title, context: `${subtask.title}, order ${operation.order_no} operation ${operation.operation_no}` })))),
      ];
      setRows((await Promise.all(requests)).flat().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
    } catch {
      setRows([]);
      setError('Could not load update history.');
    } finally {
      setLoading(false);
    }
  }, [operation]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const trigger = document.activeElement;
    const close = (event) => { if (event.key === 'Escape') photo ? setPhoto(null) : onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    closeRef.current?.focus();
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', close); trigger?.focus?.(); };
  }, [onClose, photo]);

  const visibleRows = showAll ? rows : rows.slice(0, 1);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`Update history for order ${operation.order_no} operation ${operation.operation_no}`} className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div><h2 className="font-bold text-slate-900">Update history</h2><p className="text-xs text-slate-500">{operation.history_title || `${operation.order_no} · Op ${operation.operation_no} · ${operation.operation_text}`}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close update history" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"><X size={18} /></button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4">
          {loading ? <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading...</p>
            : error ? <div className="py-8 text-center"><p className="text-sm text-rose-700">{error}</p><button type="button" onClick={load} className="mt-3 min-h-[44px] rounded-lg border border-slate-200 px-4 text-sm font-bold text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">Retry</button></div>
              : rows.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No update history</p>
                : <div className="space-y-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{showAll ? `All updates (${rows.length})` : 'Latest update'}</p>{visibleRows.map((entry, index) => <HistoryEntry key={`${entry.level}-${entry.id ?? index}`} entry={entry} onPhoto={setPhoto} />)}</div>}
        </div>
        {rows.length > 1 && <footer className="border-t border-slate-200 px-4 py-2"><button type="button" onClick={() => setShowAll((value) => !value)} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-xs font-bold text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">{showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{showAll ? 'Show latest only' : `Show all ${rows.length} updates`}</button></footer>}
      </section>
      {photo && <button type="button" aria-label="Close photo preview" onClick={() => setPhoto(null)} className="fixed inset-0 z-50 flex min-h-[44px] w-full items-center justify-center bg-black/85 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><img src={photo.src} alt={photo.alt} className="max-h-[88vh] max-w-full object-contain" /></button>}
    </div>
  );
}
