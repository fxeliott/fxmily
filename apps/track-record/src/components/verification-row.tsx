import { CheckCircle2, Clock, Users, FileText } from 'lucide-react';

interface VerificationItem {
  Icon: typeof CheckCircle2;
  label: string;
  detail: string;
}

/**
 * 4 piliers de preuve (Researcher institutional patterns 2026-05-22) :
 *   1. Annoncés en direct AVANT exécution
 *   2. Horodatés serveur Discord (UTC) — immuables
 *   3. Témoins humains présents en réunion live
 *   4. Débrief quotidien public + archive consultable
 */
const ITEMS: readonly VerificationItem[] = [
  {
    Icon: CheckCircle2,
    label: 'Annoncés en direct',
    detail: 'Setups partagés AVANT exécution en réunion d’analyse',
  },
  {
    Icon: Clock,
    label: 'Horodatés serveur',
    detail: 'Timestamp Discord (UTC) immuable — pas de fenêtre post hoc',
  },
  {
    Icon: Users,
    label: 'Témoins humains',
    detail: 'Membres présents en réunion live attestent l’entrée/sortie',
  },
  {
    Icon: FileText,
    label: 'Archive consultable',
    detail: 'Débrief public le soir-même · journal historique préservé',
  },
];

/**
 * Trust-signal row institutionnelle. 4 icônes lucide + label court + détail
 * permanent visible (PAS de popover — institutional density, mobile-safe,
 * zéro dep shadcn). Pattern Mercury "Verified row" / Myfxbook badge anatomy
 * adapté au cas Eliot (signal partagé live, pas broker API).
 *
 * Couleur tone : `--tr-verified` (vert sourcé `gain` token), JAMAIS inventer
 * une nouvelle nuance.
 *
 * Source : ui-designer audit + researcher institutional patterns 2026-05-22
 * (3 piliers de preuve verbalisés selon pattern A1 Trading "live broker
 * login" transposé pour le case Discord live-shared).
 */
export function VerificationRow() {
  return (
    <ul
      role="list"
      aria-label="Méthode de vérification du track record"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3"
    >
      {ITEMS.map((it) => {
        const Icon = it.Icon;
        return (
          <li
            key={it.label}
            role="listitem"
            className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
            style={{
              background: 'var(--tr-verified-bg)',
              borderColor: 'var(--tr-verified-border)',
            }}
          >
            <Icon
              className="h-4 w-4 shrink-0 translate-y-[1px]"
              style={{ color: 'var(--tr-verified)' }}
              aria-hidden
            />
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[12px] leading-none font-semibold tracking-tight"
                style={{ color: 'var(--tr-verified)' }}
              >
                {it.label}
              </span>
              <span className="text-[11px] leading-tight text-[var(--tr-t-3)]">{it.detail}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
