import { ArrowLeft, ArrowRight, Check, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { FirstCheckinCelebration } from '@/components/checkin/first-checkin-celebration';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { StreakCard } from '@/components/checkin/streak-card';
import { TrendCard } from '@/components/checkin/trend-card';
import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import { countCheckins, getCheckinStatus, getLast7Days, getStreak } from '@/lib/checkin/service';
import { crossedMilestone } from '@/lib/checkin/streak';
import { formatLocalDate } from '@/lib/checkin/timezone';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Check-in quotidien',
};

// Reads cookies (auth) + DB — must be dynamic so each member sees fresh state.
export const dynamic = 'force-dynamic';

interface CheckinLandingPageProps {
  searchParams: Promise<{ slot?: string; done?: string }>;
}

// S19.2 — local hour in the member's timezone, to gently surface the slot that
// fits the current moment (morning before 14h, evening after). `now = new Date()`
// default param keeps the Server Component pure for the react-hooks lint.
function currentHourIn(timezone: string, now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
}

export default async function CheckinLandingPage({ searchParams }: CheckinLandingPageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;
  // J5.5 — read timezone from the JWT-backed session (default Europe/Paris).
  const timezone = session.user.timezone || 'Europe/Paris';

  const [status, streak, last7] = await Promise.all([
    getCheckinStatus(userId, timezone),
    getStreak(userId, timezone),
    getLast7Days(userId, timezone),
  ]);

  // Slot qui correspond au moment présent (calme, jamais bloquant — les deux
  // restent cliquables ; le slot "maintenant" reçoit juste un liseré accent).
  const relevantSlot: 'morning' | 'evening' = currentHourIn(timezone) < 14 ? 'morning' : 'evening';

  const params = await searchParams;
  const justDone = params.done === '1';
  const justDoneSlot = params.slot === 'morning' || params.slot === 'evening' ? params.slot : null;

  // S9.1 "wave wow" — detect the member's VERY FIRST check-in to show a
  // one-time non-toxic celebration (Mark Douglas: name the action, no fanfare).
  // Only query the lifetime count when we actually just completed a check-in —
  // otherwise it's wasted work on every landing visit.
  const isFirstEver = justDone && justDoneSlot ? (await countCheckins(userId)) === 1 : false;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 — ambient mesh + drifting orbs behind the hub (tone blue défaut,
          comme dashboard/profile). Le hub 2×/jour mérite la même profondeur que
          ses propres enfants StreakCard/TrendCard. */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retour au tableau
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">{formatLocalDate(status.today)}</span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Check-in quotidien
            </h1>
            <p className="t-lead">
              Deux temps : matin pour cadrer, soir pour réfléchir. Trois minutes chacun. C&apos;est
              ce qui construit le score discipline.
            </p>
          </div>
        </header>

        {justDone && justDoneSlot ? (
          <>
            {/* DoneBanner is ALWAYS the confirmation status (role="status",
                "Check-in matin enregistré · streak N") — the J5 e2e asserts on it
                and assistive tech reads it. The first-ever celebration is an
                additive visual bonus ABOVE it, never a replacement. */}
            {isFirstEver ? <FirstCheckinCelebration slot={justDoneSlot} /> : null}
            <DoneBanner slot={justDoneSlot} streak={streak.current} />
          </>
        ) : null}

        <StreakCard
          streak={streak.current}
          todayFilled={streak.todayFilled}
          justCrossed={justDone ? crossedMilestone(streak.current) : null}
        />

        <TrendCard days={last7} />

        {/* dash-stagger : les 2 slots (matin/soir) arrivent en cascade — DIRECT
            children animés (compositor-only, reduced-motion neutralisé globalement). */}
        <section className="dash-stagger grid gap-4 sm:grid-cols-2">
          <SlotCard
            slot="morning"
            submitted={status.morningSubmitted}
            href="/checkin/morning"
            isNow={relevantSlot === 'morning'}
          />
          <SlotCard
            slot="evening"
            submitted={status.eveningSubmitted}
            href="/checkin/evening"
            isNow={relevantSlot === 'evening'}
          />
        </section>

        <section>
          <Card className="flex flex-col gap-2 p-5">
            <span className="t-eyebrow">Pourquoi deux fois par jour ?</span>
            <p className="t-body text-[var(--t-2)]">
              Le matin capture ton état physique et ton intention <em>avant</em> le marché. Le soir
              mesure ce qui s&apos;est passé : discipline, stress, émotions. Croisés sur 30 jours,
              ces deux signaux révèlent les patterns qui dégradent ton edge.
            </p>
            <p className="t-cap text-[var(--t-4)]">
              Tu peux passer un slot — mais le streak ne tient que si tu en fais au moins un par
              jour.
            </p>
          </Card>
        </section>
      </div>
    </main>
  );
}

