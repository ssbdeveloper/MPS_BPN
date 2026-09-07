import React from 'react';

// Tone per role sistem (5 bawaan). Role kustom jatuh ke abu-abu.
const ROLE_TONE = {
  administrator: 'border-purple-200 bg-purple-50 text-purple-700',
  supervisor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  foreman: 'border-amber-200 bg-amber-50 text-amber-700',
  warehouse: 'border-sky-200 bg-sky-50 text-sky-700',
  user: 'border-slate-200 bg-slate-50 text-slate-600',
};

// Badge role dipakai UsersTab (role utama user) & RolesTab (role_key di kartu).
export default function RoleBadge({ role, className = '' }) {
  const key = String(role || '').toLowerCase();
  const tone = ROLE_TONE[key] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase ${tone} ${className}`}>
      {role || '-'}
    </span>
  );
}
