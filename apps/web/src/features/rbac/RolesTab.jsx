import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import RoleEditorSheet from './RoleEditorSheet';
import { LEVELS } from '../../rbac/permissionMatrix';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_TONE = {
  administrator: 'border-purple-200 bg-purple-50 text-purple-700',
  supervisor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  foreman: 'border-amber-200 bg-amber-50 text-amber-700',
  warehouse: 'border-sky-200 bg-sky-50 text-sky-700',
  user: 'border-slate-200 bg-slate-50 text-slate-600',
};

function levelLabel(level) {
  return level === LEVELS.FULL_ACCESS ? 'Full' : level === LEVELS.READ_ONLY ? 'Read' : 'None';
}

// Daftar role paket (tab Roles). Role sistem (is_system) tetap bisa diedit &
// di-clone (keputusan 3b); hapus diblokir selama masih dipakai user (4a).
export default function RolesTab({ authHeaders, canManage }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { mode, role } | null
  const [deletingKey, setDeletingKey] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/auth/roles`, { headers: authHeaders })
      .then((res) => { if (!res.ok) throw new Error('Failed to load roles'); return res.json(); })
      .then((data) => setRoles(Array.isArray(data?.roles) ? data.roles : []))
      .catch((err) => { setRoles([]); toast.error('Failed to load roles', { description: err.message }); })
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (role) => {
    if (!canManage || deletingKey) return;
    if (role.user_count > 0) {
      toast.error(`Role is still used by ${role.user_count} user${role.user_count === 1 ? '' : 's'}`, {
        description: 'Detach it from those users first (Users tab), then delete (4a).',
      });
      return;
    }
    if (!window.confirm(`Delete role "${role.name || role.role_key}"?`)) return;
    setDeletingKey(role.role_key);
    try {
      const res = await fetch(`${API_BASE}/auth/roles/${role.role_key}`, { method: 'DELETE', headers: authHeaders });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) throw new Error(payload.error || 'Failed to delete role');
      setRoles((cur) => cur.filter((r) => r.role_key !== role.role_key));
      toast.success('Role deleted');
    } catch (err) {
      toast.error('Failed to delete role', { description: err.message });
    } finally {
      setDeletingKey(null);
    }
  };

  const countLevel = (role, level) => Object.values(role.permissions || {}).filter((lvl) => lvl === level).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-500">
          Roles are access packages — assign them to users, then edit here to update everyone at once.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-60" aria-label="Refresh">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          </button>
          {canManage && (
            <button type="button" onClick={() => setEditing({ mode: 'create', role: null })} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
              <Plus size={17} /> Create Role
            </button>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-14 text-sm font-semibold text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading roles…</div>
        ) : roles.length === 0 ? (
          <div className="py-14 text-center text-sm font-semibold text-slate-400">No roles yet — create the first access package.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {roles.map((r) => {
              const tone = ROLE_TONE[r.role_key] || 'border-slate-200 bg-slate-50 text-slate-600';
              return (
                <li key={r.role_key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase ${tone}`}>
                    {r.role_key}
                  </span>
                  {r.is_system && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">
                      <ShieldCheck size={11} /> System
                    </span>
                  )}
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-extrabold text-slate-900">{r.name}</p>
                    {r.description && <p className="truncate text-xs font-semibold text-slate-500">{r.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700">Full {countLevel(r, LEVELS.FULL_ACCESS)}</span>
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700">Read {countLevel(r, LEVELS.READ_ONLY)}</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500">Default {levelLabel(r.default_level)}</span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-slate-500">
                    <Users size={13} /> {r.user_count}
                  </span>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => setEditing({ mode: 'edit', role: r })} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0077b6]" aria-label="Edit"><Pencil size={16} /></button>
                      <button type="button" onClick={() => setEditing({ mode: 'clone', role: r })} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0077b6]" aria-label="Clone"><Copy size={16} /></button>
                      <button type="button" onClick={() => handleDelete(r)} disabled={deletingKey === r.role_key} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label="Delete">
                        {deletingKey === r.role_key ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && (
        <RoleEditorSheet
          role={editing.role}
          mode={editing.mode}
          authHeaders={authHeaders}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
