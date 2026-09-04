import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { directionOffset, motionOffset } from './routeDirection';

const MotionDiv = motion.div;

export default function RouteTransition({ routeKey, depth = 0, children }) {
  const reduced = useReducedMotion();
  const prevDepthRef = useRef(depth);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(directionOffset(prevDepthRef.current, depth));
    prevDepthRef.current = depth;
  }, [depth]);

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
