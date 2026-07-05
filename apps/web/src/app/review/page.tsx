import { ArrowRight, CalendarCheck, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { V18CrisisBanner } from '@/components/review/crisis-banner';
import { MirrorHero } from '@/components/review/mirror-hero';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { SubmitEchoCard } from '@/components/ui/submit-echo-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RecentRowCard } from '@/components/ui/recent-row-card';
import { safeTimeZone } from '@/lib/checkin/timezone';
import { echoProfileDims } from '@/lib/coaching/trade-echo';
import { buildReviewSubmitEcho } from '@/lib/coaching/submit-echo';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import { listMyRecentReviews } from '@/lib/weekly-review/service';
import { currentWeekStartUTC, findCurrentWeekReview } from '@/lib/weekly-review/week';
import { NextStepRail } from '@/components/nav/next-step-rail';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Revue hebdo' };

// V1.9 TIER F — `FMT_WEEK_RANGE_DAY` stays hoisted at module level: the week
// range is a civil-date pin, always rendered in the UTC frame. The submission
// INSTANT formatter is built per request inside the component instead — F2 needs
// the MEMBER's timezone (session-derived), unavailable at module load.
const FMT_WEEK_RANGE_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

interface ReviewLandingProps {
  searchParams: Promise<{ crisis?: string; done?: string }>;
}

/**
 * V1.8 REFLECT — `/review` landing.
 *
 * Server Component. Three sections:
 *   1. Hero — glass `dash-hero` card (Tour 11 finding 1: migrated off the legacy
 *      V18 theme scope onto the app-wide DashboardAmbient) with the Mirror SVG.
 *   2. Optional crisis banner + a LIVING submit echo (finding 3): after a submit,
 *      a member-specific, register-declined reading of the recul, replacing the
 *      old frozen paragraph.
 *   3. Recent reviews timeline (last 12) — Spotlight-lit RecentRowCards.
 *
 * Auth gate : redirect to /login if not active. Pattern carbone J5.
 */
export default async function ReviewLandingPage({ searchParams }: ReviewLandingProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const sp = await searchParams;
  const crisisLevel =
    sp.crisis === 'high' || sp.crisis === 'medium' ? (sp.crisis as 'high' | 'medium') : null;
  const justSubmitted = sp.done === '1';

  const recent = await listMyRecentReviews(session.user.id, 12);

  // P2 fix (mindset-landing parity `mindset/page.tsx:51`) — once this week's
  // review exists, the primary CTA says "resume" instead of pretending the
  // review is still to do (the wizard opens prefilled + upsert updates it).
  const hasCurrentWeekReview = findCurrentWeekReview(recent, currentWeekStartUTC()) !== null;
  const ctaLabel = hasCurrentWeekReview ? 'Reprendre ma revue hebdo' : 'Faire ma revue hebdo';

  // F2 — submission timestamps render in the MEMBER's timezone. Built once per
  // request and reused across the ≤12 rows (keeps the single-instantiation
  // intent of the original module-level formatter, now that the zone is dynamic).
  const timezone = safeTimeZone(session.user.timezone);
  const fmtSubmittedAt = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  // Tour 11 finding 3 — living submit echo. Built only post-submit, on the
  // freshest review (newest-first), declined by the member's coaching profile.
  // Presence-only read of `nextWeekFocus` (firewall §21.5 — never the free text).
  let submitEcho = null;
  if (justSubmitted && !crisisLevel) {
    const profile = await getProfileForUser(session.user.id);
    const dims = echoProfileDims(profile);
    const latest = recent[0];
    submitEcho = buildReviewSubmitEcho({
      hasNextWeekFocus: latest ? latest.nextWeekFocus.trim().length > 0 : false,
      learningStage: dims.learningStage,
      coachingRegister: dims.coachingRegister,
    });
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8 2xl:px-12">
        {/* HERO — Tour 11 finding 1 : glass dash-hero, illustration à droite. */}
        <section aria-labelledby="review-hero-heading" className="wow-reveal">
          <Card
            primary
            glass
            edge={false}
            className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-7"
          >
            <div className="relative grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-8">
              {/* ---- Gauche : intro ---- */}
              <div className="flex flex-col gap-3">
                <p className="t-eyebrow-lg text-[var(--t-3)]">Module REFLECT</p>
                <h1
                  id="review-hero-heading"
                  className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
                  style={{
                    fontFeatureSettings: '"ss01" 1',
                    fontSize: 'clamp(1.9rem, 1.5rem + 1.6vw, 2.6rem)',
                  }}
                >
                  Le miroir de
                  <br />
                  <span style={{ color: 'var(--acc-hi)' }}>ton exécution</span>
                </h1>
                <p className="t-lead max-w-prose text-[var(--t-2)]">
                  Une revue hebdomadaire de ton process, pas de tes P&amp;L. Cinq questions ciblées
                  pour mettre des mots sur ce qui a marché et ce qui doit changer.
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <Link
                    href="/review/new"
                    className="rounded-control inline-flex h-12 items-center gap-2 bg-[var(--acc-btn)] px-5 text-[14px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)] motion-safe:hover:-translate-y-px"
                  >
                    <NotebookPen size={16} strokeWidth={2.2} aria-hidden="true" />
                    {ctaLabel}
                    <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
                  </Link>
                  <Link
                    href="/dashboard"
                    className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-4 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
                  >
                    Retour au dashboard
                  </Link>
                </div>
              </div>

              {/* ---- Droite : illustration miroir ---- */}
              <div className="relative flex items-center justify-center">
                <MirrorHero className="w-full max-w-sm" />
              </div>
            </div>
          </Card>
        </section>

        <NextStepRail currentPath="/review" />

        {/* CRISIS BANNER (conditional). `key={crisisLevel}` forces a clean
            remount when the level changes (HIGH-4 fix — `aria-live="polite"`
            re-announces only on region-change, not on same-region prop update). */}
        {crisisLevel ? <V18CrisisBanner key={crisisLevel} level={crisisLevel} /> : null}

        {/* Tour 11 finding 3 — living submit echo (replaces the frozen paragraph). */}
        {submitEcho ? <SubmitEchoCard echo={submitEcho} /> : null}

        {/* RECENT REVIEWS TIMELINE */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-h2 text-[var(--t-1)]">Tes revues récentes</h2>
            <p className="t-cap text-[var(--t-3)]">{recent.length} / 12 affichées</p>
          </div>

          {recent.length === 0 ? (
            <Card primary className="py-2" data-empty="true">
              <EmptyState
                icon={CalendarCheck}
                headline="Aucune revue pour l'instant."
                lead="Dimanche soir est un bon moment. Le bouton ci-dessus ouvre ta première revue."
              />
            </Card>
          ) : (
            <ul
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
              data-slot="recent-reviews"
            >
              {recent.map((r) => (
                <li key={r.id} className="h-full">
                  <RecentRowCard
                    href={`/review/${r.id}`}
                    ariaLabel={`Revue de la semaine du ${FMT_WEEK_RANGE_DAY.format(
                      isoToUtcDate(r.weekStart),
                    )} au ${FMT_WEEK_RANGE_DAY.format(isoToUtcDate(r.weekEnd))}`}
                    accentBar
                    className="h-full"
                  >
                    <header className="flex items-baseline justify-between gap-3">
                      <p className="t-eyebrow text-[var(--t-3)]">
                        Semaine du <FormattedRange weekStart={r.weekStart} weekEnd={r.weekEnd} />
                      </p>
                      <p className="t-cap font-mono text-[var(--t-3)]">
                        {fmtSubmittedAt.format(new Date(r.submittedAt))}
                      </p>
                    </header>
                    <p className="t-body mt-2 line-clamp-2 text-[var(--t-2)]">
                      <strong className="text-[var(--t-1)]">Leçon :</strong> {r.lessonLearned}
                    </p>
                    <p className="t-cap mt-1.5 line-clamp-1 text-[var(--t-3)]">
                      <span className="font-semibold">Focus suivant :</span> {r.nextWeekFocus}
                    </p>
                  </RecentRowCard>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function isoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function FormattedRange({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) {
  return (
    <>
      <time dateTime={weekStart}>{FMT_WEEK_RANGE_DAY.format(isoToUtcDate(weekStart))}</time>
      <span aria-hidden="true"> → </span>
      <time dateTime={weekEnd}>{FMT_WEEK_RANGE_DAY.format(isoToUtcDate(weekEnd))}</time>
    </>
  );
}
