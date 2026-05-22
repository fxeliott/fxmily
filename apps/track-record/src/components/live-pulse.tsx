'use client';

import { motion, useReducedMotion } from 'framer-motion';

interface LivePulseProps {
  /** Dot size in px (default 8). */
  size?: number;
  /** Color CSS variable name (default --accent). */
  color?: string;
  className?: string;
}

/**
 * Live pulse indicator — a small dot breathing infinitely.
 *
 * Pattern : ring outer scales 1→1.8 + opacity 0.8→0, inner dot stays solid.
 * Indique "données live" / "en direct". Subtle, élégant.
 *
 * Reduced-motion : pas de ring scale, juste le dot fixe.
 */
export function LivePulse({ size = 8, color = 'var(--accent)', className = '' }: LivePulseProps) {
  const reduced = useReducedMotion();
  return (
    <span
      role="img"
      aria-label="En direct"
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {!reduced && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: color }}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span
        aria-hidden
        className="relative rounded-full"
        style={{ width: size, height: size, background: color }}
      />
    </span>
  );
}
