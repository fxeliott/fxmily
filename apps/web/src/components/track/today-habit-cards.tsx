import { Brain, Coffee, Dumbbell, Moon, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { localDateOf } from '@/lib/checkin/timezone';
import { listRecentHabitLogs } from '@/lib/habit/service';
import type { HabitKind } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

/**
 * V2.1 TRACK — "Aujourd'hui" status grid (5 cards, 1 per kind).
 *
 * Server Component — fetches the member's logs from the last 1 day at render
 * time, derives per-kind logged status, renders the 5 cards. As of V2.1.1
 * every kind links to its wizard.
 *
 * Mark Douglas posture (anti Black-Hat) :
 *   - No "0/5 piliers" counter
 *   - No red on un-logged kinds
 *   - Subtle lime check pill on logged kinds (positive reinforcement, no FOMO)
 *   - Calm slate on pending kinds (no shame loop)
 */

interface PillarMeta {
  kind: HabitKind;
  label: string;
  Icon: LucideIcon;
  /** One-line pedagogical hint shown under the title — Mark Douglas-aligned. */
  hint: string;
  href: string;
}

const PILLARS: PillarMeta[] = [
  {
    kind: 'sleep',
    label: 'Sommeil',
    Icon: Moon,
    hint: 'Ta clarté cognitive culmine entre 6,5 et 9 h.',
    href: '/track/sleep/new',
  },
  {
    kind: 'nutrition',
    label: 'Nutrition',
    Icon: UtensilsCrossed,
    hint: 'Des repas réguliers stabilisent ta glycémie.',
    href: '/track/nutrition/new',
  },
  {
    kind: 'caffeine',
    label: 'Café',
    Icon: Coffee,
    hint: 'Demi-vie ~6 h — coupe avant le coucher.',
    href: '/track/caffeine/new',
  },
  {
    kind: 'sport',
    label: 'Sport',
    Icon: Dumbbell,
    hint: 'ACSM : 150 min/sem régulent ton humeur.',
    href: '/track/sport/new',
  },
  {
    kind: 'meditation',
    label: 'Méditation',
    Icon: Brain,
    hint: 'Hofmann 2010 : 10 min/jour suffisent.',
    href: '/track/meditation/new',
  },
];

interface TodayHabitCardsProps {
  userId: string;
  /** IANA timezone of the member (session.user.timezone, Europe/Paris default). */
  timezone: string;
  /**
   * S19 — optional precomputed "logged today" set. When the parent page already
   * derived it (to also feed `TrackHero`), pass it here to skip a duplicate
   * `listRecentHabitLogs` query. Falls back to its own fetch when omitted
   * (backward-compatible).
   */
  loggedKinds?: ReadonlySet<HabitKind>;
}

export async function TodayHabitCards({
  userId,
  timezone,
  loggedKinds: precomputed,
}: TodayHabitCardsProps) {
  // TIER2 fix (S2 audit 2026-06-11, review pass) : this is an async SERVER
  // component — local getters here would be the SERVER's day (UTC in prod),
  // diverging from the client habit wizards (fixed to the member's local day).
  // `localDateOf` resolves "today" in the MEMBER's timezone server-side — the
  // canon pattern of `lib/schemas/habit-log.ts` / daily-guidance.
  const today = localDateOf(new Date(), timezone);
  const loggedKinds =
    precomputed ??
    new Set<HabitKind>(
      (await listRecentHabitLogs(userId, 1))
        .filter((log) => log.date === today)
        .map((log) => log.kind),
    );

  return (
    <section aria-labelledby="today-habits-heading" className="space-y-3">
      <header className="flex items-baseline justify-between gap-4">
        <h2 id="today-habits-heading" className="t-eyebrow-lg text-[var(--t-3)]">
          Aujourd&apos;hui
        </h2>
        <span className="font-mono text-[11px] text-[var(--t-3)] tabular-nums">{today}</span>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p) => {
          const isLogged = loggedKinds.has(p.kind);
          return (
            <Link
              key={p.kind}
              href={p.href}
              className="rounded-card block outline-none focus-visible:outline-none"
              aria-label={
                isLogged
                  ? `${p.label} : logué aujourd'hui. Modifier.`
                  : `Logger ${p.label.toLowerCase()} aujourd'hui.`
              }
            >
              <Card className="wow-hover-glow group relative flex h-full flex-col gap-2 p-3.5 transition-colors focus-within:ring-2 focus-within:ring-[var(--acc)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg)] hover:bg-[var(--bg-3)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p.Icon
                      className={cn(
                        'h-5 w-5 shrink-0',
                        isLogged ? 'text-[var(--acc)]' : 'text-[var(--t-2)]',
                      )}
                      aria-hidden
                    />
                    <span className="text-[14px] font-semibold text-[var(--t-1)]">{p.label}</span>
                  </div>
                  {isLogged ? <Pill tone="acc">Logué</Pill> : null}
                </div>
                <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{p.hint}</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
