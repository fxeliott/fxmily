import { ArrowDownRight, ArrowUpRight, Gauge } from 'lucide-react';

import type { CoachingInsight, CoachingTrend } from '@/lib/coaching/engine';
import type { MentalTone } from '@/lib/coaching/mental-map';
import { cn } from '@/lib/utils';

/**
 * S5 §32-C/D — « Ton coaching du moment ». La surface membre (S4) du moteur
 * d'analyses autonomes : la SYNTHÈSE de ce que les signaux réels disent du
 * mental — cause (observé) → effet (lecture Mark Douglas) → prochain pas — avec
 * sa **progression MESURÉE** (l'élément distinctif vs la carte mentale E1, qui
 * liste ; ici on synthétise + on chiffre la trajectoire) et sa **traçabilité**.
 *
 * Server Component présentationnel pur : l'insight arrive en prop (construit par
 * le moteur PUR déterministe `lib/coaching/engine.ts`). Rend `null` quand il n'y
 * a rien à dire (jamais un insight fabriqué — DoD §33 : ancré dans le réel).
 *
 * POSTURE §2 / §33.2 (BLOQUANT) : process / discipline / mental uniquement —
 * jamais un signal de marché. §31.2 : tonalités calmes ; une tendance en repli se
 * lit « à réancrer » en gris neutre, JAMAIS en rouge punitif. DÉTERMINISTE ⇒
 * AUCUN `AIGeneratedBanner` (§50 AI Act ne s'applique qu'au contenu dérivé d'un
 * LLM — ici c'est de l'arithmétique + de la copie curée).
 */

const TONE: Record<MentalTone, { label: string; chip: string }> = {
  alert: {
    label: 'À renforcer',
    chip: 'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]',
  },
  watch: {
    label: 'À surveiller',
    chip: 'border-[var(--b-acc)] bg-[var(--acc-dim-2)] text-[var(--acc-hi)]',
  },
  positive: {
    label: 'Solide',
    chip: 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]',
  },
};

/** Tendance calme : hausse en vert (renforcement positif), repli en GRIS neutre
 *  (jamais rouge §31.2), indéfendable → rien (on ne fabrique pas de direction). */
function TrendBadge({ trend }: { trend: CoachingTrend }) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ok)]">
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        en progrès
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--t-3)]">
        <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />à réancrer
      </span>
    );
  }
  return null;
}

export function CoachingInsightCard({
  insight,
  className,
}: {
  insight: CoachingInsight | null;
  className?: string;
}) {
  if (!insight) return null;
  const tone = TONE[insight.tone];
  const { progression } = insight;

  return (
    <section
      data-slot="coaching-insight-card"
      data-axis={insight.axis}
      data-tone={insight.tone}
      aria-labelledby="coaching-insight-heading"
      className={cn(
        'rounded-card-lg border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <Gauge className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <span className="t-eyebrow text-[var(--acc-hi)]">Ton coaching du moment</span>
            <span
              className={cn(
                'rounded-pill inline-flex shrink-0 items-center border px-2 py-0.5 text-[10px] font-semibold',
                tone.chip,
              )}
            >
              {tone.label}
            </span>
          </div>
          <h2 id="coaching-insight-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            {insight.headline}
          </h2>
        </div>
      </div>

      {/* Cause → effet → prochain pas (synthèse Mark Douglas, process only). */}
      <p className="t-body mt-3.5 leading-[1.5] font-medium text-[var(--t-1)]">
        {insight.observation}
      </p>
      <dl className="rounded-control mt-2.5 flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-3.5">
        <div className="flex flex-col gap-0.5">
          <dt className="t-foot font-semibold text-[var(--t-4)]">Ce que ça veut dire</dt>
          <dd className="t-cap leading-relaxed text-[var(--t-2)]">{insight.meaning}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-foot font-semibold text-[var(--t-4)]">Ton prochain pas</dt>
          <dd className="t-cap leading-relaxed font-medium text-[var(--acc-hi)]">
            {insight.nextStep}
          </dd>
        </div>
      </dl>

      {/* Progression MESURÉE — l'élément distinctif du moteur (chiffre + tendance). */}
      {progression ? (
        <div
          data-slot="coaching-progression"
          className="rounded-control mt-2.5 flex items-end justify-between gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-3.5"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="t-foot font-semibold text-[var(--acc-hi)]">{progression.label}</span>
            <span className="t-cap text-[var(--t-3)]">{progression.detail}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="f-mono text-[26px] leading-none font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
              {progression.value}
              <span className="text-[14px] font-medium text-[var(--t-3)]">{progression.unit}</span>
            </span>
            <TrendBadge trend={progression.trend} />
          </div>
        </div>
      ) : null}

      {/* Traçabilité (E2/B) — d'où découle l'insight (jusqu'au motif d'origine). */}
      {insight.basis.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="t-foot font-semibold text-[var(--t-4)]">D’après</span>
          {insight.basis.map((b) => (
            <span
              key={b}
              className="rounded-pill inline-flex items-center border border-[var(--b-default)] bg-[var(--bg-1)] px-2 py-0.5 text-[10px] font-medium text-[var(--t-3)]"
            >
              {b}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
