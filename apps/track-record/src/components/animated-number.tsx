'use client';

import { useEffect, useRef } from 'react';
import {
  animate,
  useMotionValue,
  useTransform,
  motion,
  useInView,
  useReducedMotion,
} from 'framer-motion';

interface AnimatedNumberProps {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Animation duration in seconds. Default 1.6s — sweet spot (Stripe/Mercury). */
  duration?: number;
  className?: string;
}

/**
 * Count-up KPI hero pattern (Motion docs 2026).
 * - `tabular-nums` indispensable pour éviter layout shift digit par digit.
 * - `once: true` — never re-count on scroll back (signaled as bug).
 * - ease-out exponentielle [0.22, 1, 0.36, 1] = arrive vite puis se pose.
 * - Reduce-motion = render final value directly (WCAG 2.3.3).
 */
export function AnimatedNumber({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1.6,
  className = '',
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(reduced ? to : 0);

  const formatted = useTransform(motionValue, (v) => {
    const fmt = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${prefix}${fmt.format(v)}${suffix}`;
  });

  useEffect(() => {
    if (reduced) {
      motionValue.set(to);
      return;
    }
    if (!inView) return;
    const controls = animate(motionValue, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, to, duration, reduced, motionValue]);

  return (
    <motion.span ref={ref} className={`tabular-nums ${className}`}>
      {formatted}
    </motion.span>
  );
}
