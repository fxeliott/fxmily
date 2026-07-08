'use client';

import { m, useReducedMotion } from 'framer-motion';

import { useCountUp } from '@/lib/hooks';
import {
  computeTradeRiskLevels,
  priceToFraction,
  type TradeRiskInput,
} from '@/lib/trades/risk-geometry';

/**
 * TradeRiskSchema (S11) — a compact, animated drawing of a single trade's plan:
 * entry, stop-loss, derived target (from planned R:R) and, once closed, the exit
 * + realised R. A faithful diagram of the member's OWN logged plan — descriptive
 * geometry, never a market call (SPEC §2). Returns null when no stop-loss exists.
 *
 * Discipline (frontend-elite): SVG ladder + HTML labels overlay (crisp text,
 * responsive). Segments grow on mount via Framer Motion; the R:R counts up.
 * useReducedMotion() collapses to a static draw. The risk segment uses the trade
 * `--bad` tone (standard risk geometry, not a behavioural red), reward `--acc`.
 */

const FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });

const VB_W = 60;
const VB_H = 190;
const PAD_Y = 22;
const TRACK_X = 26;
const TRACK_W = 16;

function y(fraction: number): number {
  return VB_H - PAD_Y - fraction * (VB_H - PAD_Y * 2);
}

/**
 * Fixed-order legend row (module scope — never created during render, per the
 * repo's react-hooks/static-components rule). The SVG carries the precise
 * vertical geometry, so two near-equal prices (exit ≈ target) never collide.
 */
function Row({
  dot,
  name,
  price,
  sub,
}: {
  dot: string;
  name: string;
  price: string;
  sub?: string | undefined;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 self-center rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className="t-mono-cap text-[var(--t-3)]">{name}</span>
      <span className="f-mono ml-auto text-[13px] text-[var(--t-1)] tabular-nums">{price}</span>
      {sub ? (
        <span className="f-mono text-[11px] font-semibold text-[var(--t-2)] tabular-nums">
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function TradeRiskSchema({ trade }: { trade: TradeRiskInput }) {
  const prefersReducedMotion = useReducedMotion();
  const levels = computeTradeRiskLevels(trade);
  // useCountUp is a hook → call it unconditionally before the early return.
  const rrCount = useCountUp(levels ? Math.round(levels.plannedRR * 100) : 0, 900);

  if (!levels) return null;

  const entryY = y(priceToFraction(levels.entry, levels));
  const slY = y(priceToFraction(levels.stopLoss, levels));
  const tpY = y(priceToFraction(levels.target, levels));
  const exitY = levels.exit != null ? y(priceToFraction(levels.exit, levels)) : null;

  const rewardTop = Math.min(entryY, tpY);
  const rewardH = Math.abs(tpY - entryY);
  const riskTop = Math.min(entryY, slY);
  const riskH = Math.abs(slY - entryY);
  // Animated value drives the VISUAL pill only. Every accessible surface
  // (SVG aria-label, sr-only pill text) carries the final ratio: assistive
  // tech and rAF-throttled tabs must never read a transient "0.00 pour 1"
  // (runtime finding 2026-07-08 — the a11y snapshot froze mid-animation).
  const rr = (rrCount / 100).toFixed(2);
  const rrFinal = levels.plannedRR.toFixed(2);

  const grow = (delay: number) => ({
    initial: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scaleY: 0 },
    animate: { opacity: 1, scaleY: 1 },
    transition: {
      duration: prefersReducedMotion ? 0.2 : 0.55,
      delay,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  });

  return (
    <figure className="flex items-stretch gap-4">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-[180px] w-[52px] shrink-0 overflow-visible"
        role="img"
        aria-label={`Schéma du trade : entrée ${FMT.format(levels.entry)}, stop-loss ${FMT.format(
          levels.stopLoss,
        )}, objectif ${FMT.format(levels.target)} pour un ratio de ${rrFinal} pour 1${
          levels.exit != null ? `, sortie ${FMT.format(levels.exit)}` : ''
        }.`}
      >
        <defs>
          <linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity={0.12} />
          </linearGradient>
          <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bad)" stopOpacity={0.12} />
            <stop offset="100%" stopColor="var(--bad)" stopOpacity={0.45} />
          </linearGradient>
        </defs>

        {/* Reward segment (entry → target) */}
        <m.rect
          x={TRACK_X}
          y={rewardTop}
          width={TRACK_W}
          height={rewardH}
          rx={4}
          fill="url(#rewardGrad)"
          style={{ transformOrigin: `${TRACK_X}px ${entryY}px` }}
          {...grow(0.05)}
        />
        {/* Risk segment (entry → stop-loss) */}
        <m.rect
          x={TRACK_X}
          y={riskTop}
          width={TRACK_W}
          height={riskH}
          rx={4}
          fill="url(#riskGrad)"
          style={{ transformOrigin: `${TRACK_X}px ${entryY}px` }}
          {...grow(0.12)}
        />

        {/* Level markers */}
        {[
          { yy: tpY, c: 'var(--acc)' },
          { yy: entryY, c: 'var(--t-1)' },
          { yy: slY, c: 'var(--bad)' },
        ].map((p, i) => (
          <m.circle
            key={i}
            cx={TRACK_X + TRACK_W / 2}
            cy={p.yy}
            r={4.5}
            fill="var(--bg)"
            stroke={p.c}
            strokeWidth={2.5}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: prefersReducedMotion ? 0 : 0.3 + i * 0.08,
              duration: 0.3,
              ease: [0.34, 1.56, 0.64, 1],
            }}
            style={{ transformOrigin: `${TRACK_X + TRACK_W / 2}px ${p.yy}px` }}
          />
        ))}

        {/* Exit marker (closed trades) */}
        {exitY != null ? (
          <m.path
            d={`M ${TRACK_X + TRACK_W + 6} ${exitY} l 7 -5 v 10 z`}
            fill="var(--t-2)"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.3 }}
          />
        ) : null}
      </svg>

      {/* Fixed-order legend — collision-proof, the SVG holds the geometry. */}
      <figcaption className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
        <Row dot="var(--t-1)" name="ENTRÉE" price={FMT.format(levels.entry)} />
        <Row dot="var(--acc)" name="OBJECTIF" price={FMT.format(levels.target)} />
        <Row dot="var(--bad)" name="STOP" price={FMT.format(levels.stopLoss)} />
        {levels.exit != null ? (
          <Row
            dot="var(--t-2)"
            name="SORTIE"
            price={FMT.format(levels.exit)}
            sub={
              levels.realizedR != null
                ? `${levels.realizedR > 0 ? '+' : ''}${levels.realizedR.toFixed(2)}R`
                : undefined
            }
          />
        ) : null}
        <div className="mt-1 flex items-center gap-2 border-t border-[var(--b-default)] pt-2">
          <span className="t-mono-cap text-[var(--t-4)]">R:R prévu</span>
          <span
            aria-hidden
            className="f-mono rounded-pill ml-auto border border-[var(--b-acc)] bg-[var(--acc-dim)] px-2 py-0.5 text-[12px] font-semibold text-[var(--acc-hi)] tabular-nums"
          >
            {rr} : 1
          </span>
          <span className="sr-only">{rrFinal} : 1</span>
        </div>
      </figcaption>
    </figure>
  );
}
