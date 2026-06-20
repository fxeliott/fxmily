import { ArrowLeft, CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MeetingItem } from '@/components/reunions/meeting-item';
import { listMeetingsForMember } from '@/lib/meeting/service';
import { MEETING_WINDOW_DAYS } from '@/lib/meeting/window';

export const metadata = {
  title: 'Réunions',
};

export const dynamic = 'force-dynamic';

/**
 * V1.7 §30 J-M2 — `/reunions` member landing.
 *
 * Server Component, DS-v2 NEUTRAL/lime (never `.v18-theme`, never cyan §21.7).
 * Auth-gated `status === 'active'`. Lists the member's meetings over the
 * rolling 30d window (scheduled + cancelled-greyed) with their attendance
 * state + a neutral, honest attendance rate.
 *
 * Posture §2 / anti Black-Hat (SPEC §30.7): the tone is neutral, NEVER red;
 * "en attente" reads as rattrapable, never "absent honteux"; an empty window
 * shows a pedagogical state, NEVER a fake "0 %".
 */
export default async function ReunionsPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { meetings, rate } = await listMeetingsForMember(session.user.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Réunions Fxmily · Présence
          </span>
          <h1
            id="reunions-heading"
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Tes réunions
          </h1>
          <p className="t-cap text-[var(--t-3)]">
            Déclare ta présence — en live ou en rediffusion — et que tu as lu l&apos;analyse (12h)
            ou le bilan (20h). Tu peux rattraper une réunion dans les {MEETING_WINDOW_DAYS} jours.
          </p>
        </div>
      </header>

      {/* Attendance rate — neutral, honest. Never a fake "0 %". */}
      <section
        aria-labelledby="reunions-rate-heading"
        className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
      >
        <h2 id="reunions-rate-heading" className="t-eyebrow-lg text-[var(--t-3)]">
          Ton assiduité · {MEETING_WINDOW_DAYS} derniers jours
        </h2>
        {rate.kind === 'ok' ? (
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="f-display text-[32px] leading-none font-bold text-[var(--acc)]">
              {Math.round(rate.rate * 100)}
              <span className="text-[var(--t-3)]"> %</span>
            </span>
            <span className="t-cap text-[var(--t-3)]">
              {rate.completedCount} / {rate.scheduledCount} réunion
              {rate.scheduledCount > 1 ? 's' : ''} complète{rate.scheduledCount > 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <p className="t-cap mt-1.5 text-[var(--t-3)]">
            Aucune réunion sur les {MEETING_WINDOW_DAYS} derniers jours pour l&apos;instant. Dès
            qu&apos;une réunion aura eu lieu, tu pourras déclarer ta présence ici.
          </p>
        )}
      </section>

      {/* Meeting list — newest first. */}
      <section aria-labelledby="reunions-list-heading" className="flex flex-col gap-3">
        <h2 id="reunions-list-heading" className="sr-only">
          Liste des réunions
        </h2>
        {meetings.length === 0 ? (
          <div className="rounded-card border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] p-6 text-center">
            <p className="t-body text-[var(--t-2)]">Pas encore de réunion à déclarer.</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">
              Les réunions Fxmily ont lieu du lundi au vendredi, à 12h et 20h. Elles apparaîtront
              ici une fois passées.
            </p>
          </div>
        ) : (
          meetings.map((meeting) => <MeetingItem key={meeting.id} meeting={meeting} />)
        )}
      </section>
    </main>
  );
}
