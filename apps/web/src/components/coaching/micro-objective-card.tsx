import { Compass } from 'lucide-react';

import type { MicroObjectiveCloseEcho, MicroObjectiveView } from '@/lib/coaching/micro-objective';
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
 *
 * C3 (tour 10) — quand la boucle vient d'une correction admin, `annotationExcerpt`
 * porte un court extrait du commentaire RÉEL de la correction (résolu server-side
 * via `getAnnotationExcerptForObjective`, déjà tronqué). On l'affiche SOUS
 * l'intention générique, en `full` seulement (le hub compact reste resserré) : le
 * membre lit ce que son coach lui a vraiment dit, pas juste la phrase curée. `null`
 * quand la boucle ne vient pas d'une annotation, ou que la correction n'existe plus.
 */

export function MicroObjectiveCard({
  objective,
  annotationExcerpt = null,
  isStale = false,
  variant = 'full',
  className,
  onEcho,
}: {
  objective: MicroObjectiveView | null;
  annotationExcerpt?: string | null;
  /**
   * Tour 11 (FINDING 2) — l'objectif ouvert dépasse le seuil de sommeil (14j,
   * calculé server-side via `isMicroObjectiveStale`). Ajoute UNE relance douce
   * au-dessus du bloc de clôture. Factuel, jamais un compte à rebours, jamais
   * rouge (§31.2). `false` par défaut = comportement historique inchangé.
   */
  isStale?: boolean;
  variant?: 'full' | 'compact';
  className?: string;
  /**
   * Tour 11 (FINDING 1, fix runtime) — remonte l'écho de clôture vers l'île
   * toujours montée (`MicroObjectiveLoop`) : la revalidation RSC démonte cette
   * carte (la boucle quitte le slot « ouvert »), l'écho doit vivre au-dessus.
   * Prop fonction ⇒ uniquement depuis un contexte client.
   */
  onEcho?: (echo: MicroObjectiveCloseEcho | null) => void;
}) {
  if (!objective) return null;
  const compact = variant === 'compact';

  return (
    <section
      data-slot="micro-objective-card"
      data-axis={objective.axis}
      aria-labelledby="micro-objective-heading"
      className={cn(
        'wow-hover-soft rounded-card flex flex-col gap-3.5 border border-[var(--b-acc)] bg-[var(--acc-dim)]',
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

          {/* C3 (tour 10) — l'extrait de la correction admin dont la boucle est
              issue, cité SOUS l'intention générique (full uniquement). Liseré
              accent gauche + eyebrow pour signaler « parole du coach » sans
              rivaliser avec le titre. §31.2 : c'est un rappel, jamais un reproche. */}
          {!compact && annotationExcerpt ? (
            <figure className="mt-1 border-l-2 border-[var(--b-acc)] pl-3">
              <figcaption className="t-eyebrow text-[var(--t-3)]">
                Ce que ton coach a relevé
              </figcaption>
              <blockquote className="t-foot mt-0.5 leading-relaxed text-[var(--t-2)] italic">
                {annotationExcerpt}
              </blockquote>
            </figure>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--b-acc)] pt-3">
        {/* Tour 11 (FINDING 2) — relance douce quand la boucle est en sommeil
            (> 14j). Factuel, jamais un compte à rebours ni un reproche : on
            rappelle simplement que le membre peut la refermer pour repartir.
            Rendu au-dessus du bloc de clôture, ton calme (accent, jamais rouge). */}
        {isStale ? (
          <p className="t-foot leading-relaxed text-[var(--acc-hi)]">
            Toujours d’actualité ? Tu peux le marquer tenu, pas encore, ou le laisser partir.
          </p>
        ) : null}
        {!compact ? (
          <p className="t-foot text-[var(--t-3)]">
            Une seule chose à la fois. Tu la refermeras à ton prochain passage.
          </p>
        ) : null}
        <CloseMicroObjective microObjectiveId={objective.id} onEcho={onEcho} />
      </div>
    </section>
  );
}
