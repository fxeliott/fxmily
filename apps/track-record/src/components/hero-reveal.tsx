'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface HeroRevealProps {
  children: ReactNode;
  /** Delay in seconds before reveal starts (sequential stagger). */
  delay?: number;
  /** Animation duration. Default 1.0s. */
  duration?: number;
  className?: string;
}

/**
 * Blur-to-focus reveal — pattern Stripe / Mercury hero.
 *
 * Initial : opacity 0 + blur 6px + y 8
 * Animate : opacity 1 + blur 0 + y 0
 *
 * Utilisé sur hero number + trust badges (sequential stagger via delay).
 * Reduced-motion : render immédiat sans animation.
 */
export function HeroReveal({
  children,
  delay = 0,
  duration = 1.0,
  className = '',
}: HeroRevealProps) {
  const reduced = useReducedMotion();
  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 8, filter: 'blur(6px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`inline-block ${className}`}
    >
      {children}
    </motion.div>
  );
}
