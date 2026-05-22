'use client';

import { motion, useScroll, useSpring } from 'framer-motion';

/**
 * Scroll-driven progress bar — fixed top, accent bleu signature lumineuse.
 *
 * Pattern : `useScroll().scrollYProgress` → useSpring damped → motion.div scaleX.
 * Zéro layout shift (fixed position, height 2px, sm/md responsive).
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 20,
    mass: 0.5,
  });

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 right-0 left-0 z-50 h-[2px] origin-left"
      style={{
        scaleX,
        background:
          'linear-gradient(90deg, transparent 0%, var(--accent) 15%, var(--accent) 85%, transparent 100%)',
        boxShadow: '0 0 12px var(--accent-soft)',
      }}
    />
  );
}
