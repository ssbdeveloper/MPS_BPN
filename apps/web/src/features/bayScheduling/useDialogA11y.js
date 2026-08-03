import { useEffect, useRef } from 'react';

// Selector untuk focus-trap modal (elemen yang bisa menerima fokus).
export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// A11y modal bersama: fokus masuk saat buka, Escape menutup, Tab terperangkap,
// fokus kembali ke pemicu saat tutup, scroll body dikunci. Dipakai ReservationPanel
// dan ReservationDetailModal agar pola tidak diduplikasi.
//
// PINDAHAN VERBATIM dari pages/PPC/manufacturing/SchedulingAreaPage.jsx (Fase 3
// ekstraksi features/bayScheduling). Perilaku sengaja TIDAK diubah.
//
// CATATAN PEMANGGIL: efek ini bergantung pada identitas `onClose`. Kalau pemanggil
// mengoper arrow inline, efek dibongkar-pasang tiap render -> fokus melompat balik ke
// elemen pertama setiap kali user mengetik. Oper handler yang STABIL (useCallback
// tanpa dep berubah, atau pola ref di komponen pemanggil).
export default function useDialogA11y(onClose) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;

    const previouslyFocused = document.activeElement;
    const focusables = node.querySelectorAll(FOCUSABLE);
    (focusables[0] || node).focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = node.querySelectorAll(FOCUSABLE);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [onClose]);
  return dialogRef;
}
