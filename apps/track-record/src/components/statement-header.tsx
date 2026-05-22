import { LogoMark } from './logo-mark';
import { VerificationRow } from './verification-row';
import { CompactDisclaimer } from './compact-disclaimer';
import { AnimatedNumber } from './animated-number';
import { formatCount, formatDateIso } from '@/lib/format';

interface StatementHeaderProps {
  /** Total cumulative percent (the hero focal number). */
  totalPercent: number;
  /** Number of closed trades (audit metric). */
  closedTrades: number;
  /** Number of distinct instruments. */
  instruments: number;
  /** First documented trade date. */
  firstTradeAt: Date | null;
  /** Last documented trade date. */
  lastTradeAt: Date | null;
  /** Months covered. */
  months: number;
  /** Max drawdown (signed negative %) — co-displayed with the hero to defeat
   * cherry-pick perception (Bridgewater inverted pattern). */
  maxDrawdownPercent: number;
  /** Last sync timestamp (build time for now, T2 will be DB updatedAt). */
  lastSyncAt?: Date | undefined;
}

function diffDays(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.round(ms / 86_400_000);
}

const FR_DATE_LONG = new Intl.DateTimeFormat('fr-FR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const FR_TIME = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

/**
 * Statement Header institutionnel — pattern Bloomberg / Mercury / Darwinex.
 * Drop le H1 catchphrase "Les résultats, en clair." (DIY-marketing flag par
 * ui-designer audit 2026-05-22). Le focal devient le BIG NUMBER `+215,8 %`
 * gradient bleu — c'est CE chiffre que l'investisseur est venu vérifier,
 * tout le reste sert.
 *
 * Sous le big number : période exacte + count trades + count instruments
 * en 13px tabular-nums (signal "uninterrupted since X"). Verification row
 * 4 icônes (CheckCircle / Clock / Users / FileText). Last-sync timestamp
 * avec `<time dateTime>` (SR-friendly). Logo 96px à droite (sobre, pas
 * focal — le focal est le chiffre).
 *
 * Source : ui-designer audit subagent + research institutional patterns
 * (Myfxbook public profile + Darwinex investor dashboard + Bridgewater
 * statement format).
 */
export function StatementHeader({
  totalPercent,
  closedTrades,
  instruments,
  firstTradeAt,
  lastTradeAt,
  months,
  maxDrawdownPercent,
  lastSyncAt,
}: StatementHeaderProps) {
  const periodDays = firstTradeAt && lastTradeAt ? diffDays(firstTradeAt, lastTradeAt) : null;
  const sync = lastSyncAt ?? new Date('2026-05-21T14:32:00+02:00');

  return (
    <header className="mx-auto max-w-7xl px-5 pt-10 pb-6 sm:px-7 sm:pt-14 sm:pb-8">
      {/* Eyebrow factuel */}
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div className="text-[11px] font-medium tracking-[0.16em] text-[var(--tr-acc-hi)] uppercase">
          Track record · Eliott (fxmily) · public statement
        </div>
        <div className="hidden font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums sm:block">
          v1 · 2026-05-21
        </div>
      </div>

      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto] lg:gap-12">
        {/* Left column : BIG HERO NUMBER + period + verification row */}
        <div className="order-2 lg:order-1">
          {/* H1 = the big number (SR-first). */}
          <h1
            className="font-mono text-[3.75rem] leading-none font-semibold tracking-[-0.04em] tabular-nums sm:text-[5rem] lg:text-[6rem]"
            aria-label={`Cumulé arithmétique : ${totalPercent.toFixed(2)} pourcent`}
          >
            <span className="bg-gradient-to-r from-[#60A5FA] via-[#2596FF] to-[#0085FF] bg-clip-text text-transparent">
              <AnimatedNumber to={totalPercent} decimals={1} prefix="+" /> %
            </span>
          </h1>
          <p className="mt-3 font-mono text-[13px] leading-relaxed text-[var(--tr-t-2)] tabular-nums">
            Σ % cumulé arithmétique
            {firstTradeAt && lastTradeAt ? (
              <>
                {' · '}
                <time dateTime={firstTradeAt.toISOString()}>
                  {formatDateIso(firstTradeAt)}
                </time> →{' '}
                <time dateTime={lastTradeAt.toISOString()}>{formatDateIso(lastTradeAt)}</time> (
                {periodDays ?? '—'} jours · {months} mois)
              </>
            ) : null}
            {' · '}
            <span>{formatCount(closedTrades)} trades clôturés</span>
            {' · '}
            <span>{instruments} instruments</span>
            {' · '}
            <span className="text-[var(--tr-loss)]">
              drawdown max {maxDrawdownPercent.toFixed(2).replace('.', ',')} %
            </span>
          </p>

          {/* Compact AMF disclaimer collé au chiffre (audit "IMMÉDIATEMENT collé au chiffre"). */}
          <div className="mt-5">
            <CompactDisclaimer />
          </div>

          {/* Verification row 4 icons */}
          <div className="mt-6">
            <VerificationRow />
          </div>

          {/* Last sync timestamp */}
          <div className="mt-5 inline-flex items-center gap-2 font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">
            <span aria-hidden className="relative inline-flex h-2 w-2">
              <span className="tr-ping absolute inline-flex h-full w-full rounded-full bg-[var(--tr-acc)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--tr-acc)]" />
            </span>
            Dernière mise à jour ·{' '}
            <time dateTime={sync.toISOString()}>
              {FR_DATE_LONG.format(sync)} {FR_TIME.format(sync)}
            </time>
          </div>
        </div>

        {/* Right column : logo sobre 96px (focal = chiffre, pas le logo). */}
        <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
          <LogoMark size={104} />
        </div>
      </div>
    </header>
  );
}
