'use client';

import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

interface PivotRailProps {
  /** Date label shown vertically (e.g. "22.05"). */
  date: string;
}

/**
 * PivotRail T4 — vertical accent rail fixed à droite, label "PIVOT" vertical-rl.
 *
 * Pattern ui-designer : marque le pivot historique/live en PERMANENCE à
 * l'écran (pas juste local dans les charts). Subtle : 1px width, opacity
 * suit le scroll progress.
 *
 * Reduced-motion : pas de scroll-driven opacity, opacity fixe 0.5.
 */
export function PivotRail({ date }: PivotRailProps) {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.1, 0.95, 1], [0, 0.6, 0.6, 0]);

  return (
    <motion.aside
      aria-hidden
      className="pointer-events-none fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex"
      style={reduced ? { opacity: 0.5 } : { opacity }}
    >
      <div
        className="h-20 w-px"
        style={{
          background: 'linear-gradient(180deg, transparent, var(--accent) 50%, transparent)',
        }}
      />
      <span
        className="t-caption"
        style={{
          color: 'var(--accent)',
          writingMode: 'vertical-rl',
          letterSpacing: '0.18em',
          fontSize: 9,
        }}
      >
        PIVOT · {date}
      </span>
      <div
        className="h-20 w-px"
        style={{
          background: 'linear-gradient(180deg, transparent, var(--accent) 50%, transparent)',
        }}
      />
    </motion.aside>
  );
}
