import React from 'react';

// `...rest` BUKAN kelengkapan berlebihan. Tanpa itu pemanggil tidak bisa memasang
// role="toolbar", aria-label, onScroll, atau data-testid — hanya className yang tembus —
// dan primitif setipis ini akan dipaksa di-fork ("Toolbar2") begitu satu pemanggil butuh
// atribut a11y. Ditemukan saat review Task 7.
export default function Toolbar({ className = '', children, ...rest }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