function SlotCard({
  slot,
  submitted,
  href,
  isNow = false,
}: {
  slot: 'morning' | 'evening';
  submitted: boolean;
  href: '/checkin/morning' | '/checkin/evening';
  /** Slot fitting the current moment — gets a calm accent ring + "moment" cue. */
  isNow?: boolean;
}) {
  const isMorning = slot === 'morning';
  const Icon = isMorning ? Sun : Moon;
  const title = isMorning ? 'Matin' : 'Soir';
  const sub = isMorning ? 'Sommeil · routine · intention' : 'Discipline · stress · journal';
  // The accent ring fires only when this slot is BOTH the current moment AND not
  // yet done — never a pressure cue once filled (anti-Black-Hat §31.2).
  const highlightNow = isNow && !submitted;

  return (
    <HoverLift className="block">
      <Link href={href} className="block">
        <Card
          interactive
          className={cn(
            'relative flex flex-col gap-3 p-5 transition-colors',
            submitted
              ? 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]'
              : highlightNow && 'ring-1 ring-[var(--b-acc-strong)] ring-inset',
          )}
        >
          <div className="flex items-start justify-between">
            <div className="rounded-control grid h-10 w-10 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            {submitted ? (
              <Pill tone="acc" dot>
                FAIT
              </Pill>
            ) : (
              <Pill tone={highlightNow ? 'acc' : 'cy'}>À FAIRE</Pill>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="t-h3 text-[var(--t-1)]">{title}</h3>
            <p className="t-cap text-[var(--t-3)]">{sub}</p>
          </div>
          <div className="mt-1 flex items-center justify-between text-[12px] text-[var(--t-3)]">
            <span className={cn(highlightNow && 'font-medium text-[var(--acc-hi)]')}>
              {submitted
                ? 'Voir / éditer'
                : highlightNow
                  ? 'C’est le moment · ~3 min'
                  : '~3 minutes'}
            </span>
            {submitted ? (
              <Check className="h-4 w-4 text-[var(--acc)]" strokeWidth={2} />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </div>
        </Card>
      </Link>
    </HoverLift>
  );
}

function DoneBanner({ slot, streak }: { slot: 'morning' | 'evening'; streak: number }) {
  const word = slot === 'morning' ? 'matin' : 'soir';
  // Fixed broken sentence ("À ce soir pour le matin (demain) check-in.") flagged
  // by the J5 content audit. Now grammatically clean and slot-aware.
  const followUp = slot === 'morning' ? 'On se retrouve ce soir.' : 'On se retrouve demain matin.';
  return (
    <div
      role="status"
      className="confirm-flash rounded-card border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="flex flex-1 flex-col leading-tight">
          <span className="text-[13px] font-semibold text-[var(--t-1)]">
            Check-in {word} enregistré · streak {streak} jour{streak > 1 ? 's' : ''}
          </span>
          <span className="t-cap text-[var(--t-3)]">{followUp}</span>
        </div>
      </div>
    </div>
  );
}
