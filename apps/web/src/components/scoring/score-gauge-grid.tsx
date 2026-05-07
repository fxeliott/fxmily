import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedBehavioralScore } from '@/lib/scoring';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';
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

export function ScoreGaugeGrid({ score }: ScoreGaugeGridProps) {
  if (score === null) return <EmptyScoresGrid />;

  const reasonOf = (
    s: SerializedBehavioralScore['components'][keyof SerializedBehavioralScore['components']],
  ) => s.reason ?? undefined;

  return (
    <Card primary className="flex flex-col gap-3 p-5" aria-labelledby="scores-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 id="scores-heading" className="t-eyebrow">
            Scores comportementaux
          </h2>
        </div>
        <SampleSizeDisclaimer
          current={score.sampleSize.checkins.days}
          minimum={14}
          unit="jours"
          context={`fenêtre ${score.windowDays} j`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreGauge
          score={score.disciplineScore}
          label="Discipline"
          hint="Plan + hedge + routine"
          reason={reasonOf(score.components.discipline)}
        />
        <ScoreGauge
          score={score.emotionalStabilityScore}
          label="Stabilité"
          hint="Variance + stress + tilt"
          reason={reasonOf(score.components.emotionalStability)}
        />
        <ScoreGauge
          score={score.consistencyScore}
          label="Cohérence"
          hint="Expectancy + DD + sessions"
          reason={reasonOf(score.components.consistency)}
        />
        <ScoreGauge
          score={score.engagementScore}
          label="Engagement"
          hint="Fill rate + streak + journal"
          reason={reasonOf(score.components.engagement)}
        />
      </div>
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
