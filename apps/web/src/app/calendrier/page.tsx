import { ArrowLeft, ArrowRight, CalendarClock, CalendarRange, Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { CalendarOverview } from '@/components/calendar/calendar-overview';
import { CalendarWarnings } from '@/components/calendar/calendar-warnings';
import { CalendarWeekView } from '@/components/calendar/calendar-week-view';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { logAudit } from '@/lib/auth/audit';
import { modelDisplay } from '@/lib/calendar/format';
import {
  getCalendarForUser,
  getQuestionnaireForUser,
  markAdaptiveCalendarDisclosureShown,
} from '@/lib/calendar/service';
import { currentParisWeekStart } from '@/lib/calendar/week';

export const metadata = {
  title: 'Mon calendrier · Fxmily',
};

export const dynamic = 'force-dynamic';

/**
 * §26 Calendrier adaptatif — member-facing weekly calendar (J-C4, LAST of 4).
 *
 * Server Component. Auth gate carbone `/debrief-mensuel` (status active). The
 * week is SERVER-authoritative (`currentParisWeekStart()`) — never a client
 * instant (anti-flake PR#96). Three calm states (anti-Black-Hat — no
 * adherence score, no streak shame, no red "pas fait"):
 *
 *   (i)  no questionnaire        → a calm CTA to fill it.
 *   (ii) questionnaire, no plan  → "ton calendrier se prépare, reviens lundi".
 *   (iii) plan generated         → <AIGeneratedBanner> BEFORE the blocks (EU AI
 *         Act 50(1), 7ᵉ site prod) + first-view disclosure stamp + the
 *         overview / week-view / warnings.
 *
 * §2 (BLOQUANT): the calendar organises the member's TIME of practice
 * (sessions / backtest / Mark Douglas / réunions / rest), NEVER a market call.
 */

interface CalendrierPageProps {
  searchParams: Promise<{ done?: string }>;
}

export default async function CalendrierPage({ searchParams }: CalendrierPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');
  const userId = session.user.id;

  const sp = await searchParams;
  const justSubmitted = sp.done === 'questionnaire';
  const weekStart = currentParisWeekStart();

  const [questionnaire, calendar] = await Promise.all([
    getQuestionnaireForUser(userId, weekStart),
    getCalendarForUser(userId, weekStart),
  ]);

  let body: ReactNode;

  if (questionnaire === null) {
    // (i) — no questionnaire yet. Calm first-step CTA.
    body = (
      <Card primary className="flex flex-col items-start gap-4 p-6" data-state="no-questionnaire">
        <div className="flex flex-col gap-2">
          <span className="t-eyebrow-lg text-[var(--acc)]">Première étape</span>
          <h2 className="t-h2 text-[var(--t-1)]">Organise ta semaine</h2>
          <p className="t-body max-w-prose text-[var(--t-2)]">
            Réponds à un court questionnaire — ta disponibilité, ton énergie, tes objectifs de
            pratique. Claude prépare ensuite ton calendrier de la semaine. Aucun avis sur le marché
            : on organise ton temps.
          </p>
        </div>
        <Link
          href="/calendar/questionnaire/new"
          className={btnVariants({ kind: 'primary', size: 'l' })}
        >
          Organiser ma semaine
          <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      </Card>
    );
  } else if (calendar === null) {
    // (ii) — questionnaire filled, no plan generated yet. Honest + calm.
    body = (
      <Card className="flex flex-col items-start gap-4 p-6" data-state="preparing">
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-10 w-10 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-2)]">
            <CalendarClock className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="t-h2 text-[var(--t-1)]">Ton calendrier se prépare</h2>
            <p className="t-body max-w-prose text-[var(--t-2)]">
              Ton organisation est enregistrée. Ton calendrier de la semaine sera prêt en début de
              semaine — reviens à ce moment-là, sans précipitation.
            </p>
          </div>
        </div>
        <Link
          href="/calendar/questionnaire/new"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Modifier mes réponses
        </Link>
      </Card>
    );
  } else {
    // (iii) — plan generated. EU AI Act 50(1): stamp the disclosure on FIRST
    // view (idempotent) + emit the PII-free audit. The service stamps the row;
    // the page owns the audit slug (`calendar.disclosure.shown`).
    const wasFirstView = calendar.aiDisclosureShownAt === null;
    if (wasFirstView) {
      await markAdaptiveCalendarDisclosureShown(userId, weekStart);
      await logAudit({
        action: 'calendar.disclosure.shown',
        userId,
        metadata: { weekStart: calendar.weekStart },
      });
    }

    body = (
      <div className="flex flex-col gap-5">
        <AIGeneratedBanner variant="inline" modelName={modelDisplay(calendar.claudeModel)} />
        <CalendarOverview schedule={calendar.schedule} weekStart={calendar.weekStart} />
        <CalendarWeekView days={calendar.schedule.days} />
        <CalendarWarnings warnings={calendar.schedule.warnings} />
        <Link
          href="/calendar/questionnaire/new"
          className={`${btnVariants({ kind: 'ghost', size: 'm' })} self-start`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Mettre à jour mes réponses
        </Link>
      </div>
    );
  }

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
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
            Calendrier
          </span>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Mon calendrier de la semaine
          </h1>
        </div>

        <p className="t-body leading-[1.6] text-[var(--t-2)]">
          Un plan calme de ton temps de pratique — sessions, entraînement, psychologie, réunions,
          repos. Aucune analyse de marché, aucun conseil de trade : seulement comment organiser ta
          semaine.
        </p>
      </header>

      {justSubmitted ? (
        <div
          role="status"
          className="rounded-card flex items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-4 py-3"
        >
          <Check
            className="h-4 w-4 shrink-0 text-[var(--acc)]"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="t-body text-[var(--t-1)]">
            C&apos;est noté. Ton organisation de la semaine est enregistrée.
          </p>
        </div>
      ) : null}

      {body}
    </main>
  );
}
