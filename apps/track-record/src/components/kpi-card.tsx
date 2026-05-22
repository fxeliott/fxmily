'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  /** Main number rendered with tabular-nums. Use AnimatedNumber for count-up. */
  value: ReactNode;
  /** Suffix (e.g. " %", "R"). Rendered with --tr-t-3 tone for hierarchy. */
  suffix?: ReactNode;
  /** Sub-label below the number (e.g. "sur 138 trades"). */
  caption?: string;
  /** Tone for the value color — null = primary, gain | loss | warn. */
  tone?: 'primary' | 'gain' | 'loss' | 'warn';
  /** Place in stagger order — passed by parent grid. */
  index?: number;
  className?: string;
}

const toneClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
  primary: 'text-[var(--tr-t-1)]',
  gain: 'text-[var(--tr-gain)]',
  loss: 'text-[var(--tr-loss)]',
  warn: 'text-[var(--tr-warn)]',
};

/**
 * KPI card — hero pattern (Stripe Connect + Mercury).
 * Hierarchy : Label (12px UPPERCASE tracked +0.08em --tr-t-3)
 *           → Number (56-72px tabular-nums --tr-t-1)
 *           → Caption (12px --tr-t-3, optional)
 * Lift on hover = shadow + border tint, JAMAIS scale (Steve Kinney + Stripe).
 */
export function KpiCard({
  label,
  value,
  suffix,
  caption,
  tone = 'primary',
  index = 0,
  className,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  // exactOptionalPropertyTypes: conditional spread > `prop={cond ? undefined : value}`.
  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 16, filter: 'blur(6px)' },
        whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
        whileHover: { y: -2 },
      };
  return (
    <motion.article
      {...motionProps}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay: 0.08 * index + 0.1, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-[var(--tr-bg-1)] p-6 transition-colors',
        'border-[var(--tr-b-default)] hover:border-[color-mix(in_oklab,var(--tr-acc),transparent_55%)]',
        'shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
        className,
      )}
    >
      <div className="text-[11px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
        {label}
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[2.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums sm:text-[3.25rem]',
            toneClass[tone],
          )}
          style={{ fontFamily: 'var(--tr-font-display)' }}
        >
          {value}
        </span>
        {suffix && (
          <span className="text-lg font-medium text-[var(--tr-t-3)] tabular-nums sm:text-xl">
            {suffix}
          </span>
        )}
      </div>
      {caption && <div className="mt-2 text-xs text-[var(--tr-t-3)]">{caption}</div>}

      {/* Glow propagated on hover (opacity 0→1, never scale shadow). */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ opacity: 0 }}
        {...(reduced ? {} : { whileHover: { opacity: 1 } })}
        transition={{ duration: 0.3 }}
        className="pointer-events-none absolute inset-0 -z-10 rounded-xl"
        style={{ boxShadow: '0 8px 32px -8px rgba(0,133,255,0.35)' }}
      />
    </motion.article>
  );
}
