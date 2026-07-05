import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { usePermissions, useAuth } from '../../rbac';
import { ROLES, LEVELS, resolveLevel } from '../../rbac/permissionMatrix';
import { FEATURES } from '../../rbac/featureRegistry';

const API_BASE = import.meta.env.VITE_API_URL || '';

const emptyForm = {
  id: null,
  username: '',
  password: '',
  roles: 'foreman',
};

const ROLE_TONE = {
  administrator: 'border-purple-200 bg-purple-50 text-purple-700',
  supervisor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  foreman: 'border-amber-200 bg-amber-50 text-amber-700',
  warehouse: 'border-sky-200 bg-sky-50 text-sky-700',
  user: 'border-slate-200 bg-slate-50 text-slate-600',
};

const LEVEL_META = {
  [LEVELS.FULL_ACCESS]: { label: 'Full', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  [LEVELS.READ_ONLY]: { label: 'Read', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  [LEVELS.NO_ACCESS]: { label: 'None', cls: 'border-slate-200 bg-slate-100 text-slate-400' },
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RoleBadge({ role }) {
  const key = String(role || '').toLowerCase();
  const tone = ROLE_TONE[key] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${tone}`}>
      {role || '-'}
    </span>
  );
}

// Live view of what a role grants — read straight from the central matrix.
function AccessPreview({ role }) {
  const groups = useMemo(() => {
    const byModule = {};
    Object.values(FEATURES).forEach((f) => {
      const level = resolveLevel(role, f.id);
      (byModule[f.module] = byModule[f.module] || []).push({ ...f, level });
    });
    return Object.entries(byModule).sort((a, b) => a[0].localeCompare(b[0]));
  }, [role]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <ShieldCheck size={16} className="text-[#0077b6]" />
        <h2 className="text-sm font-extrabold text-slate-900">Access preview</h2>
        <RoleBadge role={role} />
      </div>
      <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
        {groups.map(([module, items]) => (
          <div key={module}>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{module}</p>
            <ul className="space-y-1">
              {items.map((f) => {
                const meta = LEVEL_META[f.level] || LEVEL_META[LEVELS.NO_ACCESS];
                return (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-600">{f.label}</span>
                    <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-slate-400">
        Diatur terpusat di <span className="font-mono">rbac/permissionMatrix.js</span>. Frontend = UX; API tetap harus validasi.
      </p>
    </section>
  );
}

export default function ManageUsersPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { canWrite } = usePermissions();
  const canManage = canWrite('manage_users'); // write gate (route already blocks no_access)

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const authHeaders = useMemo(() => ({
    'x-user-role': authUser?.roles || '',
  }), [authUser?.roles]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => (
      String(u.username || '').toLowerCase().includes(term) ||
      String(u.name || '').toLowerCase().includes(term) ||
      String(u.roles || '').toLowerCase().includes(term)
    ));
  }, [search, users]);

  const isEditing = Boolean(form.id);
  const canSubmit = canManage && form.username.trim() && form.roles && (isEditing || form.password.length >= 5);

  const loadUsers = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch(`${API_BASE}/auth/users`, { signal: controller.signal, headers: authHeaders })
      .then((response) => {
        if (!response.ok) throw new Error('Gagal load users');
        return response.json();
      })
      .then((payload) => setUsers(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setUsers([]);
        toast.error('Gagal load users', { description: err.message });
      })
      .finally(() => setLoading(false));

    return controller;
  }, [authHeaders]);

  useEffect(() => {
    const controller = loadUsers();
    return () => controller.abort();
  }, [loadUsers]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm);
    setShowPassword(false);
  };

  const handleEdit = (u) => {
    if (!canManage) return;
    setForm({ id: u.id, username: u.username || '', password: '', roles: u.roles || 'user' });
    setShowPassword(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || saving) return;

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/users${isEditing ? `/${form.id}` : ''}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ username: form.username.trim(), password: form.password, roles: form.roles }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Gagal simpan user');
      }
      toast.success(isEditing ? 'User berhasil diupdate' : 'User berhasil dibuat');
      resetForm();
      loadUsers();
    } catch (err) {
      toast.error('Gagal simpan user', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u) => {
    if (!canManage || deletingId) return;
    if (!window.confirm(`Hapus user ${u.username}?`)) return;

    setDeletingId(u.id);
    try {
      const response = await fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'DELETE', headers: authHeaders });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Gagal hapus user');
      }
      setUsers((current) => current.filter((row) => row.id !== u.id));
      if (form.id === u.id) resetForm();
      toast.success('User berhasil dihapus');
    } catch (err) {
      toast.error('Gagal hapus user', { description: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
              <Users size={19} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold text-slate-950">Manage Users</h1>
              <p className="truncate text-xs font-semibold text-slate-500">Kelola username, password, dan role akses login</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
            Refresh
          </button>
        </div>
      </header>

      <main className="grid gap-4 px-4 py-4 md:px-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {!canManage && (
          <section className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 xl:col-span-2">
            <Lock size={16} className="flex-shrink-0" />
            Mode read-only — role kamu bisa melihat daftar user tapi tidak bisa membuat, mengubah, atau menghapus.
          </section>
        )}

        {/* Left column: form + access preview */}
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-extrabold text-slate-900">{isEditing ? 'Edit User' : 'Register User'}</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <label className="block">
                <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Username</span>
                <input
                  value={form.username}
                  onChange={(event) => updateForm('username', event.target.value)}
                  disabled={!canManage}
                  className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  placeholder="username"
                  autoComplete="username"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
                  Password {isEditing ? '(kosongkan jika tidak diubah)' : ''}
                </span>
                <span className="relative block">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => updateForm('password', event.target.value)}
                    disabled={!canManage}
                    className="h-11 w-full rounded-lg border border-slate-200 px-3 pr-11 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder={isEditing ? 'password baru optional' : 'password'}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Role</span>
                <select
                  value={form.roles}
                  onChange={(event) => updateForm('roles', event.target.value)}
                  disabled={!canManage}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                {isEditing && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                  >
                    <X size={16} />
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!canSubmit || saving}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : isEditing ? <Save size={16} /> : <Plus size={16} />}
                  {isEditing ? 'Update' : 'Register'}
                </button>
              </div>
            </form>
          </section>

          <AccessPreview role={form.roles} />
        </div>

        {/* Right column: users table */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Registered Users</h2>
              <p className="text-xs font-semibold text-slate-500">{filteredUsers.length} dari {users.length} user</p>
            </div>
            <label className="relative block w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
                placeholder="Search users"
              />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">Username</th>
                  <th className="px-4 py-3 font-bold">Role</th>
                  <th className="px-4 py-3 font-bold">Created</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Loading users
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">Belum ada user.</td>
                  </tr>
                ) : filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f7fb] text-[#0077b6]">
                          <KeyRound size={17} />
                        </span>
                        <div>
                          <p className="font-extrabold text-slate-900">{u.username}</p>
                          <p className="text-xs font-semibold text-slate-500">{u.name || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={u.roles} /></td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-500">{formatDateTime(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(u)}
                          disabled={!canManage}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={!canManage || deletingId === u.id}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-extrabold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
