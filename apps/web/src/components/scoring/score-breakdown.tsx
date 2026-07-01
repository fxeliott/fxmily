import type { SerializedBehavioralScore } from '@/lib/scoring';
import type { SubScore } from '@/lib/scoring/types';
import { cn } from '@/lib/utils';

/**
 * Session 3 (§21 « sur quoi travailler ») — consolidated sub-score breakdown.
 *
 * Pure Server Component. The four behavioral dimensions already compute &
 * persist rich sub-scores (`components.<dim>.parts.*` — each a {@link SubScore}
 * with a normalized `rate` ∈ [0,1] where higher = better) that explain WHY a
 * dimension sits where it does — but they were never surfaced (the gauge
 * `onClick` drill-down was wired but never bound). Without them the member
 * sees « Discipline : 62, À renforcer » with no actionable lever.
 *
 * This renders a single calm, collapsible `<details>` (native = keyboard +
 * SR accessible, ZERO client JS) listing every available sub-score across all
 * four dimensions, **weakest first** = the member's priority list of what to
 * work on. Posture §2 / anti-Black-Hat : neutral tone, no red punishment, no
 * fanfare — the member observes their levers, calmly.
 *
 * Null parts (a dimension that renormalized a sub-score away because the data
 * wasn't present) and `insufficient_data` dimensions are skipped — we never
 * show a fabricated 0.
 */

type DimKey = 'discipline' | 'emotionalStability' | 'consistency' | 'engagement';

const DIMENSION_LABEL: Record<DimKey, string> = {
  discipline: 'Discipline',
  emotionalStability: 'Stabilité',
  consistency: 'Cohérence',
  engagement: 'Engagement',
};

/**
 * FR labels for each sub-score key, per dimension. The keys mirror the typed
 * `*Parts` interfaces in `lib/scoring/types.ts`; the insertion order is the
 * natural reading order (used only as a tiebreak — the list is sorted by rate).
 */
const PART_LABELS: Record<DimKey, Record<string, string>> = {
  discipline: {
    planRespect: 'Respect du plan',
    hedgeRespect: 'Respect du hedge',
    eveningPlan: 'Bilan du plan (soir)',
    intentionFilled: 'Intention posée (matin)',
    routineCompleted: 'Routine du matin',
    marketAnalysisDone: 'Analyse de marché préparée',
    processComplete: 'Process complet (aucun oubli)',
  },
  emotionalStability: {
    moodVariance: 'Stabilité de l’humeur',
    stressMedian: 'Niveau de stress maîtrisé',
    negativeEmotionRate: 'Émotions sereines (check-in)',
    recoveryAfterLoss: 'Récupération après une perte',
    tradeEmotionFootprint: 'Sérénité pendant les trades',
  },
  consistency: {
    expectancyConsistency: 'Expectancy (R moyen)',
    profitFactor: 'Profit factor',
    drawdownControl: 'Contrôle du drawdown',
    lossStreakControl: 'Maîtrise des séries de pertes',
    sessionDispersion: 'Focus sur les sessions',
  },
  engagement: {
    checkinFillRate: 'Régularité des check-ins',
    dualSlotRate: 'Check-ins matin + soir',
    streakNormalized: 'Série de jours actifs',
    journalDepthRate: 'Profondeur du journal',
    trainingActivityRate: 'Activité d’entraînement',
    meetingAttendanceRate: 'Présence aux réunions',
    sleepQualityRate: 'Qualité du sommeil',
    formationFollowedRate: 'Suivi de la formation',
  },
};

interface BreakdownEntry {
  dimension: DimKey;
  label: string;
  rate: number;
}

export function ScoreBreakdown({ score }: { score: SerializedBehavioralScore }) {
  const entries: BreakdownEntry[] = [];

  // Robustesse : un snapshot ANCIEN peut avoir un `components` JSON sans toutes
  // ses dimensions → lecture défensive (sinon `result.status` crashait la page).
  const components = score.components as Partial<SerializedBehavioralScore['components']>;
  for (const dim of Object.keys(DIMENSION_LABEL) as DimKey[]) {
    const result = components[dim];
    // Skip dimensions sans assez de données (ou absentes d'un vieux snapshot) —
    // never surface a fabricated 0.
    if (!result || result.status !== 'ok') continue;
    // `parts` is the typed `*Parts` object; index it by key. Null parts were
    // renormalized away (data absent) → skipped.
    const parts = result.parts as unknown as Record<string, SubScore | null>;
    for (const [key, label] of Object.entries(PART_LABELS[dim])) {
      const sub = parts[key];
      if (!sub) continue;
      entries.push({ dimension: dim, label, rate: sub.rate });
    }
  }

  if (entries.length === 0) return null;

  // Weakest first = the member's priority list of what to work on.
  entries.sort((a, b) => a.rate - b.rate);

  return (
    <details className="group rounded-card border border-[var(--b-default)] bg-[var(--bg-1)]">
      <summary className="rounded-card flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-[var(--bg-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] [&::-webkit-details-marker]:hidden">
        <span className="t-eyebrow text-[var(--t-2)]">
          Sur quoi travailler · détail de tes scores
        </span>
        <svg
          className="h-3.5 w-3.5 shrink-0 text-[var(--t-3)] transition-transform group-open:rotate-180"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <ul className="flex flex-col gap-2.5 border-t border-[var(--b-subtle)] px-4 py-3">
        {entries.map((e) => {
          const pct = Math.round(e.rate * 100);
          // Posture §2 / anti-Black-Hat : the bar is always the calm accent —
          // a low score is a lever to work on, never a punishment in red.
          return (
            <li key={`${e.dimension}-${e.label}`} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-[var(--t-1)]">{e.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="t-mono-cap text-[var(--t-4)]">
                    {DIMENSION_LABEL[e.dimension]}
                  </span>
                  <span className="f-mono text-[12px] text-[var(--t-2)] tabular-nums">{pct}%</span>
                </span>
              </div>
              <div
                className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-2)]"
                role="img"
                aria-label={`${e.label} : ${pct}%`}
              >
                <div
                  className={cn(
                    'rounded-pill h-full origin-left',
                    pct >= 55 ? 'bg-[var(--acc)]' : 'bg-[var(--t-4)]',
                  )}
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    // S19.1 anim barres = parité ConstancyScoreCard : scaleX fill
                    // on first paint (compositor-only). The global
                    // prefers-reduced-motion filet lands it instantly; `both`
                    // locks scaleX(1) at the final state.
                    animation: 'v18StepBarFill 700ms var(--e-data) both',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="t-foot border-t border-[var(--b-subtle)] px-4 py-2.5 text-[var(--t-4)]">
        Du plus faible au plus fort : commence par le haut. Aucun conseil de marché, uniquement ton
        exécution et tes habitudes.
      </p>
    </details>
  );
}
