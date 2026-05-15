import { ArrowRight, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { V18CrisisBanner } from '@/components/review/crisis-banner';
import { MirrorHero } from '@/components/review/mirror-hero';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { listMyRecentReviews } from '@/lib/weekly-review/service';

export const dynamic = 'force-dynamic';

// V1.9 TIER F — hoisted at module level so the 12 timeline rows don't each
// instantiate a new `Intl.DateTimeFormat` (per-row cost ~0.5 ms × N rows).
const FMT_SUBMITTED_AT_FR = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
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
 *   1. Hero — Mirror SVG illustration + intro copy + primary CTA.
 *   2. Optional crisis banner (URL state `?crisis=high|medium` from
 *      `submitWeeklyReviewAction` redirect when corpus tripped detect).
 *   3. Recent reviews timeline — last 12 (clamped service-side).
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

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        {/* HERO */}
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="t-eyebrow text-[var(--t-3)]">Module REFLECT</p>
            <h1 className="t-display-fluid text-[var(--t-1)]">
              Le miroir de
              <br />
              <span style={{ color: 'var(--acc-hi)' }}>ton exécution</span>
            </h1>
            <p className="t-lead max-w-prose text-[var(--t-2)]">
              Une revue hebdomadaire de ton process — pas de tes P&amp;L. Cinq questions ciblées
              pour mettre des mots sur ce qui a marché et ce qui doit changer.
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            <MirrorHero className="w-full max-w-md" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/review/new"
              className="rounded-control inline-flex h-12 items-center gap-2 bg-[var(--acc)] px-5 text-[14px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]"
            >
              <NotebookPen size={16} strokeWidth={2.2} aria-hidden="true" />
              Faire ma revue hebdo
              <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-4 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
            >
              Retour au dashboard
            </Link>
          </div>
        </header>

        {/* CRISIS BANNER (conditional). `key={crisisLevel}` forces a clean
            remount when the level changes (HIGH-4 fix — `aria-live="polite"`
            re-announces only on region-change, not on same-region prop update). */}
        {crisisLevel ? <V18CrisisBanner key={crisisLevel} level={crisisLevel} /> : null}

        {/* CONFIRM FLASH after submit */}
        {justSubmitted && !crisisLevel ? (
          <div
            role="status"
            className="rounded-card-lg border border-[var(--b-acc)] p-4"
            style={{
              background:
                'linear-gradient(135deg, oklch(0.62 0.19 254 / 0.16) 0%, oklch(0.13 0.028 254 / 0.85) 80%)',
            }}
          >
            <p className="t-eyebrow text-[var(--t-3)]">Enregistrée</p>
            <p className="t-h3 mt-1 text-[var(--t-1)]">
              Ta revue est dans le miroir. Reviens dimanche prochain.
            </p>
          </div>
        ) : null}

        {/* RECENT REVIEWS TIMELINE */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-h2 text-[var(--t-1)]">Tes revues récentes</h2>
            <p className="t-cap text-[var(--t-3)]">{recent.length} / 12 affichées</p>
          </div>

          {recent.length === 0 ? (
            <div
              className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
              data-empty="true"
            >
              <p className="t-body text-[var(--t-2)]">
                Aucune revue pour l&apos;instant. Dimanche soir est un bon moment.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5" data-slot="recent-reviews">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/review/${r.id}`}
                    aria-labelledby={`rev-${r.id}-title`}
                    className="rounded-card block border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
                  >
                    <header className="flex items-baseline justify-between gap-3">
                      <p className="t-eyebrow text-[var(--t-3)]" id={`rev-${r.id}-title`}>
                        Semaine du <FormattedRange weekStart={r.weekStart} weekEnd={r.weekEnd} />
                      </p>
                      <p className="t-cap font-mono text-[var(--t-3)]">
                        {FMT_SUBMITTED_AT_FR.format(new Date(r.submittedAt))}
                      </p>
                    </header>
                    <p className="t-body mt-2 line-clamp-2 text-[var(--t-2)]">
                      <strong className="text-[var(--t-1)]">Leçon :</strong> {r.lessonLearned}
                    </p>
                    <p className="t-cap mt-1.5 line-clamp-1 text-[var(--t-3)]">
                      <span className="font-semibold">Focus suivant :</span> {r.nextWeekFocus}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </V18ThemeScope>
  );
}

function FormattedRange({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return FMT_WEEK_RANGE_DAY.format(dt);
  };
  return (
    <>
      <time dateTime={weekStart}>{fmt(weekStart)}</time>
      <span aria-hidden="true"> → </span>
      <time dateTime={weekEnd}>{fmt(weekEnd)}</time>
    </>
  );
}
