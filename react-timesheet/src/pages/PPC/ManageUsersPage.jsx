import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const ROLE_OPTIONS = ['administrator', 'foreman', 'warehouse', 'supervisor', 'user'];

const emptyForm = {
  id: null,
  username: '',
  password: '',
  roles: 'foreman',
};

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

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
  const normalized = String(role || '').toLowerCase();
  const tone = normalized === 'administrator'
    ? 'border-purple-200 bg-purple-50 text-purple-700'
    : normalized === 'foreman'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : normalized === 'warehouse'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${tone}`}>
      {role || '-'}
    </span>
  );
}

export default function ManageUsersPage() {
  const navigate = useNavigate();
  const [authUser] = useState(readAuthUser);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const isAdministrator = String(authUser?.roles || '').toLowerCase() === 'administrator';
  const authHeaders = useMemo(() => ({
    'x-user-role': authUser?.roles || '',
  }), [authUser?.roles]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => (
      String(user.username || '').toLowerCase().includes(term) ||
      String(user.name || '').toLowerCase().includes(term) ||
      String(user.roles || '').toLowerCase().includes(term)
    ));
  }, [search, users]);

  const isEditing = Boolean(form.id);
  const canSubmit = form.username.trim() && form.roles && (isEditing || form.password.length >= 5);

  const loadUsers = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch(`${API_BASE}/auth/users`, {
      signal: controller.signal,
      headers: authHeaders,
    })
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
    if (!isAdministrator) {
      setLoading(false);
      return undefined;
    }

    const controller = loadUsers();
    return () => controller.abort();
  }, [isAdministrator, loadUsers]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setShowPassword(false);
  };

  const handleEdit = (user) => {
    setForm({
      id: user.id,
      username: user.username || '',
      password: '',
      roles: user.roles || 'user',
    });
    setShowPassword(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isAdministrator || !canSubmit || saving) return;

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/users${isEditing ? `/${form.id}` : ''}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          roles: form.roles,
        }),
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

  const handleDelete = async (user) => {
    if (!isAdministrator || deletingId) return;
    const confirmed = window.confirm(`Hapus user ${user.username}?`);
    if (!confirmed) return;

    setDeletingId(user.id);
    try {
      const response = await fetch(`${API_BASE}/auth/users/${user.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Gagal hapus user');
      }

      setUsers((current) => current.filter((row) => row.id !== user.id));
      if (form.id === user.id) resetForm();
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
              onClick={() => navigate('/manage-user')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold text-slate-950">Users</h1>
              <p className="truncate text-xs font-semibold text-slate-500">Register username, password, dan roles login</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            disabled={!isAdministrator || loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
            Refresh
          </button>
        </div>
      </header>

      <main className="grid gap-4 px-4 py-4 md:px-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {!isAdministrator && (
          <section className="xl:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            Hanya role administrator yang bisa membuka dan mengubah Manage Users.
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-extrabold text-slate-900">
              {isEditing ? 'Edit User' : 'Register User'}
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <label className="block">
              <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Username</span>
              <input
                value={form.username}
                onChange={(event) => updateForm('username', event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
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
                  className="h-11 w-full rounded-lg border border-slate-200 px-3 pr-11 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
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
              <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Roles</span>
              <select
                value={form.roles}
                onChange={(event) => updateForm('roles', event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
              >
                {ROLE_OPTIONS.map((role) => (
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
                disabled={!isAdministrator || !canSubmit || saving}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : isEditing ? <Save size={16} /> : <Plus size={16} />}
                {isEditing ? 'Update' : 'Register'}
              </button>
            </div>
          </form>
        </section>

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
                  <th className="px-4 py-3 font-bold">Roles</th>
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
                    <td colSpan={4} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                      Belum ada user.
                    </td>
                  </tr>
                ) : filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f7fb] text-[#0077b6]">
                          <KeyRound size={17} />
                        </span>
                        <div>
                          <p className="font-extrabold text-slate-900">{user.username}</p>
                          <p className="text-xs font-semibold text-slate-500">{user.name || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={user.roles} /></td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-500">{formatDateTime(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(user)}
                          disabled={!isAdministrator}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-extrabold text-white hover:bg-[#0077b6]"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(user)}
                          disabled={!isAdministrator || deletingId === user.id}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-extrabold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === user.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
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
