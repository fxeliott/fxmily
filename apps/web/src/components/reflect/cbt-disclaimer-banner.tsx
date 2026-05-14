import { BookOpen } from 'lucide-react';

/**
 * V1.8 REFLECT — CBT clinical-honesty disclaimer banner.
 *
 * Mandatory above the ReflectionEntry wizard per `docs/jalon-V1.8-decisions.md`
 * and SPEC §2 posture (no clinical claims). The framework is *inspired by*
 * Ellis ABC + Disputation (REBT, 1955) but :
 *
 *   - We are NOT therapists.
 *   - The wizard is NOT clinically validated for trader populations.
 *   - It's a journaling structure, not a treatment.
 *
 * This banner makes the disclaimer impossible to miss (sticky-friendly).
 * Tone : warm, contained, non-condescending. Mentions Mark Douglas + Ellis
 * by name so members can read the source material themselves.
 *
 * Source — researcher findings 2026 :
 *   - Beck/Ellis CBT validated RCT n=100 (cortisol Trier Social Stress).
 *   - JMIR Mental Health 2025 review of CBT chatbots (n=14 studies).
 *   - ZERO RCT trader-specific. The honesty here is non-negotiable.
 */
export function V18CbtDisclaimerBanner() {
  return (
    <aside
      data-slot="v18-cbt-disclaimer"
      role="note"
      aria-label="Avis pédagogique CBT"
      className="rounded-card-lg border p-4 sm:p-5"
      style={{
        background: 'oklch(0.18 0.03 254 / 0.6)',
        borderColor: 'var(--b-default)',
        boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.04)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
          style={{
            background: 'oklch(0.62 0.19 254 / 0.14)',
            color: 'oklch(0.82 0.115 247)',
          }}
        >
          <BookOpen size={16} strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow text-[var(--t-3)]">Cadre pédagogique</p>
          <p className="t-body mt-1 text-[var(--t-2)]">
            Inspiré du modèle <strong className="text-[var(--t-1)]">Ellis ABC + Disputation</strong>{' '}
            (REBT, 1955), adapté ici au contexte trader. Ce wizard est une{' '}
            <em>structure de journaling</em> — il n&apos;est{' '}
            <strong className="text-[var(--t-1)]">pas validé cliniquement</strong> pour la
            population trader et n&apos;est pas un substitut à un accompagnement
            psychothérapeutique. Pour la posture process &gt; outcome, voir Mark Douglas{' '}
            <em>Trading In The Zone</em>.
          </p>
        </div>
      </div>
    </aside>
  );
}
