import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const COLUMNS = [
  ['customer', 'Customer'],
  ['order_no', 'Order No'],
  ['ssbr_id', 'SSBR ID'],
  ['operation_text', 'Operation Text'],
  ['operation_name', 'Operation Name'],
  ['planhours', 'Plan Hours'],
  ['wct_group', 'WCT Group'],
  ['workcenter', 'Workcenter'],
  ['status', 'Status'],
  ['part_number', 'Part Number'],
  ['part_name', 'Part Name'],
  ['model', 'Model'],
];

const EDIT_COLUMNS = [
  'operation_no',
  'operation_text',
  'workcenterdescription',
  'planhours',
  'wct_group',
  'workcenter',
  'status',
  'customer',
  'ssbr_id',
  'part_number',
  'part_name',
  'model',
];

const emptyOperation = (orderNo = '') => ({
  order_no: orderNo,
  operation_no: '',
  operation_text: '',
  workcenterdescription: '',
  planhours: '',
  wct_group: '',
  workcenter: '',
  status: '',
  customer: '',
  ssbr_id: '',
  part_number: '',
  part_name: '',
  model: '',
});

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function fmt(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export default function SowHistoryPage() {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [editRows, setEditRows] = useState([]);
  const [currentRevision, setCurrentRevision] = useState(0);
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pagination.limit) });
      if (search.trim()) params.set('search', search.trim());
      const payload = await request(`/sow/history-rows?${params.toString()}`);
      setRows(payload.data || []);
      setPagination(payload.pagination || { page, limit: 50, total: 0, totalPages: 1 });
    } catch (err) {
      toast.error(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, pagination.page, search]);

  const loadOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (orderSearch.trim()) params.set('search', orderSearch.trim());
      const data = await request(`/sow/history-orders?${params.toString()}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message);
      setOrders([]);
    }
  }, [orderSearch]);

  const loadOrderDetail = useCallback(async (orderNo) => {
    if (!orderNo) return;
    try {
      const data = await request(`/sow/history-order/${encodeURIComponent(orderNo)}`);
      setSelectedOrder(orderNo);
      setEditRows((data.rows || []).map((row) => ({ ...row, operation_name: row.workcenterdescription || '' })));
      setCurrentRevision(data.current_revision || 0);
    } catch (err) {
      toast.error(err.message);
      setEditRows([]);
    }
  }, []);

  useEffect(() => {
    loadRows(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showEditor) return;
    const timer = setTimeout(loadOrders, 250);
    return () => clearTimeout(timer);
  }, [loadOrders, showEditor]);

  const filteredTitle = useMemo(() => (
    search.trim() ? `Filter: ${search.trim()}` : 'Semua SOW'
  ), [search]);

  const updateEditRow = (index, key, value) => {
    setEditRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index
        ? { ...row, [key]: value, ...(key === 'workcenterdescription' ? { operation_name: value } : {}) }
        : row
    )));
  };

  const addOperation = () => {
    setEditRows((prev) => [...prev, emptyOperation(selectedOrder)]);
  };

  const removeOperation = (index) => {
    setEditRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const saveRevision = async () => {
    if (!selectedOrder) {
      toast.error('Pilih order_no dulu');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        operations: editRows.map((row) => ({
          ...row,
          order_no: selectedOrder,
          workcenterdescription: row.workcenterdescription || row.operation_name || null,
        })),
      };
      const result = await request(`/sow/history-order/${encodeURIComponent(selectedOrder)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setCurrentRevision(result.revision?.revision_no || currentRevision + 1);
      setEditRows(result.rows || []);
      toast.success(`SOW tersimpan sebagai revision ${result.revision?.revision_no || currentRevision + 1}`);
      loadRows(1);
      loadOrders();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">SOW History</h2>
            <p className="text-sm text-slate-500">{filteredTitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') loadRows(1);
                }}
                className="w-60 bg-transparent text-sm outline-none"
                placeholder="Search order_no / ssbr_id"
              />
            </label>
            <button
              type="button"
              onClick={() => loadRows(1)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowEditor(true)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-semibold text-white hover:bg-[#0077b6]"
            >
              Edit SOW
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-full overflow-auto">
          <table className="min-w-[1500px] w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                {COLUMNS.map(([, label]) => (
                  <th key={label} className="border-b border-slate-200 px-3 py-2 font-bold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-slate-500">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-slate-500">Data tidak ditemukan</td></tr>
              ) : rows.map((row, index) => (
                <tr key={`${row.order_no}-${row.operation_no}-${index}`} className="odd:bg-white even:bg-slate-50">
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="border-b border-slate-100 px-3 py-2 align-top text-slate-700">{fmt(row[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <button
          type="button"
          disabled={pagination.page <= 1 || loading}
          onClick={() => loadRows(Math.max(1, pagination.page - 1))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Prev
        </button>
        <span>Page {pagination.page} / {pagination.totalPages} ({pagination.total} row)</span>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages || loading}
          onClick={() => loadRows(Math.min(pagination.totalPages, pagination.page + 1))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {showEditor && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-6xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Edit SOW Revision</h3>
                <p className="text-sm text-slate-500">
                  {selectedOrder ? `${selectedOrder} - current revision ${currentRevision}` : 'Pilih order_no untuk mulai edit'}
                </p>
              </div>
              <button type="button" onClick={() => setShowEditor(false)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
              <aside className="min-h-0 border-r border-slate-200 p-4">
                <label className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={orderSearch}
                    onChange={(event) => setOrderSearch(event.target.value)}
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder="Cari order_no / ssbr_id"
                  />
                </label>
                <div className="h-[calc(100%-52px)] overflow-y-auto pr-1">
                  {orders.map((order) => (
                    <button
                      key={order.order_no}
                      type="button"
                      onClick={() => loadOrderDetail(order.order_no)}
                      className={`mb-2 w-full rounded-lg border p-3 text-left text-sm transition hover:border-[#0096c7] ${
                        selectedOrder === order.order_no ? 'border-[#0096c7] bg-[#caf0f8]' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="font-mono font-bold text-slate-900">{order.order_no}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{order.ssbr_id || '-'} / {order.part_name || '-'}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">{order.operation_count} operation</div>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="flex min-w-0 flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-700">{editRows.length} operation</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addOperation}
                      disabled={!selectedOrder}
                      className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={saveRevision}
                      disabled={!selectedOrder || saving}
                      className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Saving...' : 'Save Revision'}
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <table className="min-w-[1400px] w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-500">
                      <tr>
                        {EDIT_COLUMNS.map((column) => (
                          <th key={column} className="border-b border-slate-200 px-2 py-2">{column}</th>
                        ))}
                        <th className="border-b border-slate-200 px-2 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editRows.map((row, index) => (
                        <tr key={`${row.idsow || 'new'}-${index}`}>
                          {EDIT_COLUMNS.map((column) => (
                            <td key={column} className="border-b border-slate-100 px-2 py-1">
                              <input
                                value={row[column] ?? ''}
                                type={column === 'operation_no' || column === 'planhours' ? 'number' : 'text'}
                                onChange={(event) => updateEditRow(index, column, event.target.value)}
                                className="w-full rounded border border-slate-200 px-2 py-1 outline-none focus:border-[#0096c7]"
                              />
                            </td>
                          ))}
                          <td className="border-b border-slate-100 px-2 py-1">
                            <button type="button" onClick={() => removeOperation(index)} className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
