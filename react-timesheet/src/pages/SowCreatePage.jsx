import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Rnd } from 'react-rnd';
import {
  Search, Loader2, X, Plus, AlertCircle, Package, ClipboardList,
  BookmarkPlus, Check, ChevronRight, GripVertical, Trash2,
  ChevronDown, PenLine, ArrowRight, ArrowLeft, Printer, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import ssbLogo from '../assets/ssb.png';
import travelCardHtml from '../templates/travel-card.html?raw';
import operationCardHtml from '../templates/operation-card.html?raw';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const normalizeProductionOrder = (value) => String(value ?? '').trim().replace(/-/g, '000');

const fmtHours = (v) => (v != null && v !== '' ? parseFloat(v).toFixed(2) : '—');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = (s) => esc(s).replace(/'/g, '&#39;');

const OP_MAIN_BOX_W = 700;
const OP_MAIN_BOX_H = 560;

const makeOperationCardKey = (op) => op?._key || `${op?.operation_no || 'op'}-${op?.machineid || ''}`;
const operationCardStyle = operationCardHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || '';
const operationCardBody = operationCardHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || operationCardHtml;

function getOperationQrValue({ selectedPart, cardInfo, op }) {
  const productionOrder = cardInfo.productionOrder || selectedPart?.production_order || '';
  return [
    'OPERATION_CARD',
    `PO:${normalizeProductionOrder(productionOrder) || '-'}`,
    `PART:${selectedPart?.part_number || '-'}`,
    `OP:${op.operation_no || '-'}`,
    `WC:${op.machineid || '-'}`,
  ].join('|');
}

function renderOperationCardImages(images = []) {
  return images.map((img) => {
    const left = (img.x / OP_MAIN_BOX_W) * 100;
    const top = (img.y / OP_MAIN_BOX_H) * 100;
    const width = (img.width / OP_MAIN_BOX_W) * 100;
    const height = (img.height / OP_MAIN_BOX_H) * 100;

    return `
      <img
        class="main-box-image"
        src="${escAttr(img.src)}"
        alt=""
        style="left:${left.toFixed(4)}%; top:${top.toFixed(4)}%; width:${width.toFixed(4)}%; height:${height.toFixed(4)}%;"
      >`;
  }).join('');
}

function buildOperationCardsHtml({ selectedPart, editOps, selectedKeys, imagesByKey, qrByKey, cardInfo }) {
  const selectedKeySet = new Set(selectedKeys);
  const selectedOps = editOps.filter((op) => selectedKeySet.has(makeOperationCardKey(op)));

  const cards = selectedOps.map((op) => {
    const key = makeOperationCardKey(op);
    const productionOrder = normalizeProductionOrder(cardInfo.productionOrder || selectedPart?.production_order || '');
    const confirmationNo = `${productionOrder || selectedPart?.part_number || 'OP'}-${op.operation_no || key}`;

    return operationCardBody
      .replace('{{opsNo}}', esc(op.operation_no || '-'))
      .replace('{{operationText}}', esc(op.operation_text || '-'))
      .replace('{{workCenter}}', esc(op.machineid || '-'))
      .replace('{{confirmationNo}}', esc(confirmationNo))
      .replace('{{qrCodeDataUrl}}', qrByKey[key] || '')
      .replace('{{mainBoxImages}}', renderOperationCardImages(imagesByKey[key] || []));
  }).join('\n<div class="page-break"></div>\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SSB Operation Card</title>
<style>
${operationCardStyle}
.page-break { page-break-after: always; break-after: page; height: 0; }
.page-break:last-child { display: none; }
</style>
</head>
<body>
${cards || '<div style="padding:16px;font-family:Arial,sans-serif;">Pilih minimal satu operation card.</div>'}
</body>
</html>`;
}

// ─── useWorkcenterData ────────────────────────────────────────────────────────
function useWorkcenterData() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/workcenter`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Unique machineid values from the workcenter table, sorted
  const machineIds = [...new Set(rows.map((r) => r.machineid).filter(Boolean))].sort();

  return { machineIds, loading };
}

// ─── StepBadge ────────────────────────────────────────────────────────────────
function StepBadge({ n, active, done }) {
  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                 flex-shrink-0 transition-all"
      style={
        done
          ? { background: '#0096c7', color: '#fff' }
          : active
            ? { background: '#caf0f8', color: '#0077b6', border: '1.5px solid #00b4d8' }
            : { background: '#f1f5f9', color: '#94a3b8' }
      }
    >
      {done ? <Check size={10} /> : n}
    </div>
  );
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, className }) {
  return (
    <div
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                  transition-all
                  ${checked
                    ? 'bg-[#0096c7] border-[#0096c7]'
                    : indeterminate
                      ? 'border-[#0096c7] bg-white'
                      : 'border-slate-300 bg-white'
                  } ${className || ''}`}
    >
      {checked && <Check size={10} className="text-white" />}
      {indeterminate && !checked && <div className="w-2 h-0.5 bg-[#0096c7] rounded-sm" />}
    </div>
  );
}

// ─── PartPanel ────────────────────────────────────────────────────────────────
// collapsed = !!selected (auto, no separate state needed)
function PartPanel({ selected, onSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch]         = useState('');
  const [results, setResults]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/sow-components?limit=20&q=${encodeURIComponent(search)}`)
      .then((r) => r.json())
      .then((json) => setResults(json.data || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [search]);

  const handleInput = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 350);
  };

  const clearSearch = () => {
    setInputValue('');
    setSearch('');
    setResults([]);
  };

  const handlePick = (part) => {
    onSelect(part);
    clearSearch();
  };

  // ── Collapsed: part already selected ──
  if (selected) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xl border"
          style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
        >
          <Check size={13} style={{ color: '#0077b6' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-bold leading-snug"
              style={{ color: '#023e8a' }}
              title={selected.part_name}
            >
              {selected.part_name}
            </p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: '#0077b6' }}>
              {selected.part_number}
              {selected.model ? ` · ${selected.model}` : ''}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              {selected.ssbr_ident || 'No SSBR'} / {selected.production_order || 'No production order'}
            </p>
          </div>
        </div>
        <button
          onClick={() => { onSelect(null); clearSearch(); }}
          className="flex items-center justify-center gap-1.5 text-xs font-semibold
                     text-slate-400 hover:text-[#0096c7] py-1.5 rounded-lg
                     hover:bg-slate-50 border border-transparent hover:border-slate-200
                     transition-all"
        >
          <Search size={11} />
          Ganti Part
        </button>
      </div>
    );
  }

  // ── Expanded: search ──
  return (
    <div className="flex flex-col gap-3">

      {/* Search input */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          type="text"
          value={inputValue}
          onChange={handleInput}
          placeholder="Cari SSBR, production order, part, customer..."
          autoFocus
          className="w-full pl-8 pr-8 py-2 bg-white border border-slate-200 text-slate-800
                     placeholder-slate-400 rounded-lg text-sm focus:outline-none
                     focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
        />
        {inputValue && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400
                       hover:text-slate-600 p-1 rounded"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-5">
          <Loader2 size={16} className="animate-spin text-[#0096c7]" />
        </div>
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-1 max-h-[260px] md:max-h-none overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.receiving_component_id}
              onClick={() => handlePick(r)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                         transition-all min-h-[44px] border border-slate-100 bg-white
                         hover:bg-slate-50 hover:border-slate-200 active:scale-[0.98]"
            >
              <Package size={14} className="flex-shrink-0 text-slate-300" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">{r.part_name}</p>
                <p className="text-[10px] text-slate-500">
                  <span className="font-mono">{r.part_number || 'No part number'}</span>
                  {r.model ? ` · ${r.model}` : ''}
                  <span className="ml-1.5 text-slate-400">· {r.operation_count} op</span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  <span className="font-mono">{r.ssbr_ident}</span>
                  {r.production_order ? <span> / PO {r.production_order}</span> : <span> / PO belum ada</span>}
                  {r.customer_name ? <span> / {r.customer_name}</span> : null}
                </p>
              </div>
              <ChevronRight size={12} className="flex-shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      ) : search.trim() ? (
        <p className="text-center text-xs text-slate-400 py-5">
          Tidak ada hasil untuk &ldquo;{search}&rdquo;
        </p>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Package size={28} className="text-slate-200" />
          <p className="text-xs text-slate-400">Ketik untuk mencari component receiving</p>
        </div>
      )}
    </div>
  );
}

