import Link from 'next/link';

import { selectStorage } from '@/lib/storage';
import { emotionLabel } from '@/lib/trading/emotions';
import { SESSION_LABEL } from '@/lib/trading/sessions';
import type { SerializedTrade } from '@/lib/trades/service';

/**
 * Shared trade-detail rendering used by:
 *   - `/journal/[id]/page.tsx`             (member viewing their own trade)
 *   - `/admin/members/[id]/trades/[tradeId]/page.tsx` (admin viewing a member's trade)
 *
 * The two surfaces share the same content (header, plan, screens, notes) but
 * differ on the back link, the close-out CTA, and the trailing footer
 * (delete vs. annotate). Anything that varies is plugged in via props or
 * children — the component itself owns no role-specific logic.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });

interface TradeDetailViewProps {
  trade: SerializedTrade;
  /**
   * Where the back link should send the user. Member view → `/journal`,
   * admin view → `/admin/members/[memberId]`.
   */
  backHref: string;
  backLabel: string;
  /**
   * Close-out CTA when the trade is open. `null` to hide (admin variant has
   * no member-side close button — admins don't close trades on behalf of users).
   */
  closeHref: string | null;
  /** Optional badge displayed alongside the title (e.g. "Vue admin"). */
  contextBadge?: string;
  /**
   * Trailing footer slot. Member view passes `<DeleteTradeButton />`; admin
   * view will pass the annotate CTA in J4 (passing `null` for now keeps the
   * shared layout consistent — the J3 admin view simply has no footer).
   */
  footerSlot?: React.ReactNode;
}

