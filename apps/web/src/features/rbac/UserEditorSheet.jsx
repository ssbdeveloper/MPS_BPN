import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Eye, EyeOff, Loader2, Pencil, Save, Search, UserPlus, X } from 'lucide-react';
import SegmentedLevel from './SegmentedLevel';
import Drawer from './Drawer';
import { roleDot } from './roleTone';
import { resolveLevel } from '../../rbac/permissionMatrix';
import { FEATURES } from '../../rbac/featureRegistry';

function labelOf(id) {
  return FEATURES[id]?.label || String(id).split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function moduleOf(id) {
  return FEATURES[id]?.module || 'Other';
}

// Nama dinormalisasi saat diketik: tiap kata kapital di awal saja ("TEE SAN" -> "Tee San").
function titleize(v) {
  return String(v || '').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Username OTOMATIS dari nama: lowercase, karakter aneh (spasi dll) -> titik.
function slugUsername(name) {
  const s = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return s;
}

const inputCls = 'h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0077b6] focus:ring-2 focus:ring-[#ade8f4] disabled:cursor-not-allowed disabled:bg-slate-50';
const rowCls = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2';

// Slide-over (lebar ~setengah layar): profil + role paket + override per-fitur.
// Username dibuat otomatis dari Nama (field username nonaktif). Role = murni paket
// multi-pilih; override per-user tetap lapisan teratas (2a).
export default function UserEditorSheet({ user, apiBase, authHeaders, canManage, onClose, onSaved }) {
  const isNew = !user?.id;
  // Kolom users.role/roles tetap dipakai server utk header x-user-role (gate admin
  // & fallback) — TERSEMBUNYI di UI; baru = 'user', lama dipertahankan apa adanya.
  const [seedRole] = useState(user?.roles || 'user');
  const [name, setName] = useState(user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [overrides, setOverrides] = useState({});   // feature -> level (hanya override nyata)
  const [baseMap, setBaseMap] = useState({});       // feature -> level tanpa override (dari server)
  const [featureIds, setFeatureIds] = useState(() => Object.values(FEATURES).map((f) => f.id));
  const [rolesList, setRolesList] = useState([]);   // semua role (paket) utk picker
  const [packages, setPackages] = useState(() => (Array.isArray(user?.role_keys) ? [...user.role_keys] : []));
  const [roleSearch, setRoleSearch] = useState('');
  const [loadingPerms, setLoadingPerms] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Username (create) selalu ikut Nama — field username tidak bisa diketik.
  useEffect(() => {
    if (!isNew) return;
    setUsername(slugUsername(name));
  }, [name, isNew]);

  useEffect(() => {
    if (isNew) return undefined;
    let alive = true;
    fetch(`${apiBase}/auth/users/${user.id}/permissions`, { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => {
        if (!alive || !data.success) return;
        const ov = {};
        const base = {};
        Object.entries(data.permissions || {}).forEach(([f, v]) => {
          if (v.override) ov[f] = v.override;
          base[f] = v.base ?? v.role;
        });
        setOverrides(ov);
        setBaseMap(base);
        setFeatureIds(Object.keys(data.permissions || {}));
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingPerms(false); });
    return () => { alive = false; };
  }, [isNew, user?.id, apiBase, authHeaders]);

  // Semua role utk picker paket.
  useEffect(() => {
    let alive = true;
    fetch(`${apiBase}/auth/roles`, { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => { if (alive && data?.roles) setRolesList(data.roles); })
      .catch(() => {})
      .finally(() => {});
    return () => { alive = false; };
  }, [apiBase, authHeaders]);

  const filteredRoles = useMemo(() => {
    const term = roleSearch.trim().toLowerCase();
    if (!term) return rolesList;
    return rolesList.filter((r) => (
      String(r.name || '').toLowerCase().includes(term) ||
      String(r.role_key || '').toLowerCase().includes(term)
    ));
  }, [roleSearch, rolesList]);

  const groups = useMemo(() => {
    const byModule = {};
    featureIds.forEach((id) => { (byModule[moduleOf(id)] = byModule[moduleOf(id)] || []).push(id); });
    return Object.entries(byModule).sort((a, b) => a[0].localeCompare(b[0]));
  }, [featureIds]);

  const baselineOf = (id) => baseMap[id] ?? resolveLevel(seedRole, id);
  const effectiveOf = (id) => overrides[id] ?? baselineOf(id);
  const isOverridden = (id) => overrides[id] != null;
  const overrideCount = Object.keys(overrides).length;

  const setLevel = (id, level) => {
    setOverrides((cur) => {
      const next = { ...cur };
      if (level === baselineOf(id)) delete next[id]; // sama dengan baseline => inherit
      else next[id] = level;
      return next;
    });
  };
  const resetAll = () => setOverrides({});

  const togglePackage = (key) => {
    setPackages((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  const canSubmit = canManage && name.trim() && (!isNew || password.length >= 5);

  const save = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const userName = isNew ? slugUsername(name) || 'user' : username;
      const res = await fetch(`${apiBase}/auth/users${isNew ? '' : `/${user.id}`}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ username: userName, password, roles: seedRole, name: name.trim() || userName }),
      });
      const payload = await res.json().catch(() => ({}));
      // Username bentrok: coba akhiran .2 .3 dst (hanya saat create).
      if (isNew && res.status === 409) {
        const base = slugUsername(name) || 'user';
        let lastError = payload.error || 'Failed to create user';
        for (let attempt = 1; attempt < 6; attempt += 1) {
          const candidate = `${base}.${attempt + 1}`;
          const retry = await fetch(`${apiBase}/auth/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ username: candidate, password, roles: seedRole, name: name.trim() || candidate }),
          });
          const retryPayload = await retry.json().catch(() => ({}));
          if (retry.ok && retryPayload.success !== false) {
            return finishSave(retryPayload, candidate);
          }
          lastError = retryPayload.error || lastError;
          if (retry.status !== 409) break;
        }
        throw new Error(lastError);
      }
      if (!res.ok || payload.success === false) throw new Error(payload.error || 'Failed to save user');
      return finishSave(payload, userName);
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Lanjut simpan paket & override setelah user tersimpan (create ataupun edit).
  const finishSave = async (payload, savedUsername) => {
    const savedId = isNew ? payload.user?.id : user.id;
    if (savedId) {
      const rRes = await fetch(`${apiBase}/auth/users/${savedId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ role_keys: packages }),
      });
      const rData = await rRes.json().catch(() => ({}));
      if (!rRes.ok || rData.success === false) throw new Error(rData.error || 'User saved, but roles failed');
    }
    if (!isNew) {
      const body = {};
      featureIds.forEach((id) => { body[id] = overrides[id] ?? null; });
      const pRes = await fetch(`${apiBase}/auth/users/${user.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ overrides: body }),
      });
      const pData = await pRes.json().catch(() => ({}));
      if (!pRes.ok || pData.success === false) throw new Error(pData.error || 'User saved, but permissions failed');
    }
    toast.success(isNew ? `User created — ${savedUsername}` : 'Changes saved');
    setSaving(false);
    onSaved();
  };

  return (
    <Drawer onClose={onClose} widthClass="w-full md:w-1/2 xl:max-w-[54rem]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
            {isNew ? <UserPlus size={18} /> : <Pencil size={18} />}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold text-slate-900">{isNew ? 'Add User' : username || 'Edit User'}</h2>
            {!isNew && <p className="truncate text-xs font-semibold text-slate-500">{name || ''}</p>}
          </div>
        </div>
        <button onClick={onClose} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" aria-label="Close"><X size={18} /></button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Profil */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>Name</FieldLabel>
            <input
              value={name}
              onChange={(e) => setName(titleize(e.target.value))}
              disabled={!canManage}
              className={inputCls}
              placeholder="Full name"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <FieldLabel>Username {isNew && <span className="font-normal text-slate-400">(auto)</span>}</FieldLabel>
            <input
              value={username}
              readOnly
              tabIndex={-1}
              className={`${inputCls} cursor-not-allowed bg-slate-50 text-slate-500`}
              placeholder={isNew ? 'auto from name' : 'username'}
              autoComplete="off"
            />
          </label>
          <label className="block sm:col-span-2">
            <FieldLabel>Password {!isNew && <span className="font-normal text-slate-400">(optional)</span>}</FieldLabel>
            <span className="relative block">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canManage} className={`${inputCls} pr-12`} placeholder={isNew ? 'min. 5 characters' : 'leave blank to keep'} autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-1 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" aria-label="toggle password">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
          </label>
        </div>

        {/* Role packages — container sendiri: vertikal, bisa search, tinggi tetap */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <FieldLabel>Role packages</FieldLabel>
            <span className="text-xs font-bold tabular-nums text-slate-400">{packages.length} selected</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                disabled={!canManage}
                className="h-11 w-full bg-transparent text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Search roles"
              />
            </div>
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {filteredRoles.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs font-semibold text-slate-400">No roles found.</p>
              ) : (
                filteredRoles.map((r) => {
                  const checked = packages.includes(r.role_key);
                  return (
                    <button
                      key={r.role_key}
                      type="button"
                      disabled={!canManage}
                      onClick={() => togglePackage(r.role_key)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${
                        checked ? 'bg-[#caf0f8]/30 hover:bg-[#caf0f8]/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${roleDot(r.role_key)}`} />
                        <span className="truncate text-sm font-semibold text-slate-700">{r.name || r.role_key}</span>
                      </span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                        checked ? 'border-[#0077b6] bg-[#0077b6] text-white' : 'border-slate-300 bg-white text-transparent'
                      }`}>
                        <Check size={13} strokeWidth={3} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Override per-fitur */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-slate-900">Feature access</h3>
            {!isNew && overrideCount > 0 && (
              <button type="button" onClick={resetAll} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
                Reset to roles
              </button>
            )}
          </div>

          {loadingPerms ? (
            <div className="flex items-center gap-2 py-6 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {groups.map(([module, ids]) => (
                <div key={module} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-400">{module}</div>
                  <div className="divide-y divide-slate-100">
                    {ids.map((id) => {
                      const overridden = isOverridden(id);
                      return (
                        <div key={id} className={rowCls}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-semibold text-slate-700">{labelOf(id)}</span>
                            {overridden && <span className="shrink-0 rounded-full bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#0077b6]">Override</span>}
                          </span>
                          <SegmentedLevel compact value={effectiveOf(id)} onChange={(lvl) => setLevel(id, lvl)} disabled={isNew || !canManage} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button onClick={onClose} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none">Cancel</button>
        <button onClick={save} disabled={!canSubmit || saving} className="inline-flex min-h-[44px] min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-5 text-sm font-extrabold text-white hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {isNew ? 'Create User' : 'Save'}
        </button>
      </div>
    </Drawer>
  );
}

function FieldLabel({ children }) {
  return <span className="mb-1.5 block text-xs font-bold text-slate-600">{children}</span>;
}
