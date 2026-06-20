import { Card } from '@/components/ui/card';
import { InfoDot } from '@/components/ui/info-dot';
import { Pill } from '@/components/ui/pill';
import type { SerializedBehavioralScore } from '@/lib/scoring';
import type { BehavioralScoreTrendPoint } from '@/lib/scoring/service';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';
import { ScoreBreakdown } from './score-breakdown';
import { ScoreGauge } from './score-gauge';

/**
 * Four-up grid of behavioral score gauges (J6, SPEC §7.5).
 *
 * Server Component — fetches no data itself; the parent passes the latest
 * `SerializedBehavioralScore` (or null when no snapshot exists yet, i.e.
 * a brand-new member before the first cron run).
 *
 * Empty state: when the score record is null, we render a single
 * "Bientôt — passe ton premier check-in et clôture quelques trades pour
 * activer ton tableau de bord" card (encouraging, Mark Douglas tone) with
 * the four gauge slots greyed out.
 */
interface ScoreGaugeGridProps {
  score: SerializedBehavioralScore | null;
  /** 30-day behavioral-score history for inline per-dimension sparklines. */
  history?: BehavioralScoreTrendPoint[];
}

/**
 * J6.6 — empty state now shows the 4 greyed gauges (consistent with the
 * loaded view) plus a one-line pedagogical caption per dimension. More
 * scannable than the bullet list and fulfills the "tone premium" feedback.
 */
function EmptyScoresGrid() {
  return (
    <Card primary className="flex flex-col gap-4 p-5" aria-labelledby="scores-empty-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 id="scores-empty-heading" className="t-eyebrow">
            Scores comportementaux
          </h2>
          <Pill tone="cy">EN ATTENTE</Pill>
        </div>
      </div>
      <p className="t-body text-[var(--t-2)]">
        Tes 4 scores apparaîtront ici dès que tu auras renseigné quelques check-ins et clôturé
        quelques trades. Snapshot recalculé chaque nuit + en live après chaque action.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreGauge score={null} label="Discipline" hint="Plan + hedge + routine" />
        <ScoreGauge score={null} label="Stabilité" hint="Variance + stress + tilt" />
        <ScoreGauge score={null} label="Cohérence" hint="Expectancy + DD + sessions" />
        <ScoreGauge score={null} label="Engagement" hint="Fill rate + streak + journal" />
      </div>
    </Card>
  );
}

export function ScoreGaugeGrid({ score, history }: ScoreGaugeGridProps) {
  if (score === null) return <EmptyScoresGrid />;

  // Micro-tendance par dimension (nulls pré-filtrés — jamais converti en 0).
  const trendFor = (
    key: 'discipline' | 'emotionalStability' | 'consistency' | 'engagement',
  ): number[] => (history ?? []).map((p) => p[key]).filter((v): v is number => v !== null);

  const reasonOf = (
    s:
      | SerializedBehavioralScore['components'][keyof SerializedBehavioralScore['components']]
      | undefined,
  ) => s?.reason ?? undefined;

  // Robustesse : un snapshot ANCIEN (calculé avant l'ajout des sous-champs
  // `sampleSize.checkins`) a un JSON sans `checkins` → l'accès direct crashait
  // toute la page (RSC 500). On lit en défensif et on masque le disclaimer
  // quand la donnée d'échantillon n'est pas disponible.
  const checkinDays = (score.sampleSize as { checkins?: { days?: number } } | undefined)?.checkins
    ?.days;

  return (
    <Card primary className="flex flex-col gap-3 p-5" aria-labelledby="scores-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 id="scores-heading" className="t-eyebrow">
            Scores comportementaux
          </h2>
          <InfoDot
            label="les 4 scores comportementaux"
            side="bottom"
            width={272}
            tip="4 scores de process (0–100), jamais basés sur ton P&L : Discipline (plan, hedge, routine), Stabilité (variance, stress, tilt), Cohérence (expectancy, drawdown, sessions) et Engagement (check-ins, streak, journal). Recalculés chaque nuit et en live après chaque action."
          />
        </div>
        {checkinDays != null ? (
          <SampleSizeDisclaimer
            current={checkinDays}
            minimum={14}
            unit="jours"
            context={`fenêtre ${score.windowDays} j`}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreGauge
          score={score.disciplineScore}
          label="Discipline"
          hint="Plan + hedge + routine"
          reason={reasonOf(score.components.discipline)}
          trend={trendFor('discipline')}
        />
        <ScoreGauge
          score={score.emotionalStabilityScore}
          label="Stabilité"
          hint="Variance + stress + tilt"
          reason={reasonOf(score.components.emotionalStability)}
          trend={trendFor('emotionalStability')}
        />
        <ScoreGauge
          score={score.consistencyScore}
          label="Cohérence"
          hint="Expectancy + DD + sessions"
          reason={reasonOf(score.components.consistency)}
          trend={trendFor('consistency')}
        />
        <ScoreGauge
          score={score.engagementScore}
          label="Engagement"
          hint="Fill rate + streak + journal"
          reason={reasonOf(score.components.engagement)}
          trend={trendFor('engagement')}
        />
      </div>

      {/* §21 « sur quoi travailler » — collapsible sub-score breakdown (the
          gauges' drill-down was wired but never bound). Calm, weakest-first. */}
      <ScoreBreakdown score={score} />
    </Card>
  );
}

export function ScoreGaugeGridSkeleton() {
  return (
    <Card
      primary
      className="flex flex-col gap-3 p-5"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement des scores comportementaux"
    >
      <div className="flex items-center justify-between">
        <span className="t-eyebrow">Scores comportementaux</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="skel rounded-card-lg h-[208px] border border-[var(--b-default)] bg-[var(--bg-1)]"
          />
        ))}
      </div>
    </Card>
  );
}
