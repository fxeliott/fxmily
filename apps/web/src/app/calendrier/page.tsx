import { ArrowLeft, ArrowRight, CalendarClock, CalendarRange, Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { CalendarOverview } from '@/components/calendar/calendar-overview';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
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
import { reportWarning } from '@/lib/observability';
import { NextStepRail } from '@/components/nav/next-step-rail';

export const metadata = {
  title: 'Mon calendrier',
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
 *   (ii) questionnaire, no plan  → "ton calendrier se prépare" (the worker
 *         generates DAILY at ~05:10 Paris since 2026-07-08 — the copy promises
 *         "demain matin", never "lundi").
 *   (iii) plan generated         → <AIGeneratedBanner> BEFORE the blocks (EU AI
 *         Act 50(1), 7ᵉ site prod) + first-view disclosure stamp + the
 *         overview / week-view / warnings. If the questionnaire was
 *         re-submitted AFTER generation, a calm "régénération en cours" note
 *         precedes the (still displayed) current plan.
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
            Réponds à un court questionnaire : ta disponibilité, ton énergie, tes objectifs de
            pratique. Claude prépare ensuite ton calendrier de la semaine, généré chaque matin tôt
            (heure de Paris). Aucun avis sur le marché : on organise ton temps.
          </p>
        </div>
        <Link
          href="/calendar/questionnaire/new"
          className={`${btnVariants({ kind: 'primary', size: 'l' })} wow-hover-glow`}
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
              Ton organisation est enregistrée. Ton calendrier de la semaine sera prêt demain matin
              au plus tard (il se génère chaque matin, tôt, heure de Paris). Reviens à ce moment-là,
              sans précipitation.
            </p>
          </div>
        </div>
        <Link
          href="/calendar/questionnaire/new"
          className={`${btnVariants({ kind: 'ghost', size: 'm' })} wow-hover-glow`}
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
      // Best-effort: the calendar is already loaded — a transient DB hiccup on
      // the disclosure stamp/audit must NEVER 500 a member's calendar view. The
      // stamp is idempotent; a missed stamp just re-attempts on the next view.
      try {
        await markAdaptiveCalendarDisclosureShown(userId, weekStart);
        await logAudit({
          action: 'calendar.disclosure.shown',
          userId,
          metadata: { weekStart: calendar.weekStart },
        });
      } catch {
        reportWarning('calendar.disclosure', 'stamp_failed', { userId });
      }
    }

    // A questionnaire RE-submitted after generation marks the plan stale — the
    // daily batch regenerates it next tick (batch DoD#1). Tell the member
    // honestly instead of silently showing the outdated plan.
    const regenerationPending =
      questionnaire !== null &&
      new Date(questionnaire.updatedAt).getTime() > new Date(calendar.generatedAt).getTime();

    body = (
      <div className="flex flex-col gap-5">
        {regenerationPending ? (
          <div
            role="status"
            data-state="stale-regenerating"
            className="rounded-card flex items-start gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] px-4 py-3"
          >
            <CalendarClock
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-3)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="t-body text-[var(--t-2)]">
              Tes nouvelles réponses sont enregistrées : ce calendrier sera régénéré demain matin
              pour en tenir compte. En attendant, voici le plan actuel.
            </p>
          </div>
        ) : null}
        <AIGeneratedBanner variant="inline" modelName={modelDisplay(calendar.claudeModel)} />
        <CalendarOverview schedule={calendar.schedule} weekStart={calendar.weekStart} />
        <div className="wow-reveal">
          <CalendarWeekView days={calendar.schedule.days} />
        </div>
        {calendar.schedule.warnings.length > 0 ? (
          <div className="wow-reveal">
            <CalendarWarnings warnings={calendar.schedule.warnings} />
          </div>
        ) : null}
        <Link
          href="/calendar/questionnaire/new"
          className={`${btnVariants({ kind: 'ghost', size: 'm' })} wow-hover-glow self-start`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Mettre à jour mes réponses
        </Link>
      </div>
    );
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the masthead */}
      <DashboardAmbient />
      {/* Tour 12 — `page-stagger` cascades the direct children (header, rail,
          the "enregistré" status banner, then `{body}`) in on navigation. The
          `wow-reveal` blocks live nested INSIDE `{body}` (week-view, warnings),
          not as direct children here, so there is no animation/opacity conflict
          to opt out of. Compositor-only (opacity + translateY), reduced-motion
          neutralised by the class, CLS 0. No fixed descendant lives here
          (DashboardAmbient is an absolute sibling, the app-shell fixed nav is an
          ancestor), so the transform creates no containing block. */}
      <div className="page-stagger relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
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
              className="f-display h-rise text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mon calendrier de la semaine
            </h1>
          </div>

          <p className="t-body leading-[1.6] text-[var(--t-2)]">
            Un plan calme de ton temps de pratique : sessions, entraînement, psychologie, réunions,
            repos. Aucune analyse de marché, aucun conseil de trade : seulement comment organiser ta
            semaine.
          </p>
        </header>

        <NextStepRail currentPath="/calendrier" />

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
      </div>
    </main>
  );
}
