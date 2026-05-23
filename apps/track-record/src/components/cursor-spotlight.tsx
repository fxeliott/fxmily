'use client';

import { useMotionValue, useMotionTemplate, motion, useReducedMotion } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';

interface CursorSpotlightProps {
  children: ReactNode;
  /** Spotlight radius in px (default 520). */
  size?: number;
  className?: string;
}

/**
 * Cursor-following spotlight T3 — pattern Build UI / Linear.
 *
 * useMotionTemplate génère un radial-gradient CSS string depuis les motion
 * values (x, y) qui suivent le pointeur. Pas de React re-renders.
 *
 * Cleanup automatique : listeners scoped au wrapper, pas window.
 * Reduced-motion : désactive le tracking, pas de spotlight visible.
 */
export function CursorSpotlight({ children, size = 520, className = '' }: CursorSpotlightProps) {
  const reduced = useReducedMotion();
  const mouseX = useMotionValue(-1000);
  const mouseY = useMotionValue(-1000);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  const handleLeave = () => {
    if (reduced) return;
    mouseX.set(-1000);
    mouseY.set(-1000);
  };

  const background = useMotionTemplate`radial-gradient(${size}px circle at ${mouseX}px ${mouseY}px, rgba(91, 141, 239, 0.14), rgba(91, 141, 239, 0.04) 40%, transparent 75%)`;

  if (reduced) {
    return <div className={`relative ${className}`}>{children}</div>;
  }

  return (
    <div onMouseMove={handleMove} onMouseLeave={handleLeave} className={`relative ${className}`}>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background }}
      />
      {children}
    </div>
  );
}