// ─── ChecklistPanel ───────────────────────────────────────────────────────────
function ReceivingComponentTable({ onSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const debounceRef = useRef(null);
  const limit = 12;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search.trim()) params.set('q', search.trim());

    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/sow-components?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => { if (!r.ok) throw new Error(`Server ${r.status}`); return r.json(); })
      .then((json) => {
        const data = Array.isArray(json.data) ? json.data : [];
        setRows(data);
        setTotal(json.pagination?.total || data.length);
        setPreview((current) =>
          data.find((item) => item.receiving_component_id === current?.receiving_component_id) || data[0] || null
        );
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setRows([]);
          setTotal(0);
          setPreview(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [page, search]);

  const handleInput = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 350);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setInputValue('');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5">
            <StepBadge n={1} active done={false} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Pilih Receiving Component
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {total} component tersedia. Pilih row untuk preview, lalu lanjutkan ke proses SOW.
          </p>
        </div>
        <div className="relative w-[360px] max-w-full">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={inputValue}
            onChange={handleInput}
            placeholder="Cari SSBR, PO, part, customer..."
            autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm text-slate-800
                       placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none
                       focus:ring-2 focus:ring-[#00b4d8]"
          />
          {inputValue && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
        <div className="min-w-0 overflow-hidden border-r border-slate-100">
          <div className="h-full overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">SSBR</th>
                  <th className="px-3 py-3 font-bold">Production Order</th>
                  <th className="px-3 py-3 font-bold">Part</th>
                  <th className="px-3 py-3 font-bold">Model</th>
                  <th className="px-3 py-3 font-bold">Customer</th>
                  <th className="px-3 py-3 font-bold">Level</th>
                  <th className="px-4 py-3 text-right font-bold">Ops</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin text-[#0096c7]" />
                      Loading receiving components...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      Tidak ada receiving component ditemukan.
                    </td>
                  </tr>
                ) : rows.map((row) => {
                  const isActive = preview?.receiving_component_id === row.receiving_component_id;
                  return (
                    <tr
                      key={row.receiving_component_id}
                      onClick={() => setPreview(row)}
                      onDoubleClick={() => onSelect(row)}
                      className={`cursor-pointer transition-colors ${isActive ? 'bg-cyan-50/70' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-slate-900">{row.ssbr_ident}</div>
                        <div className="text-[10px] text-slate-400">
                          {row.received_date ? new Date(row.received_date).toLocaleDateString('id-ID') : '-'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-slate-700">{row.production_order || '-'}</div>
                        {row.production_order && (
                          <div className="text-[10px] text-slate-400">{normalizeProductionOrder(row.production_order)}</div>
                        )}
                      </td>
                      <td className="max-w-[300px] px-3 py-3">
                        <div className="truncate font-semibold text-slate-800">{row.part_name}</div>
                        <div className="truncate font-mono text-[10px] text-slate-400">{row.part_number || 'No part number'}</div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.model || '-'}</td>
                      <td className="max-w-[220px] px-3 py-3">
                        <div className="truncate text-slate-700">{row.customer_name || '-'}</div>
                        <div className="truncate text-[10px] text-slate-400">{row.customer_site_name || row.customer_site_location || '-'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                          L{row.part_level} {row.part_type || ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{row.operation_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-slate-50/60">
          <div className="flex-1 overflow-auto p-4">
            {preview ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{preview.ssbr_ident}</p>
                      <h3 className="mt-1 text-base font-bold leading-snug text-slate-900">{preview.part_name}</h3>
                      <p className="mt-1 font-mono text-xs text-[#0077b6]">{preview.part_number || 'No part number'} / {preview.model || 'No model'}</p>
                    </div>
                    <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-bold text-[#0077b6]">
                      {preview.operation_count} ops
                    </span>
                  </div>
                  <button
                    onClick={() => onSelect(preview)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#0077b6] active:scale-[0.98]"
                  >
                    Pilih Component
                    <ChevronRight size={13} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <PreviewField label="Production Order" value={preview.production_order || '-'} mono />
                  <PreviewField label="SOW Order No" value={preview.production_order ? normalizeProductionOrder(preview.production_order) : '-'} mono />
                  <PreviewField label="Customer" value={preview.customer_name || '-'} />
                  <PreviewField label="Location" value={preview.customer_site_name || preview.customer_site_location || '-'} />
                  <PreviewField label="Level / Type" value={`L${preview.part_level}${preview.part_type ? ` / ${preview.part_type}` : ''}`} />
                  <PreviewField label="Parent" value={preview.parent_part_name || '-'} />
                  <PreviewField label="Reference" value={preview.reff_number || '-'} mono />
                  <PreviewField label="Ex Unit" value={preview.ex_unit || '-'} mono />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                <Package size={32} className="mb-2 text-slate-300" />
                <p className="text-sm font-semibold">Pilih row untuk melihat detail</p>
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
            <span className="text-[11px] text-slate-400">
              Page <span className="font-bold text-slate-600">{page}</span> of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ label, value, mono }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 break-words text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function ComponentMasterPicker({ selectedPart, onSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '40' });
    if (search.trim()) params.set('q', search.trim());

    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/components?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => { if (!r.ok) throw new Error(`Server ${r.status}`); return r.json(); })
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== 'AbortError') setRows([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search]);

  const handleInput = (e) => {
    const value = e.target.value;
    setInputValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setInputValue('');
    setSearch('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex-shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-bold text-amber-800">
              Part receiving ini tidak punya part_number / component master.
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-amber-700">
              Pilih referensi dari master components
            </p>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-slate-100 p-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={inputValue}
            onChange={handleInput}
            placeholder={`Cari master component${selectedPart?.part_name ? `: ${selectedPart.part_name}` : ''}`}
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-8 text-xs text-slate-800
                       placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
          {inputValue && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={18} className="animate-spin text-[#0096c7]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-slate-400">
            Tidak ada master component ditemukan.
          </div>
        ) : rows.map((component) => (
          <button
            key={component.component_id}
            onClick={() => onSelect(component)}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
          >
            <Package size={14} className="mt-0.5 flex-shrink-0 text-slate-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-slate-800">{component.part_name}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                <span className="font-mono">{component.part_number}</span>
                {component.model ? <span> / {component.model}</span> : null}
              </p>
            </div>
            <ChevronRight size={12} className="mt-1 flex-shrink-0 text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ChecklistPanel({ componentId, selectedPart, checked, onToggle, onToggleAll, onResolveComponent }) {
  const [ops, setOps]         = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!componentId) { setOps([]); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/sow/standard/component/${componentId}`)
      .then((r) => { if (!r.ok) throw new Error(`Server ${r.status}`); return r.json(); })
      .then((data) =>
        setOps(Array.isArray(data) ? data.sort((a, b) => a.operation_no - b.operation_no) : [])
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [componentId]);

  if (!selectedPart) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 gap-2">
        <ClipboardList size={32} className="text-slate-200" />
        <p className="text-xs text-slate-400">Pilih part terlebih dahulu</p>
      </div>
    );
  }

  if (!componentId) {
    return (
      <ComponentMasterPicker
        selectedPart={selectedPart}
        onSelect={onResolveComponent}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={18} className="animate-spin text-[#0096c7]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 flex items-start gap-2 px-3 py-2.5 bg-red-50 border
                      border-red-200 rounded-lg text-xs text-red-700">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        {error}
      </div>
    );
  }

  if (ops.length === 0) {
    return (
      <p className="text-center text-xs text-slate-400 py-10">
        Part ini belum memiliki operasi standar.
      </p>
    );
  }

  const allChecked  = ops.every((op) => checked.has(op.id));
  const someChecked = ops.some((op) => checked.has(op.id));

  return (
    <div className="flex flex-col h-full">
      {/* Select all bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2
                      bg-slate-50 border-b border-slate-100">
        <button
          onClick={() => onToggleAll(ops, !allChecked)}
          className="flex items-center gap-2 text-xs font-semibold text-[#0096c7]
                     hover:text-[#0077b6] transition-colors min-h-[36px]"
        >
          <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} />
          {allChecked ? 'Deselect All' : 'Select All'}
        </button>
        <span className="text-[10px] text-slate-400">
          <span className="font-semibold text-slate-600">{checked.size}</span>/{ops.length}
        </span>
      </div>

      {/* Operations list */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {ops.map((op) => {
          const isChecked = checked.has(op.id);
          return (
            <button
              key={op.id}
              onClick={() => onToggle(op)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left
                         transition-colors min-h-[48px]
                         ${isChecked
                           ? 'bg-[#caf0f8]/40 hover:bg-[#caf0f8]/60'
                           : 'hover:bg-slate-50'
                         }`}
            >
              <Checkbox checked={isChecked} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-1.5 flex-wrap">
                  <span className="font-mono text-[10px] font-bold text-[#0077b6] whitespace-nowrap">
                    {String(op.operation_no).padStart(4, '0')}
                  </span>
                  <span className="text-xs text-slate-800 leading-snug">
                    {op.operation_text}
                  </span>
                </div>
                {(op.workcenter || op.std_hours != null) && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {op.workcenter && <span className="font-mono">{op.workcenter}</span>}
                    {op.workcenter && op.std_hours != null && ' · '}
                    {op.std_hours != null && `${fmtHours(op.std_hours)} hrs`}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── WorkcenterSelect ────────────────────────────────────────────────────────
// Flat list of machineid values from the workcenter table
function WorkcenterSelect({ value, onChange, machineIds, loading, className }) {
  // Always include the current value as an option so sow_standard.machineid always shows
  const options = value && !machineIds.includes(value)
    ? [value, ...machineIds]
    : machineIds;

  return (
    <div className="relative">
      <select
        value={value || ''}
        onChange={onChange}
        disabled={loading}
        className={`w-full pl-2 pr-5 py-1.5 bg-white border border-slate-200 text-slate-700
                    rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-[#00b4d8]
                    focus:border-[#0096c7] transition-all appearance-none cursor-pointer
                    ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                    ${className || ''}`}
      >
        <option value="">— WC —</option>
        {options.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
      <ChevronDown
        size={9}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      />
    </div>
  );
}

// ─── EditPanel ────────────────────────────────────────────────────────────────
function EditPanel({ editOps, onEdit, onDelete, onReorder, onAdd, wcData }) {
  const { machineIds, loading: wcLoading } = wcData;

  const [dragKey, setDragKey]         = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOp, setNewOp] = useState({
    operation_text: '', machineid: '', std_hours: '',
  });

  // ── Drag and drop ──
  const handleDragStart = (e, key) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, key) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (key !== dragKey) setDragOverKey(key);
  };
  const handleDrop = (e, targetKey) => {
    e.preventDefault();
    if (!dragKey || dragKey === targetKey) { resetDrag(); return; }
    onReorder(dragKey, targetKey);
    resetDrag();
  };
  const handleDragEnd = () => resetDrag();
  const resetDrag = () => { setDragKey(null); setDragOverKey(null); };

  // ── Workcenter change — only updates machineid field ──
  const handleWcChange = (key, value) => {
    onEdit(key, 'machineid', value);
  };

  // ── Submit add form ──
  const handleAddSubmit = () => {
    if (!newOp.operation_text.trim()) { toast.error('Operation Text wajib diisi'); return; }
    onAdd({
      operation_text: newOp.operation_text.trim(),
      machineid:      newOp.machineid,
      std_hours:      newOp.std_hours,
    });
    setNewOp({ operation_text: '', machineid: '', std_hours: '' });
    setShowAddForm(false);
  };

  // ── Empty state ──
  if (editOps.length === 0 && !showAddForm) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6">
        <PenLine size={32} className="text-slate-200" />
        <div className="text-center">
          <p className="text-sm text-slate-400 font-medium">Belum ada proses dipilih</p>
          <p className="text-xs text-slate-300 mt-1">
            Centang proses dari panel kiri, atau tambahkan operasi manual di bawah
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[#0096c7]
                     hover:text-[#0077b6] transition-colors"
        >
          <Plus size={13} />
          Tambah operasi manual
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Operation table ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[500px]">
            <thead>
              <tr style={{ background: '#caf0f8' }}>
                <th className="w-8 px-2 py-2" aria-label="Drag" />
                <th className="w-10 px-2 py-2 text-center font-semibold text-slate-600 whitespace-nowrap">
                  No.
                </th>
                <th className="px-2 py-2 text-left font-semibold text-slate-600">
                  Operation Text
                </th>
                <th className="w-[150px] px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Workcenter
                </th>
                <th className="w-[80px] px-2 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">
                  Std Hrs
                </th>
                <th className="w-8 px-2 py-2" aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {editOps.map((op) => {
                const isDragging = dragKey === op._key;
                const isDragOver = dragOverKey === op._key && dragKey !== op._key;

                return (
                  <tr
                    key={op._key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, op._key)}
                    onDragOver={(e) => handleDragOver(e, op._key)}
                    onDrop={(e) => handleDrop(e, op._key)}
                    onDragEnd={handleDragEnd}
                    className={`transition-all
                      ${isDragging ? 'opacity-30 bg-slate-50' : ''}
                      ${isDragOver ? 'bg-[#caf0f8]/50' : 'hover:bg-slate-50'}
                    `}
                    style={{
                      borderTop: isDragOver ? '2px solid #0096c7' : '1px solid #f1f5f9',
                    }}
                  >
                    {/* Drag handle */}
                    <td className="px-2 py-2">
                      <GripVertical
                        size={13}
                        className="text-slate-300 hover:text-slate-400 mx-auto cursor-grab active:cursor-grabbing"
                      />
                    </td>

                    {/* Op No badge */}
                    <td className="px-2 py-2 text-center">
                      <span className="font-mono text-[11px] font-bold text-[#0077b6]">
                        {String(op.operation_no).padStart(3, '0')}
                      </span>
                    </td>

                    {/* Operation Text (editable) */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={op.operation_text}
                        onChange={(e) => onEdit(op._key, 'operation_text', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 text-slate-800
                                   rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#00b4d8]
                                   focus:border-[#0096c7] transition-all"
                      />
                    </td>

                    {/* Workcenter — uses machineid column from workcenter table */}
                    <td className="px-2 py-1.5">
                      <WorkcenterSelect
                        key={`${op._key}-${wcLoading}`}
                        value={op.machineid}
                        onChange={(e) => handleWcChange(op._key, e.target.value)}
                        machineIds={machineIds}
                        loading={wcLoading}
                      />
                    </td>

                    {/* Std Hours */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={op.std_hours ?? ''}
                        onChange={(e) => onEdit(op._key, 'std_hours', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 text-slate-800
                                   text-right rounded text-xs focus:outline-none focus:ring-1
                                   focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                      />
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-2">
                      <button
                        onClick={() => onDelete(op._key, op._srcId)}
                        className="w-6 h-6 flex items-center justify-center rounded
                                   text-slate-300 hover:text-red-500 hover:bg-red-50
                                   transition-all mx-auto"
                        title="Hapus dari list"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Add operation form (inline) ── */}
        {showAddForm && (
          <div className="border-t-2 border-dashed border-slate-200 p-3 bg-slate-50/80">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
              Tambah Operasi Manual
            </p>
            <div className="flex flex-col gap-2">
              {/* Operation Text */}
              <input
                type="text"
                value={newOp.operation_text}
                onChange={(e) => setNewOp((p) => ({ ...p, operation_text: e.target.value }))}
                placeholder="Operation Text *"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSubmit();
                  if (e.key === 'Escape') setShowAddForm(false);
                }}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 text-slate-800
                           placeholder-slate-400 rounded-lg text-xs focus:outline-none
                           focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
              />

              {/* Workcenter + Std Hours row */}
              <div className="flex gap-2">
                {/* Workcenter flat select (machineid from workcenter table) */}
                <div className="flex-1 relative">
                  <select
                    value={newOp.machineid}
                    onChange={(e) => setNewOp((p) => ({ ...p, machineid: e.target.value }))}
                    disabled={wcLoading}
                    className="w-full pl-2.5 pr-6 py-2 bg-white border border-slate-200 text-slate-700
                               rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#00b4d8]
                               focus:border-[#0096c7] transition-all appearance-none cursor-pointer"
                  >
                    <option value="">— Workcenter —</option>
                    {machineIds.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={10}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                </div>

                {/* Std Hours */}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newOp.std_hours}
                  onChange={(e) => setNewOp((p) => ({ ...p, std_hours: e.target.value }))}
                  placeholder="Hrs"
                  className="w-[72px] px-2.5 py-2 bg-white border border-slate-200 text-slate-800
                             text-right rounded-lg text-xs focus:outline-none
                             focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 justify-end mt-0.5">
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewOp({ operation_text: '', machineid: '', std_hours: '' });
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600
                             bg-white border border-slate-200 rounded-lg
                             hover:bg-slate-50 transition-all active:scale-95"
                >
                  Batal
                </button>
                <button
                  onClick={handleAddSubmit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                             text-white bg-[#0096c7] hover:bg-[#0077b6] rounded-lg
                             transition-all active:scale-95"
                >
                  <Plus size={12} />
                  Tambah
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Add button footer ── */}
      {!showAddForm && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-slate-100 bg-white">
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0096c7]
                       hover:text-[#0077b6] transition-colors min-h-[36px]"
          >
            <Plus size={12} />
            Tambah Operasi Manual
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TravelCardPreview ────────────────────────────────────────────────────────
function TravelCardPreview({ selectedPart, editOps, cardInfo, printRef }) {
  const [srcDoc, setSrcDoc] = useState('');
  const qrRef = useRef(null);

  const today    = new Date();
  const dateStr  = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const qrValue  = cardInfo.productionOrder || selectedPart?.part_number || 'TRAVEL-CARD';
  const totalHrs = editOps.reduce((sum, op) => sum + (parseFloat(op.std_hours) || 0), 0);
  const totalHoursDisplay = totalHrs % 1 === 0 ? String(totalHrs) : totalHrs.toFixed(2);

  useEffect(() => {
    // QRCodeCanvas renders in a RAF; wait one tick before reading toDataURL()
    const timer = setTimeout(() => {
      const canvas    = qrRef.current?.querySelector('canvas');
      const qrDataUrl = canvas ? canvas.toDataURL('image/png') : '';

      const opsRows = editOps.map((op, i) => `
        <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
          <td class="ops-no">${op.operation_no}</td>
          <td>${esc(op.operation_text)}</td>
          <td class="tc">${esc(op.machineid || '—')}</td>
          <td class="tc">${op.std_hours !== '' && op.std_hours != null ? parseFloat(op.std_hours) : '—'}</td>
          <td></td><td></td><td></td>
        </tr>`).join('');

      let html = travelCardHtml
        .replace('{{qrCodeDataUrl}}',   qrDataUrl)
        .replace('../assets/ssb.png',   ssbLogo)
        .replace('{{dateStr}}',         dateStr)
        .replace('{{productionOrder}}', esc(cardInfo.productionOrder || '—'))
        .replace('{{partName}}',        esc(selectedPart?.part_name   || '—'))
        .replace('{{customer}}',        esc(cardInfo.customer         || '—'))
        .replace('{{model}}',           esc(selectedPart?.model       || '—'))
        .replace('{{ident}}',           esc(cardInfo.ident            || '—'))
        .replace('{{location}}',        esc(cardInfo.location         || '—'))
        .replace('{{partNumber}}',      esc(selectedPart?.part_number || '—'))
        .replace('{{totalHours}}',      totalHoursDisplay);

      // Replace {{#each operations}}...{{/each}} block with rendered rows
      html = html.replace(
        /<!--\s*\{\{#each operations\}\}\s*-->[\s\S]*?<!--\s*\{\{\/each\}\}\s*-->/,
        opsRows,
      );

      setSrcDoc(html);
    }, 0);
    return () => clearTimeout(timer);
  }, [qrValue, selectedPart, editOps, cardInfo, dateStr, totalHoursDisplay]);

  return (
    <div style={{ background: '#e8e6e0', padding: '20px 16px', minHeight: '100%' }}>
      {/* Offscreen QRCodeCanvas — read its toDataURL() after render */}
      <div
        ref={qrRef}
        style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <QRCodeCanvas value={qrValue} size={232} level="M" bgColor="#ffffff" fgColor="#0a0a0a" />
      </div>

      {/* Template rendered in iframe — print-safe, pixel-identical to the HTML file */}
      <iframe
        ref={printRef}
        srcDoc={srcDoc}
        title="Travel Card Preview"
        scrolling="no"
        style={{ width: '194mm', border: 'none', display: 'block', margin: '0 auto' }}
        onLoad={(e) => {
          const body = e.target.contentDocument?.body;
          if (body) e.target.style.height = body.scrollHeight + 1 + 'px';
        }}
      />
    </div>
  );
}

// ─── SowCreatePage ─────────────────────────────────────────────────────────────
function OperationCardPreview({
  selectedPart,
  editOps,
  cardInfo,
  printRef,
  selectedKeys,
  onSelectedKeysChange,
  activeOperationKey,
  onActiveOperationChange,
  imagesByKey,
  onImagesByKeyChange,
}) {
  const [srcDoc, setSrcDoc] = useState('');
  const [selectedImageId, setSelectedImageId] = useState(null);
  const fileInputRef = useRef(null);
  const qrRef = useRef(null);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedOps = useMemo(
    () => editOps.filter((op) => selectedKeySet.has(makeOperationCardKey(op))),
    [editOps, selectedKeySet],
  );
  const activeOp = useMemo(
    () => editOps.find((op) => makeOperationCardKey(op) === activeOperationKey) || selectedOps[0] || editOps[0],
    [activeOperationKey, editOps, selectedOps],
  );
  const activeKey = activeOp ? makeOperationCardKey(activeOp) : null;
  const activeImages = activeKey ? (imagesByKey[activeKey] || []) : [];

  useEffect(() => {
    if (!activeOperationKey && editOps.length > 0) {
      onActiveOperationChange(makeOperationCardKey(editOps[0]));
    }
  }, [activeOperationKey, editOps, onActiveOperationChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const qrByKey = {};
      qrRef.current?.querySelectorAll('[data-op-key]').forEach((node) => {
        const key = node.getAttribute('data-op-key');
        const canvas = node.querySelector('canvas');
        if (key && canvas) qrByKey[key] = canvas.toDataURL('image/png');
      });

      setSrcDoc(buildOperationCardsHtml({
        selectedPart,
        editOps,
        selectedKeys,
        imagesByKey,
        qrByKey,
        cardInfo,
      }));
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedPart, editOps, selectedKeys, imagesByKey, cardInfo]);

  const handleToggleOperation = useCallback((key) => {
    const exists = selectedKeys.includes(key);
    const next = exists ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key];
    onSelectedKeysChange(next);
    if (!exists) {
      onActiveOperationChange(key);
      return;
    }
    if (activeOperationKey === key) {
      onActiveOperationChange(next[0] || null);
      setSelectedImageId(null);
    }
  }, [activeOperationKey, onActiveOperationChange, onSelectedKeysChange, selectedKeys]);

  const readImageFile = useCallback((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }), []);

  const handleAddImages = useCallback(async (event) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!activeKey || files.length === 0) return;

    const dataUrls = await Promise.all(files.map(readImageFile));
    const additions = dataUrls.map((src, index) => ({
      id: `img-${Date.now()}-${index}`,
      src,
      x: Math.min(40 + index * 18, OP_MAIN_BOX_W - 180),
      y: Math.min(40 + index * 18, OP_MAIN_BOX_H - 120),
      width: 240,
      height: 160,
    }));

    onImagesByKeyChange((prev) => ({
      ...prev,
      [activeKey]: [...(prev[activeKey] || []), ...additions],
    }));
    setSelectedImageId(additions[additions.length - 1]?.id || null);
    event.target.value = '';
  }, [activeKey, onImagesByKeyChange, readImageFile]);

  const updateImage = useCallback((imageId, patch) => {
    if (!activeKey) return;
    onImagesByKeyChange((prev) => ({
      ...prev,
      [activeKey]: (prev[activeKey] || []).map((img) =>
        img.id === imageId ? { ...img, ...patch } : img
      ),
    }));
  }, [activeKey, onImagesByKeyChange]);

  const removeSelectedImage = useCallback(() => {
    if (!activeKey || !selectedImageId) return;
    onImagesByKeyChange((prev) => ({
      ...prev,
      [activeKey]: (prev[activeKey] || []).filter((img) => img.id !== selectedImageId),
    }));
    setSelectedImageId(null);
  }, [activeKey, onImagesByKeyChange, selectedImageId]);

  return (
    <div className="grid min-h-full grid-cols-[390px_minmax(0,1fr)] bg-slate-100">
      <div className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <StepBadge n={4} active done={false} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Operation Card
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Pilih operation, lalu sisipkan gambar ke main box operation aktif.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 space-y-2">
            {editOps.map((op) => {
              const key = makeOperationCardKey(op);
              const checked = selectedKeys.includes(key);
              const active = activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onActiveOperationChange(key)}
                  className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-all ${
                    active ? 'border-[#00b4d8] bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); handleToggleOperation(key); }}
                    className="mt-0.5"
                  >
                    <Checkbox checked={checked} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        Ops {op.operation_no}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {op.machineid || '-'}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-800">
                      {op.operation_text || '-'}
                    </p>
                    {(imagesByKey[key] || []).length > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-[#0096c7]">
                        {(imagesByKey[key] || []).length} gambar
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Card Selection</p>
            <p className="mt-1 text-xs text-slate-500">
              Checklist menentukan operation yang ikut dicetak. Klik row untuk mengedit preview operation tersebut.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
              <span className="font-semibold text-slate-600">{selectedKeys.length} card dipilih</span>
              <span className="text-slate-400">{activeImages.length} gambar pada operation aktif</span>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-5" style={{ background: '#e8e6e0' }}>
        <div
          ref={qrRef}
          style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {selectedOps.map((op) => {
            const key = makeOperationCardKey(op);
            return (
              <div key={key} data-op-key={key}>
                <QRCodeCanvas
                  value={getOperationQrValue({ selectedPart, cardInfo, op })}
                  size={180}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
            );
          })}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleAddImages}
        />

        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview Operation Aktif</p>
            <p className="truncate text-sm font-bold text-slate-800">
              {activeOp ? `Ops ${activeOp.operation_no} - ${activeOp.operation_text || '-'}` : 'Tidak ada operation'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {activeKey && selectedKeys.includes(activeKey) ? 'Operation ini dipilih untuk print.' : 'Operation ini belum dicentang untuk print.'}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeKey}
              className="flex items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={12} />
              Add Image
            </button>
            <button
              type="button"
              onClick={removeSelectedImage}
              disabled={!selectedImageId}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        </div>

        <div
          className="mx-auto bg-white"
          style={{
            width: 794,
            minHeight: 1010,
            border: '2px solid #000',
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', borderBottom: '2px solid #000' }}>
            <tbody>
              <tr>
                <td style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr>
                        <td style={{ width: 150, padding: 8 }}>Ops. No</td>
                        <td style={{ width: 20, textAlign: 'center' }}>:</td>
                        <td style={{ borderBottom: '1px solid #000', padding: 8, fontWeight: 'bold' }}>{activeOp?.operation_no || '-'}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Operation Text</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ borderBottom: '1px solid #000', padding: 8 }}>{activeOp?.operation_text || '-'}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Work Center</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ borderBottom: '1px solid #000', padding: 8 }}>{activeOp?.machineid || '-'}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Confirmation No</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ padding: 8 }}>
                          {activeOp ? `${normalizeProductionOrder(cardInfo.productionOrder || selectedPart?.production_order || '') || selectedPart?.part_number || 'OP'}-${activeOp.operation_no || activeKey}` : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style={{ width: 152, borderLeft: '2px solid #000', textAlign: 'center', verticalAlign: 'middle' }}>
                  {activeOp && (
                    <QRCodeCanvas
                      value={getOperationQrValue({ selectedPart, cardInfo, op: activeOp })}
                      size={114}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              width: OP_MAIN_BOX_W,
              height: OP_MAIN_BOX_H,
              margin: '19px auto',
              border: '2px solid #000',
              position: 'relative',
              overflow: 'hidden',
              background: '#fff',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedImageId(null);
            }}
          >
            {activeImages.map((img) => {
              const selected = selectedImageId === img.id;
              return (
                <Rnd
                  key={img.id}
                  size={{ width: img.width, height: img.height }}
                  position={{ x: img.x, y: img.y }}
                  bounds="parent"
                  lockAspectRatio
                  onDragStop={(_, d) => updateImage(img.id, { x: d.x, y: d.y })}
                  onResizeStop={(_, __, ref, ___, pos) =>
                    updateImage(img.id, {
                      x: pos.x,
                      y: pos.y,
                      width: parseFloat(ref.style.width),
                      height: parseFloat(ref.style.height),
                    })
                  }
                  style={{
                    border: selected ? '2px dashed #0096c7' : '2px dashed transparent',
                    boxSizing: 'border-box',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImageId(img.id);
                  }}
                >
                  <img
                    src={img.src}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none',
                      display: 'block',
                    }}
                  />
                </Rnd>
              );
            })}
          </div>
        </div>

        <iframe
          ref={printRef}
          srcDoc={srcDoc}
          title="Operation Card Print Output"
          scrolling="no"
          style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', border: 'none', background: '#fff' }}
          onLoad={(e) => {
            const body = e.target.contentDocument?.body;
            if (body) e.target.style.height = body.scrollHeight + 1 + 'px';
          }}
        />
      </div>
    </div>
  );
}

const SowCreatePage = () => {
  const [selectedPart, setSelectedPart] = useState(null);
  const [checkedOps, setCheckedOps]     = useState(new Set());
  const [editOps, setEditOps]           = useState([]);
  const [saving, setSaving]             = useState(false);
  const [activeStep, setActiveStep]     = useState('edit');
  const [cardInfo, setCardInfo]         = useState({ customer: '', productionOrder: '', location: '', ident: '' });
  const [operationCardKeys, setOperationCardKeys] = useState([]);
  const [activeOperationKey, setActiveOperationKey] = useState(null);
  const [operationCardImages, setOperationCardImages] = useState({});
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [printing, setPrinting]           = useState(false);
  const printRef = useRef(null);

  const handlePrint = useCallback(() => {
    const iframe = printRef.current;
    if (!iframe || printing) return;
    setPrinting(true);
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setPrinting(false);
    }
  }, [printing]);

  const wcData = useWorkcenterData();

  const handleGoToOperationCard = useCallback(() => {
    const keys = editOps.map(makeOperationCardKey);
    setOperationCardKeys((prev) => {
      const valid = prev.filter((key) => keys.includes(key));
      return valid.length > 0 ? valid : keys;
    });
    setActiveOperationKey((prev) => (keys.includes(prev) ? prev : keys[0] || null));
    setActiveStep('operation-card');
  }, [editOps]);

  // ── Select / deselect part ──
  const handleSelectPart = useCallback((part) => {
    setSelectedPart(part);
    setCheckedOps(new Set());
    setEditOps([]);
    setOperationCardKeys([]);
    setActiveOperationKey(null);
    setOperationCardImages({});
    setCardInfo({
      customer: part?.customer_name || '',
      productionOrder: normalizeProductionOrder(part?.production_order || ''),
      location: part?.customer_site_name || part?.customer_site_location || '',
      ident: part?.ssbr_ident || '',
    });
  }, []);

  const handleResolveComponent = useCallback((component) => {
    setSelectedPart((prev) => ({
      ...prev,
      component_id: component.component_id,
      part_name: component.part_name,
      part_number: component.part_number,
      model: component.model,
      resolved_component_id: component.component_id,
    }));
    setCheckedOps(new Set());
    setEditOps([]);
    setOperationCardKeys([]);
    setActiveOperationKey(null);
    setOperationCardImages({});
    toast.success('Master component dipilih. Operasi standar siap dimuat.');
  }, []);

  // ── Toggle single operation (syncs checkedOps ↔ editOps) ──
  const handleToggle = useCallback((op) => {
    // Update checkedOps independently
    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op.id)) next.delete(op.id);
      else next.add(op.id);
      return next;
    });

    // Update editOps independently — derive add/remove from editOps state itself
    // to avoid calling setEditOps inside setCheckedOps updater (causes double call in Strict Mode)
    setEditOps((prev) => {
      const alreadyIn = prev.some((e) => e._srcId === op.id);
      if (alreadyIn) {
        const filtered = prev.filter((e) => e._srcId !== op.id);
        return filtered.map((e, i) => ({ ...e, operation_no: (i + 1) * 10 }));
      }
      const appended = [...prev, makeEditEntry(op, 0)];
      return appended.map((e, i) => ({ ...e, operation_no: (i + 1) * 10 }));
    });
  }, []);

  // ── Toggle all ──
  const handleToggleAll = useCallback((ops, selectAll) => {
    if (selectAll) {
      setCheckedOps(new Set(ops.map((o) => o.id)));
      setEditOps(ops.map((op, i) => makeEditEntry(op, (i + 1) * 10)));
    } else {
      setCheckedOps(new Set());
      setEditOps([]);
    }
  }, []);

  // ── Edit a field in editOps ──
  const handleEdit = useCallback((key, field, value) => {
    setEditOps((prev) =>
      prev.map((op) => (op._key === key ? { ...op, [field]: value } : op))
    );
  }, []);

  // ── Delete from edit panel (also unchecks if from standard) ──
  const handleEditDelete = useCallback((key, srcId) => {
    setEditOps((prev) => {
      const filtered = prev.filter((op) => op._key !== key);
      return filtered.map((e, i) => ({ ...e, operation_no: (i + 1) * 10 }));
    });
    if (srcId != null) {
      setCheckedOps((prev) => {
        const next = new Set(prev);
        next.delete(srcId);
        return next;
      });
    }
  }, []);

  // ── Reorder via DnD ──
  const handleReorder = useCallback((fromKey, toKey) => {
    setEditOps((prev) => {
      const items = [...prev];
      const from  = items.findIndex((o) => o._key === fromKey);
      const to    = items.findIndex((o) => o._key === toKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return items.map((op, i) => ({ ...op, operation_no: (i + 1) * 10 }));
    });
  }, []);

  // ── Add manual operation ──
  const handleAddOp = useCallback((opData) => {
    setEditOps((prev) => {
      const entry = {
        _key:           `new-${Date.now()}`,
        _isNew:         true,
        _srcId:         null,
        operation_text: opData.operation_text,
        machineid:      opData.machineid,
        std_hours:      opData.std_hours,
        operation_no:   0,
      };
      const appended = [...prev, entry];
      return appended.map((e, i) => ({ ...e, operation_no: (i + 1) * 10 }));
    });
  }, []);

  // ── Submit ──
  const handleCreate = async (saveAsTemplate) => {
    if (!selectedPart) { toast.error('Pilih part terlebih dahulu'); return; }
    if (editOps.length === 0) { toast.error('Pilih atau tambahkan minimal 1 proses'); return; }

    setSaving(true);
    try {
      const orderNo = normalizeProductionOrder(cardInfo.productionOrder || selectedPart.production_order);
      if (!orderNo) {
        toast.error('Production order wajib diisi sebelum Create SOW');
        setShowInfoPanel(true);
        return;
      }

      const payload = {
        component_id:     selectedPart.component_id,
        receiving_component_id: selectedPart.receiving_component_id,
        order_no:         orderNo,
        production_order: selectedPart.production_order,
        ssbr_id:          cardInfo.ident || selectedPart.ssbr_ident,
        part_name:        selectedPart.part_name,
        part_number:      selectedPart.part_number,
        model:            selectedPart.model,
        customer:         cardInfo.customer || selectedPart.customer_name,
        location:         cardInfo.location || selectedPart.customer_site_name || selectedPart.customer_site_location,
        type:             selectedPart.part_type,
        group:            selectedPart.parent_part_name || selectedPart.part_type,
        save_as_template: saveAsTemplate,
        operations:       editOps.map((op) => ({
          operation_no:   op.operation_no,
          operation_text: op.operation_text,
          machineid:      op.machineid,
          planhours:      op.std_hours !== '' ? parseFloat(op.std_hours) : null,
          source_op_id:   op._srcId,
        })),
      };

      const res = await fetch(`${API_BASE}/sow/create`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }

      toast.success(
        saveAsTemplate
          ? 'SOW dibuat & disimpan sebagai template!'
          : 'SOW berhasil dibuat!'
      );

      // Reset
      setSelectedPart(null);
      setCheckedOps(new Set());
      setEditOps([]);
      setOperationCardKeys([]);
      setActiveOperationKey(null);
      setOperationCardImages({});
      setActiveStep('edit');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Page title bar ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-700">Buat SOW dari Receiving</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Pilih part → centang proses → review &amp; edit → buat SOW
        </p>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      {activeStep === 'preview' ? (
        <div className="flex-1 overflow-y-auto">
          <TravelCardPreview selectedPart={selectedPart} editOps={editOps} cardInfo={cardInfo} printRef={printRef} />
        </div>
      ) : activeStep === 'operation-card' ? (
        <div className="flex-1 overflow-hidden">
          <OperationCardPreview
            selectedPart={selectedPart}
            editOps={editOps}
            cardInfo={cardInfo}
            printRef={printRef}
            selectedKeys={operationCardKeys}
            onSelectedKeysChange={setOperationCardKeys}
            activeOperationKey={activeOperationKey}
            onActiveOperationChange={setActiveOperationKey}
            imagesByKey={operationCardImages}
            onImagesByKeyChange={setOperationCardImages}
          />
        </div>
      ) : (
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {!selectedPart ? (
          <div className="flex-1 min-h-0 overflow-hidden bg-slate-50 p-4">
            <ReceivingComponentTable onSelect={handleSelectPart} />
          </div>
        ) : (
          <>

        {/* Panel 1 — Part (hidden after selection) */}
        {false && (
          <div className="flex-shrink-0 bg-white
                          border-b border-slate-200 md:border-b-0 md:border-r
                          overflow-y-auto px-4 py-3 md:w-80">
            <div className="flex items-center gap-1.5 mb-3">
              <StepBadge n={1} active done={false} />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Pilih Receiving Component
              </span>
            </div>
            <PartPanel
              selected={null}
              onSelect={handleSelectPart}
            />
          </div>
        )}

        {/* Panel 2 — Checklist */}
        <div
          className="flex-shrink-0 bg-white
                     border-b border-slate-200 md:border-b-0 md:border-r
                     md:w-[450px] flex flex-col overflow-hidden
                     max-h-64 md:max-h-none"
        >
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <StepBadge
                  n={2}
                  active={!!selectedPart && checkedOps.size === 0}
                  done={checkedOps.size > 0}
                />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Pilih Proses
                </span>
              </div>
              {selectedPart && (
                <button
                  onClick={() => handleSelectPart(null)}
                  className="flex items-center gap-1 text-[10px] font-semibold
                             text-slate-400 hover:text-[#0096c7] transition-colors
                             min-h-[32px] px-1.5 rounded hover:bg-slate-50"
                >
                  <Search size={10} />
                  Ganti Part
                </button>
              )}
            </div>
            {selectedPart && (
              <div className="mt-1 flex items-center gap-1.5 min-w-0">
                <span
                  className="text-[10px] font-bold truncate"
                  style={{ color: '#023e8a' }}
                  title={selectedPart.part_name}
                >
                  {selectedPart.part_name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
                  {selectedPart.part_number}
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <ChecklistPanel
              componentId={selectedPart?.component_id}
              selectedPart={selectedPart}
              checked={checkedOps}
              onToggle={handleToggle}
              onToggleAll={handleToggleAll}
              onResolveComponent={handleResolveComponent}
            />
          </div>
        </div>

        {/* Panel 3 — Edit */}
        <div className="flex-1 bg-white flex flex-col overflow-hidden min-h-0">
          <div className="flex-shrink-0 flex items-center justify-between gap-2
                          px-4 py-2.5 border-b border-slate-200">
            <div className="flex items-center gap-1.5">
              <StepBadge n={3} active={editOps.length > 0} done={false} />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Review &amp; Edit
              </span>
            </div>
            {editOps.length > 0 && (
              <span className="text-[10px] text-slate-400">
                <span className="font-semibold text-slate-600">{editOps.length}</span> operasi
                <span className="ml-2 text-slate-300">· drag untuk reorder</span>
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <EditPanel
              editOps={editOps}
              onEdit={handleEdit}
              onDelete={handleEditDelete}
              onReorder={handleReorder}
              onAdd={handleAddOp}
              wcData={wcData}
            />
          </div>
        </div>

          </>
        )}
      </div>
      )}

      {/* ── Footer action bar ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-t border-slate-200
                      flex items-center justify-between gap-3 flex-wrap">

        {activeStep === 'edit' ? (
          <>
            {/* Summary */}
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
              {selectedPart ? (
                <>
                  <span className="font-mono text-slate-400 truncate">{selectedPart.part_number}</span>
                  {editOps.length > 0 && (
                    <span className="font-semibold text-[#0096c7] flex-shrink-0">
                      · {editOps.length} operasi
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-400">Belum ada part dipilih</span>
              )}
            </div>
            {/* Next Step */}
            <button
              onClick={() => setActiveStep('preview')}
              disabled={!selectedPart || editOps.length === 0}
              className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                         px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Preview Travel Card
              <ArrowRight size={13} />
            </button>
          </>
        ) : (
          <>
            {/* Back */}
            <button
              onClick={() => setActiveStep(activeStep === 'operation-card' ? 'preview' : 'edit')}
              className="flex items-center gap-1.5 bg-white border border-slate-200
                         text-slate-700 hover:bg-slate-50 hover:border-slate-300
                         px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
            >
              <ArrowLeft size={13} />
              {activeStep === 'operation-card' ? 'Back to Travel Card' : 'Back to Edit'}
            </button>
            {/* Preview actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowInfoPanel(true)}
                className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
              >
                <Info size={13} />
                Add Info
              </button>
              <button
                onClick={handlePrint}
                disabled={printing || (activeStep === 'operation-card' && operationCardKeys.length === 0)}
                className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                {printing ? 'Generating…' : 'Print PDF'}
              </button>
              {activeStep === 'preview' && (
                <button
                  onClick={handleGoToOperationCard}
                  className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                             px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
                >
                  Next Operation Card
                  <ArrowRight size={13} />
                </button>
              )}
              {activeStep === 'operation-card' && (
                <>
              <button
                onClick={() => handleCreate(true)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />}
                Save as Template
              </button>
              <button
                onClick={() => handleCreate(false)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                           px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Create SOW
              </button>
                </>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── Add Info Panel (modal) ──────────────────────────────────────── */}
      {showInfoPanel && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm px-0 md:px-4"
          onClick={() => setShowInfoPanel(false)}
        >
          <div
            className="bg-white w-full md:max-w-sm rounded-t-2xl md:rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">Informasi Travel Card</h3>
              <button
                onClick={() => setShowInfoPanel(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                           hover:text-slate-600 hover:bg-slate-100 transition-all"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {[
                { key: 'productionOrder', label: 'Production Order', placeholder: '1000XXXXXX' },
                { key: 'customer',        label: 'Customer',          placeholder: 'PT. ...' },
                { key: 'location',        label: 'Location',          placeholder: 'BMB / GDG ...' },
                { key: 'ident',           label: 'Ident',             placeholder: 'e.g. SHCP-331' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={cardInfo[key]}
                    onChange={(e) => setCardInfo((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                               placeholder-slate-400 rounded-lg text-sm focus:outline-none
                               focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setShowInfoPanel(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200
                           rounded-lg hover:bg-slate-50 transition-all active:scale-95"
              >
                Batal
              </button>
              <button
                onClick={() => setShowInfoPanel(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0096c7] hover:bg-[#0077b6]
                           rounded-lg transition-all active:scale-95"
              >
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// ── Helper: build editOp entry from a standard operation ──────────────────────
function makeEditEntry(op, operation_no) {
  return {
    _key:           `std-${op.id}`,
    _isNew:         false,
    _srcId:         op.id,
    operation_text: op.operation_text,
    machineid:      op.machineid || op.workcenter || '',
    std_hours:      op.std_hours ?? '',
    operation_no,
  };
}

export default SowCreatePage;
