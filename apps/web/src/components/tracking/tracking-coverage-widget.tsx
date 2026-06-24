import { ArrowRight, ClipboardList } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import { getDueTrackingInstruments, getTrackingCoverage } from '@/lib/tracking/service';

/**
 * V2 S2 — Dashboard tracking-coverage widget (member-facing). The single calm
 * surface that turns the universal engine's two reads into ONE glanceable card :
 *
 *   - **D1 completeness gauge** (`getTrackingCoverage`) — how much of the
 *     11-axis méthodo surface the member has fed in the last 30 days. COUNT /
 *     RECENCY only (§21.5 isolation), so it is a calm "where am I" read, never
 *     a score, a streak or a P&L (§2 / §31.2).
 *   - **Due prompt** (`getDueTrackingInstruments`) — the recurring instrument(s)
 *     waiting for a capture right now, offered as a soft CTA into
 *     `/tracking/[instrument]`. No urgency, no red-on-empty (anti-Black-Hat,
 *     Yu-kai Chou) — "tout est à jour" when nothing is due.
 *
 * Server Component, DS-v3 NEUTRAL/accent (never `--cy`/REFLECT). Mirrors the
 * structure + posture of `ProfileStatusWidget`. Mounted under `<Suspense>` on
 * the dashboard, beside the profile + calendar status widgets.
 */
export async function TrackingCoverageWidget({ userId }: { userId: string }) {
  const [coverage, due] = await Promise.all([
    getTrackingCoverage(userId),
    getDueTrackingInstruments(userId),
  ]);

  const top = due[0];

  return (
    <div
      data-slot="tracking-coverage-widget"
      data-state={top ? 'due' : 'current'}
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
              ? 'Commence à nourrir ton suivi — chaque dimension que tu remplis t’aide à te connaître.'
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
            className="rounded-pill h-full bg-[var(--acc)] transition-[width] duration-500"
            style={{ width: `${coverage.pct}%` }}
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

      {/* Due prompt → soft CTA, or a calm "à jour" acknowledgement. */}
      <div className="mt-4">
        {top ? (
          <HoverLift className="block">
            <Link
              href={`/tracking/${top.instrument.key}`}
              className="rounded-control flex items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 py-2.5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[12px] font-semibold text-[var(--acc-hi)]">
                  Faire mon point · {top.instrument.title}
                </span>
                <span className="truncate text-[11px] text-[var(--t-3)]">
                  Quelques questions calmes, quand tu te sens prêt·e.
                </span>
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-[var(--acc-hi)]"
                strokeWidth={2}
                aria-hidden="true"
              />
            </Link>
          </HoverLift>
        ) : (
          <p className="text-[12px] text-[var(--t-3)]">
            Ton suivi est à jour — rien à remplir pour l&apos;instant.
          </p>
        )}
      </div>
    </div>
  );
}
