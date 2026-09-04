import React from 'react';

export default function Toolbar({ className = '', children }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 ${className}`}>
      {children}
    </div>
  );
}
