import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { countUnseenDeliveries, listMyDeliveries } from '@/lib/cards/service';

/**
 * Dashboard widget — surfaces the Mark Douglas library and any recent
 * contextual deliveries directly on `/dashboard` (J7.7 polish).
 *
 * Why : the library and the deliveries are the most actionable surfaces
 * for daily engagement, but they were only reachable via the navbar. This
 * widget closes the gap with a 3-row preview + counters + 1 CTA.
 *
 * Layout :
 *   - Header strip with Pill counter ("X non lue") + Sparkles icon
 *   - Top 3 most recent deliveries OR the encouragement empty state
 *   - Footer link to `/library` (if no deliveries) or `/library/inbox`
 *
 * Pure Server Component — no client island. Counters come from indexed
 * queries (`countUnseenDeliveries` + `listMyDeliveries({ take: 3 })`).
 */

interface DouglasInboxWidgetProps {
  userId: string;
}

const DT_REL = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export async function DouglasInboxWidget({ userId }: DouglasInboxWidgetProps) {
  const [unseenCount, recent] = await Promise.all([
    countUnseenDeliveries(userId),
    listMyDeliveries(userId, { take: 3 }),
  ]);

  return (
    <Card className="p-5" aria-labelledby="douglas-widget-title">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--acc-dim)] text-[var(--acc)]"
            aria-hidden
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <h3 id="douglas-widget-title" className="t-h3">
            Mark Douglas
          </h3>
          {unseenCount > 0 && (
            <Pill tone="acc" dot="live" className="ml-1">
              {unseenCount} non&nbsp;lue{unseenCount > 1 ? 's' : ''}
            </Pill>
          )}
        </div>
      </header>

      {recent.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="t-body text-[var(--t-3)]">
            Aucune fiche poussée pour l&apos;instant. Continue ton process — le coaching arrive
            quand le système détecte un pattern (3 pertes, FOMO, etc.).
          </p>
          <Link
            href="/library"
            className="rounded-pill inline-flex h-9 w-fit items-center gap-1.5 border border-[var(--b-default)] px-3 text-xs font-medium text-[var(--t-2)] transition-all hover:border-[var(--b-acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            Parcourir la bibliothèque
            <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {recent.map((d) => {
            const Icon = CATEGORY_ICON[d.cardCategory];
            const tone = CATEGORY_TONE[d.cardCategory];
            const unread = !d.seenAt;
            return (
              <li key={d.id}>
                <Link
                  href={`/library/${d.cardSlug}`}
                  className="rounded-control group flex items-start gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-3 transition-colors hover:border-[var(--b-acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                >
                  <span
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--acc-dim)] text-[var(--acc)]"
                    aria-hidden
                  >
                    <Icon className="h-3 w-3" strokeWidth={1.75} />
                  </span>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={tone}>{CATEGORY_LABEL[d.cardCategory]}</Pill>
                      {unread && (
                        <Pill tone="acc" dot="live" aria-label="Fiche non lue">
                          Non&nbsp;lue
                        </Pill>
                      )}
                    </div>
                    <p className="t-body leading-snug font-medium text-[var(--t-1)] transition-colors group-hover:text-[var(--acc)]">
                      {d.cardTitle}
                    </p>
                    <p className="t-foot text-[var(--t-3)]">
                      {DT_REL.format(new Date(d.createdAt))} · {d.triggeredBy}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/library/inbox"
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--t-2)] transition-colors hover:text-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <Sparkles className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              Voir toutes mes fiches
              <ArrowRight className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        </ul>
      )}
    </Card>
  );
}
