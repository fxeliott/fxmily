import 'server-only';

import { Sparkles } from 'lucide-react';

import { Pill } from '@/components/ui/pill';
import type { PerReasonStats } from '@/lib/pre-trade/correlation';
import { loadPreTradeCorrelationData } from '@/lib/pre-trade/service';
import { cn } from '@/lib/utils';

import {
  REASON_LABEL_FR,
  REASON_ORDER,
  REASON_TONE,
  emptyCopyForReason,
  formatRMagnitude,
  formatRatePercent,
  formatSampleSize,
} from './format-analytics';

/**
 * V2.3 ext #4 — Session II frontend (pre-trade × outcome correlation widget).
 *
 * **Différenciateur Fxmily** : table-compare empirique des 4 raisons (edge /
 * fomo / revenge / boredom) sur la performance réelle (win-rate + R réalisé
 * moyen). Le membre VOIT factuellement si son intuition matche son edge réel
 * — pour la 1ère fois.
 *
 * Server Component async — fetch direct via `loadPreTradeCorrelationData`
 * (server-only service). 0 Client island, 0 Recharts, 0 JS client
 * supplémentaire ajouté côté membre. Carbone Session HH frontend pattern.
 *
 * Posture Mark Douglas (SPEC §2) — décisions verrouillées (NE PAS re-litiger) :
 *   - Tone `acc` (lime) UNIQUEMENT sur `edge` ; les 3 autres reçoivent
 *     `t-3` slate neutre. **AUCUNE comparaison automatique** "edge > fomo"
 *     dans l'output — la table affiche les 4 stats côte à côte et laisse
 *     le membre interpréter (Yu-kai Chou anti-Black-Hat invariant).
 *   - **Win-rate JAMAIS rouge** sur loss-dominant — tone slate neutre.
 *     Le membre n'est pas puni visuellement pour avoir tradé en fomo.
 *   - `avgRSampleSize` DISTINCTE de `sampleSize` (transparence honesty
 *     V2.1.3 carbone — "n=8 trades, R calculé sur 5").
 *   - Empty states distincts par bucket : `no_linked_trades` (jamais aucun
 *     trade linké pour cette raison) vs `below_threshold` (1-7 trades).
 *
 * Layout grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — comparaison
 * visuelle facile sur desktop, stack mobile-first.
 *
 * a11y :
 *   - `<section aria-labelledby="pre-trade-correlation-heading">` (V1.12 P7)
 *   - `<h2 id="pre-trade-correlation-heading">` visible
 *   - Chaque cellule reason a son propre `aria-label` court ("Edge: 75 % win")
 *
 * Window 30j fixed V1 (cohérent Session HH analytics — même cadre temporel
 * pour les 2 widgets pre-trade).
 */

export async function PreTradeCorrelationCard({ userId }: { userId: string }) {
  const data = await loadPreTradeCorrelationData(userId);

  // Si AUCUN reason n'a de linked trades → empty state global pédagogique
  const allNoLinkedTrades = REASON_ORDER.every((reason) => {
    const stats = data.perReason[reason];
    return stats.kind === 'insufficient_data' && stats.reason === 'no_linked_trades';
  });

  return (
    <section
      className="rounded-card-lg flex h-full flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
      aria-labelledby="pre-trade-correlation-heading"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--acc)]">Edge vs biais · 30 derniers jours</span>
            <h2
              id="pre-trade-correlation-heading"
              className="text-[15px] font-semibold text-[var(--t-1)]"
            >
              Performance réelle par raison
            </h2>
          </div>
        </div>
      </header>

      {allNoLinkedTrades ? (
        <AllNoLinkedTradesState />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REASON_ORDER.map((reason) => (
            <ReasonCell key={reason} reason={reason} stats={data.perReason[reason]} />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--t-4)]">
        Les magnitudes (R&nbsp;moyen) sont calculées uniquement sur les trades dont le R réalisé est
        exact (stop-loss saisi à l&apos;entrée). Les autres comptent dans le win-rate mais pas dans
        le R&nbsp;moyen.
      </p>
    </section>
  );
}

