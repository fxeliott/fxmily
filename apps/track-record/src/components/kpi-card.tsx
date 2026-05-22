'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { LivePulse } from './live-pulse';

interface KpiCardProps {
  label: string;
  /** Main number rendered with tabular-nums. Use AnimatedNumber for count-up. */
  value: ReactNode;
  /** Suffix (e.g. " %", "R"). Rendered with --text-subtle for hierarchy. */
  suffix?: ReactNode;
  /** Sub-label below the number (e.g. "sur 138 trades"). */
  caption?: string;
  /** Tone for the value color. */
  tone?: 'primary' | 'gain' | 'loss' | 'accent';
  /** Place in stagger order — passed by parent grid. */
  index?: number;
  /** Indique un KPI qui s'updatera live (post-pivot). Accent edge + LivePulse. */
  live?: boolean;
  className?: string;
}

const toneClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
  primary: 'text-[var(--text)]',
  gain: 'text-[var(--positive)]',
  loss: 'text-[var(--negative)]',
  accent: 'text-[var(--accent)]',
};

/**
 * KPI card T2 — pattern Stripe Connect + Mercury, adapté palette desaturée T1.
 *
 * Hiérarchie :
 *  - Label : t-caption (12px UPPERCASE tracked +0.06em --text-muted)
 *  - Number : 40-48px tabular-nums --text (ou tone)
 *  - Caption : t-micro (--text-subtle, optional)
 *
 * Animation :
 *  - Initial : opacity 0 + y 12 + blur 4
 *  - Animate : opacity 1 + y 0 + blur 0 (staggered via index)
 *  - Hover : y -2 (subtle lift, JAMAIS scale)
 *  - Glow : opacity 0 → 1 sur hover (subtle, jamais saturé)
 */
export function KpiCard({
  label,
  value,
  suffix,
  caption,
  tone = 'primary',
  index = 0,
  live = false,
  className,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  // Magnetic tilt mouse-driven (researcher pattern + ui-designer item #9).
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-4, 4]), {
    stiffness: 200,
    damping: 24,
  });
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [3, -3]), {
    stiffness: 200,
    damping: 24,
  });

  const handlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const handlePointerLeave = () => {
    if (reduced) return;
    mx.set(0);
    my.set(0);
  };

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        whileHover: { y: -2 },
      };

  const tiltStyle = reduced ? {} : { rotateX, rotateY, transformPerspective: 800 };

  return (
    <motion.article
      ref={ref}
      {...motionProps}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      transition={{ duration: 0.5, delay: 0.06 * index + 0.1, ease: [0.22, 1, 0.36, 1] }}
      style={tiltStyle}
      className={cn(
        'group relative overflow-hidden rounded-xl border p-5 transition-colors',
        live
          ? 'border-[var(--accent-edge)] bg-[var(--surface)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="t-caption">{label}</div>
        {live && (
          <span className="inline-flex items-center gap-1.5">
            <LivePulse size={6} color="var(--accent)" />
            <span
              className="t-caption"
              style={{ color: 'var(--accent)', fontSize: 9, letterSpacing: '0.14em' }}
            >
              LIVE
            </span>
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            'num text-[1.875rem] leading-none font-medium tracking-[-0.03em] tabular-nums sm:text-[2.25rem]',
            toneClass[tone],
          )}
        >
          {value}
        </span>
        {suffix && (
          <span className="num text-[15px] font-medium text-[var(--text-subtle)] tabular-nums">
            {suffix}
          </span>
        )}
      </div>
      {caption && <div className="t-micro mt-2">{caption}</div>}

      {/* Subtle accent edge on hover (propagated, never scaled). */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ opacity: live ? 0.4 : 0 }}
        {...(reduced ? {} : { whileHover: { opacity: 1 } })}
        transition={{ duration: 0.3 }}
        className="pointer-events-none absolute inset-0 -z-10 rounded-xl"
        style={{ boxShadow: '0 0 32px -8px var(--accent-soft)' }}
      />
    </motion.article>
  );
}
