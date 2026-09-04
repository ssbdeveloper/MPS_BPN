import React from 'react';
import { X } from 'lucide-react';

export default function FilterChip({ label, value, onRemove }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#90e0ef] bg-[#caf0f8] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-[#023e8a]">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#0077b6] transition-colors duration-150 hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}
