'use client';

import { m, useReducedMotion } from 'framer-motion';
import { ShieldCheck, TrendingUp } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { RiskDiscipline, SetupQualityDist } from '@/lib/scoring/setup-quality';
import { C } from '@/lib/theme-colors';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * « Qualité de setup & discipline risque » — member-facing process metrics
 * (Steenbarger A/B/C grading + Tharp ≤ 2 % ceiling).
 *
 * Posture §2 STRICT: both cards measure the ACT (grading the setup / sizing the
 * position), never P&L or market direction. No red on the quality bars (A blue,
 * B cyan, C amber = coaching signal, not danger). Calm observation, never
 * punishment (§33.2). Server data passed as plain props — no fetch here.
 */

const MIN_QUALITY_SAMPLE = 5;

interface SetupQualityCardProps {
  setupQuality: SetupQualityDist;
  riskDiscipline: RiskDiscipline;
}

export function SetupQualityCard({ setupQuality, riskDiscipline }: SetupQualityCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const { A, B, C: cCount, captured } = setupQuality;
  const { overTwoCount, median, capturedCount } = riskDiscipline;

  const qualityData = [
    { label: 'A', count: A, fill: C.acc },
    { label: 'B', count: B, fill: C.cy },
    { label: 'C', count: cCount, fill: C.warn },
  ];

  const riskRespected = capturedCount - overTwoCount;
  const riskPct = capturedCount > 0 ? Math.round((riskRespected / capturedCount) * 100) : null;
  const pct = (n: number) => (captured > 0 ? Math.round((n / captured) * 100) : 0);

  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3"
    >
      {/* ── Card 1: Distribution A/B/C ───────────────────────────────── */}
      <div
        className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
        aria-labelledby="setup-quality-title"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden />
            <span className="t-eyebrow" id="setup-quality-title">
              Qualité de setup
            </span>
          </div>
          <SampleSizeDisclaimer
            current={captured}
            minimum={MIN_QUALITY_SAMPLE}
            unit="setups gradés"
            variant="pill"
          />
        </div>

        {captured === 0 ? (
          <p className="t-cap py-4 text-center text-[var(--t-3)]">
            Grade tes setups (A / B / C) lors de la saisie pour voir ta distribution ici.
          </p>
        ) : (
          <>
            <figure
              className="h-[160px] w-full"
              role="img"
              aria-labelledby="setup-quality-title"
              aria-describedby="setup-quality-desc"
            >
              <figcaption id="setup-quality-desc" className="sr-only">
                Distribution sur {captured} setups gradés : {A} en A ({pct(A)} %), {B} en B (
                {pct(B)} %), {cCount} en C ({pct(cCount)} %).
              </figcaption>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={qualityData}
                  margin={{ top: 4, right: 0, left: -24, bottom: 0 }}
                  barSize={48}
                >
                  <XAxis
                    dataKey="label"
                    stroke={C.t4}
                    tick={{ fontSize: 13, fill: C.t4, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={C.t4}
                    tick={{ fontSize: 11, fill: C.t4 }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: C.bg2 }}
                    contentStyle={{
                      background: C.bg3,
                      border: `1px solid ${C.bDefault}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: C.t2 }}
                    itemStyle={{ color: C.t1 }}
                    formatter={(value) => [`${Number(value)} trades`, '']}
                  />
                  <Bar
                    dataKey="count"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={700}
                  >
                    {qualityData.map((entry) => (
                      <Cell key={entry.label} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </figure>

            <ul className="flex gap-4">
              {qualityData.map((q) => (
                <li key={q.label} className="flex flex-col gap-0.5">
                  <span
                    className="f-mono text-[18px] leading-none font-semibold tabular-nums"
                    style={{ color: q.fill }}
                  >
                    {pct(q.count)}%
                  </span>
                  <span className="t-cap text-[var(--t-4)]">
                    {q.label} · {q.count} trade{q.count !== 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>

            <p className="t-cap text-[var(--t-4)]">
              A = setup convaincu · B = acceptable · C = limite (coache-le)
            </p>
          </>
        )}
      </div>

      {/* ── Card 2: Respect du plafond de risque ────────────────────── */}
      <div
        className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
        aria-labelledby="risk-discipline-title"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden />
            <span className="t-eyebrow" id="risk-discipline-title">
              Plafond de risque
            </span>
          </div>
          <SampleSizeDisclaimer
            current={capturedCount}
            minimum={MIN_QUALITY_SAMPLE}
            unit="trades avec risque"
            variant="pill"
          />
        </div>

        {capturedCount === 0 ? (
          <p className="t-cap py-4 text-center text-[var(--t-3)]">
            Saisis le % de capital risqué à l&apos;ouverture pour activer cette lecture.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="t-mono-cap text-[var(--t-4)]">Respect ≤ 2 %</span>
              <span
                className={`f-mono text-[20px] leading-none font-semibold tabular-nums ${
                  riskPct !== null && riskPct >= 80 ? 'text-[var(--ok)]' : 'text-[var(--t-1)]'
                }`}
              >
                {riskPct !== null ? `${riskPct}%` : '—'}
              </span>
              <span className="t-cap text-[var(--t-4)]">des trades saisis</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="t-mono-cap text-[var(--t-4)]">Dépassements</span>
              <span
                className={`f-mono text-[20px] leading-none font-semibold tabular-nums ${
                  overTwoCount === 0 ? 'text-[var(--ok)]' : 'text-[var(--t-1)]'
                }`}
              >
                {overTwoCount}
              </span>
              <span className="t-cap text-[var(--t-4)]">trades &gt; 2 %</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="t-mono-cap text-[var(--t-4)]">Médiane</span>
              <span className="f-mono text-[20px] leading-none font-semibold text-[var(--t-1)] tabular-nums">
                {median !== null ? `${median.toFixed(2)} %` : '—'}
              </span>
              <span className="t-cap text-[var(--t-4)]">risque par trade</span>
            </div>
          </div>
        )}
      </div>
    </m.div>
  );
}
