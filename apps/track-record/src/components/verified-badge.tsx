import { Check } from 'lucide-react';

interface VerifiedBadgeProps {
  label: string;
  /** Optional sub-line under the label (timestamp, count, etc.). */
  detail?: string;
  tone?: 'accent' | 'positive';
}

/**
 * Trust-signal badge T2 — adapté palette desaturée T1.
 *
 * - Tone `accent` : bleu signature lumineuse (par défaut)
 * - Tone `positive` : vert verified (audit/check passed)
 *
 * Pattern Stripe Connect : tick icon 14px + label 12px medium + tracked.
 * Pas de mega-badge "100% authentique" : libellé = ACTION vérifiable.
 */
export function VerifiedBadge({ label, detail, tone = 'accent' }: VerifiedBadgeProps) {
  const palette =
    tone === 'positive'
      ? {
          bg: 'var(--positive-soft)',
          border: 'rgba(124, 184, 124, 0.28)',
          color: 'var(--positive)',
        }
      : {
          bg: 'var(--accent-soft)',
          border: 'var(--accent-edge)',
          color: 'var(--accent)',
        };

  return (
    <div className="inline-flex items-center gap-2.5">
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] leading-none font-medium tracking-[0.02em]"
        style={{
          background: palette.bg,
          borderColor: palette.border,
          color: palette.color,
        }}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
      {detail && <span className="num t-micro tabular-nums">{detail}</span>}
    </div>
  );
}
