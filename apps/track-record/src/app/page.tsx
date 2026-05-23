import { LogoMark } from '@/components/logo-mark';
import { AnimatedNumber } from '@/components/animated-number';
import { EquityCurve } from '@/components/charts/equity-curve';
import { MonthlyHeatmap } from '@/components/charts/monthly-heatmap';
import { DrawdownUnderwater } from '@/components/charts/drawdown-underwater';
import { RDistribution } from '@/components/charts/r-distribution';
import { InstrumentBreakdown } from '@/components/charts/instrument-breakdown';
import { KpiCard } from '@/components/kpi-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { SegmentDivider } from '@/components/segment-divider';
import { SectionHeader } from '@/components/section-header';
import { ShowYourLosses } from '@/components/show-your-losses';
import { TradesTable } from '@/components/trades-table';
import { LegalDisclaimer } from '@/components/legal-disclaimer';
import { ScrollProgress } from '@/components/scroll-progress';
import { AmbientBackground } from '@/components/ambient-background';
import { CursorSpotlight } from '@/components/cursor-spotlight';
import { LivePulse } from '@/components/live-pulse';
import { HeroReveal } from '@/components/hero-reveal';
import { PivotRail } from '@/components/pivot-rail';
import {
  TRACK_RECORD_KPIS,
  EQUITY_CURVE,
  MONTHLY_AGGREGATES,
  ODS_MONTHLY_SUMMARIES,
  INSTRUMENT_AGGREGATES,
  HISTORICAL_TRADES,
  HISTORICAL_YEAR,
} from '@/lib/data';
import { bucketByR, bestTrades, worstTrades } from '@/lib/metrics';
import { formatR, formatRatio, formatWinrate } from '@/lib/format';

