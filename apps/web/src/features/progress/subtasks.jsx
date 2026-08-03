import React, { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Ban, Loader2, Layers } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import ConfirmationModal from '../../components/ui/ConfirmationModal';
import { API_BASE, authHeaders, fmtWeight, fmtTs } from './helpers';
import { ModalShell, ProgressBar, StatusPill } from './primitives';
import { ProgressUpdatePanel } from './ProgressUpdatePanel';

// ─── Sub-task progress modal (reuses the shared interaction) ──────────────────
export const SubTaskProgressModal = ({ sub, operationNo, onClose, onSaved }) => {
  const infoRows = [
    { label: 'Order No', value: sub.order_no },
    { label: 'Op No',    value: operationNo },
    { label: 'Sub-task', value: sub.title },
    { label: 'Bobot',    value: fmtWeight(sub.weight) },
    { label: 'Status',   value: <StatusPill status={sub.status} /> },
  ];
  return (
    <ModalShell
      title="Update Progress Sub-task"
      subtitle={sub.title}
      onClose={onClose}
      size="lg"
    >
      <ProgressUpdatePanel
        historyUrl={`${API_BASE}/sow/subtasks/${sub.id}/progress-history`}
        submitUrl={`${API_BASE}/sow/subtasks/${sub.id}/progress`}
        infoRows={infoRows}
        successMsg="Progress sub-task tersimpan"
        onSaved={onSaved}
        buildPayload={(prog, issueVal, img) => ({
          progress:          prog,
          issue_description: issueVal,
          image_data:        img,
        })}
      />
    </ModalShell>
  );
};

