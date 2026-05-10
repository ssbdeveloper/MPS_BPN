import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { RefreshCw, Save, Search, Trash2, X, ChevronDown, FileText, Printer, Loader2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import ssbLogo from '../../assets/ssb.png';
import operationCardHtml from '../../templates/operation-card.html?raw';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const operationCardStyle = operationCardHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || '';
const operationCardBody = operationCardHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || operationCardHtml;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = (s) => esc(s).replace(/'/g, '&#39;');

const normalizeProductionOrder = (value) => String(value ?? '').trim().replace(/-/g, '000');
const resolveAssetUrl = (src) => {
  if (!src) return '';
  if (String(src).startsWith('/uploads/')) {
    const base = API_BASE.replace(/\/$/, '');
    if (base === '/api') return src;
    if (base.endsWith('/api')) {
      try {
        return `${new URL(base, window.location.origin).origin}${src}`;
      } catch {
        return src;
      }
    }
    return `${base}${src}`;
  }
  return src;
};

function buildOpCardPreviewHtml({ orderNo, operations, detailInfo, imagesByOpNo, logoDataUrl }) {
  const cards = operations.map((op) => {
    const pn = detailInfo.part_number || '-';
    const images = (imagesByOpNo[op.operation_no] || []).map((img) => {
      const left = (img.x / 700) * 100;
      const top = (img.y / 560) * 100;
      const width = (img.width / 700) * 100;
      const height = (img.height / 560) * 100;
      return `<img class="main-box-image" src="${escAttr(resolveAssetUrl(img.src))}" alt="" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${width.toFixed(2)}%;height:${height.toFixed(2)}%;" />`;
    }).join('');

    return `
      <div class="a4-page">
        <table class="top-table"><tr>
          <td class="qr-col"><img src="${escAttr(op.qrDataUrl || '')}" class="qr-img" /></td>
          <td class="title-col"><div class="title">Operation Card</div><div class="brand"><img src="${escAttr(logoDataUrl)}" class="logo" /><span class="brand-name"><span class="red">SANGGAR</span><span>SARANA BAJA</span></span></div></td>
          <td class="meta-col"><table class="meta-table">
            <tr><td class="ml">Order No</td><td class="mv">${esc(orderNo)}</td></tr>
            <tr><td class="ml">Part No</td><td class="mv">${esc(pn)}</td></tr>
            <tr><td class="ml">Part Name</td><td class="mv">${esc(detailInfo.part_name || '-')}</td></tr>
            <tr><td class="ml">Model</td><td class="mv">${esc(detailInfo.model || '-')}</td></tr>
            <tr><td class="ml">Customer</td><td class="mv">${esc(detailInfo.customer || '-')}</td></tr>
          </table></td>
        </tr></table>
        <table class="info-table"><tr>
          <td class="il">Ops No</td><td class="iv">${op.operation_no}</td>
          <td class="il">WC</td><td class="iv">${esc(op.machineid || op.workcenter || '-')}</td>
        </tr><tr>
          <td class="il">Op Text</td><td class="iv" colspan="3">${esc(op.operation_text || '-')}</td>
        </tr><tr>
          <td class="il">Std Hrs</td><td class="iv"><b>${op.std_hours ?? op.planhours ?? '-'}</b></td>
          <td class="il">WC Desc</td><td class="iv">${esc(op.workcenterdescription || '-')}</td>
        </tr></table>
        <div class="main-box">${images}</div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page { size: A4 portrait; margin: 0; }
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;background:#e8e6e0;display:block;padding:20px;}
    .a4-page{width:794px;background:#fff;margin:0 auto 20px;border:2px solid #000;page-break-after:always;}
    .top-table{width:100%;border-collapse:collapse;border-bottom:2px solid #000;}
    .qr-col{width:120px;text-align:center;padding:8px;border-right:2px solid #000;}
    .qr-img{width:90px;height:90px;}
    .title-col{text-align:center;padding:8px;border-right:2px solid #000;}
    .title{font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:4px;}
    .brand{display:flex;align-items:center;justify-content:center;gap:4px;margin-top:2px;}
    .logo{width:28px;height:28px;}
    .brand-name{font-size:8px;font-weight:700;text-align:left;line-height:1.2;}
    .red{color:#0300c0;}
    .meta-col{width:160px;vertical-align:top;padding:0;}
    .meta-table{width:100%;border-collapse:collapse;}
    .meta-table td{padding:2px 4px;font-size:7px;border-bottom:1px solid #ddd;}
    .ml{font-weight:600;color:#555;white-space:nowrap;}
    .mv{color:#1a1a1a;}
    .info-table{width:100%;border-collapse:collapse;border-bottom:2px solid #000;}
    .il{font-size:10px;font-weight:600;padding:4px 8px;border-right:1px solid #ccc;background:#d9d9d9;width:80px;}
    .iv{font-size:11px;padding:4px 8px;border-right:1px solid #ccc;}
    .main-box{width:700px;height:560px;margin:19px auto;border:2px solid #000;position:relative;overflow:hidden;background:#fff;}
    .main-box-image{position:absolute;object-fit:contain;pointer-events:none;}
    ${operationCardStyle}
  </style></head><body>${cards}</body></html>`;
}

const emptyOperation = (orderNo = '', info) => ({
  order_no: orderNo,
  operation_no: '',
  operation_text: '',
  workcenterdescription: '',
  planhours: '',
  wct_group: '',
  workcenter: '',
  status: '',
  customer: info.customer || '',
  ssbr_id: info.ssbr_id || '',
  part_number: info.part_number || '',
  part_name: info.part_name || '',
  model: info.model || '',
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

const INPUT_CLS = `w-full rounded border border-slate-200 px-2 py-1 outline-none focus:border-[#0096c7] text-xs`;
const SELECT_CLS = `w-full rounded border border-slate-200 px-2 py-1 outline-none focus:border-[#0096c7] appearance-none cursor-pointer bg-white text-xs truncate pr-6`;

const SelectWrapper = ({ children }) => (
  <div className="relative">
    {children}
    <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
  </div>
);

export default function SowHistoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [editRows, setEditRows] = useState([]);
  const [currentRevision, setCurrentRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [revisionOptions, setRevisionOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [showOpCard, setShowOpCard] = useState(false);
  const [opCardHtml, setOpCardHtml] = useState('');
  const [opCardLoading, setOpCardLoading] = useState(false);
  const qrRef = useRef(null);
  const opCardPrintRef = useRef(null);

  const [detailInfo, setDetailInfo] = useState({ customer: '', ssbr_id: '', part_number: '', part_name: '', model: '' });

  const [wcData, setWcData] = useState([]);
  useEffect(() => { fetch(`${API_BASE}/workcenter`).then(r => r.json()).then(d => setWcData(Array.isArray(d) ? d : d?.data || [])).catch(() => {}); }, []);

  const groupnames = useMemo(() => { const n = [...new Set(wcData.map(r => r.groupname).filter(Boolean))]; n.sort(); return n; }, [wcData]);
  const workcentersByGroup = useCallback((g) => wcData.filter(r => r.groupname === g && r.workcenternew).sort((a, b) => a.workcenternew > b.workcenternew ? 1 : -1), [wcData]);

  const [customers, setCustomers] = useState([]);
  useEffect(() => { fetch(`${API_BASE}/sow/customers`).then(r => r.json()).then(d => setCustomers(d.data || [])).catch(() => {}); }, []);

  const [components, setComponents] = useState([]);
  useEffect(() => { fetch(`${API_BASE}/sow/components`).then(r => r.json()).then(d => setComponents(d.data || [])).catch(() => {}); }, []);
  const models = useMemo(() => [...new Set(components.map(c => c.model).filter(Boolean))].sort(), [components]);
  const partsByModel = useCallback((m) => components.filter(c => c.model === m && c.part_number).sort((a, b) => a.part_number > b.part_number ? 1 : -1), [components]);
  const partInfoByNumber = useCallback((pn) => components.find(c => c.part_number === pn), [components]);

  const loadRows = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pagination.limit) });
      if (search.trim()) params.set('search', search.trim());
      const payload = await request(`/sow/history-rows?${params.toString()}`);
      setRows(payload.data || []);
      setPagination(payload.pagination || { page, limit: 50, total: 0, totalPages: 1 });
    } catch (err) { toast.error(err.message); setRows([]); } finally { setLoading(false); }
  }, [pagination.limit, pagination.page, search]);

  const loadOrderDetail = useCallback(async (orderNo, revisionNo = null) => {
    if (!orderNo) return;
    try {
      const params = new URLSearchParams();
      if (revisionNo) params.set('revision_no', String(revisionNo));
      const data = await request(`/sow/history-order/${encodeURIComponent(orderNo)}${params.toString() ? `?${params.toString()}` : ''}`);
      setSelectedOrder(orderNo);
      setEditRows((data.rows || []).map(r => ({ ...r, operation_name: r.workcenterdescription || '' })));
      setCurrentRevision(data.current_revision || 0);
      setSelectedRevision(data.selected_revision || data.current_revision || 0);
      setRevisionOptions(data.revisions || []);
      const first = (data.rows || [])[0] || {};
      setDetailInfo({ customer: first.customer || '', ssbr_id: first.ssbr_id || '', part_number: first.part_number || '', part_name: first.part_name || '', model: first.model || '' });
    } catch (err) { toast.error(err.message); setEditRows([]); }
  }, []);

  useEffect(() => { loadRows(1); }, []);

  const updateEditRow = (index, key, value) => {
    setEditRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, [key]: value };
      if (key === 'workcenter') { const wc = workcentersByGroup(row.wct_group).find(w => w.workcenternew === value); updated.workcenterdescription = wc?.workcenter_description || ''; }
      if (key === 'wct_group') { const opts = workcentersByGroup(value); updated.workcenter = opts.length ? opts[0].workcenternew : ''; updated.workcenterdescription = opts.length ? opts[0].workcenter_description || '' : ''; }
      return updated;
    }));
  };

  const addOperation = () => setEditRows(prev => [...prev, emptyOperation(selectedOrder, detailInfo)]);
  const removeOperation = (index) => setEditRows(prev => prev.filter((_, i) => i !== index));

  const saveDetailInfo = async () => {
    if (!selectedOrder) { toast.error('Pilih order_no dulu'); return; }
    setSavingInfo(true);
    try {
      await request(`/sow/history-order/${encodeURIComponent(selectedOrder)}/info`, { method: 'PUT', body: JSON.stringify(detailInfo) });
      setEditRows(prev => prev.map(r => ({ ...r, customer: detailInfo.customer, ssbr_id: detailInfo.ssbr_id, part_number: detailInfo.part_number, part_name: detailInfo.part_name, model: detailInfo.model })));
      toast.success('Detail info updated'); loadRows(1);
    } catch (err) { toast.error(err.message); } finally { setSavingInfo(false); }
  };

  const saveRevision = async () => {
    if (!selectedOrder) { toast.error('Pilih order_no dulu'); return; }
    setSaving(true);
    try {
      const result = await request(`/sow/history-order/${encodeURIComponent(selectedOrder)}`, { method: 'PUT', body: JSON.stringify({ operations: editRows.map(r => ({ ...r, order_no: selectedOrder, workcenterdescription: r.workcenterdescription || r.operation_name || null })) }) });
      setCurrentRevision(result.revision?.revision_no || currentRevision + 1);
      setEditRows(result.rows || []);
      toast.success(`Revision ${result.revision?.revision_no || currentRevision + 1} saved`); loadRows(1);
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const handleOpenOpCard = async () => {
    if (!selectedOrder || editRows.length === 0) return;
    setShowOpCard(true);
    setOpCardLoading(true);
    try {
      const logoDataUrl = ssbLogo;
      const imagesByOpNo = {};
      await Promise.all(editRows.map(async (op) => {
        const opNo = String(op.operation_no);
        try {
          const res = await fetch(`${API_BASE}/sow/operationcard/${op.idsow}`);
          const json = await res.json();
          if (json.data && Array.isArray(json.data.images)) {
            imagesByOpNo[opNo] = json.data.images;
          }
        } catch { imagesByOpNo[opNo] = []; }
      }));
      const ops = await Promise.all(editRows.map(async (op) => {
        let qrDataUrl = '';
        try {
          const partNumber = detailInfo.part_number || '-';
          const qrValue = `OPERATION_CARD|PO:${normalizeProductionOrder(selectedOrder)}|PART:${partNumber}|OP:${op.operation_no}|WC:${op.workcenter || '-'}`;
          qrDataUrl = await new Promise((resolve) => {
            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            document.body.appendChild(tempDiv);
            const { createRoot } = require('react-dom/client');
            const root = createRoot(tempDiv);
            const el = React.createElement(QRCodeCanvas, { value: qrValue, size: 90, level: 'M', bgColor: '#ffffff', fgColor: '#000000', ref: (node) => {
              setTimeout(() => {
                const canvas = tempDiv.querySelector('canvas');
                resolve(canvas ? canvas.toDataURL('image/png') : '');
                root.unmount();
                document.body.removeChild(tempDiv);
              }, 100);
            }});
            root.render(el);
          });
        } catch { qrDataUrl = ''; }
        return { ...op, machineid: op.machineid || op.workcenter || '', qrDataUrl };
      }));
      const html = buildOpCardPreviewHtml({ orderNo: selectedOrder, operations: ops, detailInfo, imagesByOpNo, logoDataUrl });
      setOpCardHtml(html);
    } catch (err) { toast.error('Gagal generate operation card'); }
    finally { setOpCardLoading(false); }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-900">SOW History</h2><p className="text-sm text-slate-500">{search.trim() ? `Filter: ${search.trim()}` : 'Semua SOW'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3"><Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') loadRows(1); }} className="w-60 bg-transparent text-sm outline-none" placeholder="Search order_no / ssbr_id" /></label>
            <button onClick={() => loadRows(1)} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button onClick={() => setShowEditor(true)} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-semibold text-white hover:bg-[#0077b6]">Edit SOW</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-full overflow-auto">
          <table className="min-w-[1200px] w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>{['Customer','Order No','SSBR ID','Operation Text','Plan Hours','WCT Group','Workcenter','Status','Part Number','Part Name','Model'].map(h => (<th key={h} className="border-b border-slate-200 px-3 py-2 font-bold">{h}</th>))}</tr>
            </thead>
            <tbody>
              {loading ? (<tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">Loading...</td></tr>) : rows.length === 0 ? (<tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">Data tidak ditemukan</td></tr>) : rows.map((row, i) => (
                <tr key={`${row.order_no}-${row.operation_no}-${i}`} onClick={() => { loadOrderDetail(row.order_no); setShowEditor(true); }} className="odd:bg-white even:bg-slate-50 hover:bg-[#caf0f8] cursor-pointer transition-colors">
                  <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.customer)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.order_no)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.ssbr_id)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.operation_text)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.planhours)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.wct_group)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.workcenter)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.status)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.part_number)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.part_name)}</td><td className="border-b border-slate-100 px-3 py-2 text-slate-700">{fmt(row.model)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <button disabled={pagination.page <= 1 || loading} onClick={() => loadRows(Math.max(1, pagination.page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40">Prev</button>
        <span>Page {pagination.page} / {pagination.totalPages} ({pagination.total} row)</span>
        <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadRows(Math.min(pagination.totalPages, pagination.page + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
      </div>

      {showEditor && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-7xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 flex-shrink-0">
              <div><h3 className="text-lg font-bold text-slate-900">Edit SOW Revision</h3><p className="text-sm text-slate-500">{selectedOrder ? `${selectedOrder} — rev ${currentRevision}` : 'Pilih order_no untuk mulai edit'}</p></div>
              <button onClick={() => setShowEditor(false)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 flex flex-col">
              <section className="flex min-w-0 min-h-0 flex-col">
                {selectedOrder && (
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 flex-shrink-0">
                    <div className="flex items-center justify-between mb-3"><span className="text-xs font-bold uppercase tracking-widest text-slate-500">Detail Info</span>
                      <button onClick={saveDetailInfo} disabled={savingInfo} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0077b6] disabled:opacity-50">{savingInfo ? 'Saving...' : <><Save size={12} /> Save Info</>}</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div><label className="block text-[10px] font-semibold text-slate-500 mb-1">Customer</label><SelectWrapper><select value={detailInfo.customer} onChange={e => setDetailInfo(p => ({ ...p, customer: e.target.value }))} className={SELECT_CLS}><option value="">— Pilih Customer —</option>{customers.map(c => <option key={c} value={c}>{c}</option>)}</select></SelectWrapper></div>
                      <div><label className="block text-[10px] font-semibold text-slate-500 mb-1">SSBR ID</label><input value={detailInfo.ssbr_id} onChange={e => setDetailInfo(p => ({ ...p, ssbr_id: e.target.value }))} className={INPUT_CLS} /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="block text-[10px] font-semibold text-slate-500 mb-1">Model</label><SelectWrapper><select value={detailInfo.model} onChange={e => { const m = e.target.value; setDetailInfo(p => ({ ...p, model: m, part_number: '', part_name: '' })); }} className={SELECT_CLS}><option value="">— Pilih Model —</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></SelectWrapper></div>
                      <div><label className="block text-[10px] font-semibold text-slate-500 mb-1">Part Number</label><SelectWrapper><select value={detailInfo.part_number} onChange={e => { const pn = e.target.value; const info = partInfoByNumber(pn); setDetailInfo(p => ({ ...p, part_number: pn, part_name: info?.part_name || '' })); }} disabled={!detailInfo.model} className={`${SELECT_CLS} ${!detailInfo.model ? 'opacity-40' : ''}`}><option value="">— Pilih Part —</option>{partsByModel(detailInfo.model).map(c => (<option key={c.component_id} value={c.part_number}>{c.part_number}</option>))}</select></SelectWrapper></div>
                      <div><label className="block text-[10px] font-semibold text-slate-500 mb-1">Part Name</label><input value={detailInfo.part_name} readOnly className={`${INPUT_CLS} bg-slate-100 text-slate-500`} placeholder="Auto-filled" /></div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 flex-shrink-0">
                  <div className="text-sm font-semibold text-slate-700">{editRows.length} operation</div>
                  <div className="flex gap-2">
                    <SelectWrapper>
                      <select
                        value={selectedRevision || 0}
                        onChange={(e) => loadOrderDetail(selectedOrder, Number(e.target.value))}
                        className={`${SELECT_CLS} min-h-[38px] w-36`}
                      >
                        <option value={0}>Latest</option>
                        {revisionOptions.map((rev) => (
                          <option key={rev.revision_no} value={rev.revision_no}>Revision {rev.revision_no}</option>
                        ))}
                      </select>
                    </SelectWrapper>
                    <button onClick={handleOpenOpCard} disabled={!selectedOrder || editRows.length === 0 || opCardLoading}
                      className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 text-sm font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-40">
                      {opCardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Op Card
                    </button>
                    <button
                      onClick={() => navigate(`/sow-edit/revision/${encodeURIComponent(selectedOrder)}${selectedRevision ? `?revision_no=${selectedRevision}` : ''}`)}
                      disabled={!selectedOrder}
                      className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      <ArrowRight className="h-4 w-4" /> Create Revision
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-[1100px] w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] uppercase tracking-widest text-slate-500">
                      <tr><th className="border-b border-slate-200 px-2 py-2 w-[70px]">Op No</th><th className="border-b border-slate-200 px-2 py-2">Operation Text</th><th className="border-b border-slate-200 px-2 py-2 w-[130px]">WCT Group</th><th className="border-b border-slate-200 px-2 py-2 w-[130px]">Workcenter</th><th className="border-b border-slate-200 px-2 py-2 w-[70px]">Plan Hrs</th><th className="border-b border-slate-200 px-2 py-2 w-[170px]">WC Desc</th><th className="border-b border-slate-200 px-2 py-2 w-[80px]">Status</th><th className="border-b border-slate-200 px-2 py-2 w-[46px]">Act</th></tr>
                    </thead>
                    <tbody>
                      {editRows.map((row, index) => {
                        const wcOpts = workcentersByGroup(row.wct_group);
                        return (
                          <tr key={`${row.idsow || 'new'}-${index}`}>
                            <td className="border-b border-slate-100 px-2 py-1"><input type="number" value={row.operation_no ?? ''} onChange={e => updateEditRow(index, 'operation_no', e.target.value)} className={`${INPUT_CLS} w-[64px]`} /></td>
                            <td className="border-b border-slate-100 px-2 py-1"><input type="text" value={row.operation_text ?? ''} onChange={e => updateEditRow(index, 'operation_text', e.target.value)} className={`${INPUT_CLS} min-w-[300px]`} /></td>
                            <td className="border-b border-slate-100 px-2 py-1"><SelectWrapper><select value={row.wct_group || ''} onChange={e => updateEditRow(index, 'wct_group', e.target.value)} className={`${SELECT_CLS} w-[120px]`}><option value="">—</option>{groupnames.map(g => <option key={g} value={g}>{g}</option>)}</select></SelectWrapper></td>
                            <td className="border-b border-slate-100 px-2 py-1"><SelectWrapper><select value={row.workcenter || ''} onChange={e => updateEditRow(index, 'workcenter', e.target.value)} disabled={wcOpts.length === 0} className={`${SELECT_CLS} w-[120px] ${wcOpts.length === 0 ? 'opacity-40' : ''}`}><option value="">—</option>{wcOpts.map(wc => <option key={wc.workcenternew} value={wc.workcenternew}>{wc.workcenternew}</option>)}</select></SelectWrapper></td>
                            <td className="border-b border-slate-100 px-2 py-1"><input type="number" step="0.01" value={row.planhours ?? ''} onChange={e => updateEditRow(index, 'planhours', e.target.value)} className={`${INPUT_CLS} w-[62px] text-right`} /></td>
                            <td className="border-b border-slate-100 px-2 py-1"><input type="text" value={row.workcenterdescription ?? ''} readOnly className={`${INPUT_CLS} w-[160px] bg-slate-50 text-slate-500`} title={row.workcenterdescription || ''} /></td>
                            <td className="border-b border-slate-100 px-2 py-1"><input type="text" value={row.status ?? ''} readOnly className={`${INPUT_CLS} w-[70px] bg-slate-50 text-slate-500 text-center`} /></td>
                            <td className="border-b border-slate-100 px-2 py-1"><button onClick={() => removeOperation(index)} className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {showOpCard && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 flex-shrink-0">
              <div><h3 className="text-lg font-bold text-slate-900">Operation Card Preview</h3><p className="text-sm text-slate-500">{selectedOrder} — {editRows.length} operasi</p></div>
              <div className="flex gap-2">
                <button onClick={() => { if (opCardPrintRef.current) { opCardPrintRef.current.contentWindow?.focus(); opCardPrintRef.current.contentWindow?.print(); } }} className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-semibold text-white hover:bg-[#0077b6]"><Printer className="h-4 w-4" /> Print</button>
                <button onClick={() => setShowOpCard(false)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-5" style={{ background: '#e8e6e0' }}>
              {opCardLoading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-[#0096c7]" /></div>
              ) : (
                <iframe ref={opCardPrintRef} srcDoc={opCardHtml} title="Operation Card" scrolling="no" style={{ width: '100%', border: 'none', background: 'transparent' }} onLoad={(e) => { const body = e.target.contentDocument?.body; if (body) e.target.style.height = body.scrollHeight + 40 + 'px'; }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
