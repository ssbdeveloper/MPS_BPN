import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Layers3,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const today = new Date().toISOString().slice(0, 10);

const emptyComponent = (level = 1) => ({
  part_level: level,
  component_id: '',
  part_number: '',
  part_description: '',
  model_code: '',
  part_type: level === 1 ? 'Group' : 'Single',
  part_category_id: '',
  production_order: '',
  actual_component: '',
});

const emptyShipping = {
  delivery_note_number: '',
  send_by_id: '',
  destination: '',
  consignment_notes: '',
  shipping_list: '',
  freight_cost_bill: '',
  delivery_date: '',
  return_to_stock_date: '',
  dn_received_by_customer: '',
  dn_received_by_ssb: '',
  dn_submit_date: '',
};

const emptyForm = {
  ssbr_ident: '',
  customer_id: '',
  customer_name: '',
  customer_site_name: '',
  received_date: today,
  tagging_time: '',
  received_by_id: '',
  reff_number: '',
  ex_unit: '',
  packing_list: '',
  da_ckb_received: '',
  packing_type_id: '',
  raw_sow_text: '',
  components: [emptyComponent(1)],
  shipping: { ...emptyShipping },
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function compactPayload(value) {
  if (Array.isArray(value)) return value.map(compactPayload);
  if (!value || typeof value !== 'object') return value === '' ? null : value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactPayload(entry)])
  );
}

function hasShippingValue(shipping) {
  return Object.values(shipping || {}).some((value) => value !== '' && value !== null && value !== undefined);
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function Field({ label, children, required = false }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function StatCard({ label, value, icon: Icon, tone }) {
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          {React.createElement(Icon, { size: 20 })}
        </div>
      </div>
    </DashboardCard>
  );
}

function StatusBadge({ shipped }) {
  if (shipped) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
        <CheckCircle2 size={13} />
        Shipped
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
      <AlertCircle size={13} />
      Receiving
    </span>
  );
}

function ReceivingShipmentPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [lookups, setLookups] = useState({
    customers: [],
    users: [],
    part_categories: [],
    packing_types: [],
    components: [],
  });
  const [query, setQuery] = useState('');
  const [shippedFilter, setShippedFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState(emptyForm);
  const selectedIdRef = useRef(null);

  const stats = useMemo(() => {
    const shipped = records.filter((item) => item.shipping_id).length;
    const totalComponents = records.reduce((sum, item) => sum + Number(item.component_count || 0), 0);

    return {
      total: records.length,
      shipped,
      open: records.length - shipped,
      components: totalComponents,
    };
  }, [records]);

  const selectedComponentSummary = useMemo(() => {
    if (!selected?.components?.length) return { parent: 0, child: 0 };
    return selected.components.reduce(
      (summary, component) => ({
        parent: summary.parent + (Number(component.part_level) === 1 ? 1 : 0),
        child: summary.child + (Number(component.part_level) === 2 ? 1 : 0),
      }),
      { parent: 0, child: 0 }
    );
  }, [selected]);

  const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50 disabled:text-slate-400';
  const textAreaClass = 'min-h-[84px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100';

  useEffect(() => {
    selectedIdRef.current = selected?.id || null;
  }, [selected?.id]);

  const loadLookups = async () => {
    const response = await fetch(`${API_BASE}/receiving-shipment/lookups`);
    if (!response.ok) throw new Error('Failed to load lookup data');
    const payload = await response.json();
    setLookups({
      customers: payload.customers || [],
      users: payload.users || [],
      part_categories: payload.part_categories || [],
      packing_types: payload.packing_types || [],
      components: payload.components || [],
    });
  };

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/${id}`);
      if (!response.ok) throw new Error('Failed to load receiving shipment detail');
      const payload = await response.json();
      setSelected(payload);
      setDetailOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ limit: '75' });
      if (query.trim()) params.set('q', query.trim());
      if (shippedFilter) params.set('shipped', shippedFilter);

      const response = await fetch(`${API_BASE}/receiving-shipment?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load receiving shipment data');

      const payload = await response.json();
      const nextRecords = payload.data || [];
      setRecords(nextRecords);

      const selectedId = selectedIdRef.current;
      if (!nextRecords.length || (selectedId && !nextRecords.some((item) => item.id === selectedId))) {
        setSelected(null);
        setDetailOpen(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, shippedFilter]);

  useEffect(() => {
    loadLookups().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadRecords();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadRecords]);

  const setFormValue = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setShippingValue = (key, value) => {
    setForm((current) => ({
      ...current,
      shipping: { ...current.shipping, [key]: value },
    }));
  };

  const setComponentValue = (index, key, value) => {
    setForm((current) => {
      const components = current.components.map((component, componentIndex) => {
        if (componentIndex !== index) return component;

        const nextComponent = { ...component, [key]: value };
        if (key === 'component_id') {
          const master = lookups.components.find((item) => String(item.component_id) === String(value));
          if (master) {
            nextComponent.part_number = master.part_number || '';
            nextComponent.part_description = master.part_name || '';
            nextComponent.model_code = master.model || '';
          }
        }

        if (key === 'part_level') {
          nextComponent.part_type = Number(value) === 1 ? 'Group' : 'Single';
        }

        return nextComponent;
      });

      return { ...current, components };
    });
  };

  const openCreate = () => {
    setMode('create');
    setForm(emptyForm);
    setDrawerOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;

    setMode('edit');
    setForm({
      ssbr_ident: selected.ssbr_ident || '',
      customer_id: selected.customer_id || '',
      customer_name: selected.customer_name || '',
      customer_site_name: selected.customer_site_name || '',
      received_date: selected.received_date || today,
      tagging_time: selected.tagging_time || '',
      received_by_id: selected.received_by_id || '',
      reff_number: selected.reff_number || '',
      ex_unit: selected.ex_unit || '',
      packing_list: selected.packing_list || '',
      da_ckb_received: selected.da_ckb_received || '',
      packing_type_id: selected.packing_type_id || '',
      raw_sow_text: selected.raw_sow_text || '',
      components: selected.components?.length
        ? selected.components.map((component) => ({
            part_level: component.part_level || 1,
            component_id: component.component_id || '',
            part_number: component.part_number || '',
            part_description: component.part_description || '',
            model_code: component.model_code || '',
            part_type: component.part_type || '',
            part_category_id: component.part_category_id || '',
            production_order: component.production_order || '',
            actual_component: component.actual_component || '',
          }))
        : [emptyComponent(1)],
      shipping: selected.shipping ? { ...emptyShipping, ...selected.shipping } : { ...emptyShipping },
    });
    setDrawerOpen(true);
  };

  const addComponentRow = (level) => {
    setForm((current) => ({
      ...current,
      components: [...current.components, emptyComponent(level)],
    }));
  };

  const removeComponentRow = (index) => {
    setForm((current) => ({
      ...current,
      components: current.components.filter((_, componentIndex) => componentIndex !== index),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const components = form.components
        .filter((component) => component.part_description.trim())
        .map((component) => compactPayload(component));

      const payload = compactPayload({
        ssbr_ident: form.ssbr_ident.trim(),
        customer_id: form.customer_id || null,
        customer: form.customer_id
          ? null
          : {
              name: form.customer_name.trim(),
              site_name: form.customer_site_name.trim() || null,
            },
        received_date: form.received_date,
        tagging_time: form.tagging_time || null,
        received_by_id: form.received_by_id || null,
        reff_number: form.reff_number,
        ex_unit: form.ex_unit,
        packing_list: form.packing_list,
        da_ckb_received: form.da_ckb_received,
        packing_type_id: form.packing_type_id || null,
        raw_sow_text: form.raw_sow_text,
        components,
        shipping: hasShippingValue(form.shipping) ? form.shipping : null,
      });

      const url = mode === 'edit'
        ? `${API_BASE}/receiving-shipment/${selected.id}`
        : `${API_BASE}/receiving-shipment`;
      const response = await fetch(url, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save receiving shipment');
      }

      const saved = await response.json();
      setDrawerOpen(false);
      await loadRecords();
      await loadDetail(saved.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`Delete receiving shipment ${selected.ssbr_ident}?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/${selected.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete receiving shipment');
      setSelected(null);
      setDetailOpen(false);
      await loadRecords();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb] text-slate-800">
      <header className="z-20 flex-shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex min-h-[72px] items-center justify-between gap-4 px-5 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
             onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              title="Back to MPS Main"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0096c7]">Receiving & Shipping</p>
              <h1 className="truncate text-xl font-extrabold text-slate-950 lg:text-2xl">
                Shipping Receiving Control
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadRecords}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0096c7] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0077b6]"
            >
              <Plus size={17} />
              New SSBR
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-5 lg:px-7">
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="rounded-lg p-1 hover:bg-red-100">
              <X size={16} />
            </button>
          </div>
        )}

        <section className="grid flex-shrink-0 gap-3 lg:grid-cols-4">
          <StatCard label="Visible SSBR" value={stats.total} icon={ClipboardList} tone="bg-sky-50 text-sky-700" />
          <StatCard label="Shipped" value={stats.shipped} icon={Truck} tone="bg-emerald-50 text-emerald-700" />
          <StatCard label="Open Receiving" value={stats.open} icon={PackageCheck} tone="bg-amber-50 text-amber-700" />
          <StatCard label="Components" value={stats.components} icon={Layers3} tone="bg-indigo-50 text-indigo-700" />
        </section>

        <section className="min-h-0 flex-1">
          <DashboardCard className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-slate-200 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-slate-950">Receiving Orders</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Track receiving header, workshop breakdown, and final shipment per SSBR-ID.
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 gap-2 lg:max-w-xl">
                  <div className="relative flex-1">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search SSBR, customer, DN, component..."
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
                    />
                  </div>
                  <select
                    value={shippedFilter}
                    onChange={(event) => setShippedFilter(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="">All status</option>
                    <option value="false">Receiving</option>
                    <option value="true">Shipped</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="px-4 py-3 font-bold">SSBR-ID</th>
                    <th className="px-4 py-3 font-bold">Customer</th>
                    <th className="px-4 py-3 font-bold">Received</th>
                    <th className="px-4 py-3 font-bold">Components</th>
                    <th className="px-4 py-3 font-bold">Shipment</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="px-4 py-12 text-center text-sm font-semibold text-slate-500">
                        <Loader2 size={22} className="mx-auto mb-2 animate-spin text-[#0096c7]" />
                        Loading receiving shipments...
                      </td>
                    </tr>
                  ) : records.length ? (
                    records.map((item) => (
                      <tr
                        key={item.id}
                        className={`cursor-pointer transition hover:bg-slate-50 ${
                          selected?.id === item.id ? 'bg-cyan-50/60' : 'bg-white'
                        }`}
                        onClick={() => loadDetail(item.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-extrabold text-slate-900">{item.ssbr_ident}</div>
                          <div className="mt-1 text-[11px] text-slate-400">{item.reff_number || 'No reference'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{item.customer_name}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.customer_site_name || 'General site'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-slate-600">{formatDate(item.received_date)}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{item.component_count || 0}</div>
                          <div className="text-[11px] text-slate-500">
                            {item.parent_component_count || 0} parent / {item.child_component_count || 0} child
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-bold text-slate-700">{item.delivery_note_number || '-'}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.destination || 'Not shipped'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge shipped={Boolean(item.shipping_id)} />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              loadDetail(item.id);
                            }}
                          >
                            Detail
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-4 py-12 text-center text-sm font-semibold text-slate-500">
                        No receiving shipment records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </DashboardCard>

          {detailOpen && selected && (
            <div className="fixed inset-0 z-30">
              <button
                type="button"
                className="absolute inset-0 bg-slate-950/25"
                onClick={() => setDetailOpen(false)}
                aria-label="Close detail panel"
              />
              <aside className="absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col bg-[#f6f8fb] shadow-2xl">
                <DashboardCard className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-y-0 border-r-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-950">SSBR Detail</h2>
                <p className="mt-1 text-xs text-slate-500">Receiving, breakdown, and shipment context.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selected || detailLoading}
                  onClick={openEdit}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={!selected || saving}
                  onClick={handleDelete}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm font-semibold text-slate-500">
                <Loader2 size={22} className="mr-2 animate-spin text-[#0096c7]" />
                Loading detail...
              </div>
            ) : selected ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xl font-extrabold text-slate-950">{selected.ssbr_ident}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">
                        {selected.customer_name} {selected.customer_site_name ? `- ${selected.customer_site_name}` : ''}
                      </p>
                    </div>
                    <StatusBadge shipped={Boolean(selected.shipping)} />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-bold uppercase tracking-wide text-slate-400">Received</p>
                      <p className="mt-1 font-bold text-slate-800">{formatDate(selected.received_date)}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-wide text-slate-400">Received By</p>
                      <p className="mt-1 font-bold text-slate-800">{selected.received_by_name || '-'}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-wide text-slate-400">Ex Unit</p>
                      <p className="mt-1 font-bold text-slate-800">{selected.ex_unit || '-'}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase tracking-wide text-slate-400">Packing</p>
                      <p className="mt-1 font-bold text-slate-800">{selected.packing_type_name || selected.packing_list || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold text-slate-500">Parent</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-950">{selectedComponentSummary.parent}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold text-slate-500">Child</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-950">{selectedComponentSummary.child}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold text-slate-500">DN</p>
                    <p className="mt-1 truncate text-sm font-extrabold text-slate-950">
                      {selected.shipping?.delivery_note_number || '-'}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Shipment</h3>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="font-bold uppercase tracking-wide text-slate-400">Destination</p>
                        <p className="mt-1 font-bold text-slate-800">{selected.shipping?.destination || '-'}</p>
                      </div>
                      <div>
                        <p className="font-bold uppercase tracking-wide text-slate-400">Delivery Date</p>
                        <p className="mt-1 font-bold text-slate-800">{formatDate(selected.shipping?.delivery_date)}</p>
                      </div>
                      <div>
                        <p className="font-bold uppercase tracking-wide text-slate-400">Consignment</p>
                        <p className="mt-1 font-bold text-slate-800">{selected.shipping?.consignment_notes || '-'}</p>
                      </div>
                      <div>
                        <p className="font-bold uppercase tracking-wide text-slate-400">Send By</p>
                        <p className="mt-1 font-bold text-slate-800">{selected.shipping?.send_by_name || '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Components</h3>
                  <div className="max-h-[260px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                    {selected.components?.map((component) => (
                      <div key={component.id} className="grid grid-cols-[52px_1fr] gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-extrabold ${
                          Number(component.part_level) === 1
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-indigo-50 text-indigo-700'
                        }`}>
                          L{component.part_level}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-slate-800">
                            {component.part_description}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {component.part_number || component.master_part_number || '-'} | {component.model_code || component.master_model || '-'} | {component.production_order || 'No prod order'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[520px] flex-col items-center justify-center px-6 text-center">
                <PackageCheck size={42} className="text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-600">Select a receiving order</p>
                <p className="mt-1 text-xs text-slate-400">Detail will appear here after you choose an SSBR-ID.</p>
              </div>
            )}
                </DashboardCard>
              </aside>
            </div>
          )}
        </section>
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close drawer"
          />
          <aside className="absolute right-0 top-0 flex h-full w-[calc(100vw-20px)] max-w-[1440px] flex-col bg-white shadow-2xl">
            <form onSubmit={handleSubmit} className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#0096c7]">
                    {mode === 'edit' ? 'Edit receiving shipment' : 'New receiving shipment'}
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold text-slate-950">
                    {mode === 'edit' ? form.ssbr_ident : 'Create SSBR record'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  <DashboardCard className="p-4">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                      <ClipboardList size={17} className="text-[#0096c7]" />
                      Receiving Header
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="SSBR-ID" required>
                        <input value={form.ssbr_ident} onChange={(event) => setFormValue('ssbr_ident', event.target.value)} className={inputClass} required />
                      </Field>
                      <Field label="Received Date" required>
                        <input type="date" value={form.received_date} onChange={(event) => setFormValue('received_date', event.target.value)} className={inputClass} required />
                      </Field>
                      <Field label="Customer">
                        <select value={form.customer_id} onChange={(event) => setFormValue('customer_id', event.target.value)} className={inputClass}>
                          <option value="">New customer / manual</option>
                          {lookups.customers.map((customer) => (
                            <option key={customer.id} value={customer.id}>
                              {customer.name}{customer.site_name ? ` - ${customer.site_name}` : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Received By">
                        <select value={form.received_by_id} onChange={(event) => setFormValue('received_by_id', event.target.value)} className={inputClass}>
                          <option value="">-</option>
                          {lookups.users.map((user) => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      </Field>
                      {!form.customer_id && (
                        <>
                          <Field label="Customer Name" required>
                            <input value={form.customer_name} onChange={(event) => setFormValue('customer_name', event.target.value)} className={inputClass} required={!form.customer_id} />
                          </Field>
                          <Field label="Site Name">
                            <input value={form.customer_site_name} onChange={(event) => setFormValue('customer_site_name', event.target.value)} className={inputClass} />
                          </Field>
                        </>
                      )}
                      <Field label="Reference Number">
                        <input value={form.reff_number} onChange={(event) => setFormValue('reff_number', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Ex Unit">
                        <input value={form.ex_unit} onChange={(event) => setFormValue('ex_unit', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Packing Type">
                        <select value={form.packing_type_id} onChange={(event) => setFormValue('packing_type_id', event.target.value)} className={inputClass}>
                          <option value="">-</option>
                          {lookups.packing_types.map((type) => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Packing List">
                        <input value={form.packing_list} onChange={(event) => setFormValue('packing_list', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="DA/CKB Received">
                        <input value={form.da_ckb_received} onChange={(event) => setFormValue('da_ckb_received', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Tagging Time">
                        <input type="datetime-local" value={form.tagging_time?.slice(0, 16) || ''} onChange={(event) => setFormValue('tagging_time', event.target.value)} className={inputClass} />
                      </Field>
                      <div className="md:col-span-2 xl:col-span-3">
                        <Field label="Raw SOW Text">
                          <textarea value={form.raw_sow_text} onChange={(event) => setFormValue('raw_sow_text', event.target.value)} className={textAreaClass} />
                        </Field>
                      </div>
                    </div>
                  </DashboardCard>

                  <DashboardCard className="p-4">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                      <Truck size={17} className="text-[#0096c7]" />
                      Shipment
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <Field label="Delivery Note">
                        <input value={form.shipping.delivery_note_number || ''} onChange={(event) => setShippingValue('delivery_note_number', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Delivery Date">
                        <input type="date" value={form.shipping.delivery_date || ''} onChange={(event) => setShippingValue('delivery_date', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Send By">
                        <select value={form.shipping.send_by_id || ''} onChange={(event) => setShippingValue('send_by_id', event.target.value)} className={inputClass}>
                          <option value="">-</option>
                          {lookups.users.map((user) => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Destination">
                        <input value={form.shipping.destination || ''} onChange={(event) => setShippingValue('destination', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Consignment Notes">
                        <input value={form.shipping.consignment_notes || ''} onChange={(event) => setShippingValue('consignment_notes', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Shipping List">
                        <input value={form.shipping.shipping_list || ''} onChange={(event) => setShippingValue('shipping_list', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Freight Cost Bill">
                        <input value={form.shipping.freight_cost_bill || ''} onChange={(event) => setShippingValue('freight_cost_bill', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Return To Stock">
                        <input type="date" value={form.shipping.return_to_stock_date || ''} onChange={(event) => setShippingValue('return_to_stock_date', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="DN Received Customer">
                        <input type="date" value={form.shipping.dn_received_by_customer || ''} onChange={(event) => setShippingValue('dn_received_by_customer', event.target.value)} className={inputClass} />
                      </Field>
                      <Field label="DN Submit Date">
                        <input type="date" value={form.shipping.dn_submit_date || ''} onChange={(event) => setShippingValue('dn_submit_date', event.target.value)} className={inputClass} />
                      </Field>
                    </div>
                  </DashboardCard>
                </div>

                <DashboardCard className="mt-4 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900">Component Breakdown</h3>
                      <p className="mt-1 text-xs text-slate-500">Level 1 becomes parent. Level 2 rows attach to the latest level 1.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => addComponentRow(1)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        Add Parent
                      </button>
                      <button type="button" onClick={() => addComponentRow(2)} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700">
                        Add Child
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1480px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-3">Level</th>
                          <th className="px-3 py-3">Master Component</th>
                          <th className="px-3 py-3">Part Number</th>
                          <th className="px-3 py-3">Part Name</th>
                          <th className="px-3 py-3">Model</th>
                          <th className="px-3 py-3">Type</th>
                          <th className="px-3 py-3">Category</th>
                          <th className="px-3 py-3">Prod Order</th>
                          <th className="px-3 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {form.components.map((component, index) => (
                          <tr key={`${index}-${component.part_level}`}>
                            <td className="px-3 py-3">
                              <select value={component.part_level} onChange={(event) => setComponentValue(index, 'part_level', Number(event.target.value))} className={`${inputClass} min-w-[150px]`}>
                                <option value={1}>Level 1 Parent</option>
                                <option value={2}>Level 2 Child</option>
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <select value={component.component_id || ''} onChange={(event) => setComponentValue(index, 'component_id', event.target.value)} className={`${inputClass} min-w-[300px]`}>
                                <option value="">Join only / no master</option>
                                {lookups.components.map((master) => (
                                  <option key={master.component_id} value={master.component_id}>
                                    {master.part_number} - {master.part_name} ({master.model})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <input value={component.part_number || ''} onChange={(event) => setComponentValue(index, 'part_number', event.target.value)} className={`${inputClass} min-w-[150px]`} />
                            </td>
                            <td className="px-3 py-3">
                              <input value={component.part_description || ''} onChange={(event) => setComponentValue(index, 'part_description', event.target.value)} className={`${inputClass} min-w-[260px]`} required />
                            </td>
                            <td className="px-3 py-3">
                              <input value={component.model_code || ''} onChange={(event) => setComponentValue(index, 'model_code', event.target.value)} className={`${inputClass} min-w-[90px]`} />
                            </td>
                            <td className="px-3 py-3">
                              <select value={component.part_type || ''} onChange={(event) => setComponentValue(index, 'part_type', event.target.value)} className={`${inputClass} min-w-[130px]`}>
                                <option value="">-</option>
                                <option value="Group">Group</option>
                                <option value="Single">Single</option>
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <select value={component.part_category_id || ''} onChange={(event) => setComponentValue(index, 'part_category_id', event.target.value)} className={`${inputClass} min-w-[150px]`}>
                                <option value="">-</option>
                                {lookups.part_categories.map((category) => (
                                  <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <input value={component.production_order || ''} onChange={(event) => setComponentValue(index, 'production_order', event.target.value)} className={`${inputClass} min-w-[130px]`} />
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => removeComponentRow(index)}
                                disabled={form.components.length === 1}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DashboardCard>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-4">
                <p className="text-xs font-semibold text-slate-500">
                  
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0096c7] px-4 text-sm font-bold text-white hover:bg-[#0077b6] disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save
                  </button>
                </div>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

export default ReceivingShipmentPage;
