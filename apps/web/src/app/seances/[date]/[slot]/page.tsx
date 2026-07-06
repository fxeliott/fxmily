import { ArrowLeft, CalendarX, Clock, FileText, LineChart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache, type CSSProperties } from 'react';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { AssetDeepDive } from '@/components/seances/asset-deepdive';
import { SeanceBiasBasket } from '@/components/seances/bias-basket';
import { BiasSynthesis } from '@/components/seances/bias-synthesis';
import { pickCorrelatedSatellites, SeanceMacroCompass } from '@/components/seances/macro-compass';
import { ReplayPlayer } from '@/components/seances/replay-player';
import { SeancesDisclaimer } from '@/components/seances/seances-disclaimer';
import { SessionChoreography } from '@/components/seances/session-choreography';
import type { SeanceSlot } from '@/lib/seances/derive';
import { getSeanceByDateSlot } from '@/lib/seances/service';

export const dynamic = 'force-dynamic';

const VALID_SLOTS: readonly SeanceSlot[] = ['analyse', 'debrief'];

function isSeanceSlot(value: string): value is SeanceSlot {
  return (VALID_SLOTS as readonly string[]).includes(value);
}

/** Per-request memoised loader so generateMetadata + the page share one query. */
const loadSeance = cache(getSeanceByDateSlot);

interface SeancePageProps {
  params: Promise<{ date: string; slot: string }>;
}

export async function generateMetadata({ params }: SeancePageProps): Promise<Metadata> {
  const { date, slot } = await params;
  if (!isSeanceSlot(slot)) return { title: 'Séance' };
  const seance = await loadSeance(date, slot);
  return { title: seance ? seance.title : 'Séance' };
}

