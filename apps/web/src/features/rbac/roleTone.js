// Identitas visual role sistem (dot kecil) — util murni, bukan komponen.
// Role kustom jatuh ke abu-abu. Dipakai picker paket & chip daftar user.
export const ROLE_DOT = {
  administrator: 'bg-purple-500',
  supervisor: 'bg-indigo-500',
  foreman: 'bg-amber-500',
  warehouse: 'bg-sky-500',
  user: 'bg-slate-400',
};

export function roleDot(key) {
  return ROLE_DOT[String(key || '').toLowerCase()] || 'bg-slate-300';
}
