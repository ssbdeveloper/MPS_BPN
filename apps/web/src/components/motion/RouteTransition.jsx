import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { directionOffset, motionOffset } from './routeDirection';

const MotionDiv = motion.div;

export default function RouteTransition({ routeKey, depth = 0, children }) {
  const reduced = useReducedMotion();

  // Arah dihitung SAAT RENDER, bukan di useEffect. Ini bukan gaya penulisan — versi useEffect
  // SALAH. Effect berjalan setelah commit, sedangkan AnimatePresence menangkap `initial` pada
  // render yang me-mount key baru. Jadi offset yang terpakai selalu milik transisi SEBELUMNYA:
  // navigasi pertama tidak bergerak sama sekali (offset masih 0), dan Back pertama setelah
  // serangkaian maju beranimasi seolah masih maju.
  // Pola di bawah adalah "adjusting state when props change" yang didokumentasikan React:
  // set state selama render, React langsung render ulang TANPA commit, sehingga nilainya
  // segar di render yang sama.
  const [prevDepth, setPrevDepth] = useState(depth);
  const [offset, setOffset] = useState(0);
  if (depth !== prevDepth) {
    setOffset(directionOffset(prevDepth, depth));
    setPrevDepth(depth);
  }

  const enter = motionOffset(offset, reduced);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <MotionDiv
        key={routeKey}
        initial={{ opacity: 0, x: enter }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: motionOffset(-enter, reduced) }}
        transition={reduced
          ? { duration: 0 }
          : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </MotionDiv>
    </AnimatePresence>
  );
}
