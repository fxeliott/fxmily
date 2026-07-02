import { Check, ImageIcon, Minus, ScanSearch, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import type { TrackRecordTimelineItem } from '@/lib/trades/track-record-timeline';
import { cn } from '@/lib/utils';

/**
 * S4 §33 (enrichissement #1) — la frise chronologique du track record.
 *
 * Une rangée de nœuds (un par trade clôturé, du plus ancien au plus récent,
 * scrollable au doigt) qui réunit ce qui vivait dans trois surfaces séparées :
 * R réalisé (track record), respect du plan + photo (fiche détail, atteinte par
 * le lien), et écart de vérité S3. Le membre voit ses SÉRIES d'un coup d'œil.
 *
 * Posture §2 : descriptif, aucune lecture de marché. §33.2 : l'écart est un
 * repère CALME (cyan), jamais rouge. Le R garde la sémantique P&L établie
 * (vert gain / rouge perte) comme partout ailleurs sur le track record. Le
 * « plan non tenu » est ambre (process), jamais rouge punitif (§31.2).
 */

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
});

function nodeLabel(item: TrackRecordTimelineItem): string {
  const r =
    item.realizedR === null
      ? 'R non chiffré'
      : `${item.realizedR > 0 ? 'plus' : item.realizedR < 0 ? 'moins' : ''} ${Math.abs(
          item.realizedR,
        ).toFixed(1)} R réalisé`.trim();
  return [
    `Trade ${item.pair} ${item.direction === 'long' ? 'long' : 'short'} clôturé le ${DATE_FMT.format(item.date)}`,
    r,
    item.planRespected === null ? null : item.planRespected ? 'plan tenu' : 'plan non tenu',
    item.hasDiscrepancy ? 'écart de vérité associé' : null,
    item.hasPhoto ? 'photo d’analyse jointe' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function TrackRecordTimeline({ items }: { items: readonly TrackRecordTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <p className="t-body max-w-prose text-[var(--t-3)]">
        Ta frise apparaît dès ton premier trade clôturé, chaque trade y reliera sa photo
        d&apos;analyse, ton respect du plan et l&apos;écart de vérité associé.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Légende (use-of-color WCAG 1.4.1 : forme + couleur, jamais couleur seule). */}
      <ul className="t-cap flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--t-4)]">
        <li className="inline-flex items-center gap-1">
          <Check className="h-3 w-3 text-[var(--ok)]" strokeWidth={2.25} aria-hidden />
          plan tenu
        </li>
        <li className="inline-flex items-center gap-1">
          <Minus className="h-3 w-3 text-[var(--warn)]" strokeWidth={2.25} aria-hidden />
          plan non tenu
        </li>
        <li className="inline-flex items-center gap-1">
          <ScanSearch className="h-3 w-3 text-[var(--cy)]" strokeWidth={2} aria-hidden />
          écart
        </li>
        <li className="inline-flex items-center gap-1">
          <ImageIcon className="h-3 w-3 text-[var(--t-3)]" strokeWidth={2} aria-hidden />
          photo
        </li>
      </ul>

      <ul className="flex snap-x [scrollbar-width:thin] gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const r = item.realizedR;
          const win = r !== null && r > 0;
          const loss = r !== null && r < 0;
          return (
            <li key={item.id} className="shrink-0 snap-start">
              <Link
                href={`/journal/${item.id}`}
                aria-label={nodeLabel(item)}
                className="wow-hover-glow rounded-card flex min-w-[116px] flex-col gap-1.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-2.5 transition-colors hover:border-[var(--b-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                <span aria-hidden className="t-cap text-[var(--t-4)]">
                  {DATE_FMT.format(item.date)}
                </span>
                <span
                  aria-hidden
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--t-2)]"
                >
                  {item.direction === 'long' ? (
                    <TrendingUp className="h-3 w-3 text-[var(--ok)]" strokeWidth={2} />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-[var(--bad)]" strokeWidth={2} />
                  )}
                  {item.pair}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'f-mono text-[18px] leading-none font-bold tabular-nums',
                    win ? 'text-[var(--ok)]' : loss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]',
                  )}
                >
                  {r === null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(1)}R`}
                  {item.realizedREstimated && r !== null ? (
                    <span className="text-[10px] font-normal text-[var(--t-4)]"> est.</span>
                  ) : null}
                </span>
                <div aria-hidden className="flex items-center gap-1.5 pt-0.5">
                  {item.planRespected === false ? (
                    <Minus className="h-3.5 w-3.5 text-[var(--warn)]" strokeWidth={2.25} />
                  ) : item.planRespected ? (
                    <Check className="h-3.5 w-3.5 text-[var(--ok)]" strokeWidth={2.25} />
                  ) : null}
                  {item.hasDiscrepancy ? (
                    <ScanSearch className="h-3.5 w-3.5 text-[var(--cy)]" strokeWidth={2} />
                  ) : null}
                  {item.hasPhoto ? (
                    <ImageIcon className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={2} />
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
