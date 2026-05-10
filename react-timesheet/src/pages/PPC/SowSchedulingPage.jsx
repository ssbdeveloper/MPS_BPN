import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Loader2, Plus, Save, Search, Send, User, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../../components';
import {
  approveOvertime, createBatch, createOvertime, createSchedule,
  deleteBatch, deleteSchedule, fetchBatches, fetchCapacity,
  fetchManpower, fetchOvertime, fetchSchedules, fetchSchedulingActivities,
  fetchSchedulingMachines, fetchShifts, rejectOvertime, updateSchedule,
  assignManpower, deleteOvertime,
} from '../../services/sowScheduleService';
import { goBackOrFallback } from '../../utils/navigation';

const ACTIVITY_PAGE_SIZE = 100;
const SCHEDULE_LIMIT = 500;

function todayText() { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); }
function readAuthUser() { try { return JSON.parse(sessionStorage.getItem('authUser')||'null'); } catch { return null; } }
function roleText(user) { return String(user?.roles||user?.role||'').toLowerCase(); }
function canApproveOvertime(user) { const r=roleText(user).split(/[,\s/;|]+/); return r.includes('supervisor')||r.includes('administrator'); }
function asNumber(v, f=0) { const n=Number(v); return Number.isFinite(n)?n:f; }
function formatHours(v) { return asNumber(v).toLocaleString('id-ID',{maximumFractionDigits:2}); }
function formatTime(v) { if(!v) return '-'; const t=String(v); const m=t.match(/(\d{2}:\d{2})/); return m?m[1]:t.slice(0,5); }
function activityIdentity(item={}) { return { sow_id:item.idsow||item.sow_id||null, production_order:item.order_no||item.production_order||'', operation_no:item.operation_no||'', ssbr_id:item.ssbr_id||'', workcenter:item.workcenter||'' }; }
function capacityKey(mc,sid) { return `${mc||''}::${sid||''}`; }
function groupByMachineShift(rows=[]) { return rows.reduce((a,r)=>{ const k=capacityKey(r.machine_code,r.shift_id); if(!a[k])a[k]=[]; a[k].push(r); return a; },{}); }
function groupOvertimeByMachine(rows=[]) { return rows.reduce((a,r)=>{ const k=r.machine_code||''; if(!a[k])a[k]=[]; a[k].push(r); return a; },{}); }
function buildDropId(t,mc,sid='') { return [t,mc,sid].join('|'); }
function parseDropId(id) { const [t,mc,sid]=String(id||'').split('|'); return {type:t,machineCode:mc,shiftId:sid}; }
function clockToMinutes(v) { const [h,m]=String(v||'00:00').split(':').map(p=>Number(p)||0); return h*60+m; }
function minutesToClock(m) { const n=((Math.round(m)%1440)+1440)%1440; return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
function addHoursToClock(v,h) { return minutesToClock(clockToMinutes(v)+asNumber(h)*60); }

function SowActivityCard({ item, dragging=false, source='activity' }) {
  const identity = activityIdentity(item);
  const ph = item.planhours??item.original_planhours??item.planned_hours??0;
  const rm = item.remaining_hours??item.planned_hours??item.planhours??0;
  const sc = item.scheduled_hours??0;
  const isUnplanned = source==='unplanned'||item.schedule_status==='UNPLANNED';
  return (
    <div className={`rounded-lg border bg-white p-2.5 shadow-sm transition ${dragging?'w-80 border-[#0096c7] shadow-xl shadow-[#0096c7]/20':isUnplanned?'border-red-300 bg-red-50':'border-slate-300'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1"><p className="truncate font-mono text-xs font-extrabold text-slate-900">{identity.production_order||'-'}</p><p className="truncate text-[10px] font-semibold text-slate-500">{identity.ssbr_id||'-'}</p></div>
        <span className="shrink-0 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-extrabold text-white">{identity.operation_no||'-'}</span>
      </div>
      <p className="mt-1.5 line-clamp-1 text-[11px] font-semibold text-slate-700">{item.operation_text||item.part_name||'-'} / {identity.workcenter||item.machine_code||'-'}</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-extrabold">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-center text-slate-600">Plan {formatHours(ph)}</span>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-center text-violet-700">Done {formatHours(sc)}</span>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-center text-emerald-700">Left {formatHours(rm)}</span>
      </div>
    </div>
  );
}

function DropScheduleCard({ schedule, onDelete }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id:`planned-${schedule.id}`, data:{item:schedule,source:'planned'} });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`group cursor-grab rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition hover:border-[#90e0ef] hover:shadow active:cursor-grabbing ${isDragging?'opacity-50':''}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-slate-700">{schedule.operation_no||'-'}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{schedule.production_order||schedule.ssbr_id||'-'}</span>
        <span className="shrink-0 text-[11px] font-extrabold text-[#0096c7]">{formatHours(schedule.planned_hours)}h</span>
        <button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(schedule.id)}} className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-red-100"><X className="h-3 w-3 text-red-500"/></button>
      </div>
      <p className="mt-0.5 truncate pl-7 text-[10px] text-slate-400">{schedule.operation_text||schedule.part_name||''}</p>
    </div>
  );
}

function BatchBox({ batch, schedules, onDelete, onDeleteBatch }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50 p-2">
      <button type="button" onClick={()=>setExpanded(v=>!v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0"><p className="truncate text-[11px] font-extrabold text-violet-800">{batch.batch_code||'Batch'}</p><p className="text-[10px] font-bold text-violet-600">max {formatHours(batch.batch_capacity_hours)}h/op · {schedules.length} ops</p></div>
        <div className="flex items-center gap-1"><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-violet-700">{expanded?'Hide':`${schedules.length} ops`}</span><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDeleteBatch(batch.id)}} className="flex h-6 w-6 items-center justify-center rounded-md bg-red-100 text-red-700 hover:bg-red-200"><X className="h-3.5 w-3.5"/></button></div>
      </button>
      {expanded&&<div className="mt-2 space-y-2">{schedules.map(s=><DropScheduleCard key={s.id} schedule={s} onDelete={onDelete}/>)}</div>}
    </div>
  );
}

function DraggableActivity({ item, source='activity' }) {
  const id = source==='unplanned'?`unplanned-${item.id}`:`activity-${item.idsow}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data:{item,source} });
  return <div ref={setNodeRef} {...listeners} {...attributes} className={`cursor-grab active:cursor-grabbing ${isDragging?'opacity-50':''}`}><SowActivityCard item={item} source={source}/></div>;
}

function DraggableManpower({ person }) {
  const id = `manpower-${person.snssb}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data:{item:person, source:'manpower'} });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`cursor-grab active:cursor-grabbing rounded-lg border bg-white p-2 shadow-sm transition hover:border-[#0096c7] ${isDragging?'opacity-50':''}`}>
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-slate-400 shrink-0"/>
        <div className="min-w-0"><p className="truncate text-[11px] font-extrabold text-slate-800">{person.full_name||'-'}</p><p className="text-[10px] text-slate-400">{person.snssb||'-'} · {person.employee_category||'-'}</p></div>
      </div>
    </div>
  );
}

