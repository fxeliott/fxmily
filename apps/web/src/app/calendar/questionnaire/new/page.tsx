import { ArrowLeft, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  CalendarQuestionnaireWizard,
  type CalendarQuestionnairePrefill,
} from '@/components/calendar/calendar-questionnaire-wizard';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { getQuestionnaireForUser } from '@/lib/calendar/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/calendar/week';

export const metadata = {
  title: 'Organise ta semaine',
};

export const dynamic = 'force-dynamic';

/**
 * §26 Calendrier adaptatif — `/calendar/questionnaire/new` (J-C3).
 *
 * Server Component, DS-v2 NEUTRAL. The closed weekly-schedule instrument
 * (frozen, versioned). Re-submitting an already-filled week upserts (prefill →
 * edit). `weekStart` is server-derived (Europe/Paris) — the wizard never
 * computes it client-side (anti-flake PR#96). Posture §2: organises the
 * member's TIME of practice, never the market.
 */
export default async function NewCalendarQuestionnairePage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const weekStart = currentParisWeekStart();
  const existing = await getQuestionnaireForUser(session.user.id, weekStart);

  const weekRange = formatWeekRangeFr(weekStart);
  const prefill: CalendarQuestionnairePrefill | undefined = existing
    ? { instrumentVersion: existing.instrumentVersion, responses: existing.responses }
    : undefined;

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the glass wizard */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
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
              <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
              Calendrier · Organisation de la semaine
            </span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {existing ? 'Mets à jour ton organisation' : 'Organise ta semaine'}
            </h1>
            <p className="t-cap text-[var(--t-3)]">Semaine du {weekRange}</p>
          </div>
          <DrawnRule className="max-w-[220px]" />
        </header>

        <CalendarQuestionnaireWizard weekStart={weekStart} {...(prefill ? { prefill } : {})} />
      </div>
    </main>
  );
}
