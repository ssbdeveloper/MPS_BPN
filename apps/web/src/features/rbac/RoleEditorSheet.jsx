import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Save, Shield, X } from 'lucide-react';
import SegmentedLevel from './SegmentedLevel';
import { FEATURES } from '../../rbac/featureRegistry';
import { LEVELS } from '../../rbac/permissionMatrix';

const API_BASE = import.meta.env.VITE_API_URL || '';
const ROLE_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

// Fitur yang hanya ada di katalog backend (features.js) tapi belum di registry FE.
const EXTRA_FEATURES = [
  { id: 'sow_verification', label: 'SOW Verification', module: 'PE' },
];

function titleCase(id) {
  return String(id).split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function labelOf(id) {
  return FEATURES[id]?.label || titleCase(id);
}
function moduleOf(id) {
  return FEATURES[id]?.module || 'Other';
}

// Katalog features = registry FE + ekstra backend + id apa pun yang sudah tersimpan di
// role ini (carry-over supaya replace full-set tidak menghapus features asing).
function buildCatalog(existingPermIds) {
  const seen = new Set();
  const out = [];
  const push = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: labelOf(id), module: moduleOf(id) });
  };
  Object.values(FEATURES).forEach((f) => push(f.id));
  EXTRA_FEATURES.forEach((f) => push(f.id));
  (existingPermIds || []).forEach(push);
  return out;
}

const FieldLabel = ({ children }) => (<span className="mb-1.5 block text-xs font-bold text-slate-600">{children}</span>);

const inputCls = 'h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100';

export default function RoleEditorSheet({ role, mode, authHeaders, onClose, onSaved }) {
  // mode: 'create' | 'edit' | 'clone'
  const isEdit = mode === 'edit';
  const [roleKey, setRoleKey] = useState(isEdit ? role.role_key : mode === 'clone' ? `${role.role_key}_copy` : '');
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [defaultLevel, setDefaultLevel] = useState(role?.default_level || LEVELS.NO_ACCESS);
  const [perms, setPerms] = useState(() => {
    const base = role?.permissions || {};
    const catalog = buildCatalog(Object.keys(base));
    const init = {};
    catalog.forEach((f) => { init[f.id] = base[f.id] || role?.default_level || LEVELS.NO_ACCESS; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const catalog = useMemo(() => buildCatalog(Object.keys(role?.permissions || {})), [role]);
  const groups = useMemo(() => {
    const byModule = {};
    catalog.forEach((f) => { (byModule[f.module] = byModule[f.module] || []).push(f); });
    return Object.entries(byModule).sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  const keyInvalid = !isEdit && (!roleKey || !ROLE_KEY_RE.test(roleKey));
  const canSubmit = name.trim() && !keyInvalid && !saving;

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body = {
        role_key: roleKey.trim(),
        name: name.trim(),
        description: description.trim(),
        default_level: defaultLevel,
        // Full-set: tiap features di katalog dikirim eksplisit (paket stabil).
        permissions: catalog.map((f) => ({ feature_id: f.id, level: perms[f.id] || defaultLevel })),
      };
      const res = await fetch(`${API_BASE}/auth/roles${isEdit ? `/${role.role_key}` : ''}`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) throw new Error(payload.error || 'Failed to save role');
      toast.success(isEdit ? 'Role updated — all its users follow' : 'Role created');
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const countLevel = (level) => catalog.filter((f) => (perms[f.id] || defaultLevel) === level).length;

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" data-modal-overlay="true">{/* deslop-allow C5: overlay sheet editor role — pola sama dengan sheet lain (klik-tutup sengaja tidak ada, cegah kehilangan isian) */}
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
              {isEdit ? <Shield size={18} /> : <Copy size={18} />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-slate-900">
                {isEdit ? `Edit ${role?.name || role?.role_key}` : mode === 'clone' ? `Clone ${role?.name || role?.role_key}` : 'Create Role'}
              </h2>
              <p className="truncate text-xs font-semibold text-slate-500">Access package — edit once, applies to every user who holds it</p>
            </div>
          </div>
          <button onClick={onClose} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" aria-label="Close"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Role key {isEdit && <span className="font-normal text-slate-400">(cannot be changed)</span>}</FieldLabel>
              <input
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                disabled={isEdit}
                className={`${inputCls} disabled:bg-slate-50`}
                placeholder="e.g. ppc"
              />
              {keyInvalid && <span className="mt-1 block text-xs font-bold text-red-600">Lowercase letters, digits, underscore; starts with a letter; max 32 chars</span>}
            </label>
            <label className="block">
              <FieldLabel>Name</FieldLabel>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. PPC" />
            </label>
            <label className="block sm:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="What this role is for (optional)" />
            </label>
            <div className="sm:col-span-2">
              <FieldLabel>Default level</FieldLabel>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-500">Applied to features not listed here (future features).</p>
                <SegmentedLevel value={defaultLevel} onChange={setDefaultLevel} />
              </div>
            </div>
          </div>

          {/* Isi paket */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-slate-900">Package access</h3>
              <p className="text-xs font-semibold text-slate-500">{catalog.length} features · Full {countLevel(LEVELS.FULL_ACCESS)} · Read {countLevel(LEVELS.READ_ONLY)}</p>
            </div>
            <div className="space-y-3">
              {groups.map(([module, features]) => (
                <div key={module} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-400">{module}</div>
                  <div className="divide-y divide-slate-100">
                    {features.map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{f.label}</span>
                        <SegmentedLevel compact value={perms[f.id] || defaultLevel} onChange={(lvl) => setPerms((cur) => ({ ...cur, [f.id]: lvl }))} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button onClick={onClose} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">Cancel</button>
          <button onClick={save} disabled={!canSubmit} className="inline-flex min-h-[44px] min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-5 text-sm font-extrabold text-white hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
