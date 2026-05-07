import { Info } from 'lucide-react';

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

export function ScoreGaugeGrid({ score }: ScoreGaugeGridProps) {
  if (score === null) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="t-eyebrow">Scores comportementaux</span>
          <Pill tone="cy">EN ATTENTE</Pill>
        </div>
        <p className="t-body text-[var(--t-2)]">
          Tes 4 scores apparaîtront ici dès que tu auras renseigné quelques check-ins et clôturé
          quelques trades. Le snapshot est calculé chaque nuit sur les 30 derniers jours.
        </p>
        <ul className="t-cap mt-1 grid gap-1.5 text-[var(--t-3)]">
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong className="text-[var(--t-1)]">Discipline</strong> — plan respecté, hedge
              respecté, routine matin.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong className="text-[var(--t-1)]">Stabilité émotionnelle</strong> — variance du
              mood, gestion du stress.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong className="text-[var(--t-1)]">Cohérence</strong> — expectancy, profit factor,
              drawdown maîtrisé.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong className="text-[var(--t-1)]">Engagement</strong> — régularité des check-ins,
              streak, journal.
            </span>
          </li>
        </ul>
      </Card>
    );
  }

  const reasonOf = (
    s: SerializedBehavioralScore['components'][keyof SerializedBehavioralScore['components']],
  ) => s.reason ?? undefined;

  return (
    <section aria-labelledby="scores-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 id="scores-heading" className="t-eyebrow">
            Scores comportementaux
          </h2>
          <Pill tone="acc" dot="live">
            ACTIFS
          </Pill>
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
    </section>
  );
}

export function ScoreGaugeGridSkeleton() {
  return (
    <section className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="t-eyebrow">Scores comportementaux</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="skel rounded-card-lg h-[224px] border border-[var(--b-default)] bg-[var(--bg-1)]"
          />
        ))}
      </div>
    </section>
  );
}
