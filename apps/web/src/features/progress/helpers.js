// Shared helpers + constants for the sub-task / physical-progress feature.
//
// Extracted VERBATIM from OrderListPage.jsx so the PE Order List page and the
// foreman-facing Update Progress page share ONE implementation. Logic here is
// intentionally endpoint-agnostic — callers pass full URLs.

export const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Compress image via canvas (max 1920px, 80% JPEG — ~300–800 KB) ──────────
export const compressImage = (file) =>
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
export const fmtTs = (ts) => {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    );
  } catch { return ts || '—'; }
};

// ─── Auth headers (populates created_by/updated_by via x-user-id on writes) ─────
export const authHeaders = () => {
  try {
    const u = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    if (!u) return {};
    return {
      'x-user-id':   u.id != null ? String(u.id) : '',
      'x-user-name': u.name || u.username || '',
    };
  } catch { return {}; }
};

// ─── Format sub-task weight (numeric string "1.00" → "1") ──────────────────────
export const fmtWeight = (w) => {
  const n = Number(w);
  return Number.isFinite(n) ? String(n) : '—';
};

// ─── Weighted roll-up of active sub-tasks (mirrors backend recompute) ──────────
export const computeRollup = (list) => {
  let weighted = 0;
  let total = 0;
  for (const s of list) {
    const w = Number(s.weight) || 0;
    weighted += (Number(s.progress) || 0) * w;
    total += w;
  }
  return total > 0 ? Math.round(weighted / total) : null;
};

// ─── Sub-task status pill config (NOT_STARTED / IN_PROGRESS / ON_HOLD / DONE) ──
export const SUBTASK_STATUS = {
  NOT_STARTED: { label: 'Belum Mulai', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  IN_PROGRESS: { label: 'Berjalan',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  ON_HOLD:     { label: 'Ditahan',     cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  DONE:        { label: 'Selesai',     cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};
