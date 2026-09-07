import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const MotionDiv = motion.div;

// Slide-over shell (drawer kanan) dengan animasi masuk/keluar.
// - Overlay fade + panel slide dari kanan; gerakan hanya menjawab aksi buka/tutup.
// - prefers-reduced-motion: tanpa translasi, cukup fade.
// - Klik backdrop TIDAK menutup (cegah kehilangan isian yang belum disimpan);
//   tutup lewat tombol X / Cancel. Esc menutup.
// - Dipakai UserEditorSheet & RoleEditorSheet (rule of two -> satu komponen).
export default function Drawer({ onClose, widthClass = 'max-w-xl', children }) {
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* deslop-allow C5: overlay modal drawer (pola sama di semua sheet; klik-tutup sengaja tidak ada) */}
      <MotionDiv className="modal-overlay fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" data-modal-overlay="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
        <MotionDiv
          role="dialog"
          aria-modal="true"
          className={`flex h-full w-full ${widthClass} flex-col bg-white shadow-2xl`}
          initial={reduce ? { opacity: 0 } : { x: '100%' }}
          animate={reduce ? { opacity: 1 } : { x: 0 }}
          exit={reduce ? { opacity: 0 } : { x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320, mass: 0.9 }}
        >
          {children}
        </MotionDiv>
      </MotionDiv>
    </>
  );
}
