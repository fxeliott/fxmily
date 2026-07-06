import { CalendarCheck, Target } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { DayRecap } from '@/lib/day-recap';
import { cn } from '@/lib/utils';

/**
 * Tour 16 — la carte de récapitulatif de journée, rendue sur l'écran de
 * confirmation post-wrap (`/checkin?slot=evening&done=1`), sous l'écho réflexif.
 * Elle donne au membre la photo factuelle de sa journée juste après l'avoir
 * bouclée : compteurs (trades, gagnants), faits clés de process, sortie notable,
 * rappel du micro-objectif ouvert.
 *
 * Surface de LECTURE (jamais interactive) sur `.card-premium` (le défaut du
 * composant `Card`). Copie 100 % déterministe (lib/day-recap.ts) → aucune
 * bannière AI Act. POSTURE §31.2 : accents calmes uniquement ; le rouge est
 * réservé au ton 'loss' (outcome de trade). Le glyphe décoratif est aria-hidden ;
 * chaque signal est porté par le texte, jamais par la couleur seule.
 */

/** Ton d'un fait → classe de couleur de texte. 'loss' est le seul rouge. */
function factToneClass(tone: DayRecap['facts'][number]['tone']): string {
  switch (tone) {
    case 'held':
      return 'text-[var(--ok)]';
    case 'watch':
      return 'text-[var(--acc-hi)]';
    case 'loss':
      return 'text-[var(--bad)]';
    default:
      return 'text-[var(--t-2)]';
  }
}

/** Accord au pluriel du libellé d'un compteur (« trade » → « trades »). */
function pluralize(label: string, value: number): string {
  return value > 1 ? `${label}s` : label;
}

export function DayRecapCard({ recap }: { recap: DayRecap }) {
  const hasCounters = recap.counters.length > 0;
  const hasFacts = recap.facts.length > 0;

  return (
    <Card data-slot="day-recap" className="p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--acc)]"
        >
          <CalendarCheck className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="t-eyebrow text-[var(--t-3)]">{recap.title}</h2>

          {/* Compteurs — la photo chiffrée en tête (trades journalisés, gagnants). */}
          {hasCounters ? (
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {recap.counters.map((counter) => (
                <div key={counter.label} className="flex items-baseline gap-1.5">
                  <dd className="f-mono text-xl font-semibold text-[var(--t-1)] tabular-nums">
                    {counter.value}
                  </dd>
                  <dt className="t-cap text-[var(--t-3)]">
                    {pluralize(counter.label, counter.value)}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}

          {/* Faits clés — process tenu / écarts déclarés / sortie notable. */}
          {hasFacts ? (
            <ul className="flex flex-col gap-1.5">
              {recap.facts.map((fact, i) => (
                <li
                  key={i}
                  className={cn(
                    't-body flex items-start gap-2 leading-relaxed',
                    factToneClass(fact.tone),
                  )}
                >
                  <span
                    aria-hidden
                    className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current"
                  />
                  <span>{fact.text}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Rappel doux du micro-objectif ouvert (titre curé, jamais un verdict). */}
          {recap.microObjectiveTitle ? (
            <p className="t-cap flex items-center gap-1.5 text-[var(--t-3)]">
              <Target
                className="h-3.5 w-3.5 shrink-0 text-[var(--acc)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                Ton engagement du moment :{' '}
                <span className="text-[var(--t-2)]">{recap.microObjectiveTitle}</span>
              </span>
            </p>
          ) : null}

          <p className="t-cap text-[var(--t-3)]">{recap.closer}</p>
        </div>
      </div>
    </Card>
  );
}
