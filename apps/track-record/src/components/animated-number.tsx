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
  /** Animation duration in seconds. Default 1.6s. */
  duration?: number;
  className?: string;
}

/**
 * Count-up T1 — utilisé UNE seule fois sur le chiffre hero (effet rare =
 * effet puissant, ui-designer §8). Geist Sans tabular-nums via classe `.num`
 * (drop Mono — trop ingénieur).
 *
 * `once: true` + `amount: 0.5` : se déclenche une seule fois quand le chiffre
 * entre dans 50 % du viewport. Reduced-motion → valeur finale instant.
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
    <motion.span ref={ref} className={`num ${className}`}>
      {formatted}
    </motion.span>
  );
}
