import { Check } from 'lucide-react';

interface VerifiedBadgeProps {
  label: string;
  /** Optional sub-line under the label, e.g. ISO timestamp. */
  detail?: string;
}

/**
 * Trust-signal badge (Myfxbook anatomy verbatim, recolored to Stripe Connect
 * success token).
 * - `gain-bg #152207` + `verified-border #20360C` + `verified #3EAE20`
 * - Tick icon 14px, label 12px, weight 500, tracking +0.02em.
 * - Reuse `gain` hue — JAMAIS inventer une nouvelle nuance verte.
 * - Pas de mega-badge "100% authentique" : libellé = ACTION verifiable.
 */
export function VerifiedBadge({ label, detail }: VerifiedBadgeProps) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] leading-none font-medium tracking-[0.02em]"
        style={{
          background: 'var(--tr-verified-bg)',
          borderColor: 'var(--tr-verified-border)',
          color: 'var(--tr-verified)',
        }}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
      {detail && (
        <span className="font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">{detail}</span>
      )}
    </div>
  );
}
