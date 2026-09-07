import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Lock, Pencil, Plus, RefreshCw, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { usePermissions, useAuth } from '../../rbac';
import RolesTab from '../../features/rbac/RolesTab';
import UserEditorSheet from '../../features/rbac/UserEditorSheet';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_TONE = {
  administrator: 'border-purple-200 bg-purple-50 text-purple-700',
  supervisor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  foreman: 'border-amber-200 bg-amber-50 text-amber-700',
  warehouse: 'border-sky-200 bg-sky-50 text-sky-700',
  user: 'border-slate-200 bg-slate-50 text-slate-600',
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function RoleBadge({ role, className = '' }) {
  const key = String(role || '').toLowerCase();
  const tone = ROLE_TONE[key] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${tone} ${className}`}>
      {role || '-'}
    </span>
  );
}

// Manage Users: tab Users (akun + override per-user + role paket per user) dan
// tab Roles (kelola paket akses). Fitur role paket — docs/planning/rbac-role-paket.md.
export default function ManageUsersPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { canWrite } = usePermissions();
  const canManage = canWrite('manage_users');

  const [tab, setTab] = useState('users'); // 'users' | 'roles'
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null); // user object | { } for new | null closed

  const authHeaders = useMemo(() => ({
    'x-user-role': authUser?.roles || '',
    'x-user-id': authUser?.id ? String(authUser.id) : '',
  }), [authUser?.roles, authUser?.id]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => (
      String(u.username || '').toLowerCase().includes(term) ||
      String(u.name || '').toLowerCase().includes(term) ||
      String(u.roles || '').toLowerCase().includes(term)
    ));
  }, [search, users]);

  const loadUsers = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/auth/users`, { signal: controller.signal, headers: authHeaders })
      .then((response) => { if (!response.ok) throw new Error('Failed to load users'); return response.json(); })
      .then((payload) => setUsers(Array.isArray(payload) ? payload : []))
      .catch((err) => { if (err.name === 'AbortError') return; setUsers([]); toast.error('Failed to load users', { description: err.message }); })
      .finally(() => setLoading(false));
    return controller;
  }, [authHeaders]);

  useEffect(() => {
    if (tab !== 'users') return undefined;
    const controller = loadUsers();
    return () => controller.abort();
  }, [loadUsers, tab]);

  const switchTab = (next) => { setTab(next); setEditing(null); };

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate('/operations-hub')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Back"><ArrowLeft size={18} /></button>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]"><Users size={19} /></span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold text-slate-950">Manage Users</h1>
              <p className="truncate text-xs font-semibold text-slate-500">Users, roles &amp; per-feature access control</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 md:px-6" role="tablist" aria-label="Manage users sections">
          {(['users', 'roles']).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className={`relative -mb-px border-b-2 px-3 py-2.5 text-sm font-extrabold transition-colors ${
                tab === t ? 'border-[#0096c7] text-[#0077b6]' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t === 'users' ? 'Users' : 'Roles'}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 md:px-6">
        {!canManage && (
          <section className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <Lock size={16} className="shrink-0" /> Read-only access — you can view users &amp; roles but cannot create, edit, or delete.
          </section>
        )}

        {tab === 'roles' ? (
          <RolesTab authHeaders={authHeaders} canManage={canManage} />
        ) : (
          <>
            {/* Search */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="relative block w-full max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100" placeholder="Search users…" />
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-bold text-slate-500">{filteredUsers.length}{filteredUsers.length !== users.length ? ` / ${users.length}` : ''} users</span>
                <button type="button" onClick={loadUsers} disabled={loading} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-60" aria-label="Refresh">
                  {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                </button>
                {canManage && (
                  <button type="button" onClick={() => setEditing({})} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">
                    <UserPlus size={17} /> <span className="hidden sm:inline">Add User</span>
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {loading ? (
                <div className="flex flex-col items-center gap-2 py-16 text-sm font-semibold text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading users…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-16 text-center text-sm font-semibold text-slate-400">No users found.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => (
                    <li
                      key={u.id}
                      onClick={() => canManage && setEditing(u)}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${canManage ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#caf0f8] text-sm font-extrabold text-[#0077b6]">
                        {String(u.username || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-extrabold text-slate-900">{u.username}</p>
                        <p className="truncate text-xs font-semibold text-slate-500">
                          {u.name || '—'} · created {formatDateTime(u.created_at)}
                          {Array.isArray(u.role_keys) && u.role_keys.some((k) => k !== u.roles) && (
                            <span className="text-[#0077b6]"> · pkg: {u.role_keys.filter((k) => k !== u.roles).join(', ')}</span>
                          )}
                        </p>
                      </div>
                      <RoleBadge role={u.roles} className="hidden sm:inline-flex" />
                      {canManage && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(u); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0077b6]" aria-label="Edit"><Pencil size={16} /></button>
                          <button type="button" onClick={(e) => handleDelete(u, e)} disabled={deletingId === u.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label="Delete">
                            {deletingId === u.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {editing && tab === 'users' && (
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
    </div>
  );
}
