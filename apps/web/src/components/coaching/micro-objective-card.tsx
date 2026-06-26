import { Compass } from 'lucide-react';

import type { MicroObjectiveView } from '@/lib/coaching/micro-objective';
import { cn } from '@/lib/utils';

import { CloseMicroObjective } from './close-micro-objective';

/**
 * S5 §32-E3 — « Ton micro-objectif » : la boucle d'engagement OUVERTE (un seul à
 * la fois). L'app propose UNE chose mentale à travailler (titre Mark Douglas par
 * axe) avec son geste concret (intention), puis offre le suivi qui REFERME la
 * boucle au prochain passage (`CloseMicroObjective`).
 *
 * Server Component : la donnée arrive en props (`getOpenMicroObjective`) ; seul le
 * suivi est un îlot client. Rend `null` quand aucune boucle n'est ouverte.
 *
 * POSTURE §2 / §33.2 : process/mental uniquement (copie curée, jamais le marché).
 * §31.2 : un cap doux, jamais un compte à rebours ni un reproche. Déterministe ⇒
 * pas d'`AIGeneratedBanner`.
 *
 * `full` — /objectifs (avec le rappel « tu le refermeras à ton prochain passage »).
 * `compact` — le hub (resserré ; le suivi reste actionnable sur place).
 */

export function MicroObjectiveCard({
  objective,
  variant = 'full',
  className,
}: {
  objective: MicroObjectiveView | null;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  if (!objective) return null;
  const compact = variant === 'compact';

  return (
    <section
      data-slot="micro-objective-card"
      data-axis={objective.axis}
      aria-labelledby="micro-objective-heading"
      className={cn(
        'rounded-card flex flex-col gap-3.5 border border-[var(--b-acc)] bg-[var(--acc-dim)]',
        compact ? 'p-4' : 'p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <Compass className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">Ton micro-objectif</span>
          <h2 id="micro-objective-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            {objective.title}
          </h2>
          <p className="t-cap leading-relaxed text-[var(--t-2)]">{objective.intention}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--b-acc)] pt-3">
        {!compact ? (
          <p className="t-foot text-[var(--t-3)]">
            Une seule chose à la fois. Tu la refermeras à ton prochain passage.
          </p>
        ) : null}
        <CloseMicroObjective microObjectiveId={objective.id} />
      </div>
    </section>
  );
}