function DropZone({ id, title, capacity, schedules, onDeleteSchedule, onDeleteBatch }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [expanded, setExpanded] = useState(true);
  const used = asNumber(capacity?.used_normal_planned_hours);
  const total = asNumber(capacity?.total_capacity_hours, 8);
  const remaining = asNumber(capacity?.remaining_capacity_hours, Math.max(total-used,0));
  const pct = Math.min(100,Math.max(0,(used/Math.max(total,1))*100));
  const batches = schedules.reduce((acc,s)=>{ if(!s.batch_id)return acc; const k=String(s.batch_id); if(!acc[k])acc[k]={batch:{id:s.batch_id,batch_code:s.batch_code,batch_capacity_hours:s.batch_capacity_hours},schedules:[]}; acc[k].schedules.push(s); return acc; },{});
  const batchedIds = new Set(Object.values(batches).flatMap(g=>g.schedules.map(r=>r.id)));
  const items = [...Object.values(batches).map(g=>({type:'batch',...g})),...schedules.filter(s=>!batchedIds.has(s.id)).map(s=>({type:'schedule',schedule:s}))];
  const barColor = pct>=90?'bg-red-500':pct>=70?'bg-amber-500':'bg-[#0096c7]';
  return (
    <div ref={setNodeRef} className={`rounded-lg border p-2.5 transition ${isOver?'border-[#0096c7] bg-[#caf0f8] ring-2 ring-[#00b4d8]':'border-slate-200 bg-white'}`}>
      <button type="button" onClick={()=>setExpanded(v=>!v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-extrabold text-slate-700">{title}</span><span className="text-[10px] font-bold text-slate-400">{formatHours(used)}/{formatHours(total)}h</span></div><div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${barColor}`} style={{width:`${pct}%`}}/></div></div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="text-[11px] font-extrabold text-slate-600">{formatHours(remaining)}h</span><ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${expanded?'rotate-180':''}`}/></div>
      </button>
      {expanded&&<div className="mt-2 min-h-12 space-y-1.5">{items.length===0?<div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-[11px] font-medium text-slate-400">Drop SOW here</div>:items.map(item=>item.type==='batch'?<BatchBox key={`batch-${item.batch.id}`} batch={item.batch} schedules={item.schedules} onDelete={onDeleteSchedule} onDeleteBatch={onDeleteBatch}/>:<DropScheduleCard key={item.schedule.id} schedule={item.schedule} onDelete={onDeleteSchedule}/>)}</div>}
    </div>
  );
}

function OvertimeRow({ row, onDelete }) {
  const id = `assign-ot-${row.id}`;
  const { setNodeRef, isOver } = useDroppable({ id, data: { overtimeId: row.id, machine_code: row.machine_code } });
  const status = String(row.request_status||'').toUpperCase();
  const statusColor = status==='APPROVED'?'border-emerald-300 bg-emerald-50':status==='REJECTED'?'border-red-300 bg-red-50':'border-amber-200 bg-white';
  const textColor = status==='APPROVED'?'text-emerald-700':status==='REJECTED'?'text-red-500':'';
  return (
    <div ref={setNodeRef} className={`group rounded-lg border px-2.5 py-2 transition ${isOver?'border-violet-400 bg-violet-100 ring-2 ring-violet-200':statusColor}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`min-w-0 truncate font-mono text-[11px] font-extrabold ${textColor||'text-slate-800'}`}>{row.production_order||'-'}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${status==='APPROVED'?'bg-emerald-100 text-emerald-700':status==='REJECTED'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{status}</span>
          <span className="text-[10px] font-bold text-amber-700">{formatHours(row.overtime_hours)}h</span>
          <button type="button" onClick={e=>{e.stopPropagation();onDelete(row.id)}} className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-red-100"><X className="h-3 w-3 text-red-500"/></button>
        </div>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">{formatTime(row.overtime_start_datetime)}–{formatTime(row.overtime_end_datetime)}</p>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-slate-500">
        {row.operation_no&&<span>Op {row.operation_no}</span>}
        {row.ssbr_id&&<span>{row.ssbr_id}</span>}
      </div>
      {row.assigned_to_name
        ? <p className="text-[10px] font-semibold text-violet-600">👤 {row.assigned_to_name}</p>
        : <p className="text-[10px] text-slate-400 italic">Drop person here</p>
      }
    </div>
  );
}

function OvertimeDropZone({ id, rows, onDeleteOvertime }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [expanded, setExpanded] = useState(false);
  return (
    <div ref={setNodeRef} className={`rounded-lg border p-2.5 transition ${isOver?'border-amber-400 bg-amber-100 ring-2 ring-amber-200':'border-amber-200 bg-amber-50'}`}>
      <button type="button" onClick={()=>setExpanded(v=>!v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2"><span className="text-xs font-extrabold uppercase text-amber-700">Overtime</span><span className="text-[11px] font-bold text-amber-600">{rows.length} req</span></div>
        <ChevronDown className={`h-3.5 w-3.5 text-amber-500 transition ${expanded?'rotate-180':''}`}/>
      </button>
      {expanded&&<div className="mt-2 min-h-12 space-y-1.5">{rows.length===0?<div className="rounded-lg border border-dashed border-amber-200 bg-white px-3 py-3 text-center text-[11px] font-medium text-amber-500">Drop SOW here</div>:rows.map(row=><OvertimeRow key={row.id} row={row} onDelete={onDeleteOvertime}/>)}</div>}
    </div>
  );
}

function MachineCard({ machine, shifts, capacityBySlot, schedulesBySlot, overtimeRows, onDeleteSchedule, onDeleteBatch, onDeleteOvertime }) {
  const totals = shifts.reduce((a,s)=>{const cap=capacityBySlot[capacityKey(machine.machine_code,s.id)];const t=asNumber(cap?.total_capacity_hours,8);const u=asNumber(cap?.used_normal_planned_hours);a.capacity+=t;a.used+=u;a.remaining+=asNumber(cap?.remaining_capacity_hours,Math.max(t-u,0));return a;},{capacity:0,used:0,remaining:0});
  return (
    <article className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="min-w-0"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 truncate text-base font-extrabold text-slate-900">{machine.machine_code}</h2><span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700">{formatHours(totals.remaining)}/{formatHours(totals.capacity)}h</span></div><p className="truncate text-xs font-semibold text-slate-500">{machine.machine_name||machine.workcenter||'-'}</p></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#0096c7]" style={{width:`${Math.min(100,Math.max(0,(totals.used/Math.max(totals.capacity,1))*100))}%`}}/></div>
      </div>
      <div className="mt-3 flex flex-col gap-2">{shifts.slice(0,2).map(s=><DropZone key={s.id} id={buildDropId('shift',machine.machine_code,s.id)} title={s.shift_name} capacity={capacityBySlot[capacityKey(machine.machine_code,s.id)]} schedules={schedulesBySlot[capacityKey(machine.machine_code,s.id)]||[]} onDeleteSchedule={onDeleteSchedule} onDeleteBatch={onDeleteBatch}/>)}<OvertimeDropZone id={buildDropId('overtime',machine.machine_code)} rows={overtimeRows} onDeleteOvertime={onDeleteOvertime}/></div>
    </article>
  );
}

function ScheduleModal({ pending, capacity, batches=[], saving, onClose, onSubmit, onCreateBatch }) {
  const item = pending?.item;
  const remainingHours = asNumber(item?.remaining_hours, asNumber(item?.planhours,1));
  const remainingCapacity = asNumber(capacity?.remaining_capacity_hours,8);
  const defaultHours = Math.max(0.01, Math.min(remainingHours||1, remainingCapacity||remainingHours||1));
  const [hours, setHours] = useState(String(defaultHours));
  const [scheduleDate, setScheduleDate] = useState(pending?.scheduleDate||todayText());
  const [mode, setMode] = useState('single');
  const [batchId, setBatchId] = useState('');
  const [batchCapacityHours, setBatchCapacityHours] = useState(String(defaultHours));
  const [note, setNote] = useState('');
  if(!pending||!item) return null;
  const plannedHours = asNumber(hours);
  const exceedsCapacity = plannedHours > remainingCapacity;
  const identity = activityIdentity(item);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <form onSubmit={e=>{e.preventDefault();onSubmit({hours:plannedHours,note,scheduleDate,batchId:mode==='batch'?batchId:''})}} className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-bold uppercase text-[#0077b6]">Schedule Activity</p><h2 className="mt-1 text-lg font-extrabold text-slate-900">{identity.production_order||'-'}</h2><p className="text-sm font-semibold text-slate-500">{pending.machineCode} / {pending.shift?.shift_name||'-'}</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase text-slate-500">Cap Left</p><p className="mt-1 text-lg font-extrabold text-slate-900">{formatHours(remainingCapacity)}h</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase text-slate-500">Plan Hrs</p><p className="mt-1 text-lg font-extrabold text-slate-900">{formatHours(item.planhours)}h</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase text-slate-500">Left</p><p className="mt-1 text-lg font-extrabold text-slate-900">{formatHours(remainingHours)}h</p></div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">{['single','batch'].map(o=><button key={o} type="button" onClick={()=>setMode(o)} className={`rounded-md px-3 py-1.5 text-xs font-extrabold uppercase ${mode===o?'bg-[#0096c7] text-white':'text-slate-600 hover:bg-slate-50'}`}>{o}</button>)}</div>
            {mode==='batch'&&<div className="mt-3 grid grid-cols-[1fr_120px_auto] gap-2"><select value={batchId} onChange={e=>setBatchId(e.target.value)} className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"><option value="">Select batch</option>{batches.map(b=><option key={b.id} value={b.id}>{b.batch_code}</option>)}</select><input type="number" min="0.01" step="0.01" value={batchCapacityHours} onChange={e=>setBatchCapacityHours(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"/><button type="button" onClick={async()=>{const c=await onCreateBatch({batch_capacity_hours:asNumber(batchCapacityHours),schedule_date:scheduleDate});if(c?.id)setBatchId(String(c.id))}} disabled={saving||asNumber(batchCapacityHours)<=0} className="h-10 rounded-lg bg-violet-600 px-3 text-xs font-extrabold text-white hover:bg-violet-500 disabled:opacity-50">Create</button></div>}
          </div>
          <label className="block"><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Planned Hours</span><input type="number" min="0.01" step="0.01" value={hours} onChange={e=>setHours(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" required/></label>
          <label className="block"><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Schedule Date</span><input type="date" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" required/></label>
          {exceedsCapacity&&<div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>Exceeds capacity. Extra hours become unplanned.</span></div>}
          <label className="block"><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Note</span><textarea value={note} onChange={e=>setNote(e.target.value)} className="min-h-24 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800" placeholder="Optional note"/></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={saving||plannedHours<=0||(mode==='batch'&&!batchId)} className="inline-flex items-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-bold text-white hover:bg-[#0077b6] disabled:opacity-50">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Save</button></div>
      </form>
    </div>
  );
}

function OvertimeModal({ pending, shifts, saving, onClose, onSubmit }) {
  const item = pending?.item;
  const [shiftId, setShiftId] = useState(String(shifts[0]?.id||''));
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('19:00');
  const [hours, setHours] = useState('2');
  const [note, setNote] = useState('');
  if(!pending||!item) return null;
  const identity = activityIdentity(item);
  const isManpower = pending.source==='manpower';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <form onSubmit={e=>{e.preventDefault();onSubmit({shiftId,startTime,endTime,hours:asNumber(hours),note,assigned_to:isManpower?item.snssb:'',assigned_to_name:isManpower?item.full_name:''})}} className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-bold uppercase text-amber-700">Overtime Request</p><h2 className="mt-1 text-lg font-extrabold text-slate-900">{isManpower?item.full_name:identity.production_order||'-'}</h2><p className="text-sm font-semibold text-slate-500">{pending.machineCode}{isManpower&&` · ${item.snssb||'-'}`}</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 p-5">
          <label className="block"><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Related Shift</span><select value={shiftId} onChange={e=>setShiftId(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" required>{shifts.map(s=><option key={s.id} value={s.id}>{s.shift_name}</option>)}</select></label>
          <div className="grid grid-cols-3 gap-3">
            <label><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Start</span><input type="time" value={startTime} onChange={e=>{setStartTime(e.target.value);setEndTime(addHoursToClock(e.target.value,hours))}} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"/></label>
            <label><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">End</span><input type="time" value={endTime} onChange={e=>{setEndTime(e.target.value);setHours(String((clockToMinutes(e.target.value)-clockToMinutes(startTime)+(clockToMinutes(e.target.value)<=clockToMinutes(startTime)?1440:0))/60))}} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"/></label>
            <label><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Hours</span><input type="number" min="0.01" step="0.01" value={hours} onChange={e=>{setHours(e.target.value);setEndTime(addHoursToClock(startTime,e.target.value))}} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"/></label>
          </div>
          <label className="block"><span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Note</span><textarea value={note} onChange={e=>setNote(e.target.value)} className="min-h-24 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800" placeholder="Reason for overtime"/></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={saving||!shiftId} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}Request</button></div>
      </form>
    </div>
  );
}

function OvertimeApprovalPanel({ rows, canApprove, saving, onApprove, onReject, onClose }) {
  const [expandedPending, setExpandedPending] = useState(true);
  const [expandedApproved, setExpandedApproved] = useState(false);
  const [expandedRejected, setExpandedRejected] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const pending = rows.filter(r=>r.request_status==='PENDING');
  const approved = rows.filter(r=>r.request_status==='APPROVED');
  const rejected = rows.filter(r=>r.request_status==='REJECTED');

  const SectionHeader = ({ label, count, expanded, onToggle, color }) => (
    <button type="button" onClick={onToggle} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-extrabold uppercase ${color}`}>
      <span>{label} ({count})</span>
      <ChevronDown className={`h-3.5 w-3.5 transition ${expanded?'rotate-180':''}`}/>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-bold uppercase text-[#0077b6]">Overtime Approval</p><h2 className="mt-1 text-base font-extrabold text-slate-900">Review Requests</h2></div><div className="flex items-center gap-2">{saving&&<Loader2 className="h-4 w-4 animate-spin text-[#0096c7]"/>}<button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4"/></button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <SectionHeader label="Pending" count={pending.length} expanded={expandedPending} onToggle={()=>setExpandedPending(v=>!v)} color="text-amber-700"/>
            {expandedPending&&<div className="mt-2 space-y-2">{pending.length===0?<p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-400">No pending overtime.</p>:pending.map(row=>(<div key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-mono text-xs font-extrabold text-slate-900">{row.production_order||'-'}</p><div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-500">{row.operation_no&&<span>Op {row.operation_no}</span>}{row.ssbr_id&&<span>{row.ssbr_id}</span>}</div><p className="text-xs font-semibold text-slate-600">{row.machine_code||'-'} / {formatTime(row.overtime_start_datetime)}-{formatTime(row.overtime_end_datetime)} · {formatHours(row.overtime_hours)}h</p><p className="text-[10px] text-slate-400">By: {row.requested_by_name||'-'} {row.assigned_to_name?`· To: ${row.assigned_to_name}`:''}</p>{row.note&&<p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">{row.note}</p>}</div><StatusBadge value={row.request_status}/></div>{canApprove&&<div className="mt-3 flex gap-2">
              <button type="button" onClick={()=>onApprove(row.id)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"><CheckCircle2 className="h-3.5 w-3.5"/>Approve</button>
              {rejectingId===row.id?<div className="flex flex-1 gap-1"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Reason..." className="flex-1 rounded-lg border border-slate-200 px-2 text-xs"/><button onClick={()=>{onReject(row.id,rejectNote);setRejectingId(null);setRejectNote('')}} className="rounded-lg bg-red-600 px-3 text-xs font-bold text-white">OK</button><button onClick={()=>setRejectingId(null)} className="rounded-lg border px-2 text-xs">X</button></div>:<button type="button" onClick={()=>setRejectingId(row.id)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 text-xs font-bold text-white hover:bg-red-500"><X className="h-3.5 w-3.5"/>Reject</button>}
            </div>}</div>))}</div>}
          </div>
          <div>
            <SectionHeader label="Approved" count={approved.length} expanded={expandedApproved} onToggle={()=>setExpandedApproved(v=>!v)} color="text-emerald-700"/>
            {expandedApproved&&<div className="mt-2 space-y-1.5">{approved.slice(0,12).map(row=>(<div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"><div className="min-w-0"><p className="truncate font-mono text-xs font-extrabold text-slate-900">{row.production_order||'-'}</p><div className="flex flex-wrap gap-x-2 text-[9px] text-slate-500">{row.operation_no&&<span>Op {row.operation_no}</span>}{row.ssbr_id&&<span>{row.ssbr_id}</span>}</div><p className="text-[10px] text-emerald-700">{row.machine_code||'-'} · {formatHours(row.overtime_hours)}h{row.assigned_to_name?` · ${row.assigned_to_name}`:''}</p></div><StatusBadge value="APPROVED"/></div>))}{approved.length===0&&<p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-400">No approved overtime.</p>}</div>}
          </div>
          <div>
            <SectionHeader label="Rejected" count={rejected.length} expanded={expandedRejected} onToggle={()=>setExpandedRejected(v=>!v)} color="text-red-700"/>
            {expandedRejected&&<div className="mt-2 space-y-1.5">{rejected.slice(0,8).map(row=>(<div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"><div className="min-w-0"><p className="truncate font-mono text-xs font-extrabold text-slate-900">{row.production_order||'-'}</p><div className="flex flex-wrap gap-x-2 text-[9px] text-slate-500">{row.operation_no&&<span>Op {row.operation_no}</span>}{row.ssbr_id&&<span>{row.ssbr_id}</span>}</div><p className="text-[10px] text-red-600">{row.machine_code||'-'} · {formatHours(row.overtime_hours)}h{row.rejection_note?` · ${row.rejection_note}`:''}</p></div><StatusBadge value="REJECTED"/></div>))}{rejected.length===0&&<p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-400">No rejected overtime.</p>}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ value }) {
  const v = String(value||'').toUpperCase();
  const cls = v==='APPROVED'||v==='PLANNED'?'border-emerald-200 bg-emerald-50 text-emerald-700':v==='PENDING'||v==='PARTIAL'?'border-amber-200 bg-amber-50 text-amber-700':v==='UNPLANNED'||v==='REJECTED'?'border-red-200 bg-red-50 text-red-700':'border-slate-200 bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{value||'-'}</span>;
}

function SummaryBar({ schedules, capacityRows, overtimeRows }) {
  const planned = schedules.filter(r=>r.schedule_status!=='UNPLANNED'&&r.schedule_status!=='CANCELLED').reduce((s,r)=>s+asNumber(r.planned_hours),0);
  const unplanned = schedules.filter(r=>r.schedule_status==='UNPLANNED').reduce((s,r)=>s+asNumber(r.planned_hours),0);
  const capLeft = capacityRows.reduce((s,r)=>s+asNumber(r.remaining_capacity_hours),0);
  const pendOT = overtimeRows.filter(r=>r.request_status==='PENDING').reduce((s,r)=>s+asNumber(r.overtime_hours),0);
  return <div className="flex flex-wrap items-center justify-end gap-2">{[{l:'Planned',v:`${formatHours(planned)}h`},{l:'Unplanned',v:`${formatHours(unplanned)}h`},{l:'Cap Left',v:`${formatHours(capLeft)}h`},{l:'Pending OT',v:`${formatHours(pendOT)}h`}].map(s=><div key={s.l} className="min-w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"><p className="text-[10px] font-bold uppercase text-slate-500">{s.l}</p><p className="text-sm font-extrabold text-slate-900">{s.v}</p></div>)}</div>;
}

function SowSchedulingPage() {
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
  const [authUser] = useState(readAuthUser);
  const [date, setDate] = useState(todayText);
  const [search, setSearch] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [shifts, setShifts] = useState([]);
  const [machines, setMachines] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activityPagination, setActivityPagination] = useState({page:1,totalPages:1,total:0});
  const [schedules, setSchedules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [capacityRows, setCapacityRows] = useState([]);
  const [overtimeRows, setOvertimeRows] = useState([]);
  const [manpower, setManpower] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDrag, setActiveDrag] = useState(null);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [overtimeModal, setOvertimeModal] = useState(null);
  const [showOvertimeApproval, setShowOvertimeApproval] = useState(false);
  const [sowExpanded, setSowExpanded] = useState(true);
  const [manpowerExpanded, setManpowerExpanded] = useState(false);
  const [sowFilter, setSowFilter] = useState('all'); // 'all' | 'unscheduled'
  const [manpowerSearch, setManpowerSearch] = useState('');
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  const visibleShifts = useMemo(()=>shifts.slice(0,2),[shifts]);
  const capacityBySlot = useMemo(()=>capacityRows.reduce((a,r)=>{a[capacityKey(r.machine_code,r.shift_id)]=r;return a},{}),[capacityRows]);
  const plannedSchedules = useMemo(()=>schedules.filter(r=>r.schedule_status!=='UNPLANNED'&&r.schedule_status!=='CANCELLED'),[schedules]);
  const schedulesBySlot = useMemo(()=>groupByMachineShift(plannedSchedules),[plannedSchedules]);
  const overtimeByMachine = useMemo(()=>groupOvertimeByMachine(overtimeRows),[overtimeRows]);
  const supervisorCanApprove = canApproveOvertime(authUser);
  const pendingOvertimeCount = useMemo(()=>overtimeRows.filter(r=>r.request_status==='PENDING').length,[overtimeRows]);
  const filteredMachines = useMemo(()=>{const n=machineSearch.trim().toLowerCase();if(!n)return machines;return machines.filter(m=>[m.machine_code,m.machine_name,m.workcenter,m.groupname].some(v=>String(v||'').toLowerCase().includes(n)))},[machineSearch,machines]);
  const filteredManpower = useMemo(()=>{const n=manpowerSearch.trim().toLowerCase();if(!n)return manpower;return manpower.filter(p=>[p.full_name,p.snssb,p.employee_category].some(v=>String(v||'').toLowerCase().includes(n)))},[manpower,manpowerSearch]);

  const groupedActivities = useMemo(()=>{
    const filtered = sowFilter==='unscheduled'?activities.filter(a=>asNumber(a.remaining_hours,asNumber(a.planhours,0))>0):activities;
    const groups = {}; const order = [];
    filtered.forEach(a=>{const k=a.order_no||'--';if(!groups[k]){groups[k]=[];order.push(k)} groups[k].push(a)});
    return order.map(k=>({order_no:k,items:groups[k],total_plan:groups[k].reduce((s,i)=>s+asNumber(i.planhours),0),total_scheduled:groups[k].reduce((s,i)=>s+asNumber(i.scheduled_hours,0),0),part_name:groups[k][0]?.part_name||''}));
  },[activities,sowFilter]);

  const loadReference = useCallback(async()=>{const[sh,mc,mp]=await Promise.all([fetchShifts(),fetchSchedulingMachines(),fetchManpower()]);setShifts(sh);setMachines(mc);setManpower(mp)},[]);
  const loadActivities = useCallback(async({page=1,append=false}={})=>{setLoadingActivities(true);setError('');try{const p=await fetchSchedulingActivities({search,page,limit:ACTIVITY_PAGE_SIZE});setActivities(prev=>append?[...prev,...(p.data||[])]:p.data||[]);setActivityPagination(p.pagination||{page,totalPages:1,total:0})}catch(err){setError(err.message||'Failed to load')}finally{setLoadingActivities(false)}},[search]);
  const loadBoard = useCallback(async()=>{setLoadingBoard(true);setError('');try{const[sc,cap,ot,b]=await Promise.all([fetchSchedules({date,limit:SCHEDULE_LIMIT}),fetchCapacity({date}),fetchOvertime({date,limit:SCHEDULE_LIMIT}),fetchBatches({date})]);setSchedules((sc.data||[]).filter(r=>r.schedule_status!=='CANCELLED'));setCapacityRows(cap||[]);setOvertimeRows((ot||[]).filter(r=>r.request_status!=='CANCELLED'));setBatches(b||[])}catch(err){setError(err.message||'Failed to load')}finally{setLoadingBoard(false)}},[date]);

  useEffect(()=>{loadReference().catch(e=>setError(e.message||'Failed'))},[loadReference]);
  useEffect(()=>{loadActivities({page:1,append:false})},[loadActivities,refreshKey]);
  useEffect(()=>{loadBoard()},[loadBoard,refreshKey]);

  const refresh = ()=>setRefreshKey(v=>v+1);

  const handleDragStart = ({active})=>{setActiveDrag(active.data?.current||null)};
  const handleDragEnd = async({active,over})=>{const d=active.data?.current;setActiveDrag(null);if(!d?.item||!over?.id)return;
    // Manpower drag to existing overtime row (drop id: assign-ot-{id})
    if(d.source==='manpower'&&String(over.id).startsWith('assign-ot-')&&over.data?.current?.overtimeId){
      setSaving(true);setError('');try{await assignManpower(over.data.current.overtimeId,d.item.snssb,d.item.full_name);refresh()}catch(err){setError(err.message||'Failed to assign')}finally{setSaving(false)}return}
    const drop=parseDropId(over.id);
    if(drop.type==='shift'){const shift=shifts.find(r=>String(r.id)===String(drop.shiftId));const cap=capacityBySlot[capacityKey(drop.machineCode,drop.shiftId)];
      if(d.source==='planned'&&d.item.id){setSaving(true);setError('');try{const m=machines.find(r=>r.machine_code===drop.machineCode);await updateSchedule(d.item.id,{machine_code:drop.machineCode,workcenter:m?.workcenter||d.item.workcenter||null,schedule_date:date,shift_id:drop.shiftId,batch_id:null});refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}return}
      setScheduleModal({item:d.item,source:d.source||'activity',machineCode:drop.machineCode,shiftId:drop.shiftId,shift,scheduleDate:date})}
    if(drop.type==='overtime'){if(d.source==='manpower')return;setOvertimeModal({item:d.item,machineCode:drop.machineCode,source:d.source})}};

  const submitSchedule = async({hours,note,scheduleDate,batchId})=>{if(!scheduleModal?.item||!scheduleModal.machineCode||!scheduleModal.shiftId)return;setSaving(true);setError('');try{const iden=activityIdentity(scheduleModal.item);const m=machines.find(r=>r.machine_code===scheduleModal.machineCode);await createSchedule({...iden,schedule_date:scheduleDate||date,shift_id:scheduleModal.shiftId,machine_code:scheduleModal.machineCode,workcenter:m?.workcenter||iden.workcenter,planned_hours:hours,batch_id:batchId||null,remarks:note});if(scheduleModal.source==='unplanned'&&scheduleModal.item.id)await deleteSchedule(scheduleModal.item.id);setScheduleModal(null);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};

  const handleCreateBatch = async({batch_capacity_hours,schedule_date})=>{if(!scheduleModal?.machineCode||!scheduleModal?.shiftId)return null;setSaving(true);setError('');try{const m=machines.find(r=>r.machine_code===scheduleModal.machineCode);const c=await createBatch({machine_code:scheduleModal.machineCode,workcenter:m?.workcenter||null,schedule_date:schedule_date||date,shift_id:scheduleModal.shiftId,batch_capacity_hours});const br=await fetchBatches({date:schedule_date||date,machine_code:scheduleModal.machineCode,shift_id:scheduleModal.shiftId});setBatches(p=>[...p.filter(r=>!(r.machine_code===scheduleModal.machineCode&&String(r.schedule_date).slice(0,10)===String(schedule_date||date)&&String(r.shift_id)===String(scheduleModal.shiftId))),...br]);refresh();return c}catch(err){setError(err.message||'Failed');return null}finally{setSaving(false)}};

  const submitOvertime = async({shiftId,startTime,endTime,note,assigned_to,assigned_to_name})=>{if(!overtimeModal?.item||!overtimeModal.machineCode||!shiftId)return;setSaving(true);setError('');try{const iden=activityIdentity(overtimeModal.item);const m=machines.find(r=>r.machine_code===overtimeModal.machineCode);await createOvertime({...iden,overtime_date:date,shift_id:shiftId,machine_code:overtimeModal.machineCode,workcenter:m?.workcenter||iden.workcenter,start_time:startTime,end_time:endTime,note,assigned_to,assigned_to_name});setOvertimeModal(null);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};

  const handleApprove = async(id)=>{setSaving(true);setError('');try{await approveOvertime(id);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};
  const handleReject = async(id,rejectionNote='')=>{setSaving(true);setError('');try{await rejectOvertime(id,rejectionNote);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};
  const handleDeleteSchedule = async(id)=>{setSaving(true);setError('');try{await deleteSchedule(id);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};
  const handleDeleteBatch = async(id)=>{if(!confirm('Cancel this batch?'))return;setSaving(true);setError('');try{await deleteBatch(id);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};
  const handleAssignManpower = async(overtimeId, snssb, fullName)=>{setSaving(true);setError('');try{await assignManpower(overtimeId,snssb,fullName);refresh()}catch(err){setError(err.message||'Failed to assign')}finally{setSaving(false)}};
  const handleDeleteOvertime = async(id)=>{if(!confirm('Delete this overtime?'))return;setSaving(true);setError('');try{await deleteOvertime(id);refresh()}catch(err){setError(err.message||'Failed')}finally{setSaving(false)}};
  const loadMoreActivities = ()=>{if(loadingActivities||activityPagination.page>=activityPagination.totalPages)return;loadActivities({page:activityPagination.page+1,append:true})};

  return (<PageContainer className="h-screen gap-4 overflow-hidden bg-slate-50">
    <header className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><button onClick={()=>goBackOrFallback(navigate,'/operations-hub')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4"/>Back</button><div><p className="text-xs font-bold uppercase text-[#0077b6]">Daily Scheduling</p><h1 className="text-xl font-extrabold text-slate-900">SOW Machine Schedule</h1></div></div><div className="flex min-w-0 flex-1 items-end justify-end gap-3"><SummaryBar schedules={schedules} capacityRows={capacityRows} overtimeRows={overtimeRows}/><label className="w-44 shrink-0"><span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"/></label><button onClick={()=>setShowOvertimeApproval(true)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-bold text-white hover:bg-[#0077b6]"><Clock className="h-4 w-4"/>OT<span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#0077b6]">{pendingOvertimeCount}</span></button></div></div></header>
    {error&&<div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">{error}</div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToWindowEdges]} onDragStart={handleDragStart} onDragCancel={()=>setActiveDrag(null)} onDragEnd={handleDragEnd}>
      <main className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
        <section className="flex h-full min-h-0 w-full flex-row overflow-hidden">
        <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-slate-300 bg-[#f0fbff]">
          {/* SOW Activity List */}
          <div className="p-4 pb-0">
            <button onClick={()=>setSowExpanded(v=>!v)} className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2"><p className="text-xs font-bold uppercase text-[#0077b6]">Activity</p><span className="text-[10px] text-slate-400">{activityPagination.total} records</span></div>
              <div className="flex items-center gap-1.5">
                <button onClick={e=>{e.stopPropagation();setSowFilter(sowFilter==='all'?'unscheduled':'all')}} className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase border ${sowFilter==='unscheduled'?'bg-amber-100 border-amber-300 text-amber-700':'bg-slate-100 border-slate-200 text-slate-500'}`}>{sowFilter==='unscheduled'?'Unscheduled':'All'}</button>
                <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${sowExpanded?'rotate-180':''}`}/>
              </div>
            </button>
          </div>
          {sowExpanded&&<>
          <div className="px-4 pt-2"><div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-4 w-4 text-slate-500"/><input value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none" placeholder="Search..."/></div></div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            {groupedActivities.map(g=>{const exp=expandedOrders.has(g.order_no);return (<div key={g.order_no} className="mb-1"><button onClick={()=>setExpandedOrders(p=>{const n=new Set(p);n.has(g.order_no)?n.delete(g.order_no):n.add(g.order_no);return n})} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-sky-100"><div className="min-w-0 flex-1"><p className="truncate font-mono text-[11px] font-extrabold text-slate-800">{g.order_no}</p><p className="truncate text-[9px] text-slate-400">{g.part_name||''}</p></div><div className="flex items-center gap-2 shrink-0"><span className="text-[9px] font-bold text-slate-500">{formatHours(g.total_plan)}/{formatHours(g.total_scheduled)}h</span><ChevronDown className={`h-3 w-3 text-slate-400 transition ${exp?'rotate-180':''}`}/></div></button>{exp&&<div className="ml-2 space-y-1.5 mt-1">{g.items.map(a=><DraggableActivity key={a.idsow} item={a}/>)}</div>}</div>)})}
            {groupedActivities.length===0&&!loadingActivities&&<div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">No activities.</div>}
          </div>
          <button onClick={loadMoreActivities} disabled={loadingActivities||activityPagination.page>=activityPagination.totalPages} className="mx-4 mb-3 mt-1 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{activityPagination.page>=activityPagination.totalPages?`${activities.length} of ${activityPagination.total}`:`Load more (${activities.length}/${activityPagination.total})`}</button>
          </>}

          {/* Manpower List */}
          <div className="border-t border-slate-200 px-4 py-3"><button onClick={()=>setManpowerExpanded(v=>!v)} className="flex w-full items-center justify-between gap-2"><div className="flex items-center gap-2"><User className="h-4 w-4 text-slate-400"/><span className="text-xs font-bold uppercase text-slate-600">Manpower</span><span className="text-[10px] text-slate-400">{manpower.length} people</span></div><ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${manpowerExpanded?'rotate-180':''}`}/></button></div>
          {manpowerExpanded&&<div className="px-4 pb-3">
            <div className="mb-2"><div className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2"><Search className="h-3 w-3 text-slate-400"/><input value={manpowerSearch} onChange={e=>setManpowerSearch(e.target.value)} className="w-full bg-transparent text-[11px] font-semibold text-slate-800 outline-none" placeholder="Search name / SN..."/></div></div>
            <div className="max-h-60 overflow-y-auto space-y-1.5">{filteredManpower.map(p=><DraggableManpower key={p.snssb} person={p}/>)}</div>
            <p className="mt-2 text-[10px] text-slate-400 italic">Seret Orang ke Box Overtime</p>
          </div>}
        </aside>

        <section className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">MACHINE CAPACITY</h2></div><div className="flex items-center gap-3"><label className="w-72"><div className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8]"><Search className="h-4 w-4 text-slate-500"/><input value={machineSearch} onChange={e=>setMachineSearch(e.target.value)} className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none" placeholder="Search machine..."/></div></label>{loadingBoard&&<Loader2 className="h-5 w-5 animate-spin text-[#0096c7]"/>}</div></div>
          <div className="grid grid-cols-3 gap-3">{filteredMachines.map(m=><MachineCard key={m.machine_code} machine={m} shifts={visibleShifts} capacityBySlot={capacityBySlot} schedulesBySlot={schedulesBySlot} overtimeRows={overtimeByMachine[m.machine_code]||[]} onDeleteSchedule={handleDeleteSchedule} onDeleteBatch={handleDeleteBatch} onDeleteOvertime={handleDeleteOvertime}/>)}{filteredMachines.length===0&&!loadingBoard&&<div className="col-span-3 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-500">No machines found.</div>}</div>
        </section>
        </section>
      </main>
      <DragOverlay dropAnimation={null}>{activeDrag?.item&&(activeDrag.source==='manpower'?<DraggableManpower person={activeDrag.item}/>:<SowActivityCard item={activeDrag.item} source={activeDrag.source} dragging/>)}</DragOverlay>
    </DndContext>
    {scheduleModal&&<ScheduleModal pending={scheduleModal} capacity={capacityBySlot[capacityKey(scheduleModal.machineCode,scheduleModal.shiftId)]} batches={batches.filter(b=>b.machine_code===scheduleModal.machineCode&&String(b.schedule_date).slice(0,10)===String(scheduleModal.scheduleDate||date)&&String(b.shift_id)===String(scheduleModal.shiftId))} saving={saving} onClose={()=>setScheduleModal(null)} onSubmit={submitSchedule} onCreateBatch={handleCreateBatch}/>}
    {overtimeModal&&<OvertimeModal pending={overtimeModal} shifts={visibleShifts} saving={saving} onClose={()=>setOvertimeModal(null)} onSubmit={submitOvertime}/>}
    {showOvertimeApproval&&<OvertimeApprovalPanel rows={overtimeRows} canApprove={supervisorCanApprove} saving={saving} onApprove={handleApprove} onReject={handleReject} onClose={()=>setShowOvertimeApproval(false)}/>}
  </PageContainer>);
}

export default SowSchedulingPage;
