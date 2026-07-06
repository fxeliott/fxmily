import { SampleSizeDisclaimer } from '@/components/scoring/sample-size-disclaimer';
import {
  type CorrelationInterpretation,
  type CorrelationStatus,
  type HabitTradeCorrelationResult,
  SPEARMAN_PEARSON_DIVERGENCE,
  SUFFICIENT_SAMPLE_MIN,
} from '@/lib/analytics/habit-trade-correlation';
import type { HabitKind } from '@/lib/schemas/habit-log';

import { HabitCorrelationScatter, type ScatterPoint } from './habit-correlation-scatter';
import { HabitHeatmap } from './habit-heatmap';

/**
 * V2.1.3 — Habit × Trade correlation card (Server Component, presentational).
 *
 * The documented Fxmily differentiator: does a logged habit move with
 * realized R? Rendered with statistical honesty as the *product posture*
 * (Mark Douglas), not a disclaimer bolted on:
 *
 *   - `insufficient_data` → a calm focal `{n}/{minRequired}` anchor (no
 *     coefficient, no scatter — the union has no `r` to render), warm
 *     forward-looking copy, NO progress bar (anti-gamification). The
 *     heatmap still shows so the member sees their logging rhythm.
 *   - `sufficient` → effect-size *words* as the headline (never the raw r),
 *     r + ρ as secondary mono detail, an always-visible sample-size pill,
 *     a "low sample" caveat below SUFFICIENT_SAMPLE_MIN, the point cloud
 *     (no trend line), and a persistent correlation≠causation footnote.
 */

const KIND_LABEL_FR: Record<HabitKind, string> = {
  sleep: 'Sommeil',
  nutrition: 'Nutrition',
  caffeine: 'Café',
  sport: 'Sport',
  meditation: 'Méditation',
};

const KIND_NOUN_FR: Record<HabitKind, string> = {
  sleep: 'sommeil',
  nutrition: 'nutrition',
  caffeine: 'café',
  sport: 'sport',
  meditation: 'méditation',
};

const KIND_X_LABEL: Record<HabitKind, string> = {
  sleep: 'Sommeil (h)',
  nutrition: 'Repas (n)',
  caffeine: 'Cafés (tasses)',
  sport: 'Sport (min)',
  meditation: 'Méditation (min)',
};

const INTERPRETATION_FR: Record<CorrelationInterpretation, string> = {
  strong_positive: 'Lien positif fort',
  moderate_positive: 'Lien positif modéré',
  weak: 'Lien faible, pas de tendance nette',
  moderate_negative: 'Lien négatif modéré',
  strong_negative: 'Lien négatif fort',
};

/**
 * Discipline (= plan-respect) interpretation copy. Strictly DESCRIPTIVE and
 * day-of-pairing framed ("va de pair avec", "sur N jours") — never causal,
 * never predictive, never advice (SPEC §2 / Mark Douglas). "plus de {noun}"
 * reads naturally for every pillar ("plus de sommeil", "plus de café") and the
 * direction is factual, not normative: a negative caffeine link is reported as
 * "moins de respect du plan", not "tu bois trop de café".
 */
const DISCIPLINE_INTERPRETATION_FR: Record<
  CorrelationInterpretation,
  (noun: string, n: number) => string
> = {
  strong_positive: (noun, n) =>
    `Sur ${n} jours, plus de ${noun} va de pair avec un meilleur respect du plan.`,
  moderate_positive: (noun, n) =>
    `Sur ${n} jours, plus de ${noun} tend à aller de pair avec un meilleur respect du plan.`,
  weak: (noun, n) => `Sur ${n} jours, pas de tendance nette entre ${noun} et respect du plan.`,
  moderate_negative: (noun, n) =>
    `Sur ${n} jours, plus de ${noun} tend à aller de pair avec un moindre respect du plan.`,
  strong_negative: (noun, n) =>
    `Sur ${n} jours, plus de ${noun} va de pair avec un moindre respect du plan.`,
};

interface HabitCorrelationCardProps {
  result: HabitTradeCorrelationResult;
  /**
   * Optional habit × *discipline* (plan-respect) correlation over the same
   * window/kind (point-biserial). When provided, a calm descriptive line is
   * shown in addition to the habit × R correlation. Same honesty union:
   * `insufficient_data` renders a pedagogical hint, never a fabricated score.
   */
  discipline?: CorrelationStatus;
}

