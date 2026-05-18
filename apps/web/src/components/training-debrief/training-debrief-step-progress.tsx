'use client';

import { m } from 'framer-motion';

import { V18_SPRING_TIGHT } from '@/components/v18/motion-presets';
import { cn } from '@/lib/utils';

/**
 * V1.3 — TrainingDebrief wizard step indicator (SPEC §23).
 *
 * Structural + a11y clone of `<V18StepProgress>` (the WAI-ARIA APG sr-only
 * `<ol>` pattern is canon) but re-skinned to the **cyan DS-v2 training
 * identity** — NEVER `.v18-theme` / `--v18-b-*` (those tokens only exist
 * under `.v18-theme`, REFLECT-only, invariant §23.7). `V18_SPRING_TIGHT` is
 * a shared motion-timing constant (app-wide SSOT, not a theme token), reused
 * here so the progress fill feels identically "decisive".
 *
 * Linear/Stripe-checkout pattern: one thin bar + label, no dots/breadcrumbs.
 */
interface TrainingDebriefStepProgressProps {
  /** 1-indexed current step. */
  current: number;
  total: number;
  /** Step labels (length === total). Rendered sr-only as the APG `<ol>`. */
  labels?: readonly string[];
  className?: string;
}

export function TrainingDebriefStepProgress({
  current,
  total,
  labels,
  className,
}: TrainingDebriefStepProgressProps) {
  const safeCurrent = Math.max(1, Math.min(current, total));
  const percent = safeCurrent / total;

  return (
    <div
      className={cn('w-full', className)}
      data-slot="training-debrief-step-progress"
      role="group"
      aria-label="Progression du débrief"
    >
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <p className="t-mono-cap" data-slot="step-counter">
          ÉTAPE <span className="text-[var(--t-1)]">{safeCurrent}</span> / {total}
        </p>
        {labels?.[safeCurrent - 1] ? (
          <p className="t-cap truncate text-right text-[var(--t-2)]">{labels[safeCurrent - 1]}</p>
        ) : null}
      </div>

      <div
        className="relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--b-default)]"
        data-slot="step-bar"
      >
        <m.div
          className="absolute inset-y-0 left-0 origin-left rounded-full"
          style={{
            width: '100%',
            // Cyan training identity — hardcoded OKLCH (the `--cy` family,
            // mirror of `globals.css` `--cy` #22d3ee), NOT `--v18-b-*`.
            background:
              'linear-gradient(90deg, oklch(0.6 0.12 217) 0%, oklch(0.789 0.139 217) 60%, oklch(0.85 0.13 210) 100%)',
            boxShadow: '0 0 12px -2px oklch(0.789 0.139 217 / 0.5)',
          }}
          initial={false}
          animate={{ scaleX: percent }}
          transition={V18_SPRING_TIGHT}
          aria-hidden="true"
        />
      </div>

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