/**
 * Empty state global : aucun PreTradeCheck linké à un Trade closed dans la
 * fenêtre 30j. Phrase factuelle Mark Douglas non culpabilisante.
 */
function AllNoLinkedTradesState() {
  return (
    <div className="rounded-card flex flex-col gap-2 border border-dashed border-[var(--b-default)] bg-[var(--bg-2)] p-4">
      <p className="text-[13px] font-semibold text-[var(--t-1)]">
        Pas encore de pré-trade check lié à un trade fermé
      </p>
      <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
        Fais ton pré-trade check juste avant un trade, puis clôture le trade, l&apos;auto-link
        15&nbsp;min connectera les deux. Avec 8 trades par raison, tu verras tes patterns réels.
      </p>
    </div>
  );
}

/**
 * Cellule par reason : 1 cell de la grille 4-colonnes. Soit `ok` (stats
 * complètes), soit `insufficient_data` (empty state pédagogique avec
 * remaining count vs threshold 8).
 */
function ReasonCell({
  reason,
  stats,
}: {
  reason: keyof typeof REASON_LABEL_FR;
  stats: PerReasonStats;
}) {
  const tone = REASON_TONE[reason];
  const label = REASON_LABEL_FR[reason];

  if (stats.kind === 'insufficient_data') {
    const copy = emptyCopyForReason(stats.reason, stats.sampleSize, 8);
    return (
      <div
        className={cn(
          'rounded-card flex flex-col gap-2 border p-3',
          tone === 'acc'
            ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]'
            : 'border-[var(--b-default)] bg-[var(--bg-2)]',
        )}
        aria-label={`${label} : pas assez de trades pour calculer les stats`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn('t-eyebrow', tone === 'acc' ? 'text-[var(--acc)]' : 'text-[var(--t-3)]')}
          >
            {label}
          </span>
          <Pill tone="mute">{formatSampleSize(stats.sampleSize)}</Pill>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--t-3)]">{copy.title}</p>
      </div>
    );
  }

  const winRateLabel = formatRatePercent(stats.winRate);
  const lossRateLabel = formatRatePercent(stats.lossRate);
  const breakEvenRateLabel = formatRatePercent(stats.breakEvenRate);
  const avgRLabel = formatRMagnitude(stats.avgRealizedR);

  return (
    <div
      className={cn(
        'rounded-card flex flex-col gap-2 border p-3',
        tone === 'acc'
          ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]'
          : 'border-[var(--b-default)] bg-[var(--bg-2)]',
      )}
      aria-label={`${label} : ${winRateLabel} win sur ${stats.sampleSize} trades`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn('t-eyebrow', tone === 'acc' ? 'text-[var(--acc)]' : 'text-[var(--t-1)]')}
        >
          {label}
        </span>
        <Pill tone="mute">{formatSampleSize(stats.sampleSize)}</Pill>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-[22px] font-semibold tabular-nums',
            tone === 'acc' ? 'text-[var(--acc)]' : 'text-[var(--t-1)]',
          )}
        >
          {winRateLabel}
        </span>
        <span className="text-[11px] text-[var(--t-4)]">win</span>
      </div>
      <dl className="flex flex-col gap-0.5 text-[11px] leading-relaxed">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[var(--t-3)]">Perdants</dt>
          <dd className="t-mono-cap text-[var(--t-3)]">{lossRateLabel}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[var(--t-3)]">BE</dt>
          <dd className="t-mono-cap text-[var(--t-3)]">{breakEvenRateLabel}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-t border-[var(--b-default)] pt-1">
          <dt className="text-[var(--t-3)]">R moyen</dt>
          <dd
            className={cn(
              'f-mono tabular-nums',
              stats.avgRealizedR === null
                ? 'text-[var(--t-4)]'
                : tone === 'acc'
                  ? 'text-[var(--acc)]'
                  : 'text-[var(--t-1)]',
            )}
          >
            {avgRLabel}
          </dd>
        </div>
        {stats.avgRSampleSize !== stats.sampleSize && (
          <div className="text-[10px] text-[var(--t-4)]">
            R calculé sur {stats.avgRSampleSize}/{stats.sampleSize}
          </div>
        )}
      </dl>
    </div>
  );
}
