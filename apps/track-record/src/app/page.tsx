import { LogoMark } from '@/components/logo-mark';
import { AnimatedNumber } from '@/components/animated-number';
import { EquityCurve } from '@/components/charts/equity-curve';
import { MonthlyHeatmap } from '@/components/charts/monthly-heatmap';
import { TradesTable } from '@/components/trades-table';
import { LegalDisclaimer } from '@/components/legal-disclaimer';
import {
  TRACK_RECORD_KPIS,
  EQUITY_CURVE,
  MONTHLY_AGGREGATES,
  ODS_MONTHLY_SUMMARIES,
  HISTORICAL_TRADES,
  HISTORICAL_YEAR,
} from '@/lib/data';

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

const LAST_UPDATE = new Date('2026-05-21T14:32:00+02:00');

export default function TrackRecordPage() {
  const k = TRACK_RECORD_KPIS;
  const monthsCount = MONTHLY_AGGREGATES.length;

  return (
    <main className="bg-[var(--bg)] text-[var(--text)]">
      {/* ─────────────────── Header — logo + nom seul ─────────────────── */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-5 sm:px-10">
          <LogoMark height={32} />
          <span className="t-caption text-[var(--text-muted)]">Performance vérifiée</span>
        </div>
      </header>

      {/* ─────────────────── Hero centré : chiffre + période ─────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pt-24 pb-16 text-center sm:px-10 sm:pt-32 sm:pb-24">
        <h1 className="t-h1 text-[var(--text-muted)]">Performance cumulée</h1>
        <div className="mt-6">
          <span className="t-display text-[var(--text)]">
            <AnimatedNumber to={k.totalPercent} decimals={1} prefix="+" suffix=" %" />
          </span>
        </div>
        <div
          aria-hidden
          className="mx-auto mt-8 h-px w-12"
          style={{ background: 'var(--accent)' }}
        />
        <p className="t-body mx-auto mt-6 max-w-md text-[var(--text-muted)]">
          Sur {monthsCount} mois — {HISTORICAL_YEAR}. {k.closedTrades} trades publiés en direct,
          avant exécution.
        </p>
      </section>

      {/* ─────────────────── Courbe equity centrée ─────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pb-24 sm:px-10">
        <EquityCurve data={EQUITY_CURVE} height={320} />
      </section>

      {/* ─────────────────── 3 chiffres inline (Gain / Recul / Trades gagnants) ─────────────────── */}
      <section aria-label="Indicateurs clés" className="mx-auto max-w-[1120px] px-6 pb-24 sm:px-10">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-24">
          <div className="text-center sm:text-left">
            <div className="t-caption">Performance cumulée</div>
            <div className="num mt-2 text-2xl font-medium text-[var(--positive)] sm:text-[28px]">
              {FR_PCT.format(k.totalPercent)} %
            </div>
          </div>
          <div className="text-center sm:text-left">
            <div className="t-caption">Recul maximum</div>
            <div className="num mt-2 text-2xl font-medium text-[var(--negative)] sm:text-[28px]">
              {FR_PCT.format(k.maxDrawdownPercent)} %
            </div>
          </div>
          <div className="text-center sm:text-left">
            <div className="t-caption">Trades gagnants</div>
            <div className="num mt-2 text-2xl font-medium text-[var(--text)] sm:text-[28px]">
              {(k.winrate * 100).toFixed(0).replace('.', ',')} %
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────── Heatmap mensuel ─────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pb-24 sm:px-10">
        <h2 className="t-h1 mb-8 text-[var(--text)]">Mois par mois</h2>
        <MonthlyHeatmap
          data={MONTHLY_AGGREGATES}
          odsSummaries={ODS_MONTHLY_SUMMARIES}
          year={HISTORICAL_YEAR}
        />
        <p className="t-micro mt-6">
          Le mois en recul est affiché avec la même prégnance que les mois positifs.
        </p>
      </section>

      {/* ─────────────────── Trades table ─────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pb-24 sm:px-10">
        <h2 className="t-h1 mb-2 text-[var(--text)]">Liste des trades</h2>
        <p className="t-body mb-8 text-[var(--text-muted)]">
          {k.closedTrades} trades clôturés, dans l&apos;ordre chronologique. Aucun trade retiré.
        </p>
        <TradesTable trades={HISTORICAL_TRADES} initialVisible={12} />
      </section>

      {/* ─────────────────── Footer minimal (1 ligne dernière maj + disclaimer condensé) ─────────────────── */}
      <footer className="mx-auto max-w-[1120px] px-6 pt-12 pb-16 sm:px-10">
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
  );
}
