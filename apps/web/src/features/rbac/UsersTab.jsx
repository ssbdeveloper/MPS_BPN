import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2, Pencil, RefreshCw, Search, Trash2, UserPlus, Users } from 'lucide-react';
import UserEditorSheet from './UserEditorSheet';
import { roleDot } from './roleTone';

const API_BASE = import.meta.env.VITE_API_URL || '';

const MotionUl = motion.ul;
const MotionLi = motion.li;

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[#0077b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-50 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-40 max-w-full animate-pulse rounded bg-slate-100" />
        <div className="h-2.5 w-56 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="hidden h-6 w-24 animate-pulse rounded-full bg-slate-100 sm:block" />
    </div>
  );
}

// Daftar user (tab Users) — murni role packages (tanpa kolom role utama).
export default function UsersTab({ authHeaders, canManage }) {
  const reduce = useReducedMotion();
  const [users, setUsers] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null); // user object | {} utk baru | null tutup

  const rolesByName = useMemo(() => {
    const map = {};
    rolesList.forEach((r) => { map[r.role_key] = r.name || r.role_key; });
    return map;
  }, [rolesList]);
  const pkgName = (key) => rolesByName[key] || key;

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => (
      String(u.username || '').toLowerCase().includes(term) ||
      String(u.name || '').toLowerCase().includes(term) ||
      (Array.isArray(u.role_keys) && u.role_keys.some((k) => pkgName(k).toLowerCase().includes(term)))
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, users, rolesByName]);

  const stats = useMemo(() => {
    const assignments = users.reduce((n, u) => n + (Array.isArray(u.role_keys) ? u.role_keys.length : 0), 0);
    return { users: users.length, roles: rolesList.length, assignments };
  }, [users, rolesList]);

  const loadUsers = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/auth/users`, { signal: controller.signal, headers: authHeaders })
      .then((response) => { if (!response.ok) throw new Error('Failed to load users'); return response.json(); })
      .then((payload) => setUsers(Array.isArray(payload) ? payload : []))
      .catch((err) => { if (err.name === 'AbortError') return; setUsers([]); setError(err.message || 'Failed to load users'); })
      .finally(() => setLoading(false));
    return controller;
  }, [authHeaders]);

  useEffect(() => {
    const controller = loadUsers();
    return () => controller.abort();
  }, [loadUsers]);

  // Daftar role utk menampilkan NAMA paket (role key tidak ditampilkan ke user).
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/auth/roles`, { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => { if (alive && data?.roles) setRolesList(data.roles); })
      .catch(() => {})
      .finally(() => {});
    return () => { alive = false; };
  }, [authHeaders]);

  const handleDelete = async (u, e) => {
    e?.stopPropagation();
    if (!canManage || deletingId) return;
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    setDeletingId(u.id);
    try {
      const response = await fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'DELETE', headers: authHeaders });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to delete user');
      setUsers((current) => current.filter((row) => row.id !== u.id));
      toast.success('User deleted');
    } catch (err) {
      toast.error('Failed to delete user', { description: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  const listVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.03 } },
  };
  const rowVariants = {
    hidden: { opacity: 0, y: reduce ? 0 : 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  };

  const colHead = 'px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400';
  const pkgChip = (key) => (
    <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${roleDot(key)}`} />
      {pkgName(key)}
    </span>
  );

  return (
    <div>
      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Users" value={stats.users} />
        <Stat label="Roles" value={stats.roles} />
        <Stat label="Assignments" value={stats.assignments} />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0077b6] focus:ring-2 focus:ring-[#ade8f4]"
            placeholder="Search users, packages…"
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tabular-nums text-slate-500">{filteredUsers.length}{filteredUsers.length !== users.length ? ` / ${users.length}` : ''} users</span>
          <IconBtn label="Refresh" onClick={loadUsers} disabled={loading}>
            <Loader2 size={17} className={loading ? 'animate-spin' : 'hidden'} />
            <RefreshCw size={17} className={loading ? 'hidden' : ''} />
          </IconBtn>
          {canManage && (
            <button type="button" onClick={() => setEditing({})} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
              <UserPlus size={17} /> <span className="hidden sm:inline">Add User</span>
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <section className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <span>{error}</span>
          <button type="button" onClick={loadUsers} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
            <RefreshCw size={14} /> Try again
          </button>
        </section>
      )}

      {/* List */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {!loading && !error && filteredUsers.length > 0 && (
          <div className="hidden border-b border-slate-100 bg-slate-50/60 md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.8fr)_minmax(0,0.9fr)_auto]">
            <div className={colHead}>User</div>
            <div className={colHead}>Packages</div>
            <div className={`${colHead} text-right`}>Created</div>
            <div className={colHead} />
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-slate-100">
            {[...Array(6)].map((_, i) => <RowSkeleton key={i} />)}
          </div>
        ) : error ? null : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm font-semibold text-slate-400">
            <Users size={20} className="text-slate-300" />
            {users.length === 0 ? 'No users found.' : 'No users match your search.'}
          </div>
        ) : (
          <MotionUl variants={listVariants} initial="hidden" animate="show" className="divide-y divide-slate-100">
            <AnimatePresence initial={false}>
              {filteredUsers.map((u) => {
                const keys = Array.isArray(u.role_keys) ? u.role_keys : [];
                return (
                  <MotionLi
                    key={u.id}
                    layout
                    variants={rowVariants}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                    onClick={() => canManage && setEditing(u)}
                    className={`group transition-colors md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.8fr)_minmax(0,0.9fr)_auto] md:items-center ${
                      canManage ? 'cursor-pointer hover:bg-slate-50' : ''
                    }`}
                  >
                    {/* User + chips (mobile) */}
                    <div className="flex items-center gap-3 px-4 pt-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#caf0f8] text-sm font-extrabold text-[#0077b6]">
                        {String(u.username || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-extrabold text-slate-900">{u.username}</p>
                        <p className="truncate text-xs font-semibold text-slate-500">{u.name || '—'}</p>
                      </div>
                    </div>
                    {keys.length > 0 && (
                      <div className="flex flex-wrap gap-1 px-4 pb-1 pt-2 md:hidden">{keys.map(pkgChip)}</div>
                    )}
                    {/* Packages (desktop) */}
                    <div className="hidden px-4 py-3 md:flex md:flex-wrap md:items-center md:gap-1">
                      {keys.length > 0 ? keys.map(pkgChip) : <span className="text-xs font-semibold text-slate-300">—</span>}
                    </div>
                    {/* Created */}
                    <div className="px-4 pb-2 text-xs font-semibold tabular-nums text-slate-500 md:py-3 md:text-right">
                      {formatDateTime(u.created_at)}
                    </div>
                    {/* Actions */}
                    <div className="flex shrink-0 items-center justify-end gap-0.5 px-2 pb-3 md:py-3">
                      {canManage && (
                        <>
                          <IconBtn label="Edit" onClick={(e) => { e.stopPropagation(); setEditing(u); }}>
                            <Pencil size={16} />
                          </IconBtn>
                          <IconBtn label="Delete" onClick={(e) => handleDelete(u, e)} disabled={deletingId === u.id}>
                            {deletingId === u.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </IconBtn>
                        </>
                      )}
                    </div>
                  </MotionLi>
                );
              })}
            </AnimatePresence>
          </MotionUl>
        )}
      </section>

      {/* Footer */}
      {!loading && !error && filteredUsers.length > 0 && (
        <div className="mt-2 text-right text-xs font-bold tabular-nums text-slate-400">
          Showing {filteredUsers.length} of {users.length} users
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <UserEditorSheet
            key={editing.id || 'new'}
            user={editing}
            apiBase={API_BASE}
            authHeaders={authHeaders}
            canManage={canManage}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); loadUsers(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
