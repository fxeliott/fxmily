import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import {
  HabitCorrelationSection,
  HabitCorrelationSkeleton,
} from '@/components/track/habit-correlation-section';
import { HabitKindPicker } from '@/components/track/habit-kind-picker';
import { HabitKindTabPicker } from '@/components/track/habit-kind-tab-picker';
import { TodayHabitCards } from '@/components/track/today-habit-cards';
import { TrackHero } from '@/components/track/track-hero';
import { localDateOf } from '@/lib/checkin/timezone';
import { listRecentHabitLogs } from '@/lib/habit/service';
import { type HabitKind, habitKindSchema } from '@/lib/schemas/habit-log';
import { auth } from '@/auth';

/**
 * V2.1 TRACK — landing page route.
 *
 * Server Component. Forces dynamic since `auth()` reads cookies (Next.js 16
 * inferred `force-dynamic`). Composes :
 *   - `<TrackHero>` SVG pentagon "5 piliers" (Client Component for Framer)
 *   - `<TodayHabitCards>` async Server Component (fetches today's logs)
 *   - `<HabitKindPicker>` Server Component navigation grid
 *
 * Auth gate :
 *   - Not logged in → /login
 *   - status !== 'active' → /login (status guard already enforced globally
 *     by `auth.config.ts authorized()` V1.12 P3 — defense-in-depth here)
 *
 * `?done=1&kind=sleep` query — surfaces a calm confirmation banner post
 * submit (Server-Action redirected here). Mark Douglas posture : no
 * confetti, no streak counter — "Ta pratique du sommeil est dans le
 * miroir" (M4 metaphor extension V1.8 carbone).
 */

export const dynamic = 'force-dynamic';

interface TrackPageProps {
  searchParams: Promise<{ done?: string; kind?: string; corr?: string }>;
}

const KIND_LABELS_FR: Record<string, string> = {
  sleep: 'Sommeil',
  nutrition: 'Nutrition',
  caffeine: 'Café',
  sport: 'Sport',
  meditation: 'Méditation',
};

export default async function TrackPage({ searchParams }: TrackPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const sp = await searchParams;
  const justLogged = sp.done === '1' && sp.kind && KIND_LABELS_FR[sp.kind];
  const corrParsed = habitKindSchema.safeParse(sp.corr);
  const corrKind = corrParsed.success ? corrParsed.data : 'sleep';

  // S19 — compute "logged today" ONCE here (was only computed inside
  // TodayHabitCards, so TrackHero's `loggedToday` halo was never fed → the
  // pentagon "completed" styling was dead code, finding #1a). Same source +
  // member-timezone day as TodayHabitCards; shared with it to avoid a double
  // fetch. `listRecentHabitLogs(_, 1)` = 1-day window, tiny indexed query.
  const timezone = session.user.timezone || 'Europe/Paris';
  const today = localDateOf(new Date(), timezone);
  const loggedToday = new Set<HabitKind>(
    (await listRecentHabitLogs(session.user.id, 1))
      .filter((log) => log.date === today)
      .map((log) => log.kind),
  );

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the masthead */}
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
        <header className="space-y-2">
          <p className="t-eyebrow-lg text-[var(--acc)]">Suivi des habitudes</p>
          <h1
            className="f-display h-rise text-[28px] font-semibold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Tes 5 piliers de pratique
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--t-2)]">
            Loguer ces piliers révèle les conditions biologiques qui alimentent ton exécution. Aucun
            jugement, aucun comparatif — juste le miroir de ta pratique quotidienne.
          </p>
        </header>

        {justLogged ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-input border border-[var(--b-acc)] bg-[var(--acc-dim)] px-4 py-3 text-[13px] text-[var(--t-1)]"
          >
            <strong className="font-semibold">{KIND_LABELS_FR[sp.kind as string]} loggué.</strong>{' '}
            C&apos;est dans le miroir. Reviens demain.
          </div>
        ) : null}

        <div className="wow-reveal">
          <TrackHero loggedToday={loggedToday} />
        </div>

        <div className="wow-reveal">
          <TodayHabitCards userId={session.user.id} timezone={timezone} loggedKinds={loggedToday} />
        </div>

        <section aria-labelledby="track-corr-heading" className="wow-reveal flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span id="track-corr-heading" className="t-eyebrow">
              Corrélations habitudes × trading
            </span>
          </div>
          <HabitKindTabPicker
            selected={corrKind}
            labelId="track-corr-heading"
            pathname="/track"
            preservedQuery=""
          />
          <Suspense key={corrKind} fallback={<HabitCorrelationSkeleton />}>
            <HabitCorrelationSection
              userId={session.user.id}
              timezone={session.user.timezone || 'Europe/Paris'}
              habitKind={corrKind}
            />
          </Suspense>
        </section>

        <HabitKindPicker />
      </div>
    </main>
  );
}
