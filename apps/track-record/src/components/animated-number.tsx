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
  /** Use signed (+/-) display via Intl signDisplay 'always'. */
  signed?: boolean;
  /** Animation duration in seconds. Default 1.4s. */
  duration?: number;
  className?: string;
}

/**
 * Count-up T4 — utilisé sur hero display + 8 KPIs.
 *
 * Pattern Build UI : `useInView` `once: true, amount: 0.4` déclenche
 * l'animation quand l'élément entre dans le viewport. Geist Sans tabular-nums
 * via classe `.num`. Reduced-motion → valeur finale instant.
 *
 * `signed: true` → Intl signDisplay 'always' pour gain +X / perte -X.
 */
export function AnimatedNumber({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  signed = false,
  duration = 1.4,
  className = '',
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(reduced ? to : 0);

  const formatted = useTransform(motionValue, (v) => {
    const fmt = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      ...(signed ? { signDisplay: 'always' as const } : {}),
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
