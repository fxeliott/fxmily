import { ArrowLeft, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { selectStorage } from '@/lib/storage';
import type { SerializedTrade } from '@/lib/trades/service';
import { emotionLabel } from '@/lib/trading/emotions';
import { SESSION_LABEL } from '@/lib/trading/sessions';
import { cn } from '@/lib/utils';

/**
 * Shared trade-detail rendering used by:
 *   - `/journal/[id]/page.tsx`             (member viewing their own trade)
 *   - `/admin/members/[id]/trades/[tradeId]/page.tsx` (admin variant)
 *
 * Élévation Sprint 1B : Card primary sur résultat hero (R réalisé big mono
 * avec drop-shadow lime/red selon outcome), Pill primitives, sémantique
 * long=ok / short=bad préservée. Sections cards default avec edge-top.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });

interface TradeDetailViewProps {
  trade: SerializedTrade;
  backHref: string;
  backLabel: string;
  closeHref: string | null;
  contextBadge?: string;
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
  const isWin = realizedR !== null && realizedR > 0;
  const isLoss = realizedR !== null && realizedR < 0;
  const isAdmin = !!contextBadge;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          {backLabel}
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="f-mono text-[28px] font-semibold leading-none tracking-[0.01em] text-[var(--t-1)] sm:text-[32px]">
            {trade.pair}
          </h1>
          <Pill tone={trade.direction === 'long' ? 'ok' : 'bad'}>
            {trade.direction === 'long' ? (
              <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" strokeWidth={2} />
            )}
            {trade.direction === 'long' ? 'LONG' : 'SHORT'}
          </Pill>
          {!trade.isClosed ? (
            <Pill tone="warn" dot="live">
              EN COURS
            </Pill>
          ) : null}
          {contextBadge ? (
            <Pill tone="acc">
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} />
              {contextBadge.toUpperCase()}
            </Pill>
          ) : null}
        </div>

        <p className="t-body text-[var(--t-3)]">
          Entré le{' '}
          <span className="font-mono tabular-nums text-[var(--t-2)]">
            {DATETIME_FMT.format(new Date(trade.enteredAt))}
          </span>{' '}
          · {SESSION_LABEL[trade.session]}
        </p>
      </header>

      {/* Open warning + close CTA */}
      {!trade.isClosed && closeHref ? (
        <div className="rounded-card border border-[oklch(0.834_0.158_80_/_0.30)] bg-[var(--warn-dim)] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--warn)]">Trade ouvert</span>
            <p className="t-body text-[var(--t-2)]">
              Ajoute le résultat et la capture à la sortie pour calculer ton R réalisé.
            </p>
          </div>
          <Link
            href={closeHref}
            className={cn(
              btnVariants({ kind: 'primary', size: 'm' }),
              'mt-3 w-full sm:mt-0 sm:w-auto',
            )}
          >
            Clôturer maintenant
          </Link>
        </div>
      ) : null}

      {/* Result hero card (closed only) */}
      {trade.isClosed && trade.outcome ? (
        <Card primary className="p-5">
          <div className="flex items-center justify-between">
            <span className="t-eyebrow">Résultat clôturé</span>
            <Pill tone={trade.outcome === 'win' ? 'ok' : trade.outcome === 'loss' ? 'bad' : 'mute'}>
              {trade.outcome === 'win' ? 'GAIN' : trade.outcome === 'loss' ? 'PERTE' : 'BREAK-EVEN'}
            </Pill>
          </div>
          {realizedR !== null ? (
            <div className="mt-3 flex items-baseline gap-3">
              <span
                className={cn(
                  'f-mono text-[48px] font-bold tabular-nums leading-none tracking-[-0.04em] sm:text-[56px]',
                  isWin ? 'text-[var(--ok)]' : isLoss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]',
                )}
                style={
                  isWin
                    ? { filter: 'drop-shadow(0 0 18px oklch(0.804 0.181 145 / 0.32))' }
                    : isLoss
                      ? { filter: 'drop-shadow(0 0 18px oklch(0.7 0.165 22 / 0.28))' }
                      : undefined
                }
              >
                {realizedR > 0 ? '+' : ''}
                {realizedR.toFixed(2)}R
              </span>
              <span className="t-eyebrow mb-1.5">R réalisé</span>
            </div>
          ) : null}
          {trade.realizedRSource === 'estimated' ? (
            <p className="t-cap mt-2 text-[var(--t-4)]">
              Valeur estimée — fournir le stop-loss au moment de l&apos;entrée permet un R exact.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Plan d'entrée */}
      <Card className="p-4">
        <h2 className="t-eyebrow mb-3">Plan d&apos;entrée</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="Prix entrée" value={NUMBER_FMT.format(Number(trade.entryPrice))} mono />
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
      </Card>

      {/* Émotion avant */}
      {trade.emotionBefore.length > 0 ? (
        <Card className="p-4">
          <h2 className="t-eyebrow mb-3">Émotion avant</h2>
          <ul className="flex flex-wrap gap-1.5">
            {trade.emotionBefore.map((slug) => (
              <li key={slug}>
                <Pill tone="mute">{emotionLabel(slug)}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Capture entrée */}
      {entryUrl ? (
        <section className="flex flex-col gap-2">
          <h2 className="t-eyebrow">Capture avant entrée</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entryUrl}
            alt={`Capture avant entrée du trade ${trade.pair}`}
            className="rounded-card w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
          />
        </section>
      ) : null}

      {/* Sortie (closed only) */}
      {trade.isClosed ? (
        <>
          <Card className="p-4">
            <h2 className="t-eyebrow mb-3">Sortie</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
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
          </Card>

          {trade.emotionAfter.length > 0 ? (
            <Card className="p-4">
              <h2 className="t-eyebrow mb-3">Émotion après</h2>
              <ul className="flex flex-wrap gap-1.5">
                {trade.emotionAfter.map((slug) => (
                  <li key={slug}>
                    <Pill tone="mute">{emotionLabel(slug)}</Pill>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {exitUrl ? (
            <section className="flex flex-col gap-2">
              <h2 className="t-eyebrow">Capture après sortie</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={exitUrl}
                alt={`Capture après sortie du trade ${trade.pair}`}
                className="rounded-card w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
              />
            </section>
          ) : null}
        </>
      ) : null}

      {/* Notes */}
      {trade.notes ? (
        <Card className="p-4">
          <h2 className="t-eyebrow mb-2">Notes</h2>
          <p className="t-body whitespace-pre-wrap leading-relaxed text-[var(--t-2)]">
            {trade.notes}
          </p>
        </Card>
      ) : null}

      {/* Footer admin/member-specific slot */}
      {footerSlot ? (
        <footer className="border-t border-[var(--b-default)] pt-4">{footerSlot}</footer>
      ) : null}

      {/* Admin watermark hint (J4 annotate placeholder) */}
      {isAdmin ? (
        <div className="rounded-control border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] px-3 py-2.5">
          <p className="t-cap text-[var(--t-2)]">
            <span className="font-medium text-[var(--cy)]">Vue admin · J4</span> — l&apos;outil
            d&apos;annotation (texte + vidéo Zoom) arrive au prochain jalon.
          </p>
        </div>
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
    tone === 'good'
      ? 'text-[var(--ok)]'
      : tone === 'bad'
        ? 'text-[var(--bad)]'
        : tone === 'neutral'
          ? 'text-[var(--t-3)]'
          : 'text-[var(--t-1)]';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-mono-cap text-[var(--t-4)]">{label}</dt>
      <dd className={cn('text-[14px] tabular-nums', mono && 'f-mono', toneClass)}>{value}</dd>
    </div>
  );
}
