import { TrendingDown } from 'lucide-react';

import { Sparkline } from '@/components/ui/sparkline';
import type { ObjectiveDimension } from '@/lib/objectives/projection';
import {
  detectMomentum,
  MOMENTUM_WINDOW_DAYS,
  type MomentumHistoryPoint,
} from '@/lib/scoring/momentum';

/**
 * MomentumCard (S22) — surface the slow behavioral drift that ONLY the data can
 * see, to the MEMBER, calmly.
 *
 * `detectMomentum` (a pure, tested module, `lib/scoring/momentum.ts`) was wired
 * end-to-end since S15 but its output (`patternSignals.momentumDeclines`) was
 * locked inside the admin/AI weekly report (`lib/weekly-report/builder.ts:210`
 * → `prompt.ts`). The member — the person the drift is actually about — never
 * saw it. This card closes that asymmetry: it is the incarnation of the SPEC §3
 * "athlete approach" promise to "catch patterns early".
 *
 * POSTURE (non-negotiable, §2 + §31.2 anti-Black-Hat — the sensitive invariant):
 *   - This is a CALM process signal, NEVER an alarmist verdict. No red, no
 *     danger token, no guilt, no "tu baisses, fais mieux", no countdown. The
 *     tone mirrors the no-"down"-branch discipline of `WeeklyInsightCard`: a
 *     downward slope is reframed as a gentle anchor-check, Mark Douglas
 *     (process > outcome), never a reprimand.
 *   - INTEGRITY: `detectMomentum` only reports a SUSTAINED decline over ≥6
 *     samples in a ~6-week window past a -0.5 pt/week threshold. Below that, it
 *     returns []. We then render NOTHING (this card is not a permanent fixture
 *     — a "nothing is drifting" card every day would be noise). When several
 *     dimensions drift, we show only the STEEPEST one: one calm nudge, never a
 *     wall of failings (that would be Black-Hat).
 *   - §2: behavioral process only (discipline/stability/consistency/engagement),
 *     zero market content.
 *
 * Server Component (static, no interactivity, DB-free): it computes from the
 * `scoreHistory` already loaded once on the dashboard (`page.tsx:102`,
 * `getBehavioralScoreHistory(..., { sinceDays: 90 }`) — zero added query.
 */

const DAY_MS = 86_400_000;

/**
 * Grammatical gender of each dimension's FR label, so the copy agrees ("Ta
 * stabilité s'est tassée" vs "Ton engagement s'est tassé"). 3 of the 4 labels
 * are feminine; `engagement` is masculine — without this the masculine case
 * would read "Ta engagement s'est tassée" (wrong on three counts). The labels
 * themselves stay sourced from `DIMENSION_META` (SSOT); only the gender, which
 * can't be derived from a string, lives here.
 */
const DIM_GENDER: Record<ObjectiveDimension, 'f' | 'm'> = {
  discipline: 'f',
  emotionalStability: 'f',
  consistency: 'f',
  engagement: 'm',
};

function isoToUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

/**
 * Non-null values of one dimension within the SAME ~6-week window
 * `detectMomentum` measured the slope over — so the sparkline can never tell a
 * different story than the headline (anchored on the most recent point, not
 * "today", exactly like the detector).
 */
function windowedValues(
  history: readonly MomentumHistoryPoint[],
  dim: keyof Omit<MomentumHistoryPoint, 'date'>,
): number[] {
  if (history.length === 0) return [];
  const lastDay = isoToUtcDays(history[history.length - 1]!.date);
  const windowStart = lastDay - MOMENTUM_WINDOW_DAYS;
  const out: number[] = [];
  for (const point of history) {
    const value = point[dim];
    if (value === null || !Number.isFinite(value)) continue;
    if (isoToUtcDays(point.date) < windowStart) continue;
    out.push(value);
  }
  return out;
}

export function MomentumCard({
  history,
  className = '',
}: {
  history: readonly MomentumHistoryPoint[];
  className?: string;
}) {
  const declines = detectMomentum([...history]);

  // Healthy / insufficient-data → render nothing. This card only appears when
  // there is a real slow drift worth a calm nudge.
  if (declines.length === 0) return null;

  // Steepest decline only — one signal, never a list of failings.
  const top = declines[0]!;
  const perWeek = Math.abs(top.weeklySlope);
  const dimLower = top.label.toLowerCase();
  const trendValues = windowedValues(history, top.dimension);

  // Gender-correct copy. Built as plain JS strings (rendered via `{…}`) on
  // purpose: a JSX expression directly followed by entity-bearing text drops the
  // whitespace under SWC (the "stabilités'est" bug caught at runtime, S22), and a
  // string also keeps the apostrophes readable without `&apos;`.
  const feminine = DIM_GENDER[top.dimension] === 'f';
  const poss = feminine ? 'Ta' : 'Ton';
  const possLower = feminine ? 'ta' : 'ton';
  const declined = feminine ? 'tassée' : 'tassé';
  const headline = `${poss} ${dimLower} s'est ${declined} doucement ces dernières semaines`;
  const body =
    `Sur environ 6 semaines, ${possLower} ${dimLower} suit une pente descendante légère ` +
    `(~${perWeek} pt/semaine). C'est le genre de dérive lente qu'on ne sent pas au jour le ` +
    `jour — seules tes données la voient. Rien d'alarmant : juste un repère. Dans l'esprit ` +
    `de Mark Douglas, on ne juge pas un résultat, on revient simplement à la régularité du process.`;

  return (
    <aside
      className={`rounded-card flex items-start gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 ${className}`.trim()}
      aria-label="Un signal de tes données"
      data-slot="momentum-card"
    >
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
      >
        <TrendingDown className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Un signal de tes données</span>
          <p className="text-[15px] font-semibold text-[var(--t-1)]">{headline}</p>
          <p className="t-body leading-[1.5] text-[var(--t-2)]">{body}</p>
        </div>
        {trendValues.length >= 2 ? (
          <Sparkline
            data={trendValues}
            width={132}
            height={40}
            fill
            showLastDot
            color="var(--t-3)"
            className="shrink-0 self-end opacity-80 sm:self-center"
            ariaLabel={`Tendance de ${possLower} ${dimLower} sur tes ${trendValues.length} derniers points notés, de ${trendValues[0]} à ${trendValues[trendValues.length - 1]} sur 100.`}
          />
        ) : null}
      </div>
    </aside>
  );
}
