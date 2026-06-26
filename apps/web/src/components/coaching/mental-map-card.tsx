import { BrainCircuit } from 'lucide-react';

import type { MentalMapEntry, MentalTone } from '@/lib/coaching/mental-map';
import { cn } from '@/lib/utils';

/**
 * S5 §32-E1 — « Ta carte mentale ». Surfaces, in plain language, the member's
 * psychological read of their OWN process signals: for each entry, the triptych
 * **observé → ce que ça signifie (Mark Douglas) → ton geste**. The member sees
 * where they stand on discipline & mental WITHOUT any effort of interpretation.
 *
 * Server Component présentationnel pur : tout arrive en props (la carte est
 * construite par `lib/coaching/mental-map.ts`, déterministe + curé). Rend `null`
 * quand il n'y a rien à dire (jamais une entrée fabriquée).
 *
 * POSTURE §2 / §33.2 (BLOQUANT) : process/discipline/mental uniquement — jamais
 * un signal de marché. §31.2 : tonalités calmes (ambre = attention douce, jamais
 * de rouge punitif). Déterministe ⇒ AUCUN `AIGeneratedBanner` (cf. le module).
 *
 * `full` — la section autonome de /objectifs (toutes les entrées, ≤4).
 * `compact` — une carte resserrée pour le hub : la SEULE entrée la plus prioritaire.
 */

/** `pill` = tonalité du slot pill → hérite du correctif de contraste light S18.1. */
const TONE: Record<MentalTone, { label: string; pill: string; chip: string; geste: string }> = {
  // Alerte de répétition (déjà escaladée) — attention douce, JAMAIS rouge (§31.2).
  alert: {
    label: 'À renforcer',
    pill: 'warn',
    chip: 'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]',
    geste: 'text-[var(--warn)]',
  },
  // Vigilance sous le seuil — neutre/accent, on réancre tant que c'est facile.
  watch: {
    label: 'À surveiller',
    pill: 'acc',
    chip: 'border-[var(--b-acc)] bg-[var(--acc-dim-2)] text-[var(--acc-hi)]',
    geste: 'text-[var(--acc-hi)]',
  },
  // Renfort positif — la constance qui se construit.
  positive: {
    label: 'Solide',
    pill: 'ok',
    chip: 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]',
    geste: 'text-[var(--ok)]',
  },
};

export function MentalMapCard({
  entries,
  variant = 'full',
  className,
}: {
  entries: readonly MentalMapEntry[];
  variant?: 'full' | 'compact';
  className?: string;
}) {
  if (entries.length === 0) return null;
  const compact = variant === 'compact';
  // Compact (hub) : on ne montre QUE la priorité #1 (les entrées arrivent triées).
  const shown = compact ? entries.slice(0, 1) : entries;

  return (
    <section
      data-slot="mental-map-card"
      aria-labelledby="mental-map-heading"
      className={cn(
        'rounded-card border border-[var(--b-acc)] bg-[var(--acc-dim)]',
        compact ? 'p-4' : 'p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <BrainCircuit className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">Ta carte mentale</span>
          <h2 id="mental-map-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            Ce que tes signaux disent de ton mental
          </h2>
          {!compact ? (
            <p className="t-cap leading-relaxed text-[var(--t-2)]">
              Ta discipline et ton honnêteté avec toi-même, lues dans tes faits — et un seul geste
              pour chaque. Aucun conseil de marché : seulement ton process.
            </p>
          ) : null}
        </div>
      </div>

      <ul className={cn('mt-3.5 flex flex-col', compact ? 'gap-2' : 'gap-2.5')}>
        {shown.map((entry) => {
          const tone = TONE[entry.tone];
          return (
            <li
              key={entry.id}
              data-slot="mental-map-entry"
              data-axis={entry.axis}
              data-tone={entry.tone}
              className="rounded-control border border-[var(--b-default)] bg-[var(--bg-1)] p-3.5"
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <p className="t-body leading-[1.5] font-medium text-[var(--t-1)]">
                  {entry.observation}
                </p>
                <span
                  data-slot="pill"
                  data-tone={tone.pill}
                  className={cn(
                    'rounded-pill inline-flex shrink-0 items-center border px-2 py-0.5 text-[10px] font-semibold',
                    tone.chip,
                  )}
                >
                  {tone.label}
                </span>
              </div>
              {/* Triptyque : signification (Mark Douglas) → geste concret. */}
              <dl className="flex flex-col gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <dt className="t-foot font-semibold text-[var(--t-4)]">Ce que ça signifie</dt>
                  <dd className="t-cap leading-relaxed text-[var(--t-2)]">{entry.meaning}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="t-foot font-semibold text-[var(--t-4)]">Ton geste</dt>
                  <dd className={cn('t-cap leading-relaxed font-medium', tone.geste)}>
                    {entry.action}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