const FR_PCT = new Intl.NumberFormat('fr-FR', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FR_DATE_LONG = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const LAST_UPDATE = new Date('2026-05-22T11:00:00+02:00');
const PIVOT_DATE = new Date('2026-05-22T00:00:00+02:00');

/** Container widths T4 :
 *  - Prose/hero/footer : 1280px max (lecture confortable)
 *  - Data viz/charts/tables : FULL-BLEED (no max-w, edge-padding only)
 *    Padding adaptatif : 24px → 80px → 128px → 160px selon viewport.
 *    Eliot feedback T3 « focus sur le milieu » : drop the cap entirely. */
const CONTAINER_PROSE = 'mx-auto max-w-[1280px] px-6 sm:px-10';
const CONTAINER_WIDE = 'px-6 sm:px-12 lg:px-20 xl:px-28 2xl:px-40';

export default function TrackRecordPage() {
  const k = TRACK_RECORD_KPIS;
  const monthsCount = MONTHLY_AGGREGATES.length;
  const rBuckets = bucketByR(HISTORICAL_TRADES, 0.5);
  const best5 = bestTrades(HISTORICAL_TRADES, 5);
  const worst5 = worstTrades(HISTORICAL_TRADES, 5);

  // Pivot historique → live.
  // - pivotOrdinal : dernier ordinal historique + 1 (ex 140 = where live starts)
  // - pivotMonth : 12 (Décembre — Nov est dernier historique)
  const pivotOrdinal = HISTORICAL_TRADES.length + 1;
  const pivotMonth = 12;

  return (
    <>
      <AmbientBackground />
      <ScrollProgress />
      <PivotRail date="22.05.2026" />

      <main className="relative bg-transparent text-[var(--text)]">
        {/* ─────────────────── Header — logo + caption verified ─────────────────── */}
        <header className="border-b border-[var(--border)]">
          <div className={`${CONTAINER_PROSE} flex items-center justify-between py-5`}>
            <LogoMark height={32} />
            <span className="t-caption inline-flex items-center gap-2 text-[var(--text-muted)]">
              <LivePulse size={6} color="var(--positive)" />
              Performance vérifiée
            </span>
          </div>
        </header>

        {/* ─────────────────── Hero — Logo halo+tilt + Display blur-to-focus + badges ─────────────────── */}
        <CursorSpotlight size={640}>
          <section
            aria-labelledby="hero-title"
            className={`${CONTAINER_PROSE} pt-20 pb-16 text-center sm:pt-28 sm:pb-20`}
          >
            <div className="mb-10 flex justify-center">
              <LogoMark height={64} withHalo withTilt />
            </div>

            <h1 id="hero-title" className="t-h1 text-[var(--text-muted)]">
              Performance cumulée
            </h1>
            <HeroReveal delay={0.35}>
              <div className="mt-5">
                <span className="t-display num text-[var(--text)] tabular-nums">
                  <AnimatedNumber to={k.totalPercent} decimals={1} prefix="+" suffix=" %" />
                </span>
              </div>
            </HeroReveal>

            <div
              aria-hidden
              className="mx-auto mt-7 h-px w-12"
              style={{ background: 'var(--accent)' }}
            />
            <p className="t-body mx-auto mt-6 max-w-md text-[var(--text-muted)]">
              Sur {monthsCount} mois — {HISTORICAL_YEAR}. {k.closedTrades} trades publiés en direct,
              avant exécution.
            </p>

            {/* Trust signals row — sequential reveal */}
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <HeroReveal delay={0.55}>
                <VerifiedBadge label="Performance vérifiée" tone="positive" />
              </HeroReveal>
              <HeroReveal delay={0.7}>
                <VerifiedBadge
                  label="Aucun trade retiré"
                  detail={`${k.totalTrades} sur ${k.totalTrades}`}
                />
              </HeroReveal>
              <HeroReveal delay={0.85}>
                <span className="inline-flex items-center gap-2.5">
                  <LivePulse size={8} color="var(--accent)" />
                  <VerifiedBadge label="Publiés en direct" tone="accent" />
                </span>
              </HeroReveal>
            </div>
          </section>
        </CursorSpotlight>

        {/* ─────────────────── KPIs grid — 4×2 hero density ─────────────────── */}
        <section aria-label="Indicateurs clés" className={`${CONTAINER_WIDE} pb-24`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8 xl:gap-3">
            <KpiCard
              index={0}
              label="Performance cumulée"
              tone="gain"
              value={FR_PCT.format(k.totalPercent)}
              suffix="%"
              caption={`${monthsCount} mois ${HISTORICAL_YEAR}`}
            />
            <KpiCard
              index={1}
              label="R-multiple cumulé"
              tone="primary"
              value={formatR(k.totalR)}
              caption={`sur ${k.closedTrades} trades`}
            />
            <KpiCard
              index={2}
              label="Profit factor"
              tone="accent"
              value={formatRatio(k.profitFactor)}
              caption="gains / pertes"
            />
            <KpiCard
              index={3}
              label="Recul maximum"
              tone="loss"
              value={FR_PCT.format(k.maxDrawdownPercent)}
              suffix="%"
              caption="point bas equity"
            />
            <KpiCard
              index={4}
              label="Trades clôturés"
              tone="primary"
              value={String(k.closedTrades)}
              caption={`${k.openCount} ouverts`}
              live
            />
            <KpiCard
              index={5}
              label="Trades gagnants"
              tone="gain"
              value={formatWinrate(k.winrate)}
              caption={`${k.winCount} gains · ${k.lossCount} pertes · ${k.beCount} BE`}
              live
            />
            <KpiCard
              index={6}
              label="Espérance par trade"
              tone="primary"
              value={formatR(k.expectancyR)}
              caption="formule Van Tharp"
              live
            />
            <KpiCard
              index={7}
              label="Meilleure série"
              tone="accent"
              value={String(k.bestStreak)}
              caption={`gains consécutifs · pire ${k.worstStreak}`}
              live
            />
          </div>
        </section>

        {/* ─────────────────── Equity curve — signature lumineuse + pivot ─────────────────── */}
        <section aria-label="Courbe de performance cumulée" className={`${CONTAINER_WIDE} pb-24`}>
          <SectionHeader
            eyebrow="Performance"
            title="Courbe cumulée"
            description="Variation du portefeuille trade par trade, exprimée en pourcentage du capital. La marque PIVOT indique la frontière entre trades historiques et trades à venir publiés en direct."
          />
          <EquityCurve data={EQUITY_CURVE} height={420} pivotOrdinal={pivotOrdinal} />
        </section>

        {/* ─────────────────── Bento row 1 — Drawdown + Heatmap ─────────────────── */}
        <section
          aria-label="Drawdown et performance mensuelle"
          className={`${CONTAINER_WIDE} pb-24`}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <SectionHeader
                eyebrow="Risque"
                title="Drawdown underwater"
                description="Distance au plus haut historique. Reste sous zéro tant que le portefeuille n'a pas reconquis son sommet."
              />
              <DrawdownUnderwater data={EQUITY_CURVE} height={240} pivotOrdinal={pivotOrdinal} />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <SectionHeader
                eyebrow="Calendrier"
                title="Mois par mois"
                description="Chaque cellule = un mois. Les cellules en ring bleu marquent les mois à venir publiés en direct."
              />
              <MonthlyHeatmap
                data={MONTHLY_AGGREGATES}
                odsSummaries={ODS_MONTHLY_SUMMARIES}
                year={HISTORICAL_YEAR}
                pivotMonth={pivotMonth}
              />
            </div>
          </div>
        </section>

        {/* ─────────────────── Bento row 2 — R-Dist + Instruments ─────────────────── */}
        <section
          aria-label="Distribution R-multiple et répartition par instrument"
          className={`${CONTAINER_WIDE} pb-24`}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <SectionHeader
                eyebrow="Distribution"
                title="R-multiple par bucket"
                description="Histogramme des R-multiples par tranches de 0,5R. Visualise l'asymétrie gain/perte."
              />
              <RDistribution buckets={rBuckets} height={240} />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <SectionHeader
                eyebrow="Instruments"
                title="Top 8 par fréquence"
                description="Paires les plus tradées, avec winrate et R-multiple cumulé."
              />
              <InstrumentBreakdown data={INSTRUMENT_AGGREGATES} limit={8} />
            </div>
          </div>
        </section>

        {/* ─────────────────── Show your losses — Bridgewater 2-col ─────────────────── */}
        <section aria-label="Meilleurs et pires trades" className={`${CONTAINER_WIDE} pb-24`}>
          <SectionHeader
            eyebrow="Transparence"
            title="Meilleurs et pires trades"
            description="Les 5 plus gros gains et les 5 plus grosses pertes, présentés côte à côte avec exactement la même mise en avant."
          />
          <ShowYourLosses bestTrades={best5} worstTrades={worst5} />
        </section>

        {/* ─────────────────── Trades table — filter buttons + pagination ─────────────────── */}
        <section aria-label="Liste exhaustive des trades" className={`${CONTAINER_WIDE} pb-24`}>
          <SectionHeader
            eyebrow="Journal"
            title="Liste des trades"
            description={`${k.closedTrades} trades clôturés, dans l'ordre chronologique. Aucun trade retiré, aucune modification rétroactive.`}
          />
          <TradesTable
            trades={HISTORICAL_TRADES}
            initialVisible={12}
            pivotCaption="Les prochains trades seront ajoutés en direct via l'interface admin."
            pivotDate={FR_DATE_LONG.format(PIVOT_DATE)}
          />
        </section>

        {/* ─────────────────── Segment divider — historique → live ─────────────────── */}
        <section className={CONTAINER_PROSE}>
          <SegmentDivider date={FR_DATE_LONG.format(PIVOT_DATE)} />
          <p className="t-body mx-auto max-w-xl pb-24 text-center text-[var(--text-muted)]">
            À partir d&apos;aujourd&apos;hui, les trades sont ajoutés en direct via l&apos;interface
            admin. Aucune modification rétroactive sur les trades historiques.
          </p>
        </section>

        {/* ─────────────────── Verification trail — proof signals ─────────────────── */}
        <section aria-label="Vérification et audit" className={`${CONTAINER_WIDE} pb-24`}>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 sm:p-10">
            <SectionHeader
              eyebrow="Audit"
              title="Comment on garantit l'intégrité"
              description="Trois engagements concrets, vérifiables par construction."
            />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <div className="t-caption" style={{ color: 'var(--positive)' }}>
                  01 · Trades publiés en direct
                </div>
                <p className="t-body mt-3 text-[var(--text-muted)]">
                  Chaque setup est partagé avant l&apos;exécution, horodaté. La sortie est annoncée
                  au moment où elle a lieu — aucun rétroactif possible.
                </p>
              </div>
              <div>
                <div className="t-caption" style={{ color: 'var(--positive)' }}>
                  02 · Zéro trade retiré
                </div>
                <p className="t-body mt-3 text-[var(--text-muted)]">
                  {k.totalTrades} trades publiés, {k.totalTrades} affichés. Aucune sélection, aucune
                  purge de pertes embarrassantes. La courbe contient tout, sans exception.
                </p>
              </div>
              <div>
                <div className="t-caption" style={{ color: 'var(--positive)' }}>
                  03 · Résultats en pourcentage uniquement
                </div>
                <p className="t-body mt-3 text-[var(--text-muted)]">
                  Aucun montant en euros n&apos;apparaît, jamais. La performance s&apos;exprime en
                  pourcentage du capital risqué (conformité AMF promesse de gain).
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─────────────────── Footer — last update + disclaimer ─────────────────── */}
        <footer className={`${CONTAINER_PROSE} pt-12 pb-16`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="t-micro">
              Mis à jour le{' '}
              <time dateTime={LAST_UPDATE.toISOString()}>{FR_DATE_LONG.format(LAST_UPDATE)}</time>.
            </span>
            <span className="t-micro">© Fxmily {new Date().getFullYear()}</span>
          </div>
          <LegalDisclaimer />
        </footer>
      </main>
    </>
  );
}
