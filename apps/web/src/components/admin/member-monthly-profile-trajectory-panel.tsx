import { CalendarRange } from 'lucide-react';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { DeepDimensionSections } from '@/components/admin/deep-dimension-sections';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMonthLabelFr } from '@/lib/monthly-debrief/format';
import type { SerializedMonthlyProfileSnapshot } from '@/lib/member-profile-monthly/types';

/**
 * J-E inc.3 — admin READ-ONLY monthly deep re-profiling trajectory for the
 * member detail `?tab=trajectoire`. Eliott reads, month by month, how the 4
 * deep AI dimensions (coaching tone, learning stage, structured axes, weak
 * signals) moved vs the onboarding baseline, plus the AI evolution narrative
 * that is the J-E value-add. ADMIN-ONLY (never dispatched to the member) and
 * READ-ONLY (no action, mirror `member-monthly-debriefs-panel`).
 *
 * 🚨 §21.5 — none of the 4 dims is EVER a scoring input; the snapshots are read
 * straight from `member_profile_monthly_snapshots`, never recomputed against
 * `trades`. Reuses the SAME `deep-dimension-sections` renderer as the onboarding
 * `MemberProfile` viewer (the schema promised one renderer for both surfaces).
 *
 * Heading outline: this panel's `h2` title → a per-month `h3` → the 4 dim
 * sections at `h4` (a valid, non-skipping document outline). `idPrefix` is the
 * month, so the many months' dim heading ids never collide.
 *
 * One EU AI Act 50(1) `<AIGeneratedBanner>` covers the whole AI-derived block
 * (narrative + dims), never one per month. Empty state is an honest "pas encore
 * de re-profilage" (canon §21.4/§25.4), never a misleading fake trajectory.
 */

const FMT_GENERATED = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function MemberMonthlyProfileTrajectoryPanel({
  snapshots,
}: {
  snapshots: readonly SerializedMonthlyProfileSnapshot[];
}) {
  if (snapshots.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={CalendarRange}
          headline="Aucun re-profilage mensuel pour ce membre."
          lead="La trajectoire des 4 dimensions apparaîtra ici au fil des mois, dès que le membre aura écrit assez de réflexions pour être re-profilé."
          headingLevel="h3"
        />
      </Card>
    );
  }

  // Newest first (loader orders by monthStart desc): the most recent model pin
  // labels the shared AI Act banner.
  const latestModel = snapshots[0]?.claudeModel;

  return (
    <section className="flex flex-col gap-4" data-slot="member-monthly-profile-trajectory">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-h2 text-[var(--t-1)]">Trajectoire mensuelle du profil</h2>
        <p className="t-cap text-[var(--t-3)]">
          {snapshots.length} mois affiché{snapshots.length > 1 ? 's' : ''}
        </p>
      </div>

      {/* Single AI Act art.50 banner covering the whole AI-derived block. */}
      <AIGeneratedBanner variant="inline" {...(latestModel ? { modelName: latestModel } : {})} />

      <ul className="flex flex-col gap-5">
        {snapshots.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <header className="flex items-baseline justify-between gap-3">
                <h3 className="t-h3 text-[var(--t-1)]">{formatMonthLabelFr(s.monthStart)}</h3>
                <p className="t-cap font-mono text-[var(--t-3)]">
                  Généré le {FMT_GENERATED.format(new Date(s.generatedAt))}
                </p>
              </header>

              {/* The month-over-month evolution synthesis: the J-E headline. */}
              <p className="t-body leading-relaxed text-[var(--t-2)]">{s.evolutionNarrative}</p>

              <DeepDimensionSections
                coachingTone={s.coachingTone}
                learningStage={s.learningStage}
                axesStructured={s.axesStructured}
                weakSignals={s.weakSignals}
                idPrefix={`trajectoire-${s.monthStart}`}
                headingLevel="h4"
              />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
