'use client';

import { motion } from 'framer-motion';

import { V18_SPRING_TIGHT } from '@/components/v18/motion-presets';
import { cn } from '@/lib/utils';

interface V18StepProgressProps {
  /** Step number, 1-indexed (e.g. 2 means "step 2 of N"). */
  current: number;
  /** Total steps. */
  total: number;
  /** Optional list of step labels (length must match `total`). Rendered as sr-only nav. */
  labels?: readonly string[];
  /** Optional className applied to the wrapper. */
  className?: string;
}

/**
 * V1.8 REFLECT — wizard step indicator.
 *
 * Mobile-first sticky-friendly. Two surfaces :
 *   1. Visible : "Étape X / N" small label + thin animated progress bar
 *      (blue accent, smooth spring scale-x transition between steps).
 *   2. Invisible : `<ol>` of step names for screen readers, with the
 *      current step marked `aria-current="step"` (per WAI-ARIA APG).
 *
 * No dots, no breadcrumbs — these add cognitive overhead on mobile. Linear /
 * Stripe Checkout pattern : a single thin bar + the label, that's enough.
 */
export function V18StepProgress({ current, total, labels, className }: V18StepProgressProps) {
  const safeCurrent = Math.max(1, Math.min(current, total));
  const percent = safeCurrent / total;

  return (
    <div
      className={cn('w-full', className)}
      data-slot="v18-step-progress"
      role="group"
      aria-label="Progression du wizard"
    >
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <p className="t-mono-cap" data-slot="v18-step-counter">
          ÉTAPE <span className="text-[var(--t-1)]">{safeCurrent}</span> / {total}
        </p>
        {labels?.[safeCurrent - 1] ? (
          <p className="t-cap truncate text-right text-[var(--t-2)]">{labels[safeCurrent - 1]}</p>
        ) : null}
      </div>

      <div
        className="relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--b-default)]"
        data-slot="v18-step-bar"
      >
        <motion.div
          className="absolute inset-y-0 left-0 origin-left rounded-full"
          style={{
            width: '100%',
            background:
              'linear-gradient(90deg, var(--v18-b-700) 0%, var(--v18-b-500) 55%, var(--v18-b-400) 100%)',
            boxShadow: '0 0 12px -2px oklch(0.62 0.19 254 / 0.55)',
          }}
          initial={false}
          animate={{ scaleX: percent }}
          transition={V18_SPRING_TIGHT}
          aria-hidden="true"
        />
      </div>

      {/* SR-only step list — APG pattern */}
      {labels ? (
        <ol className="sr-only">
          {labels.map((label, i) => (
            <li key={label + i} aria-current={i === safeCurrent - 1 ? 'step' : undefined}>
              Étape {i + 1} sur {total} — {label}
              {i < safeCurrent - 1 ? ' (complétée)' : ''}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
