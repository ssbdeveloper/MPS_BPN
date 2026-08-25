import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, Users, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function EwsForemanTeamPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedForeman, setSelectedForeman] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const authUser = useMemo(() => JSON.parse(sessionStorage.getItem('authUser') || 'null'), []);
  const myId = authUser?.id != null ? String(authUser.id) : null;
  const isForeman = String(authUser?.roles || '').toLowerCase().includes('foreman');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/foreman-team`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      const d = payload.data;
      setData(d);
      if (!selectedForeman && d.foremen?.length) {
        setSelectedForeman(isForeman ? myId : String(d.foremen[0].id));
      }
    } catch (err) {
      setError(err.message || 'Failed to load foreman team');
    } finally {
      setLoading(false);
    }
  }, [isForeman, myId, selectedForeman]);

  useEffect(() => { load(); }, [load]);

  const members = data?.members || [];
  const operators = data?.operators || [];
  const foremen = data?.foremen || [];

  const membersOf = (uid) => members.filter((m) => String(m.foreman_user_id) === String(uid));
  const assignedTo = useMemo(() => {
    const m = {};
    for (const mem of members) m[mem.member_serialnumber] = mem.foreman_user_id;
    return m;
  }, [members]);

  const filteredOperators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? operators.filter((o) => (o.full_name || '').toLowerCase().includes(q) || String(o.snssb).includes(q)) : operators;
  }, [operators, search]);

  const assign = useCallback(async (foremanId, sn) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/foreman-team/member`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foreman_user_id: Number(foremanId), member_serialnumber: sn, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const f = foremen.find((x) => String(x.id) === String(foremanId));
      toast.success(`${sn} → ${f?.name || foremanId}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to assign operator');
    } finally {
      setBusy(false);
    }
  }, [foremen, load]);

  const removeMember = useCallback(async (sn) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/ews/roster/foreman-team/member`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_serialnumber: sn }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      toast.success(`${sn} removed from team`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to remove member');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const onDrop = (e, foremanId) => {
    e.preventDefault();
    const sn = e.dataTransfer.getData('text/plain');
    if (sn) assign(foremanId, sn);
  };

  const selectedMembers = membersOf(selectedForeman);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-300 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/ews/roster')}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            aria-label="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6] shadow-sm">
            <Users size={19} />
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p>
            <h1 className="text-base font-extrabold text-slate-900 md:text-lg">Foreman Team</h1>
          </div>
        </div>
      </header>

      <main className="w-full space-y-4 px-4 py-5 md:px-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-[#0096c7]" /></div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[340px_1fr]">
            <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
              <header className="flex items-center gap-2 border-b border-slate-300 bg-slate-50/60 px-4 py-3">
                <UserRound size={15} className="text-[#0077b6]" />
                <h2 className="text-sm font-extrabold text-slate-900">Foremen</h2>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{foremen.length}</span>
              </header>
              <div className="max-h-[70vh] overflow-y-auto p-2">
                {foremen.map((f) => {
                  const n = membersOf(f.id).length;
                  const isMe = String(f.id) === myId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedForeman(String(f.id))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDrop(e, f.id)}
                      className={`mb-1.5 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                        String(f.id) === String(selectedForeman)
                          ? 'border-[#0096c7] bg-[#caf0f8]/50 ring-1 ring-[#0096c7]'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#0077b6] text-[11px] font-black text-white">
                        {(f.name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-extrabold text-slate-800">
                          {f.name}
                          {isMe && <span className="ml-1.5 rounded-full bg-[#0077b6] px-1.5 py-0.5 text-[9px] font-black text-white">YOU</span>}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-slate-400">{f.username}</span>
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-600">{n}</span>
                    </button>
                  );
                })}
                {foremen.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">No foreman accounts yet.</div>}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
                <header className="flex items-center gap-2 border-b border-slate-300 bg-slate-50/60 px-4 py-3">
                  <UserRound size={15} className="text-[#0077b6]" />
                  <h2 className="text-sm font-extrabold text-slate-900">
                    Team of {foremen.find((f) => String(f.id) === String(selectedForeman))?.name || '—'}
                  </h2>
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-500">{selectedMembers.length}</span>
                </header>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { if (selectedForeman) onDrop(e, selectedForeman); }}
                  className="grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto p-3 md:grid-cols-2 xl:grid-cols-3"
                >
                  {selectedMembers.map((m) => (
                    <div key={m.member_serialnumber} className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-800">{m.full_name || m.member_serialnumber}</span>
                        <span className="block font-mono text-[10px] text-slate-400">{m.member_serialnumber}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMember(m.member_serialnumber)}
                        disabled={busy}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        title="Remove from team"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {selectedMembers.length === 0 && (
                    <div className="col-span-full px-3 py-8 text-center text-xs text-slate-400">
                      No members yet. Drag operators here or onto the foreman card.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
                <header className="flex items-center gap-2 border-b border-slate-300 bg-slate-50/60 px-4 py-3">
                  <Search size={15} className="text-[#0077b6]" />
                  <h2 className="text-sm font-extrabold text-slate-900">All NFC operators</h2>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="ml-auto h-8 w-44 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-500">{operators.length}</span>
                </header>
                <div className="grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto p-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredOperators.map((o) => {
                    const owner = assignedTo[o.snssb];
                    const ownerName = owner != null ? foremen.find((f) => String(f.id) === String(owner))?.name : null;
                    return (
                      <div
                        key={o.snssb}
                        draggable={!busy}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', o.snssb)}
                        className={`flex cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 transition active:cursor-grabbing ${
                          owner != null ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-[#0096c7] hover:bg-[#caf0f8]/30'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-slate-800">{o.full_name}</span>
                          <span className="block font-mono text-[10px] text-slate-400">{o.snssb}</span>
                        </span>
                        {owner != null ? (
                          <span className="max-w-24 truncate rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700" title={ownerName || ''}>
                            {ownerName || `#${owner}`}
                          </span>
                        ) : (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">unassigned</span>
                        )}
                      </div>
                    );
                  })}
                  {filteredOperators.length === 0 && (
                    <div className="col-span-full px-3 py-8 text-center text-xs text-slate-400">No operators found.</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default EwsForemanTeamPage;
