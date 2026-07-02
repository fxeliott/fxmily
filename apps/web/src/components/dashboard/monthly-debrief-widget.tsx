import { ArrowRight, BookOpenText } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import { formatMonthLabelFr, formatMonthInlineFr } from '@/lib/monthly-debrief/format';
import { getLatestUnreadMonthlyDebrief } from '@/lib/monthly-debrief/service';

/**
 * §25/§30 — dashboard nudge toward a FRESH monthly debrief (S6 audit).
 *
 * Server Component. The monthly debrief is an AI synthesis the member only
 * reads (`/debrief-mensuel`); push + email announce it, but those are transient.
 * This calm in-app card guides the member to read their latest UNREAD debrief —
 * "rapports délivrés guidés, sans friction" (§30). It surfaces ONLY when an
 * unread debrief exists and goes silent once opened (the page stamps `seenAt`).
 *
 * Anti-Black-Hat (§25.2): a quiet acknowledgement, never a streak / score /
 * countdown / "en retard". Renders `null` when there is nothing to read, so the
 * hub stays calm. DS-v2 NEUTRAL/lime, never `.v18-theme`.
 */
export async function MonthlyDebriefWidget({ userId }: { userId: string }) {
  const debrief = await getLatestUnreadMonthlyDebrief(userId);
  // Nothing unread → render NOTHING (no section, no heading, no margin) so the
  // hub stays calm and screen readers get no orphan heading.
  if (debrief === null) return null;

  return (
    <section className="mb-6" aria-labelledby="monthly-debrief-widget-heading">
      <h2 id="monthly-debrief-widget-heading" className="sr-only">
        Débrief mensuel
      </h2>
      <HoverLift className="block">
        <Link
          href={`/debrief-mensuel?id=${debrief.id}`}
          data-slot="monthly-debrief-widget"
          className="rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
              <BookOpenText className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-eyebrow text-[var(--acc-hi)]">
                Débrief mensuel · {formatMonthLabelFr(debrief.monthStart)}
              </span>
              <h3 className="text-[15px] font-semibold text-[var(--t-1)]">
                Ton débrief de {formatMonthInlineFr(debrief.monthStart)} est prêt
              </h3>
              <p className="text-[12px] leading-relaxed text-[var(--t-2)]">
                Une synthèse calme de ton mois : progression et exécution, pour prendre du recul.
                Pas d&apos;analyse de marché.
              </p>
            </div>
            <span
              className="rounded-control mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 px-2.5 text-[12px] font-semibold text-[var(--acc-hi)]"
              aria-hidden="true"
            >
              Lire
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </div>
        </Link>
      </HoverLift>
    </section>
  );
}
