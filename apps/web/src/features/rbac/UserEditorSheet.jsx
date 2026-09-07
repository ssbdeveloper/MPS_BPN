import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Pencil, Save, UserPlus, X } from 'lucide-react';
import SegmentedLevel from './SegmentedLevel';
import { ROLES, LEVELS, resolveLevel } from '../../rbac/permissionMatrix';
import { FEATURES } from '../../rbac/featureRegistry';

function labelOf(id) {
  return FEATURES[id]?.label || String(id).split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function moduleOf(id) {
  return FEATURES[id]?.module || 'Other';
}

const FieldLabel = ({ children }) => (<span className="mb-1.5 block text-xs font-bold text-slate-600">{children}</span>);

const inputCls = 'h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50';

// Slide-over: profile + role packages + per-feature override dalam satu tempat.
// - Role utama (legacy, satu) = select di atas; dipakai badge & gate admin.
// - Role paket (tambahan, banyak) = chips; akses efektif = gabungan level tertinggi.
// - Override per-user tetap lapisan teratas (2a); baseline "clear" = `base` dari server
//   (level role paket tanpa override) supaya grid akurat walau paket menaikkan level.
export default function UserEditorSheet({ user, apiBase, authHeaders, canManage, onClose, onSaved }) {
  const isNew = !user?.id;
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.roles || 'foreman');
  const [showPassword, setShowPassword] = useState(false);
  const [overrides, setOverrides] = useState({});   // feature -> level (hanya override nyata)
  const [baseMap, setBaseMap] = useState({});       // feature -> level tanpa override (dari server)
  const [featureIds, setFeatureIds] = useState(() => Object.values(FEATURES).map((f) => f.id));
  const [rolesList, setRolesList] = useState([]);   // semua role (paket) utk chips
  const [packages, setPackages] = useState(() => {
    const owned = user?.role_keys || [];
    return owned.filter((k) => k !== user?.roles);  // role utama ditampilkan terpisah
  });
  const [loadingPerms, setLoadingPerms] = useState(!isNew);
  const [saving, setSaving] = useState(false);

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

  // Semua role utk chips paket (server menambahkan role utama otomatis saat simpan).
  useEffect(() => {
    let alive = true;
    fetch(`${apiBase}/auth/roles`, { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => { if (alive && data?.roles) setRolesList(data.roles); })
      .catch(() => {})
      .finally(() => {});
    return () => { alive = false; };
  }, [apiBase, authHeaders]);

  const groups = useMemo(() => {
    const byModule = {};
    featureIds.forEach((id) => { (byModule[moduleOf(id)] = byModule[moduleOf(id)] || []).push(id); });
    return Object.entries(byModule).sort((a, b) => a[0].localeCompare(b[0]));
  }, [featureIds]);

  const baselineOf = (id) => baseMap[id] ?? resolveLevel(role, id);
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

  const canSubmit = canManage && username.trim() && role && (!isNew || password.length >= 5);

  const save = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/auth/users${isNew ? '' : `/${user.id}`}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ username: username.trim(), password, roles: role }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) throw new Error(payload.error || 'Failed to save user');
      const savedId = isNew ? payload.user?.id : user.id;

      // Simpan role paket (role utama otomatis dipertahankan server-side).
      if (savedId) {
        const rRes = await fetch(`${apiBase}/auth/users/${savedId}/roles`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ role_keys: packages }),
        });
        const rData = await rRes.json().catch(() => ({}));
        if (!rRes.ok || rData.success === false) throw new Error(rData.error || 'User saved, but roles failed');
      }

      // Simpan override per-user (kirim semua fitur: level atau null).
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
      toast.success(isNew ? 'User created' : 'Changes saved');
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" data-modal-overlay="true">{/* deslop-allow C5: overlay sheet editor user — pola sama dengan sheet lain */}
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
              {isNew ? <UserPlus size={18} /> : <Pencil size={18} />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-slate-900">{isNew ? 'Add User' : username || 'Edit User'}</h2>
              {!isNew && <p className="truncate text-xs font-semibold text-slate-500">{user?.name || 'Profile & access'}</p>}
            </div>
          </div>
          <button onClick={onClose} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]" aria-label="Close"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Profile */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <FieldLabel>Username</FieldLabel>
              <input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canManage} className={inputCls} placeholder="username" autoComplete="username" />
            </label>
            <label className="block">
              <FieldLabel>Password {!isNew && <span className="font-normal text-slate-400">(optional)</span>}</FieldLabel>
              <span className="relative block">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canManage} className={`${inputCls} pr-11`} placeholder={isNew ? 'min. 5 characters' : 'leave blank to keep'} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="toggle">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
            </label>
            <label className="block">
              <FieldLabel>Main role</FieldLabel>
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={!canManage} className={`${inputCls} bg-white`}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>

          {/* Role packages */}
          <div className="mt-4">
            <FieldLabel>Role packages <span className="font-normal text-slate-400">(extra, can stack)</span></FieldLabel>
            {rolesList.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400">Loading roles…</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {rolesList.map((r) => {
                  const isMain = r.role_key === role;
                  const active = isMain || packages.includes(r.role_key);
                  return (
                    <button
                      key={r.role_key}
                      type="button"
                      disabled={isMain || !canManage}
                      onClick={() => togglePackage(r.role_key)}
                      title={isMain ? 'Main role — always held' : r.description || r.role_key}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold transition-colors ${
                        active
                          ? 'border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      } ${isMain || !canManage ? 'cursor-not-allowed opacity-70' : ''}`}
                    >
                      {r.name || r.role_key} {isMain && <span className="text-[11px] font-black uppercase opacity-60">main</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              Effective access = highest level across all held roles (main role is always held).
            </p>
          </div>

          {/* Access overrides */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Feature access</h3>
                <p className="text-xs text-slate-500">
                  {isNew ? 'Derived from role packages. Save first to set per-user overrides.' : 'Override where this user must differ from their roles.'}
                </p>
              </div>
              {!isNew && overrideCount > 0 && (
                <button type="button" onClick={resetAll} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
                  Reset to roles
                </button>
              )}
            </div>

            {loadingPerms ? (
              <div className="flex items-center gap-2 py-6 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : (
              <div className="space-y-3">
                {groups.map(([module, ids]) => (
                  <div key={module} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-400">{module}</div>
                    <div className="divide-y divide-slate-100">
                      {ids.map((id) => {
                        const overridden = isOverridden(id);
                        return (
                          <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-slate-700">{labelOf(id)}</span>
                              {overridden && <span className="shrink-0 rounded-full bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#0077b6]">Override</span>}
                            </div>
                            <SegmentedLevel value={effectiveOf(id)} onChange={(lvl) => setLevel(id, lvl)} disabled={isNew || !canManage} />
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
      </div>
    </div>
  );
}
