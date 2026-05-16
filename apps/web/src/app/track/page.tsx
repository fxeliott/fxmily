import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  HabitCorrelationSection,
  HabitCorrelationSkeleton,
} from '@/components/track/habit-correlation-section';
import { HabitKindPicker } from '@/components/track/habit-kind-picker';
import { TodayHabitCards } from '@/components/track/today-habit-cards';
import { TrackHero } from '@/components/track/track-hero';
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
  searchParams: Promise<{ done?: string; kind?: string }>;
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

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 outline-none"
    >
      <header className="space-y-2">
        <p className="text-[12px] font-medium tracking-[0.10em] text-[var(--acc)] uppercase">
          Suivi des habitudes
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--t-1)] sm:text-[32px]">
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

      <TrackHero />

      <TodayHabitCards userId={session.user.id} />

      <Suspense fallback={<HabitCorrelationSkeleton />}>
        <HabitCorrelationSection
          userId={session.user.id}
          timezone={session.user.timezone || 'Europe/Paris'}
        />
      </Suspense>

      <HabitKindPicker />
    </main>
  );
}
