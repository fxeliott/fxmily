import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Tiny pill that surfaces "your sample is small" honesty (J6).
 *
 * Mark Douglas posture: we never display a metric without telling the
 * member how many observations it sits on top of. Lying-by-omission
 * (a 78% win rate over 4 trades feels solid) is the exact opposite of
 * what *Trading in the Zone* teaches.
 *
 * Pure presentation, server-renderable.
 */
interface SampleSizeDisclaimerProps {
  /** Current sample size (e.g. trades closed in window, days with check-in). */
  current: number;
  /** Threshold below which we deem the sample insufficient. */
  minimum: number;
  /** Unit shown next to the count (e.g. "trades", "jours"). */
  unit: string;
  /**
   * Optional context. e.g. "fenêtre 30 jours" — appended after the count.
   */
  context?: string;
  /**
   * Cosmetic — `subtle` for the dashboard cards (no border), `pill` when
   * docked next to a chart title.
   */
  variant?: 'subtle' | 'pill';
}

export function SampleSizeDisclaimer({
  current,
  minimum,
  unit,
  context,
  variant = 'subtle',
}: SampleSizeDisclaimerProps) {
  const sufficient = current >= minimum;
  const Icon = Info;

  const label = sufficient
    ? `${current} ${unit}${context ? ` · ${context}` : ''}`
    : `Échantillon faible — ${current}/${minimum} ${unit}${context ? ` · ${context}` : ''}`;

  const role = sufficient ? undefined : ('note' as const);

  return (
    <span
      className={cn(
        't-mono-cap inline-flex items-center gap-1.5',
        sufficient ? 'text-[var(--t-4)]' : 'text-[var(--warn)]',
        variant === 'pill' && 'rounded-pill border px-2 py-0.5',
        variant === 'pill' &&
          (sufficient
            ? 'border-[var(--b-default)]'
            : 'border-[var(--warn)]/40 bg-[var(--warn-dim-2)]'),
      )}
      {...(role ? { role } : {})}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