// ─── Sub-task add / edit modal ────────────────────────────────────────────────
export const SubTaskFormModal = ({ mode, idsow, sub, onClose, onSaved }) => {
  const isEdit = mode === 'edit';
  const [title, setTitle]         = useState(sub?.title ?? '');
  const [weight, setWeight]       = useState(sub?.weight != null ? String(Number(sub.weight)) : '');
  const [sortOrder, setSortOrder] = useState(sub?.sort_order != null ? String(sub.sort_order) : '');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const titleValid  = title.trim().length > 0;
  const weightValid = weight === '' || Number(weight) > 0;
  const sortValid   = sortOrder === '' || Number.isInteger(Number(sortOrder));
  const canSave     = titleValid && weightValid && sortValid && !saving;

  const handleSave = async () => {
    if (!titleValid)  { setError('Judul wajib diisi'); return; }
    if (!weightValid) { setError('Bobot harus lebih besar dari 0'); return; }
    if (!sortValid)   { setError('Urutan harus angka bulat'); return; }

    setSaving(true);
    setError('');
    try {
      const url    = isEdit ? `${API_BASE}/sow/subtasks/${sub.id}` : `${API_BASE}/sow/operations/${idsow}/subtasks`;
      const method = isEdit ? 'PUT' : 'POST';
      const body   = { title: title.trim() };
      if (weight !== '')    body.weight     = Number(weight);
      if (sortOrder !== '') body.sort_order = parseInt(sortOrder, 10);

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j.error || 'Gagal menyimpan sub-task';
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(isEdit ? 'Sub-task diperbarui' : 'Sub-task ditambahkan');
      onSaved();
    } catch (err) {
      const msg = 'Gagal: ' + err.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm bg-white text-slate-800 border border-slate-200 rounded-lg placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all motion-reduce:transition-none';

  return (
    <ModalShell
      title={isEdit ? 'Edit Sub-task' : 'Tambah Sub-task'}
      onClose={onClose}
      size="sm"
    >
      <div className="overflow-y-auto p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Judul <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(''); }}
            placeholder="mis. Fabrikasi bracket kiri"
            autoFocus
            className={`${inputCls} ${!titleValid && error ? 'border-red-400 ring-2 ring-red-200' : ''}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Bobot <span className="font-normal text-slate-400">(opsional)</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={weight}
              onChange={(e) => { setWeight(e.target.value); setError(''); }}
              placeholder="1"
              className={`${inputCls} tabular-nums`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Urutan <span className="font-normal text-slate-400">(opsional)</span>
            </label>
            <input
              type="number"
              step="1"
              value={sortOrder}
              onChange={(e) => { setSortOrder(e.target.value); setError(''); }}
              placeholder="0"
              className={`${inputCls} tabular-nums`}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <span className="text-xs text-red-700 font-medium">{error}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700
                       hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                       transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                Menyimpan...
              </span>
            ) : (isEdit ? 'Simpan' : 'Tambah')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

// ─── Sub-task row (presentational) ────────────────────────────────────────────
export const SubTaskRow = ({ sub, onUpdate, onEdit, onDeactivate }) => (
  <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 truncate">{sub.title}</span>
        <StatusPill status={sub.status} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span className="tabular-nums">Bobot {fmtWeight(sub.weight)}</span>
        <span className="text-slate-300">·</span>
        <span>Update {fmtTs(sub.updated_at)}</span>
        {sub.updated_by && (
          <>
            <span className="text-slate-300">·</span>
            <span className="italic">{sub.updated_by}</span>
          </>
        )}
      </div>
    </div>

    <div className="w-full md:w-40 flex-shrink-0">
      <ProgressBar value={sub.progress} />
    </div>

    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={onUpdate}
        className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                   transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        Update
      </button>
      <button
        onClick={onEdit}
        aria-label="Edit sub-task"
        title="Edit sub-task"
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600
                   hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <Pencil size={15} />
      </button>
      <button
        onClick={onDeactivate}
        aria-label="Nonaktifkan sub-task"
        title="Nonaktifkan sub-task"
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500
                   hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all active:scale-95
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <Ban size={15} />
      </button>
    </div>
  </div>
);

// ─── Sub-operation panel (list + CRUD orchestration for one operation) ────────
export const SubOperationPanel = ({ idsow, operationNo, state, onRefresh }) => {
  const { list = [], loading, error } = state || {};
  const [formModal, setFormModal]         = useState(null); // { mode, sub? }
  const [progressSub, setProgressSub]     = useState(null);
  const [deactivateSub, setDeactivateSub] = useState(null);
  const [deactivating, setDeactivating]   = useState(false);

  const handleDeactivate = async () => {
    if (!deactivateSub || deactivating) return;
    setDeactivating(true);
    try {
      const res = await fetch(`${API_BASE}/sow/subtasks/${deactivateSub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Gagal menonaktifkan sub-task');
        return;
      }
      toast.success('Sub-task dinonaktifkan');
      setDeactivateSub(null);
      onRefresh();
    } catch (err) {
      toast.error('Gagal: ' + err.message);
    } finally {
      setDeactivating(false);
    }
  };

  const addButton = (
    <button
      onClick={() => setFormModal({ mode: 'add' })}
      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-semibold text-white
                 bg-[#0077b6] hover:bg-[#023e8a] transition-all active:scale-95
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
    >
      <Plus size={15} />
      Tambah Sub-task
    </button>
  );

  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Sub-tasks</span>
          {list.length > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded bg-[#0077b6] text-white text-[11px] font-bold tabular-nums">
              {list.length}
            </span>
          )}
        </div>
        {!loading && !error && list.length > 0 && addButton}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <span className="text-xs text-red-700 font-medium">{error}</span>
          <button
            onClick={onRefresh}
            className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
          >
            Coba lagi
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Belum ada sub-task"
          description="Pecah operasi ini menjadi child task untuk melacak progress fisik yang lebih granular."
          action={addButton}
        />
      ) : (
        <div className="space-y-2">
          {list.map((sub) => (
            <SubTaskRow
              key={sub.id}
              sub={sub}
              onUpdate={() => setProgressSub(sub)}
              onEdit={() => setFormModal({ mode: 'edit', sub })}
              onDeactivate={() => setDeactivateSub(sub)}
            />
          ))}
        </div>
      )}

      {formModal && (
        <SubTaskFormModal
          mode={formModal.mode}
          idsow={idsow}
          sub={formModal.sub}
          onClose={() => setFormModal(null)}
          onSaved={() => { setFormModal(null); onRefresh(); }}
        />
      )}

      {progressSub && (
        <SubTaskProgressModal
          sub={progressSub}
          operationNo={operationNo}
          onClose={() => setProgressSub(null)}
          onSaved={onRefresh}
        />
      )}

      <ConfirmationModal
        isOpen={!!deactivateSub}
        title="Nonaktifkan sub-task?"
        message={deactivateSub
          ? `"${deactivateSub.title}" akan disembunyikan dan progress operasi dihitung ulang dari sub-task yang tersisa.`
          : ''}
        confirmLabel={deactivating ? 'Memproses...' : 'Nonaktifkan'}
        cancelLabel="Batal"
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateSub(null)}
      />
    </div>
  );
};
