import 'server-only';

import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { winRateWithBand, type WilsonInterval } from '@/lib/analytics';
import type { TagPerfRow } from '@/lib/scoring/pattern-rhythms';
// Import-only reuse of the shared REFLECT tag labels. This module never edits
// `reflect-tags.ts`.
import { TRADE_TAG_LABELS, isPositiveTradeTag } from '@/lib/trading/reflect-tags';
import type { TradeTagSlug } from '@/lib/schemas/trade';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Tour 11, Finding 2 — REFLECT bias tag × outcome table, calqued on
 * `EmotionPerfTable` (same Wilson 95% band + « échantillon faible » disclaimer).
 *
 * `Trade.tags` (up to 3 per trade, V1.8 REFLECT allowlist) had NO member
 * aggregate. A coach wants to show « ton biais revenge-trade apparaît sur 40 %
 * de tes trades perdants ». A trade counts toward each of its tags (multi-tag).
 *
 * Posture §2 / §31.2 / Mark Douglas: a named bias is DATA, never a punishment.
 * Bias tags stay neutral/mute; `discipline-high` is the ONLY strengths-based
 * counterpoint (the label carries the `ok` tone via `isPositiveTradeTag`). Red
 * stays reserved for trade outcomes — a losing win-rate is never painted red.
 *
 * Server Component, pure presentation, no client JS.
 */

interface TagPerfTableProps {
  rows: ReadonlyArray<TagPerfRow>;
  /** Total closed trades in the window — drives the section disclaimer. */
  totalTrades: number;
}

const PATTERN_MIN_TRADES = 30; // surface threshold (mirrors EmotionPerfTable)

function tagLabel(slug: string): string {
  // `slug` comes from the validated `Trade.tags` allowlist; fall back to the raw
  // slug if an append-only slug ships before its label (defensive, never throws).
  return TRADE_TAG_LABELS[slug as TradeTagSlug] ?? slug;
}

function isPositive(slug: string): boolean {
  // Guard the cast: only known slugs can be positive; unknown → neutral.
  return slug in TRADE_TAG_LABELS && isPositiveTradeTag(slug as TradeTagSlug);
}

export function TagPerfTable({ rows, totalTrades }: TagPerfTableProps) {
  const sorted = [...rows].filter((r) => r.trades > 0).sort((a, b) => b.trades - a.trades);

  return (
    <HoverGlowLift
      tone="acc"
      className="rounded-card-lg flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Biais × résultat</span>
        <SampleSizeDisclaimer
          current={totalTrades}
          minimum={PATTERN_MIN_TRADES}
          unit="trades"
          context="Wilson 95%"
          variant="pill"
        />
      </div>
      {sorted.length === 0 ? (
        <p className="t-cap py-4 text-center text-[var(--t-4)]">
          Pas encore de biais tagué sur des trades clôturés.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="t-mono-cap text-[var(--t-4)]">
                <th className="py-1.5">Biais</th>
                <th className="py-1.5 text-right">n</th>
                <th className="py-1.5 text-right">Taux de réussite</th>
                <th className="py-1.5 text-right">Wilson 95%</th>
                <th className="py-1.5 text-right">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const ci: WilsonInterval = winRateWithBand(r.wins, r.trades);
                const avgR = r.rTrades > 0 ? r.sumR / r.rTrades : null;
                const positive = isPositive(r.slug);
                return (
                  <tr key={r.slug} className="border-t border-[var(--b-subtle)]">
                    <td className="py-2">
                      <span
                        className={
                          'text-[12px] ' + (positive ? 'text-[var(--ok)]' : 'text-[var(--t-1)]')
                        }
                      >
                        {tagLabel(r.slug)}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="t-mono-cap text-[var(--t-3)]">{r.trades}</span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="f-mono text-[12px] text-[var(--t-1)] tabular-nums">
                        {(ci.point * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={
                          'f-mono text-[11px] tabular-nums ' +
                          (ci.sufficientSample ? 'text-[var(--t-3)]' : 'text-[var(--warn-hi)]')
                        }
                      >
                        [{(ci.lower * 100).toFixed(0)}-{(ci.upper * 100).toFixed(0)}%]
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={
                          'f-mono text-[12px] tabular-nums ' +
                          (avgR === null
                            ? 'text-[var(--t-4)]'
                            : avgR > 0
                              ? 'text-[var(--acc)]'
                              : avgR < 0
                                ? 'text-[var(--bad)]'
                                : 'text-[var(--t-3)]')
                        }
                      >
                        {avgR === null
                          ? 'non calculé'
                          : `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="t-cap text-[var(--t-4)]">
        Un biais nommé est une donnée d&apos;observation, jamais un reproche.
      </p>
    </HoverGlowLift>
  );
}
