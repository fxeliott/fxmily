import { AnimatedNumber } from '@/components/animated-number';
import { KpiCard } from '@/components/kpi-card';
import { LegalDisclaimer } from '@/components/legal-disclaimer';
import { SectionHeader } from '@/components/section-header';
import { MonthlyHeatmap } from '@/components/charts/monthly-heatmap';
import { ChartTabPanel } from '@/components/chart-tab-panel';
import { TradesTable } from '@/components/trades-table';
import { ShowYourLosses } from '@/components/show-your-losses';
import { StatementHeader } from '@/components/statement-header';
import { MethodologyBand } from '@/components/methodology-band';
import { CutoverTimeline } from '@/components/cutover-timeline';
import { FooterAudit } from '@/components/footer-audit';
import {
  TRACK_RECORD_KPIS,
  EQUITY_CURVE,
  MONTHLY_AGGREGATES,
  ODS_MONTHLY_SUMMARIES,
  INSTRUMENT_AGGREGATES,
  HISTORICAL_TRADES,
  HISTORICAL_YEAR,
} from '@/lib/data';
import { bestTrades, worstTrades, bucketByR } from '@/lib/metrics';
import { formatCount } from '@/lib/format';

export default function TrackRecordPage() {
  const k = TRACK_RECORD_KPIS;
  const rBuckets = bucketByR(HISTORICAL_TRADES, 0.5);
  const best = bestTrades(HISTORICAL_TRADES, 5);
  const worst = worstTrades(HISTORICAL_TRADES, 5);
  const monthsCount = MONTHLY_AGGREGATES.length;
  const tradesPerMonth = monthsCount > 0 ? k.closedTrades / monthsCount : 0;

  return (
    <main className="relative overflow-x-hidden">
      {/* Aurora background bleu lumineux + grid pattern. */}
      <div
        aria-hidden
        className="tr-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[740px]"
      />
      <div
        aria-hidden
        className="tr-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[740px] opacity-20"
        style={{ maskImage: 'linear-gradient(180deg, black 0%, transparent 80%)' }}
      />

      {/* ─────────────────── BLOC 1 — Statement header institutionnel ─────────────────── */}
      <StatementHeader
        totalPercent={k.totalPercent}
        closedTrades={k.closedTrades}
        instruments={INSTRUMENT_AGGREGATES.length}
        firstTradeAt={k.firstTradeAt}
        lastTradeAt={k.lastTradeAt}
        months={monthsCount}
        maxDrawdownPercent={k.maxDrawdownPercent}
      />

      {/* ─────────────────── BLOC 2 — KPI strip dense (8 cells, Max DD en position 1 — Bridgewater inversé) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-8 sm:px-7" aria-label="Indicateurs clés">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 lg:gap-2.5">
          <KpiCard
            index={0}
            label="Drawdown max"
            value={<AnimatedNumber to={k.maxDrawdownPercent} decimals={1} />}
            suffix="%"
            caption="Pire creux peak-to-trough"
            tone="loss"
          />
          <KpiCard
            index={1}
            label="R cumulé"
            value={<AnimatedNumber to={k.totalR} decimals={1} prefix="+" />}
            suffix="R"
            caption={`${formatCount(k.closedTrades)} clôturés`}
            tone="primary"
          />
          <KpiCard
            index={2}
            label="Win rate"
            value={<AnimatedNumber to={k.winrate * 100} decimals={1} />}
            suffix="%"
            caption={`${formatCount(k.winCount)}W · ${formatCount(k.lossCount)}L · ${formatCount(k.beCount)}BE`}
            tone="primary"
          />
          <KpiCard
            index={3}
            label="Profit factor"
            value={
              <AnimatedNumber
                to={Number.isFinite(k.profitFactor) ? k.profitFactor : 99}
                decimals={2}
              />
            }
            caption="Σ gains / Σ pertes"
            tone="primary"
          />
          <KpiCard
            index={4}
            label="Expectancy"
            value={<AnimatedNumber to={k.expectancyR} decimals={2} prefix="+" />}
            suffix="R"
            caption="Van Tharp · R / trade"
            tone="gain"
          />
          <KpiCard
            index={5}
            label="Trades / mois"
            value={<AnimatedNumber to={tradesPerMonth} decimals={1} />}
            caption="Cadence moyenne documentée"
            tone="primary"
          />
          <KpiCard
            index={6}
            label="Instruments"
            value={<AnimatedNumber to={INSTRUMENT_AGGREGATES.length} decimals={0} />}
            caption="Distinct instruments traded"
            tone="primary"
          />
          <KpiCard
            index={7}
            label="Best streak"
            value={<AnimatedNumber to={k.bestStreak} decimals={0} />}
            caption={`Pire série · ${k.worstStreak} L`}
            tone="primary"
          />
        </div>
      </section>

      {/* ─────────────────── BLOC 3 — Méthodologie (4 colonnes Calc / Source / Excl / Audit) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-8 sm:px-7">
        <MethodologyBand />
      </section>

      {/* ─────────────────── BLOC 4 — Cutover timeline (historique → live) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-8 sm:px-7">
        <CutoverTimeline
          historicalCount={HISTORICAL_TRADES.length}
          historicalInstruments={INSTRUMENT_AGGREGATES.length}
          historicalLabel={`Jan – Nov ${HISTORICAL_YEAR}`}
          cutoverDate="2026-05-21"
          cutoverLabel="21 mai 2026"
        />
      </section>

      {/* ─────────────────── BLOC 5 — Main grid : ChartTabs (left 65%) + Sidebar (right 35%) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-7">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-5">
          <div className="lg:col-span-8">
            <ChartTabPanel
              equityCurve={EQUITY_CURVE}
              rBuckets={rBuckets}
              instruments={INSTRUMENT_AGGREGATES}
            />
          </div>
          <aside className="space-y-5 lg:col-span-4">
            <section className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold tracking-tight text-[var(--tr-t-1)]">
                  Performance mensuelle · {HISTORICAL_YEAR}
                </h2>
                <span className="text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
                  {monthsCount} mois
                </span>
              </div>
              <MonthlyHeatmap
                data={MONTHLY_AGGREGATES}
                odsSummaries={ODS_MONTHLY_SUMMARIES}
                year={HISTORICAL_YEAR}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--tr-t-3)]">
                Source verbatim ODS · Avril affiché en perte avec la même prégnance que les mois
                positifs.
              </p>
            </section>
            <section className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold tracking-tight text-[var(--tr-t-1)]">
                  Top 5 par R-multiple
                </h2>
                <span className="text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
                  Pires & meilleurs
                </span>
              </div>
              <ShowYourLosses bestTrades={best} worstTrades={worst} />
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--tr-t-3)]">
                Pertes et gains affichés côte-à-côte · anti-cherrypick par construction.
              </p>
            </section>
          </aside>
        </div>
      </section>

      {/* ─────────────────── BLOC 6 — Trade-by-trade table (audit trail) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-7">
        <SectionHeader
          eyebrow={`${formatCount(HISTORICAL_TRADES.length)} trades · ${monthsCount} mois · ${INSTRUMENT_AGGREGATES.length} instruments`}
          title="Journal trade-par-trade · audit trail"
          description={
            <>
              Aucun trade retiré. Filtre par résultat ci-dessous. Pertes en{' '}
              <span className="text-[var(--tr-loss)]">rouge</span>, gains en{' '}
              <span className="text-[var(--tr-gain)]">vert</span>, BE en gris — convention finance
              respectée.
            </>
          }
        />
        <TradesTable trades={HISTORICAL_TRADES} initialVisible={10} />
      </section>

      {/* ─────────────────── BLOC 7 — Disclaimer AMF complet ─────────────────── */}
      <section id="legal" className="mx-auto max-w-7xl px-5 pb-12 sm:px-7">
        <LegalDisclaimer />
      </section>

      {/* ─────────────────── BLOC 8 — Footer audit Bloomberg-grade ─────────────────── */}
      <FooterAudit
        closedTrades={k.closedTrades}
        totalTrades={HISTORICAL_TRADES.length}
        months={monthsCount}
        instruments={INSTRUMENT_AGGREGATES.length}
      />
    </main>
  );
}
