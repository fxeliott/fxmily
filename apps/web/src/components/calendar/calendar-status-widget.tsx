import { ArrowRight, CalendarRange, Check, Pencil } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import { getQuestionnaireForUser } from '@/lib/calendar/service';
import { currentParisWeekStart, formatWeekRangeFr } from '@/lib/calendar/week';

/**
 * §26 Calendrier adaptatif — dashboard status widget (J-C3).
 *
 * Server Component. Reads the member's questionnaire for the CURRENT
 * Europe/Paris week (server-derived `weekStart`, never client). Two calm
 * states, anti-Black-Hat (Yu-kai Chou) — NO streak, NO score, NO shame, NO
 * red-on-empty:
 *   - not filled → a calm "Organise ta semaine" CTA → `/calendar/questionnaire/new`.
 *   - filled     → a discreet "✓ rempli cette semaine" acknowledgement + an
 *                  unobtrusive edit affordance.
 *
 * `justSubmitted` (from `/dashboard?done=questionnaire`) adds a brief, polite
 * confirmation line — the redirect target's calm reveal (§26 posture §2).
 * DS-v2 NEUTRAL/lime — never `--cy` (training) nor `.v18-theme` (REFLECT).
 */
export async function CalendarStatusWidget({
  userId,
  justSubmitted = false,
}: {
  userId: string;
  justSubmitted?: boolean;
}) {
  const weekStart = currentParisWeekStart();
  const questionnaire = await getQuestionnaireForUser(userId, weekStart);
  const weekRange = formatWeekRangeFr(weekStart);
  const filled = questionnaire !== null;

  if (!filled) {
    return (
      <HoverLift className="block">
        <Link
          href="/calendar/questionnaire/new"
          data-slot="calendar-status-widget"
          className="rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
              <CalendarRange className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-eyebrow text-[var(--acc)]">
                Calendrier · Semaine du {weekRange}
              </span>
              <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Organise ta semaine</h3>
              <p className="text-[12px] leading-relaxed text-[var(--t-2)]">
                Un court questionnaire pour adapter ton temps de pratique — sessions, entraînement,
                repos. Pas d&apos;avis sur le marché.
              </p>
            </div>
            <span
              className="rounded-control mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 px-2.5 text-[12px] font-semibold text-[var(--acc)]"
              aria-hidden="true"
            >
              Commencer
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </div>
        </Link>
      </HoverLift>
    );
  }

  return (
    <div
      data-slot="calendar-status-widget"
      className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
          <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--t-3)]">Calendrier · Semaine du {weekRange}</span>
          <h3 className="text-[15px] font-semibold text-[var(--t-1)]">
            Ton organisation est enregistrée
          </h3>
          <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
            {justSubmitted
              ? "C'est noté. Ton calendrier de la semaine sera prêt en début de semaine."
              : 'Tu peux la mettre à jour si ta disponibilité change.'}
          </p>
        </div>
        <Link
          href="/calendar/questionnaire/new"
          className="rounded-control mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 border border-[var(--b-default)] px-2.5 text-[12px] text-[var(--t-3)] transition-colors hover:border-[var(--b-acc)] hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
          Modifier
        </Link>
      </div>
    </div>
  );
}
