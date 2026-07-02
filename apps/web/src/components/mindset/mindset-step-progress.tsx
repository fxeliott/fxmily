'use client';

import { m } from 'framer-motion';

import { V18_SPRING_TIGHT } from '@/components/v18/motion-presets';
import { cn } from '@/lib/utils';

/**
 * V1.5 — MindsetCheck wizard step indicator (SPEC §27).
 *
 * Structural + a11y clone of `<TrainingDebriefStepProgress>` (WAI-ARIA APG
 * sr-only `<ol>` pattern, canon) re-skinned to the **DS-v2 NEUTRAL/lime
 * identity** — NEVER the cyan `--cy` family (§21.7 training-only), NEVER
 * `.v18-theme` (REFLECT-only). The fill uses DS accent tokens via a DOM CSS
 * gradient (not an SVG fill — `var()` is safe here, unlike Recharts).
 * `V18_SPRING_TIGHT` is a shared motion-timing constant (app-wide SSOT, not a
 * theme token), reused so the progress fill feels identically decisive.
 */
interface MindsetStepProgressProps {
  /** 1-indexed current step. */
  current: number;
  total: number;
  /** Step labels (length === total). Rendered sr-only as the APG `<ol>`. */
  labels?: readonly string[];
  className?: string;
}

export function MindsetStepProgress({
  current,
  total,
  labels,
  className,
}: MindsetStepProgressProps) {
  const safeCurrent = Math.max(1, Math.min(current, total));
  const percent = safeCurrent / total;

  return (
    <div
      className={cn('w-full', className)}
      data-slot="mindset-step-progress"
      role="group"
      aria-label="Progression de l'auto-évaluation"
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
            background: 'linear-gradient(90deg, var(--acc) 0%, var(--acc-hi) 100%)',
            boxShadow: 'var(--acc-glow)',
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
              Étape {i + 1} sur {total} · {label}
              {i < safeCurrent - 1 ? ' (complétée)' : ''}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
