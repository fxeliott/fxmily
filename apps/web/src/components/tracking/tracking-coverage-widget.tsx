import { ClipboardList } from 'lucide-react';

import { getTrackingCoverage } from '@/lib/tracking/service';

/**
 * V2 S2 — Dashboard tracking-coverage widget (member-facing). The calm
 * « vue d'ensemble » of how much of the 11-axis méthodo surface the member has
 * fed in the last 30 days (`getTrackingCoverage`) — COUNT / RECENCY only (§21.5
 * isolation), so it is a reflective "where am I" read, never a score, a streak
 * or a P&L (§2 / §31.2).
 *
 * S6 §32-2 — the DUE relevé CTA moved to the consolidated « plan du jour »
 * (`TodayGuidance`, the single top-of-dashboard place the member looks for "what
 * to do now"), so this widget now shows ONLY the reflective coverage gauge: the
 * same « faire mon point » action is never offered twice on one page
 * (ui-review: no overlap). The due read therefore lives in `getDailyGuidance`
 * alone — this widget no longer queries it (one fewer DB round-trip).
 *
 * Server Component, DS-v3 NEUTRAL/accent (never `--cy`/REFLECT). Mirrors the
 * structure + posture of `ProfileStatusWidget`. Mounted under `<Suspense>` on
 * the dashboard, beside the profile + calendar status widgets.
 */
export async function TrackingCoverageWidget({ userId }: { userId: string }) {
  const coverage = await getTrackingCoverage(userId);

  return (
    <div
      data-slot="tracking-coverage-widget"
      data-state={coverage.coveredCount === 0 ? 'empty' : 'covered'}
      className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
          <ClipboardList className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--t-3)]">Suivi · Ta méthode</span>
          <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Vue d&apos;ensemble</h3>
          <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
            {coverage.coveredCount === 0
              ? 'Commence à nourrir ton suivi, chaque dimension que tu remplis t’aide à te connaître.'
              : `${coverage.coveredCount} dimension${coverage.coveredCount > 1 ? 's' : ''} sur ${coverage.totalCount} nourrie${coverage.coveredCount > 1 ? 's' : ''} ces 30 derniers jours.`}
          </p>
        </div>
      </div>

      {/* Calm completeness bar — descriptive, never a verdict. */}
      <div className="mt-4 flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-valuenow={coverage.coveredCount}
          aria-valuemin={0}
          aria-valuemax={coverage.totalCount}
          aria-valuetext={`${coverage.coveredCount} dimensions sur ${coverage.totalCount} suivies récemment`}
          className="rounded-pill h-2 w-full overflow-hidden bg-[var(--bg-3)]"
        >
          <div
            className="rounded-pill h-full w-full origin-left bg-[var(--acc)] transition-transform duration-500"
            style={{ transform: `scaleX(${coverage.pct / 100})` }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {coverage.axes.map((a) => (
            <span
              key={a.axis}
              data-covered={a.covered}
              className={
                a.covered
                  ? 'rounded-pill border border-[var(--b-acc)] bg-[var(--acc-dim)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--acc-hi)]'
                  : 'rounded-pill border border-[var(--b-default)] px-2 py-0.5 text-[10.5px] text-[var(--t-3)]'
              }
            >
              {a.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
