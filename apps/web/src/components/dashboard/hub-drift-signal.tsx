import { ArrowRight, Compass } from 'lucide-react';
import Link from 'next/link';

import type { AlertView } from '@/lib/verification/alerts';

/**
 * S4 §32/§33 — « alertes immédiates en cas de dérive — visibles, sans délai, sans
 * qu'il ait à les chercher ».
 *
 * The drift-alert FEED lives on `/verification`, and the coaching card it
 * triggers lands in the Douglas inbox — but the member's LANDING point (the hub)
 * carried no explicit drift signal, so an active pattern was something he had to
 * go look for. This compact strip closes that gap: a calm, one-line heads-up at
 * the top of the hub that deep-links to the full feed.
 *
 * Posture §33.2 (BLOQUANT) : amber « attention », JAMAIS de rouge punitif, jamais
 * « violation » — le vocabulaire reste celui du miroir (« un schéma s'est répété,
 * une fiche t'attend pour le travailler »). §31.2 : ambre, pas rouge.
 *
 * Read-only, presentational. Renders `null` when there is no ACTIVE alert
 * (dismissed alerts are settled — never resurfaced). 0 query of its own : the
 * page passes the same `listRecentAlertsForMember` feed the /verification page reads.
 */
export function HubDriftSignal({
  alerts,
  className,
}: {
  alerts: readonly AlertView[];
  className?: string;
}) {
  // Settled (dismissed) alerts are done — only open/delivered patterns are live.
  const active = alerts.filter((a) => a.status !== 'dismissed');
  if (active.length === 0) return null;

  // Feed is desc by createdAt → the first is the most recent.
  const latest = active[0]!;
  const headline =
    active.length === 1 ? latest.label : `${active.length} schémas se répètent en ce moment`;

  return (
    <Link
      href="/verification"
      data-slot="hub-drift-signal"
      aria-label="Voir tes alertes de dérive dans la vérification"
      className={[
        'rounded-card group flex items-center gap-3.5 border border-[var(--warn-edge)] bg-[var(--warn-dim)] p-4 transition-colors hover:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--warn-edge)] bg-[var(--bg-1)] text-[var(--warn)]">
        <Compass className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-eyebrow text-[var(--warn)]" data-warn-text="">
          Signal de dérive
        </span>
        <p className="t-body leading-snug text-[var(--t-2)]">
          <span className="font-medium text-[var(--t-1)]">{headline}</span>, une fiche pour le
          travailler t&apos;attend, calmement.
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