export function TradeDetailView({
  trade,
  backHref,
  backLabel,
  closeHref,
  contextBadge,
  footerSlot,
}: TradeDetailViewProps) {
  const storage = selectStorage();
  const entryUrl = trade.screenshotEntryKey ? storage.getReadUrl(trade.screenshotEntryKey) : null;
  const exitUrl = trade.screenshotExitKey ? storage.getReadUrl(trade.screenshotExitKey) : null;

  const realizedR = trade.realizedR ? Number(trade.realizedR) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href={backHref}
          className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-foreground font-mono text-3xl font-semibold tracking-tight">
            {trade.pair}
          </h1>
          <span
            className={[
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
              trade.direction === 'long'
                ? 'border-success/40 text-success'
                : 'border-danger/40 text-danger',
            ].join(' ')}
          >
            {trade.direction === 'long' ? 'Long' : 'Short'}
          </span>
          {!trade.isClosed ? (
            <span className="border-warning/40 text-warning inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
              Ouvert
            </span>
          ) : null}
          {contextBadge ? (
            <span className="border-accent/40 text-accent inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
              {contextBadge}
            </span>
          ) : null}
        </div>
        <p className="text-muted text-sm">
          Entré le {DATETIME_FMT.format(new Date(trade.enteredAt))} · {SESSION_LABEL[trade.session]}
        </p>
      </header>

      {!trade.isClosed && closeHref ? (
        <div className="border-warning/40 bg-warning/5 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-foreground text-sm">
            Ce trade est ouvert. Quand il est clôturé, ajoute le résultat et la capture sortie.
          </p>
          <Link
            href={closeHref}
            className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Clôturer maintenant
          </Link>
        </div>
      ) : null}

      {trade.isClosed && trade.outcome ? (
        <section className="bg-card flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted text-xs uppercase tracking-widest">Résultat</span>
            <span
              className={[
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                trade.outcome === 'win'
                  ? 'border-success/40 text-success'
                  : trade.outcome === 'loss'
                    ? 'border-danger/40 text-danger'
                    : 'text-muted border-[var(--border)]',
              ].join(' ')}
            >
              {trade.outcome === 'win' ? 'Gain' : trade.outcome === 'loss' ? 'Perte' : 'Break-even'}
            </span>
          </div>
          {realizedR !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted text-sm">R réalisé</span>
              <span
                className={[
                  'font-mono text-2xl font-semibold tabular-nums sm:text-3xl',
                  realizedR > 0 ? 'text-success' : realizedR < 0 ? 'text-danger' : 'text-muted',
                ].join(' ')}
              >
                {realizedR > 0 ? '+' : ''}
                {realizedR.toFixed(2)}R
              </span>
            </div>
          ) : null}
          {trade.realizedRSource === 'estimated' ? (
            <p className="text-muted text-xs">
              Valeur estimée — un stop-loss permettrait un R réalisé exact.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="bg-card flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-muted text-xs uppercase tracking-widest">Plan d&apos;entrée</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <Stat label="Prix d'entrée" value={NUMBER_FMT.format(Number(trade.entryPrice))} mono />
          <Stat label="Lot / contrats" value={NUMBER_FMT.format(Number(trade.lotSize))} mono />
          <Stat
            label="Stop-loss"
            value={trade.stopLossPrice ? NUMBER_FMT.format(Number(trade.stopLossPrice)) : '—'}
            mono
          />
          <Stat label="R:R prévu" value={Number(trade.plannedRR).toFixed(2)} mono />
          <Stat
            label="Plan respecté"
            value={trade.planRespected ? 'Oui' : 'Non'}
            tone={trade.planRespected ? 'good' : 'bad'}
          />
          <Stat
            label="Hedge respecté"
            value={trade.hedgeRespected === null ? 'N/A' : trade.hedgeRespected ? 'Oui' : 'Non'}
            tone={trade.hedgeRespected === null ? 'neutral' : trade.hedgeRespected ? 'good' : 'bad'}
          />
        </dl>
      </section>

      {trade.emotionBefore.length > 0 ? (
        <section className="bg-card flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-muted text-xs uppercase tracking-widest">Émotion avant</h2>
          <ul className="flex flex-wrap gap-2">
            {trade.emotionBefore.map((slug) => (
              <li
                key={slug}
                className="bg-secondary/50 text-foreground inline-flex items-center rounded-full px-3 py-1 text-xs"
              >
                {emotionLabel(slug)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {entryUrl ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted text-xs uppercase tracking-widest">Capture avant entrée</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entryUrl}
            alt={`Capture avant entrée du trade ${trade.pair}`}
            className="w-full rounded-lg border border-[var(--border)] object-contain"
          />
        </section>
      ) : null}

      {trade.isClosed ? (
        <>
          <section className="bg-card flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
            <h2 className="text-muted text-xs uppercase tracking-widest">Sortie</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Stat
                label="Date sortie"
                value={trade.exitedAt ? DATETIME_FMT.format(new Date(trade.exitedAt)) : '—'}
              />
              <Stat
                label="Prix sortie"
                value={trade.exitPrice ? NUMBER_FMT.format(Number(trade.exitPrice)) : '—'}
                mono
              />
            </dl>
          </section>

          {trade.emotionAfter.length > 0 ? (
            <section className="bg-card flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
              <h2 className="text-muted text-xs uppercase tracking-widest">Émotion après</h2>
              <ul className="flex flex-wrap gap-2">
                {trade.emotionAfter.map((slug) => (
                  <li
                    key={slug}
                    className="bg-secondary/50 text-foreground inline-flex items-center rounded-full px-3 py-1 text-xs"
                  >
                    {emotionLabel(slug)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {exitUrl ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted text-xs uppercase tracking-widest">Capture après sortie</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={exitUrl}
                alt={`Capture après sortie du trade ${trade.pair}`}
                className="w-full rounded-lg border border-[var(--border)] object-contain"
              />
            </section>
          ) : null}
        </>
      ) : null}

      {trade.notes ? (
        <section className="bg-card flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-muted text-xs uppercase tracking-widest">Notes</h2>
          <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
            {trade.notes}
          </p>
        </section>
      ) : null}

      {footerSlot ? (
        <footer className="border-t border-[var(--border)] pt-4">{footerSlot}</footer>
      ) : null}
    </main>
  );
}

function Stat({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-foreground';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className={['text-sm tabular-nums', mono ? 'font-mono' : '', toneClass].join(' ')}>
        {value}
      </dd>
    </div>
  );
}
