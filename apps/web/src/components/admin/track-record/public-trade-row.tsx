import { Card } from '@/components/ui/card';
import { Pill, type PillProps } from '@/components/ui/pill';
import type { SerializedPublicTrade } from '@/lib/admin/public-trade-service';

import { PublicTradeActionsRow } from './public-trade-actions-row';

interface PublicTradeRowProps {
  trade: SerializedPublicTrade;
}

const STATUS_LABEL: Record<SerializedPublicTrade['status'], string> = {
  open: 'Ouvert',
  closed: 'Clôturé',
  break_even: 'BE',
};

const STATUS_TONE: Record<SerializedPublicTrade['status'], PillProps['tone']> = {
  open: 'cy',
  closed: 'acc',
  break_even: 'mute',
};

const SEGMENT_LABEL: Record<SerializedPublicTrade['segment'], string> = {
  historical: 'Historique',
  live: 'Live',
};

const SEGMENT_TONE: Record<SerializedPublicTrade['segment'], PillProps['tone']> = {
  historical: 'mute',
  live: 'acc',
};

const DIRECTION_LABEL: Record<NonNullable<SerializedPublicTrade['direction']>, string> = {
  long: 'Long',
  short: 'Short',
};

const DIRECTION_TONE: Record<NonNullable<SerializedPublicTrade['direction']>, PillProps['tone']> = {
  long: 'ok',
  short: 'bad',
};

/**
 * Row de la list `/admin/track-record`. Server Component (pas d'interactivité
 * — toutes les actions sont déléguées à `<PublicTradeActionsRow>` client).
 *
 * Display : ordinal + segment pill + status pill + direction pill + instrument
 * + R + % + date enteredAt + partial badge si > 0 + actions row.
 */
export function PublicTradeRow({ trade }: PublicTradeRowProps) {
  const dateLabel = formatDate(trade.enteredAt);
  const rNum = trade.resultR !== null ? Number(trade.resultR) : null;
  const isWin = rNum !== null && rNum > 0;
  const isLoss = rNum !== null && rNum < 0;
  // T5 audit Phase H — a11y-reviewer T1#2 : signed R label avec `+` prefix
  // pour les gains. Sans préfixe explicite, le signal win/loss reposait
  // uniquement sur la couleur (WCAG 1.4.1 Use of Color). Les utilisateurs
  // daltoniens (deutéranopie ~5% population masculine) ne distinguaient pas
  // `+1.50 R` vert de `-1.50 R` rouge si la couleur est désaturée.
  // `formatSignedPercent` (helper bas du fichier) avait déjà ce pattern.
  const resultLabel = rNum === null ? '—' : `${rNum > 0 ? '+' : ''}${rNum.toFixed(2)} R`;
  const resultAriaLabel: string | undefined =
    rNum === null ? undefined : isWin ? 'gain' : isLoss ? 'perte' : 'break-even';
  const percentLabel =
    trade.resultPercent !== null ? formatSignedPercent(Number(trade.resultPercent)) : null;

  return (
    <Card className="p-4" edge={false}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-eyebrow-lg text-[var(--t-3)]">#{trade.ordinal}</span>
            <Pill tone={SEGMENT_TONE[trade.segment]}>{SEGMENT_LABEL[trade.segment]}</Pill>
            <Pill tone={STATUS_TONE[trade.status]} dot={trade.status === 'open' ? 'live' : false}>
              {STATUS_LABEL[trade.status]}
            </Pill>
            {trade.direction ? (
              <Pill tone={DIRECTION_TONE[trade.direction]}>{DIRECTION_LABEL[trade.direction]}</Pill>
            ) : null}
            {!trade.isPublished ? <Pill tone="warn">Brouillon</Pill> : null}
            {trade.partialsCount > 0 ? (
              <Pill tone="cy">
                {trade.partialsCount} leg{trade.partialsCount > 1 ? 's' : ''}
              </Pill>
            ) : null}
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-base font-semibold tracking-tight text-[var(--t-1)]">
              {trade.instrument}
            </h3>
            <span
              className={`text-sm font-semibold tabular-nums ${
                isWin ? 'text-[var(--ok)]' : isLoss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]'
              }`}
              aria-label={resultAriaLabel ? `${resultLabel} — ${resultAriaLabel}` : undefined}
            >
              {resultLabel}
            </span>
            {percentLabel ? (
              <span
                className={`text-xs tabular-nums ${
                  isWin ? 'text-[var(--ok)]' : isLoss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]'
                }`}
              >
                {percentLabel}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--t-3)]">
            <span className="tabular-nums">{dateLabel}</span>
            {trade.session ? <span className="capitalize">{trade.session}</span> : null}
            {trade.setup ? <span>· {trade.setup}</span> : null}
            <span className="font-mono">risque {Number(trade.riskPercent).toFixed(2)}%</span>
          </div>
        </div>
        <PublicTradeActionsRow
          publicTradeId={trade.id}
          initialPublished={trade.isPublished}
          ordinal={trade.ordinal}
          instrument={trade.instrument}
        />
      </div>
    </Card>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function formatSignedPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)} %`;
}
