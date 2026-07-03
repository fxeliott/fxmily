import { ClipboardCheck } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getAxisLabel } from '@/lib/tracking/axes';
import { ageDays, isCorrectionStale } from '@/lib/admin/correction-followup-age';
import type { AnnotationObjectiveRow } from '@/lib/coaching/micro-objective';
import type { MicroObjectiveStatusView } from '@/lib/coaching/micro-objective';
import type { TrackingAxisId } from '@/lib/tracking/axes';
import { cn } from '@/lib/utils';

import { ReinforceObjectiveButton } from './reinforce-objective-button';

/**
 * C3 (tour 10) — « Suivi des corrections » : la boucle « correction admin →
 * micro-objectif membre », vue côté ADMIN. Pour chaque correction taggée d'un axe
 * (`TradeAnnotation.axis`), le système sème un micro-objectif membre
 * (`sourceKind='annotation'`) ; ce panel liste ces micro-objectifs avec leur
 * intention, leur date et leur STATUT, pour que l'admin voie si ses corrections
 * sont tenues.
 *
 * Tour 11 (chantier G) — le panel n'est plus 100% read-only :
 *  - FINDING 2 : une boucle OUVERTE de plus de 14 jours affiche un sous-libellé
 *    ambre neutre « ouvert depuis N j » (un objectif zombie bloque l'invariant
 *    « ≤ 1 ouvert » du membre, il ne doit plus être invisible). Factuel, jamais
 *    rouge, jamais un compte à rebours.
 *  - FINDING 4 : sur une boucle open-et-ancienne OU « Pas tenu » (missed), un
 *    bouton discret « Renforcer » pose une note privée pré-remplie (jamais vue
 *    du membre). Aucune autre commande, le panel reste lisible.
 *
 * Server Component présentationnel (DB-free) : la liste + `memberId` arrivent en
 * props. Vit dans l'onglet « Mark Douglas » car un micro-objectif EST un
 * engagement Mark Douglas.
 *
 * POSTURE §31.2 (anti-Black-Hat) : « Pas tenu » (missed) est un état FACTUEL, jamais
 * un rouge punitif — ton ambre calme (warn), libellé neutre. On donne à l'admin une
 * lecture et un levier de relance, jamais un verdict à charge contre le membre.
 */

/** `axis` est l'axe MENTAL (discipline/honesty/ego/consistency), pas un TrackingAxis :
 *  on affiche un libellé FR dédié (le TrackingAxis d'origine n'est pas persisté sur
 *  le micro-objectif — firewall §21.5). */
const MENTAL_AXIS_LABEL: Record<string, string> = {
  discipline: 'Discipline',
  honesty: 'Honnêteté',
  ego: 'Ego / acceptation',
  consistency: 'Régularité',
};

function mentalAxisLabel(axis: string): string {
  // Fallback défensif : si un jour l'axe stocké est un TrackingAxis, on retombe sur
  // son libellé méthodo ; sinon l'id brut (jamais un crash, jamais un vide).
  return MENTAL_AXIS_LABEL[axis] ?? getAxisLabel(axis as TrackingAxisId);
}

const STATUS: Record<MicroObjectiveStatusView, { label: string; chip: string; dot: string }> = {
  open: {
    label: 'En cours',
    chip: 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc-hi)]',
    dot: 'bg-[var(--acc)]',
  },
  kept: {
    label: 'Tenu',
    chip: 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]',
    dot: 'bg-[var(--ok)]',
  },
  missed: {
    // §31.2 — factuel, jamais punitif : ambre calme, pas de rouge « bad ».
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

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export function MemberCorrectionsFollowupPanel({
  memberId,
  objectives,
}: {
  memberId: string;
  objectives: readonly AnnotationObjectiveRow[];
}) {
  if (objectives.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={ClipboardCheck}
          headline="Aucune correction suivie pour l'instant"
          lead="Quand tu tagges une correction d'un axe de coaching, le système propose au membre un micro-objectif lié. Ils apparaîtront ici avec leur statut pour que tu voies si tes corrections sont tenues."
          tip="Tagge une correction d'un axe depuis le détail d'un trade du membre."
        />
      </Card>
    );
  }

  // Server-side clock (une seule lecture pour tout le rendu) — l'âge est un fait
  // dérivé à l'instant du rendu, pas un compte à rebours vivant côté client.
  const now = new Date();

  return (
    <Card className="p-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
        <ClipboardCheck className="text-acc h-4 w-4" aria-hidden />
        <h2 className="t-h3 text-[var(--t-1)]">Suivi des corrections</h2>
        <span
          data-slot="pill"
          data-tone="mute"
          className="rounded-pill inline-flex items-center border border-[var(--b-default)] bg-[var(--bg-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--t-3)] tabular-nums"
        >
          {objectives.length}
        </span>
        <p className="t-cap w-full text-[var(--t-3)]">
          Les micro-objectifs semés par tes corrections taggées. Une lecture de ce que le membre
          tient, jamais un verdict.
        </p>
      </header>
      <ul className="flex flex-col">
        {objectives.map((obj) => {
          const status = STATUS[obj.status];
          const stale = obj.status === 'open' && isCorrectionStale(obj.createdAt, now);
          // « Renforcer » : sur une boucle ouverte ANCIENNE (zombie) ou « Pas tenu »
          // (missed) — les deux cas où une relance a du sens (FINDING 4).
          const canReinforce = stale || obj.status === 'missed';
          return (
            <li
              key={obj.id}
              data-slot="correction-followup-row"
              data-status={obj.status}
              className="flex items-start gap-3 border-b border-[var(--b-default)] px-5 py-4 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', status.dot)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="t-body min-w-0 font-medium text-[var(--t-1)]">{obj.title}</p>
                  <span
                    data-slot="pill"
                    data-tone={
                      obj.status === 'open'
                        ? 'acc'
                        : obj.status === 'kept'
                          ? 'ok'
                          : obj.status === 'missed'
                            ? 'warn'
                            : 'mute'
                    }
                    className={cn(
                      'rounded-pill inline-flex shrink-0 items-center border px-2 py-0.5 text-[10px] font-semibold',
                      status.chip,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <p className="t-cap leading-relaxed text-[var(--t-2)]">{obj.intention}</p>
                <p className="t-foot text-[var(--t-4)] tabular-nums">
                  {mentalAxisLabel(obj.axis)} · ouvert le {DT.format(obj.createdAt)}
                  {obj.closedAt ? ` · refermé le ${DT.format(obj.closedAt)}` : ''}
                </p>
                {/* FINDING 2 — âge d'une boucle zombie. Ambre calme, factuel, jamais
                    rouge, jamais un décompte (§31.2). Statut aussi en texte (pas
                    color-only) : le libellé « ouvert depuis N j » porte l'info. */}
                {stale ? (
                  <p className="t-foot font-medium text-[var(--warn)] tabular-nums">
                    Ouvert depuis {ageDays(obj.createdAt, now)} j
                  </p>
                ) : null}
                {/* FINDING 4 — relance. Un seul contrôle discret, aucun autre. */}
                {canReinforce ? (
                  <div className="mt-1.5">
                    <ReinforceObjectiveButton memberId={memberId} objectiveId={obj.id} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
