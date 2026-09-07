import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Copy, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users } from 'lucide-react';

const MotionDiv = motion.div;
const MotionArticle = motion.article;
import RoleBadge from './RoleBadge';
import RoleEditorSheet from './RoleEditorSheet';
import { LEVELS } from '../../rbac/permissionMatrix';

const API_BASE = import.meta.env.VITE_API_URL || '';

function levelLabel(level) {
  return level === LEVELS.FULL_ACCESS ? 'Full' : level === LEVELS.READ_ONLY ? 'Read' : 'None';
}
function levelTone(level) {
  return level === LEVELS.FULL_ACCESS
    ? 'bg-[#f0fdf4] text-[#047857]'
    : level === LEVELS.READ_ONLY
      ? 'bg-[#fffbeb] text-[#b45309]'
      : 'bg-slate-100 text-slate-500';
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function CardIconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-50 motion-reduce:transition-none ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:text-[#0077b6]'
      }`}
    >
      {children}
    </button>
  );
}

// Daftar role paket (tab Roles) — kartu grid full-width di desktop.
// Role sistem (is_system) tetap bisa diedit & di-clone (3b);
// hapus diblokir selama masih dipakai user (4a).
export default function RolesTab({ authHeaders, canManage }) {
  const reduce = useReducedMotion();
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { mode, role } | null
  const [deletingKey, setDeletingKey] = useState(null);

  const filteredRoles = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return roles;
    return roles.filter((r) => (
      String(r.name || '').toLowerCase().includes(term) ||
      String(r.role_key || '').toLowerCase().includes(term) ||
      String(r.description || '').toLowerCase().includes(term)
    ));
  }, [search, roles]);

  const stats = useMemo(() => {
    const users = roles.reduce((n, r) => n + (r.user_count || 0), 0);
    return { roles: roles.length, system: roles.filter((r) => r.is_system).length, assignments: users };
  }, [roles]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/auth/roles`, { headers: authHeaders })
      .then((res) => { if (!res.ok) throw new Error('Failed to load roles'); return res.json(); })
      .then((data) => setRoles(Array.isArray(data?.roles) ? data.roles : []))
      .catch((err) => { setRoles([]); setError(err.message || 'Failed to load roles'); })
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

  const cardVariants = {
    hidden: { opacity: 0, y: reduce ? 0 : 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  };

  return (
    <div>
      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total roles" value={stats.roles} />
        <Stat label="System roles" value={stats.system} />
        <Stat label="Assignments" value={stats.assignments} />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0077b6] focus:ring-2 focus:ring-[#ade8f4]"
            placeholder="Search roles…"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={load} disabled={loading} aria-label="Refresh" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-60 motion-reduce:transition-none">
            <Loader2 size={17} className={loading ? 'animate-spin' : 'hidden'} />
            <RefreshCw size={17} className={loading ? 'hidden' : ''} />
          </button>
          {canManage && (
            <button type="button" onClick={() => setEditing({ mode: 'create', role: null })} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
              <Plus size={17} /> Create Role
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <section className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <span>{error}</span>
          <button type="button" onClick={load} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
            <RefreshCw size={14} /> Try again
          </button>
        </section>
      )}

      {/* Grid kartu */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : error ? null : filteredRoles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm font-semibold text-slate-400">
          <ShieldCheck size={20} className="text-slate-300" />
          {roles.length === 0 ? 'No roles yet — create the first access package.' : 'No roles match your search.'}
        </div>
      ) : (
        <MotionDiv
          layout
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.04 } } }}
          initial="hidden"
          animate="show"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          <AnimatePresence initial={false}>
            {filteredRoles.map((r) => (
              <MotionArticle
                key={r.role_key}
                layout
                variants={cardVariants}
                exit={{ opacity: 0, scale: reduce ? 0.98 : 0.96, transition: { duration: 0.16 } }}
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RoleBadge role={r.role_key} />
                    {r.is_system && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">
                        <ShieldCheck size={11} /> System
                      </span>
                    )}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-slate-500" title="Users holding this role">
                    <Users size={13} /> {r.user_count}
                  </span>
                </div>

                <h3 className="mt-2.5 truncate text-base font-extrabold text-slate-900">{r.name || r.role_key}</h3>
                <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs font-semibold text-slate-500">
                  {r.description || '—'}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className={`rounded-md px-1.5 py-0.5 ${levelTone(LEVELS.FULL_ACCESS)}`}>Full {countLevel(r, LEVELS.FULL_ACCESS)}</span>
                  <span className={`rounded-md px-1.5 py-0.5 ${levelTone(LEVELS.READ_ONLY)}`}>Read {countLevel(r, LEVELS.READ_ONLY)}</span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500">Default {levelLabel(r.default_level)}</span>
                </div>

                {canManage && (
                  <div className="mt-3 flex items-center justify-end gap-0.5 border-t border-slate-100 pt-2">
                    <CardIconBtn label="Edit" onClick={() => setEditing({ mode: 'edit', role: r })}>
                      <Pencil size={16} />
                    </CardIconBtn>
                    <CardIconBtn label="Clone" onClick={() => setEditing({ mode: 'clone', role: r })}>
                      <Copy size={16} />
                    </CardIconBtn>
                    <CardIconBtn label="Delete" danger onClick={() => handleDelete(r)} disabled={deletingKey === r.role_key}>
                      {deletingKey === r.role_key ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </CardIconBtn>
                  </div>
                )}
              </MotionArticle>
            ))}
          </AnimatePresence>
        </MotionDiv>
      )}

      <AnimatePresence>
        {editing && (
          <RoleEditorSheet
            role={editing.role}
            mode={editing.mode}
            authHeaders={authHeaders}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