export default async function SeancePage({ params }: SeancePageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { date, slot } = await params;
  if (!isSeanceSlot(slot)) notFound();

  const seance = await loadSeance(date, slot);
  if (!seance) notFound();

  const SlotIcon = seance.slot === 'analyse' ? LineChart : FileText;
  // Eyebrow TEXT colour — must stay ≥4.5:1 in both themes. debrief uses
  // `--acc-2-hi` (6.27:1 dark), not `--acc-2` (3.98:1 dark = AA fail). cf. slotMeta.
  const accentText = seance.slot === 'analyse' ? 'var(--acc)' : 'var(--acc-2-hi)';
  const isCancelled = seance.status === 'cancelled';
  // Degraded IA content → render replay + summary only, never a fabricated analysis.
  const showAnalysis = !isCancelled && !seance.contentNeedsReview;
  const hasTakeaways = seance.keyTakeaways.some((t) => t.trim().length > 0);
  const allAssets = [...seance.macroAssets, ...seance.assets];
  // "Le plan du jour" building blocks: the macro conductor (DXY) drives its
  // inverse-correlated satellites in the compass; the tradeable basket = the
  // non-macro assets. The compass only renders when a conductor + ≥1 satellite
  // exist; the section itself renders when either sub-view has data.
  const conductor = seance.macroAssets[0] ?? null;
  const satellites = pickCorrelatedSatellites(seance.assets);
  const hasCompass = conductor !== null && satellites.length > 0;
  const showPlan = showAnalysis && (hasCompass || seance.assets.length > 0);
  const showChoreography = showAnalysis && seance.slot === 'analyse';

  return (
    <main
      className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]"
      style={{ ['--gold']: 'oklch(0.74 0.13 80)' } as CSSProperties}
    >
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 lg:px-8">
        <header className="masthead-accent flex flex-col gap-3">
          <Link
            href="/seances"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Les séances
          </Link>

          <div className="flex flex-col gap-2">
            <span
              className="t-eyebrow-lg inline-flex items-center gap-1.5"
              style={{ color: isCancelled ? 'var(--t-3)' : accentText }}
            >
              <SlotIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {seance.slotLong}
            </span>
            <h1
              className="f-display text-[26px] leading-[1.1] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[30px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {seance.title}
            </h1>
            <p className="t-cap flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--t-3)]">
              <span className="capitalize">{seance.dateLabel}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                {seance.time}
              </span>
              {seance.durationLabel ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{seance.durationLabel}</span>
                </>
              ) : null}
            </p>
          </div>
        </header>

        {isCancelled ? (
          <section
            aria-labelledby="seance-cancelled-heading"
            className="rounded-card flex flex-col items-start gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
          >
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <CalendarX className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Séance annulée
            </span>
            <h2 id="seance-cancelled-heading" className="t-body text-[var(--t-1)]">
              Cette séance n&apos;a pas eu lieu.
            </h2>
            {seance.cancelReason ? (
              <p className="t-cap text-[var(--t-3)]">{seance.cancelReason}</p>
            ) : null}
          </section>
        ) : (
          <>
            {/* Replay. */}
            <section aria-label="Replay de la séance">
              <ReplayPlayer
                embedUrl={seance.vimeoEmbedUrl}
                processing={seance.vimeoProcessing}
                title={seance.title}
              />
            </section>

            {/* Summary lead. */}
            {seance.summary ? (
              <p className="t-body max-w-prose text-[var(--t-2)]">{seance.summary}</p>
            ) : null}

            {seance.contentNeedsReview ? (
              <p className="rounded-card t-cap border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] p-4 text-[var(--t-3)]">
                Le compte rendu détaillé de cette séance sera complété prochainement.
              </p>
            ) : null}

            {/* Le plan du jour — the visual overview: the macro engine (compass)
                + the day's basket at a glance. The highest-comprehension block,
                placed high where the eye lands. */}
            {showPlan ? (
              <section
                aria-labelledby="seance-plan-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-plan-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  Le plan du jour
                </h2>
                {hasCompass && conductor ? (
                  <SeanceMacroCompass conductor={conductor} satellites={satellites} />
                ) : null}
                {seance.assets.length > 0 ? <SeanceBiasBasket assets={seance.assets} /> : null}
              </section>
            ) : null}

            {/* L'essentiel — whole-session key takeaways. */}
            {showAnalysis && hasTakeaways ? (
              <section
                aria-labelledby="seance-essentiel-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-essentiel-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  L&apos;essentiel
                </h2>
                <ol className="flex flex-col gap-2.5">
                  {seance.keyTakeaways
                    .filter((t) => t.trim().length > 0)
                    .map((takeaway, i) => (
                      <li
                        key={i}
                        className="rounded-card flex gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-3.5"
                      >
                        <span
                          aria-hidden
                          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--acc-dim)] font-mono text-[11px] font-semibold text-[var(--acc-hi)] tabular-nums"
                        >
                          {i + 1}
                        </span>
                        <p className="t-body text-[var(--t-2)]">{takeaway}</p>
                      </li>
                    ))}
                </ol>
              </section>
            ) : null}

            {/* La chorégraphie — the method primer (manipulation-first + the NY
                session windows). Pre-session planning only (analyse slot). */}
            {showChoreography ? (
              <section
                aria-labelledby="seance-choreography-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-choreography-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  La chorégraphie de séance
                </h2>
                <SessionChoreography />
              </section>
            ) : null}

            {/* Macro context (DXY). */}
            {showAnalysis && seance.macroAssets.length > 0 ? (
              <section
                aria-labelledby="seance-macro-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-macro-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  Contexte macro
                </h2>
                <div className="flex flex-col gap-4">
                  {seance.macroAssets.map((asset) => (
                    <AssetDeepDive key={asset.id} asset={asset} />
                  ))}
                </div>
              </section>
            ) : null}

            {/* Per-asset analysis. */}
            {showAnalysis && seance.assets.length > 0 ? (
              <section
                aria-labelledby="seance-analyse-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-analyse-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  Analyse par actif
                </h2>
                <div className="flex flex-col gap-4">
                  {seance.assets.map((asset) => (
                    <AssetDeepDive key={asset.id} asset={asset} />
                  ))}
                </div>
              </section>
            ) : null}

            {/* Bias overview. */}
            {showAnalysis && allAssets.length >= 2 ? (
              <section
                aria-labelledby="seance-synthese-heading"
                className="wow-reveal flex flex-col gap-3"
              >
                <h2 id="seance-synthese-heading" className="t-eyebrow-lg text-[var(--t-3)]">
                  Vue d&apos;ensemble des biais
                </h2>
                <BiasSynthesis assets={allAssets} />
              </section>
            ) : null}
          </>
        )}

        <SeancesDisclaimer />
      </div>
    </main>
  );
}
