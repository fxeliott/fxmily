import { ArrowRight, NotebookPen } from 'lucide-react';
import Link from 'next/link';

import type { StaleOpenTradesSummary } from '@/lib/trades/service';

/**
 * Tour 13 — rappel doux « un trade attend sa clôture ».
 *
 * Un trade jamais clôturé garde `exitReason` / `planRespected` à null : il
 * disparaît du score comportemental EN SILENCE et le journal cesse de refléter
 * la réalité du membre. Un signal côté coach est ajouté ailleurs ; ceci est le
 * rappel CÔTÉ MEMBRE, à son point d'entrée.
 *
 * Posture §2 (BLOQUANT) : orienté PROCESS, jamais punitif ni culpabilisant. Ce
 * n'est PAS un signal de dérive (celui-là est ambre) et surtout PAS un outcome
 * (jamais de rouge) : c'est une invitation calme à garder le journal fidèle.
 * La palette est donc le bleu de process (--acc), pas l'ambre d'alerte.
 *
 * Read-only, présentationnel. Rend `null` quand aucun trade ouvert ne dépasse
 * le seuil (le service renvoie alors `count: 0`) — jamais une carte vide.
 * Deep-link vers le trade concerné s'il est seul, sinon vers le journal filtré
 * sur les trades ouverts.
 */
export function OpenTradesReminder({
  summary,
  className,
}: {
  summary: StaleOpenTradesSummary;
  className?: string;
}) {
  if (summary.count === 0) return null;

  // Seul trade concerné → lien direct vers sa fiche ; plusieurs → journal des
  // trades en cours (un vrai lien dans les deux cas, jamais un bouton factice).
  const href =
    summary.count === 1 && summary.oldestTradeId
      ? `/journal/${summary.oldestTradeId}`
      : '/journal?status=open';

  const headline =
    summary.count === 1
      ? 'Un trade est encore ouvert depuis quelques jours'
      : `${summary.count} trades sont encore ouverts depuis quelques jours`;

  return (
    <Link
      href={href}
      data-slot="open-trades-reminder"
      aria-label={
        summary.count === 1
          ? 'Clôturer ton trade encore ouvert dans le journal'
          : 'Clôturer tes trades encore ouverts dans le journal'
      }
      className={[
        'rounded-card group flex items-center gap-3.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 transition-colors hover:border-[var(--b-acc-strong)] hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)] text-[var(--acc-hi)]">
        <NotebookPen className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-eyebrow text-[var(--acc-hi)]">Ton journal</span>
        <p className="t-body leading-snug text-[var(--t-2)]">
          <span className="font-medium text-[var(--t-1)]">{headline}</span>. Le clôturer garde ton
          journal fidèle à ta réalité.
        </p>
      </div>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-[var(--t-3)] transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.75}
        aria-hidden
      />
    </Link>
  );
}