export function HabitCorrelationCard({ result, discipline }: HabitCorrelationCardProps) {
  const { correlation, heatmap, habitKind, windowDays } = result;
  const kindLabel = KIND_LABEL_FR[habitKind];
  const kindNoun = KIND_NOUN_FR[habitKind];

  return (
    <section
      aria-labelledby="habit-corr-title"
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <h3 id="habit-corr-title" className="t-eyebrow text-[var(--acc)]">
        Corrélation · {kindLabel} × R réalisé
      </h3>

      {correlation.status === 'insufficient_data' ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="f-mono text-[28px] leading-none font-semibold tracking-[-0.02em] text-[var(--t-2)] tabular-nums">
              {correlation.n}
              <span className="text-[var(--t-4)]">/{correlation.minRequired}</span>
            </span>
            <span className="t-mono-cap text-[var(--t-4)]">jours appariés</span>
          </div>
          <p className="text-[14px] leading-relaxed text-[var(--t-2)]">
            Pas encore assez de données pour un lien fiable, un coefficient sur si peu de points ne
            voudrait rien dire.
          </p>
          <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
            Il faut un trade clôturé (R précis) ET un log {KIND_NOUN_FR[habitKind]} le même jour. La
            carte s’active à {correlation.minRequired} jours appariés, chaque trade loggué t’en
            rapproche.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-semibold text-[var(--t-1)]">
              {INTERPRETATION_FR[correlation.interpretation]}
            </p>
            <p className="t-mono-cap text-[var(--t-4)]">
              r {fmt(correlation.r)} · ρ {fmt(correlation.rSpearman)} · n {correlation.n}
              {Math.abs(correlation.r - correlation.rSpearman) > SPEARMAN_PEARSON_DIVERGENCE
                ? ' · écart Pearson/Spearman, sensible aux valeurs extrêmes'
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SampleSizeDisclaimer
              current={correlation.n}
              minimum={SUFFICIENT_SAMPLE_MIN}
              unit="jours appariés"
              context={`fenêtre ${windowDays} j`}
              variant="pill"
            />
            {correlation.confidence === 'low' ? (
              <span className="t-mono-cap text-[var(--t-3)]">
                Échantillon limité, à confirmer avec plus de jours.
              </span>
            ) : null}
          </div>

          <HabitCorrelationScatter
            points={toScatterPoints(correlation.pairs)}
            xLabel={KIND_X_LABEL[habitKind]}
            summary={buildSummary(
              kindLabel,
              correlation.interpretation,
              correlation.n,
              correlation.confidence,
            )}
          />

          <p className="t-cap leading-relaxed text-[var(--t-4)]">
            Corrélation, pas causalité : tes habitudes et ton R bougent peut-être ensemble, ça ne
            prouve pas que l&apos;un cause l&apos;autre. Trades à stop-loss estimé exclus (R non
            précis).
          </p>
        </div>
      )}

      {discipline ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--b-default)] pt-4">
          <p className="t-eyebrow text-[var(--cy)]">{kindLabel} × respect du plan</p>
          {discipline.status === 'insufficient_data' ? (
            <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
              Pas encore assez de trades notés « plan respecté » sur des jours {kindNoun}{' '}
              enregistrés ({discipline.n}/{discipline.minRequired}) pour un lien fiable. Chaque
              trade clôturé avec son auto-évaluation rapproche la carte.
            </p>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-[var(--t-2)]">
                {DISCIPLINE_INTERPRETATION_FR[discipline.interpretation](kindNoun, discipline.n)}
              </p>
              <p className="t-mono-cap text-[var(--t-4)]">
                r {fmt(discipline.r)} · ρ {fmt(discipline.rSpearman)} · n {discipline.n}
                {discipline.confidence === 'low' ? ' · échantillon limité, à confirmer' : ''}
              </p>
              <p className="t-cap leading-relaxed text-[var(--t-4)]">
                Descriptif, pas causal : tes habitudes et ton respect du plan bougent peut-être
                ensemble, ça ne prouve pas que l&apos;un provoque l&apos;autre.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="border-t border-[var(--b-default)] pt-4">
        <HabitHeatmap days={heatmap} />
      </div>
    </section>
  );
}

function fmt(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function toScatterPoints(
  pairs: ReadonlyArray<{ habitValue: number; realizedR: number; date: string }>,
): ScatterPoint[] {
  return pairs.map((p) => ({ x: p.habitValue, y: p.realizedR, date: p.date }));
}

function buildSummary(
  kindLabel: string,
  interpretation: CorrelationInterpretation,
  n: number,
  confidence: 'low' | 'adequate',
): string {
  const link = INTERPRETATION_FR[interpretation].toLowerCase();
  const conf = confidence === 'low' ? ' Échantillon limité, à confirmer avec plus de jours.' : '';
  return `${kindLabel} et R réalisé : ${link}, sur ${n} jours appariés.${conf} Corrélation, pas causalité.`;
}
