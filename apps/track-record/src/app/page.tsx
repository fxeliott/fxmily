import { LogoMark } from '@/components/logo-mark';
import { AnimatedNumber } from '@/components/animated-number';
import { KpiCard } from '@/components/kpi-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { SegmentDivider } from '@/components/segment-divider';
import { LegalDisclaimer } from '@/components/legal-disclaimer';
import { CompactDisclaimer } from '@/components/compact-disclaimer';
import { SectionHeader } from '@/components/section-header';
import { MonthlyHeatmap } from '@/components/charts/monthly-heatmap';
import { ChartTabPanel } from '@/components/chart-tab-panel';
import { TradesTable } from '@/components/trades-table';
import { ShowYourLosses } from '@/components/show-your-losses';
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

  return (
    <main className="relative overflow-x-hidden">
      {/* Aurora background bleu lumineux + grid pattern (mask towards bottom). */}
      <div
        aria-hidden
        className="tr-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px]"
      />
      <div
        aria-hidden
        className="tr-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] opacity-25"
        style={{ maskImage: 'linear-gradient(180deg, black 0%, transparent 75%)' }}
      />

      {/* ─────────────────── HERO BAND (≈220px) ─────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pt-10 pb-6 sm:px-7 sm:pt-14 sm:pb-8">
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto] lg:gap-10">
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <div className="mb-2 text-[11px] font-medium tracking-[0.16em] text-[var(--tr-acc-hi)] uppercase">
              Track record · fxmily
            </div>
            <h1
              className="mb-3 max-w-3xl text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.025em] text-[var(--tr-t-1)] sm:text-[3rem] lg:text-[3.5rem]"
              style={{ fontFamily: 'var(--tr-font-display)' }}
            >
              Les résultats,{' '}
              <span className="bg-gradient-to-r from-[#60A5FA] via-[#2596FF] to-[#0085FF] bg-clip-text text-transparent">
                en clair.
              </span>
            </h1>
            <p className="mx-auto mb-4 max-w-2xl text-[14px] leading-relaxed text-[var(--tr-t-2)] sm:text-[15px] lg:mx-0">
              Tous les trades de la fxmily et d&apos;Eliott, partagés en live avec les membres
              présents à la réunion d&apos;analyse du jour. Pertes affichées avec la même mise en
              avant que les gains. Aucune période exclue.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5 lg:justify-start">
              <VerifiedBadge label="Trades partagés en live" />
              <VerifiedBadge label="Pertes incluses" />
              <VerifiedBadge label="Résultats en %, jamais en €" />
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">
                <span aria-hidden className="relative inline-flex h-2 w-2">
                  <span className="tr-ping absolute inline-flex h-full w-full rounded-full bg-[var(--tr-acc)] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--tr-acc)]" />
                </span>
                Mis à jour · 2026-05-21
              </span>
              <CompactDisclaimer />
            </div>
          </div>
          <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
            <LogoMark size={148} />
          </div>
        </div>
      </section>

      {/* ─────────────── KPI STRIP (8 cells, dense horizontal) ─────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-8 sm:px-7">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 lg:gap-2.5">
          <KpiCard
            index={0}
            label="Cumulé"
            value={<AnimatedNumber to={k.totalPercent} decimals={1} prefix="+" />}
            suffix="%"
            caption={`${monthsCount} mois ${HISTORICAL_YEAR}`}
            tone="gain"
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
            label="Max DD"
            value={<AnimatedNumber to={k.maxDrawdownPercent} decimals={1} />}
            suffix="%"
            caption="Pire creux observé"
            tone="loss"
          />
          <KpiCard
            index={6}
            label="Instruments"
            value={<AnimatedNumber to={INSTRUMENT_AGGREGATES.length} decimals={0} />}
            caption="Paires diversifiées"
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

      {/* ──────────── MAIN GRID : ChartTabs (left 65%) + Sidebar (right 35%) ──────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-7">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-5">
          {/* Tab-driven main panel — Equity / Drawdown / R-dist / Instruments */}
          <div className="lg:col-span-8">
            <ChartTabPanel
              equityCurve={EQUITY_CURVE}
              rBuckets={rBuckets}
              instruments={INSTRUMENT_AGGREGATES}
            />
          </div>
          {/* Sidebar : heatmap + show-your-losses (Bridgewater symmetric) */}
          <aside className="space-y-5 lg:col-span-4">
            <section className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold tracking-tight text-[var(--tr-t-1)]">
                  Mensuel
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
                Source verbatim ODS · Avril en perte affiché avec la même prégnance.
              </p>
            </section>
            <section className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="text-base font-semibold tracking-tight text-[var(--tr-t-1)]">
                  Pires & meilleurs
                </h2>
                <span className="text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
                  Bridgewater
                </span>
              </div>
              <ShowYourLosses bestTrades={best} worstTrades={worst} />
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--tr-t-3)]">
                Pertes et gains affichés côte-à-côte — anti-cherrypick par construction.
              </p>
            </section>
          </aside>
        </div>
      </section>

      {/* ──────────────── TABLE EXCERPT 10 ROWS + CTA EXPAND ──────────────── */}
      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-7">
        <SectionHeader
          eyebrow={`${formatCount(HISTORICAL_TRADES.length)} trades · ${monthsCount} mois · ${INSTRUMENT_AGGREGATES.length} instruments`}
          title="Tous les trades"
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

      {/* ──────────────── AMF DISCLAIMER FULL ──────────────── */}
      <section id="legal" className="mx-auto max-w-7xl px-5 pb-12 sm:px-7">
        <LegalDisclaimer />
      </section>

      {/* ──────────────── DIVIDER REFONTE + BLOC LIVE PLACEHOLDER ──────────────── */}
      <SegmentDivider date="2026-05-21" label="Refonte structurelle" />
      <section className="mx-auto max-w-7xl px-5 pb-24 sm:px-7">
        <div className="text-center">
          <div className="mb-3 text-[11px] font-medium tracking-[0.16em] text-[var(--tr-acc-hi)] uppercase">
            Bloc live · à partir du 21 mai 2026
          </div>
          <h2
            className="mb-3 text-2xl font-semibold tracking-[-0.01em] text-[var(--tr-t-1)] sm:text-3xl"
            style={{ fontFamily: 'var(--tr-font-display)' }}
          >
            Chaque trade, en direct.
          </h2>
          <p className="mx-auto max-w-xl text-[14px] leading-relaxed text-[var(--tr-t-2)] sm:text-[15px]">
            À partir du{' '}
            <span className="font-mono text-[var(--tr-t-1)] tabular-nums">21 mai 2026</span>, chaque
            entrée et chaque sortie est horodatée et partagée en direct avec les membres présents à
            la réunion d&apos;analyse du jour.
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--tr-b-subtle)] py-8 text-center text-[11px] text-[var(--tr-t-3)]">
        <p className="font-mono tabular-nums">
          © Fxmily · {new Date().getFullYear()} · Track record public · Performances passées ne
          préjugent pas des performances futures
        </p>
      </footer>
    </main>
  );
}
