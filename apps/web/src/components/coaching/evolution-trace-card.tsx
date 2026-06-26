import { History } from 'lucide-react';

import type { MicroObjectiveStatusView, MicroObjectiveView } from '@/lib/coaching/micro-objective';
import { cn } from '@/lib/utils';

/**
 * S5 §32-E2 — « Ton évolution » : la trace HORODATÉE des micro-objectifs mentaux,
 * du plus récent au plus ancien. Chaque ligne matérialise la boucle « créé →
 * refermé » (date de création, geste, issue, date de fermeture), donnant au membre
 * une lecture de son évolution psychologique dans le temps (livrable E2/B : le
 * motif d'origine reste traçable via la donnée sous-jacente).
 *
 * Server Component présentationnel (DB-free) : consomme `listRecentMicroObjectives`.
 * Rend `null` tant qu'aucune boucle n'a existé (jamais un historique vide simulé).
 *
 * POSTURE §31.2 : un `missed` (« pas tenu ») est une DONNÉE de progression, jamais
 * un reproche — ambre calme, jamais rouge. Carte NEUTRE (pas accent) : c'est de la
 * lecture, pas une action.
 */

const STATUS: Record<MicroObjectiveStatusView, { label: string; chip: string; dot: string }> = {
  open: {
    label: 'En cours',
    chip: 'border-[var(--b-acc)] bg-[var(--acc-dim-2)] text-[var(--acc-hi)]',
    dot: 'bg-[var(--acc)]',
  },
  kept: {
    label: 'Tenu',
    chip: 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]',
    dot: 'bg-[var(--ok)]',
  },
  missed: {
    label: 'Pas tenu',
    chip: 'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]',
    dot: 'bg-[var(--warn)]',
  },
  dismissed: {
    label: 'Écarté',
    chip: 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
    dot: 'bg-[var(--t-4)]',
  },
};

function formatDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(date);
}

export function EvolutionTraceCard({
  items,
  timezone,
  className,
}: {
  items: readonly MicroObjectiveView[];
  timezone: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <section
      data-slot="evolution-trace-card"
      aria-labelledby="evolution-trace-heading"
      className={cn(
        'rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-1)] p-5',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Ton évolution</span>
          <h2 id="evolution-trace-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            Tes micro-objectifs dans le temps
          </h2>
          <p className="t-body leading-[1.5] text-[var(--t-2)]">
            Chaque boucle ouverte puis refermée — une trace honnête de ta progression mentale.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
        >
          <History className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>

      <ol className="flex flex-col gap-3" aria-label="Historique de tes micro-objectifs">
        {items.map((item) => {
          const status = STATUS[item.status];
          return (
            <li
              key={item.id}
              data-slot="evolution-trace-row"
              data-status={item.status}
              className="flex items-start gap-3"
            >
              <span
                aria-hidden="true"
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', status.dot)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="t-body min-w-0 font-medium text-[var(--t-1)]">{item.title}</p>
                  <span
                    className={cn(
                      'rounded-pill inline-flex shrink-0 items-center border px-2 py-0.5 text-[10px] font-semibold',
                      status.chip,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <p className="t-foot text-[var(--t-4)] tabular-nums">
                  Ouvert le {formatDay(item.createdAt, timezone)}
                  {item.closedAt ? ` · refermé le ${formatDay(item.closedAt, timezone)}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
