import { LogoMark } from '@/components/logo-mark';
import { AnimatedNumber } from '@/components/animated-number';
import { KpiCard } from '@/components/kpi-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { SegmentDivider } from '@/components/segment-divider';
import { LegalDisclaimer } from '@/components/legal-disclaimer';
import { SectionHeader } from '@/components/section-header';
import { EquityCurve } from '@/components/charts/equity-curve';
import { DrawdownUnderwater } from '@/components/charts/drawdown-underwater';
import { MonthlyHeatmap } from '@/components/charts/monthly-heatmap';
import { RDistribution } from '@/components/charts/r-distribution';
import { InstrumentBreakdown } from '@/components/charts/instrument-breakdown';
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
import { CompactDisclaimer } from '@/components/compact-disclaimer';
import { bestTrades, worstTrades, bucketByR } from '@/lib/metrics';
import { formatCount, formatPercent } from '@/lib/format';

export default function TrackRecordPage() {
  const k = TRACK_RECORD_KPIS;
  const rBuckets = bucketByR(HISTORICAL_TRADES, 0.5);
  const best = bestTrades(HISTORICAL_TRADES, 5);
  const worst = worstTrades(HISTORICAL_TRADES, 5);
  const monthsCount = MONTHLY_AGGREGATES.length;

  return (
    <main className="relative overflow-x-hidden">
      {/* Aurora background — radial gradients bleu lumineux subtil. */}
      <div
        aria-hidden
        className="tr-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px]"
      />
      <div
        aria-hidden
        className="tr-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px] opacity-25"
        style={{ maskImage: 'linear-gradient(180deg, black 0%, transparent 80%)' }}
      />

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={112} className="mb-8" />

          <div className="mb-3 text-[11px] font-medium tracking-[0.16em] text-[var(--tr-acc-hi)] uppercase">
            Track record · fxmily
          </div>
          <h1
            className="mb-5 max-w-3xl text-[2.5rem] leading-[1.04] font-semibold tracking-[-0.025em] text-[var(--tr-t-1)] sm:text-[3.5rem] lg:text-[4rem]"
            style={{ fontFamily: 'var(--tr-font-display)' }}
          >
            Les résultats,
            <br />
            <span className="bg-gradient-to-r from-[#60A5FA] via-[#2596FF] to-[#0085FF] bg-clip-text text-transparent">
              en clair.
            </span>
          </h1>
          <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-[var(--tr-t-2)] sm:text-[17px]">
            Tous les trades de la fxmily et d&apos;Eliott, partagés en live avec les membres
            présents à la réunion d&apos;analyse du jour. Pertes affichées avec la même mise en
            avant que les gains. Aucune période exclue.
          </p>

          {/* Trust-signal stack (Myfxbook anatomy). */}
          <div className="mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <VerifiedBadge label="Trades partagés en live" />
            <VerifiedBadge label="Pertes incluses" />
            <VerifiedBadge label="Résultats en %, jamais en €" />
          </div>
          <div className="inline-flex items-center gap-2 font-mono text-[12px] text-[var(--tr-t-3)] tabular-nums">
            <span aria-hidden className="relative inline-flex h-2 w-2">
              <span className="tr-ping absolute inline-flex h-full w-full rounded-full bg-[var(--tr-acc)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--tr-acc)]" />
            </span>
            Mis à jour · 2026-05-21
          </div>

          {/* AMF inline disclaimer (T0.5 a11y audit T3.2 — "en bonne place"). */}
          <div className="mt-6">
            <CompactDisclaimer />
          </div>
        </div>
      </section>

      {/* ──────────────────── KPI GRID ──────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          <KpiCard
            index={0}
            label="Résultat cumulé"
            value={<AnimatedNumber to={k.totalPercent} decimals={1} prefix="+" />}
            suffix="%"
            caption={`Sur ${monthsCount} mois consécutifs, ${HISTORICAL_YEAR}`}
            tone="gain"
          />
          <KpiCard
            index={1}
            label="R cumulé"
            value={<AnimatedNumber to={k.totalR} decimals={1} prefix="+" />}
            suffix="R"
            caption={`${formatCount(k.closedTrades)} trades clôturés`}
            tone="primary"
          />
          <KpiCard
            index={2}
            label="Win rate"
            value={<AnimatedNumber to={k.winrate * 100} decimals={1} />}
            suffix="%"
            caption={`${formatCount(k.winCount)} gains · ${formatCount(k.lossCount)} pertes · ${formatCount(k.beCount)} BE`}
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
            suffix="R / trade"
            caption="Van Tharp · R moyen par trade"
            tone="gain"
          />
          <KpiCard
            index={5}
            label="Drawdown max"
            value={<AnimatedNumber to={k.maxDrawdownPercent} decimals={1} />}
            suffix="%"
            caption="Plus grosse perte cumulée temporaire"
            tone="loss"
          />
          <KpiCard
            index={6}
            label="Instruments tradés"
            value={<AnimatedNumber to={INSTRUMENT_AGGREGATES.length} decimals={0} />}
            caption="Forex majeures, indices, métaux"
            tone="primary"
          />
          <KpiCard
            index={7}
            label="Streak max gagnant"
            value={<AnimatedNumber to={k.bestStreak} decimals={0} />}
            caption={`Pire série perdante · ${k.worstStreak} consécutifs`}
            tone="primary"
          />
        </div>
      </section>

      {/* ────────────────── EQUITY CURVE ────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <SectionHeader
          eyebrow="Cumulé arithmétique des résultats %"
          title="Courbe d'équity"
          description={
            <>
              Somme arithmétique chronologique de tous les trades clôturés (trade #1 → #
              {HISTORICAL_TRADES.length}, ordinal d&apos;import). Chaque pic et chaque creux est
              lisible — y compris le drawdown d&apos;avril {HISTORICAL_YEAR}.
            </>
          }
        />
        <div className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-6">
          <EquityCurve data={EQUITY_CURVE} height={380} />
        </div>
      </section>

      {/* ───── DRAWDOWN UNDERWATER + MONTHLY HEATMAP ───── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionHeader
              eyebrow={`Drawdown · point bas ${formatPercent(k.maxDrawdownPercent, { signed: true })}`}
              title="Résilience sous l'eau"
              description="Mesure du décrochage cumulé sous le pic. La courbe revient à 0 = nouvelle high atteinte."
            />
            <div className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-6">
              <DrawdownUnderwater data={EQUITY_CURVE} height={260} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <SectionHeader
              eyebrow={`${monthsCount} mois consécutifs`}
              title="Mensuel"
              description={
                <>
                  Source verbatim ODS (Janvier→Novembre {HISTORICAL_YEAR}). Avril en perte affiché
                  avec la même prégnance que les mois gagnants.
                </>
              }
            />
            <div className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-6">
              <MonthlyHeatmap data={MONTHLY_AGGREGATES} odsSummaries={ODS_MONTHLY_SUMMARIES} />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── R DISTRIBUTION + INSTRUMENTS ─────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <SectionHeader
              eyebrow="Histogramme · buckets 0,5R"
              title="Distribution des R"
              description="Visualisation Van Tharp — l'asymétrie wins/losses est la prémisse de l'edge."
            />
            <div className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-4 sm:p-6">
              <RDistribution buckets={rBuckets} height={260} />
            </div>
          </div>
          <div>
            <SectionHeader
              eyebrow={`Top ${Math.min(8, INSTRUMENT_AGGREGATES.length)} sur ${INSTRUMENT_AGGREGATES.length}`}
              title="Performance par instrument"
              description="Répartition du volume — la diversification est lisible, le focus aussi."
            />
            <div className="overflow-hidden rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)]">
              <InstrumentBreakdown data={INSTRUMENT_AGGREGATES} limit={8} />
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────── SHOW YOUR LOSSES ──────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <SectionHeader
          eyebrow="Transparence radicale · Bridgewater pattern"
          title="Pires et meilleurs trades"
          description={
            <>
              Les 5 pires affichés avec la même prégnance que les 5 meilleurs. La perte est une
              donnée comme une autre — pas un fait à minimiser.
            </>
          }
        />
        <ShowYourLosses bestTrades={best} worstTrades={worst} />
      </section>

      {/* ─────────────────── TRADES TABLE ─────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
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
        <TradesTable trades={HISTORICAL_TRADES} initialVisible={25} />
      </section>

      {/* ────────────── DISCLAIMER AMF INLINE ────────────── */}
      <section id="legal" className="mx-auto max-w-6xl px-6 pb-12">
        <LegalDisclaimer />
      </section>

      {/* ─────────────── DIVIDER REFONTE ─────────────── */}
      <SegmentDivider date="2026-05-21" label="Refonte structurelle" />

      {/* ──────────── BLOC LIVE — placeholder T0 ──────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
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
          <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-[var(--tr-t-2)]">
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
