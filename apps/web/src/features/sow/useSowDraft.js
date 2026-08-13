import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// useSowDraft — autosave draft untuk Create SOW / Edit SOW history (anti crash-loss).
//
// Mekanisme:
//  - mount: GET draft (context+refKey, scoped per user via header x-user-name)
//  - autosave: debounce 1.5s setelah state berubah; HANYA jika `enabled` (initial
//    load selesai) DAN draft sudah dicek (jangan menimpa draft lama dengan state
//    awal yang kosong) DAN state berbeda dari baseline (jangan simpan state yang
//    baru saja di-load tanpa sentuhan user).
//  - pagehide (tab ditutup/refresh/close): last-chance save via fetch keepalive.
//  - restoreDraft(payload): set baseline ke payload (tidak langsung autosave ulang).
//  - discardDraft(): hapus draft di server; autosave baru aktif lagi setelah state
//    berubah berikutnya (clearedRef di-rearm di effect debounce).
//  - payload > 10mb (operation card images base64) → fallback simpan tanpa images.
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || '/api';
const AUTOSAVE_DEBOUNCE_MS = 1500;

function readUserName() {
  try {
    const u = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    return (u && (u.name || u.username)) || '';
  } catch {
    return '';
  }
}

function draftUrl(context, refKey) {
  return `${API_BASE}/sow/drafts/${encodeURIComponent(context)}/${encodeURIComponent(refKey || '')}`;
}

// Kunci pembanding state — KECUALI operationCardImages (base64 besar; mengubahnya
// tidak perlu memicu stringify berat tiap keystroke, tapi tetap ikut tersimpan).
function makeCompareKey(payload) {
  if (!payload || typeof payload !== 'object') return JSON.stringify(payload);
  const rest = { ...payload };
  delete rest.operationCardImages;
  return JSON.stringify(rest);
}

function stripImages(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const rest = { ...payload };
  delete rest.operationCardImages;
  return rest;
}

export function useSowDraft({ context, refKey, state, enabled, onRestore }) {
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const baselineRef = useRef(null); // kunci state pertama kali enabled — tanpa user edit
  const draftCheckedRef = useRef(false); // GET draft mount sudah selesai
  const clearedRef = useRef(false); // discard baru saja → jangan save di pagehide
  const draftPayloadRef = useRef(null); // payload draft hasil GET (untuk Resume)
  const optionsRef = useRef({});
  optionsRef.current = { context, refKey, enabled, onRestore };

  const draftKey = `${context}/${refKey || ''}`;

  // ── Cek draft (mount & tiap ganti context/refKey) ────────────────────────
  useEffect(() => {
    let cancelled = false;
    draftCheckedRef.current = false;
    baselineRef.current = null;
    draftPayloadRef.current = null;
    setDraftAvailable(false);
    setLastSavedAt(null);
    fetch(draftUrl(context, refKey), { headers: { 'x-user-name': readUserName() } })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.draft) return;
        draftPayloadRef.current = json.draft;
        setDraftAvailable(true);
        setLastSavedAt(json.updated_at ? new Date(json.updated_at) : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) draftCheckedRef.current = true;
      });
    return () => { cancelled = true; };
  }, [context, refKey, draftKey]);

  const saveDraft = useCallback(async (payload) => {
    const { context: ctx, refKey: rk } = optionsRef.current;
    const headers = { 'Content-Type': 'application/json', 'x-user-name': readUserName() };
    const put = (body) => fetch(draftUrl(ctx, rk), { method: 'PUT', headers, body: JSON.stringify(body) });
    try {
      const res = await put({ payload });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLastSavedAt(new Date());
      return true;
    } catch (err) {
      // Payload kebesaran (images base64 > 10mb limit) → simpan tanpa images.
      if (String(err.message).includes('413')) {
        try {
          const res = await put({ payload: stripImages(payload) });
          if (!res.ok) return false;
          setLastSavedAt(new Date());
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }, []);

  // ── Autosave debounce ─────────────────────────────────────────────────────
  const prevEnabledRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      prevEnabledRef.current = false;
      return undefined;
    }
    // Rearm setelah discard: edit berikutnya boleh autosave lagi.
    clearedRef.current = false;
    // Sesi edit baru (reopen editor / selesai load): baseline harus diambil ULANG dari
    // state yang baru di-load, supaya autosave tidak menimpa draft lama tanpa edit user.
    if (!prevEnabledRef.current) baselineRef.current = null;
    prevEnabledRef.current = true;
    if (baselineRef.current === null) baselineRef.current = makeCompareKey(stateRef.current);

    const timer = setTimeout(() => {
      if (!draftCheckedRef.current) return; // jangan timpa draft lama sebelum dicek
      if (clearedRef.current) return;
      const payload = stateRef.current;
      if (!payload) return;
      if (makeCompareKey(payload) === baselineRef.current) return; // belum ada edit
      saveDraft(payload);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, enabled, saveDraft, draftKey]);

  // ── pagehide: last-chance save (refresh / tutup tab / crash) ──────────────
  useEffect(() => {
    const onHide = () => {
      if (!optionsRef.current.enabled || clearedRef.current) return;
      const payload = stateRef.current;
      if (!payload) return;
      const { context: ctx, refKey: rk } = optionsRef.current;
      fetch(draftUrl(ctx, rk), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-name': readUserName() },
        body: JSON.stringify({ payload }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const restoreDraft = useCallback(() => {
    const payload = draftPayloadRef.current;
    if (payload) baselineRef.current = makeCompareKey(payload);
    optionsRef.current.onRestore?.(payload);
    setDraftAvailable(false);
  }, []);

  const discardDraft = useCallback(async () => {
    clearedRef.current = true;
    draftPayloadRef.current = null;
    const { context: ctx, refKey: rk } = optionsRef.current;
    try {
      await fetch(draftUrl(ctx, rk), {
        method: 'DELETE',
        headers: { 'x-user-name': readUserName() },
      });
    } catch { /* draft sudah tidak ada — abaikan */ }
    setDraftAvailable(false);
    setLastSavedAt(null);
  }, []);

  return { draftAvailable, lastSavedAt, restoreDraft, discardDraft };
}
