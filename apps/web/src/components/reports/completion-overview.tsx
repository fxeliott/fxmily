import { CalendarCheck, Flame, NotebookPen, Sunrise } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { InfoDot } from '@/components/ui/info-dot';
import type { CompletionSummary } from '@/lib/reports/completion';

/**
 * CompletionOverview (S6 §32-3) — deterministic "vue d'ensemble du taux de
 * complétion + continuité" rendered at the HEAD of a report reader.
 *
 * Shown in BOTH the admin weekly-report detail (`/admin/reports/[id]`) and the
 * member monthly debrief (`/debrief-mensuel`). It is NOT AI-generated — it is a
 * pure factual snapshot of the member's check-in coverage, morning-routine
 * adherence and continuity for the report period — so it is placed ABOVE the
 * EU-AI-Act banner (the banner introduces only the AI prose below it).
 *
 * Posture (mirror `weekly-recap-card`, anti-Black-Hat §31.2): calm, neutral,
 * NEVER red, NEVER a verdict. Values use `tabular-nums`; a low-coverage period
 * is a neutral fact framed by process > outcome. Mobile-first, 0 overflow at
 * 375px (2-col grid), reduced-motion safe (no animation here). Pure Server
 * Component (only the `InfoDot` popovers are interactive).
 */

type MetricKey = 'coverage' | 'streak' | 'routine' | 'journal';

interface OverviewMetric {
  key: MetricKey;
  label: string;
  display: string;
  tip: string;
}

const METRIC_ICON: Record<MetricKey, typeof CalendarCheck> = {
  coverage: CalendarCheck,
  streak: Flame,
  routine: Sunrise,
  journal: NotebookPen,
};

function buildMetrics(summary: CompletionSummary, periodNoun: string): OverviewMetric[] {
  return [
    {
      key: 'coverage',
      label: 'Jours actifs',
      display: `${summary.checkinDaysFilled}/${summary.periodDays} j`,
      tip: `Nombre de jours distincts où tu as fait au moins un check-in sur ${periodNoun} (${Math.round(
        summary.checkinCoverageRate * 100,
      )} % de couverture). Un repère de présence, jamais un quota.`,
    },
    {
      key: 'streak',
      label: 'Série la plus longue',
      display: `${summary.longestStreakDays} j`,
      tip: `La plus longue suite de jours consécutifs avec un check-in sur ${periodNoun}. La continuité du process compte plus qu'un jour isolé.`,
    },
    {
      key: 'routine',
      label: 'Routine matinale',
      display: `${summary.routineDaysCompleted} j`,
      tip: `Nombre de jours où tu as marqué ta routine du matin comme tenue. Un jour non renseigné n'est jamais compté comme un échec.`,
    },
    {
      key: 'journal',
      label: 'Journaux du soir',
      display: `${summary.eveningCheckinsCount}`,
      tip: `Nombre de bilans du soir remplis sur ${periodNoun}, le moment où tu poses des mots sur ton exécution.`,
    },
  ];
}

export function CompletionOverview({
  summary,
  periodLabel,
  className = '',
}: {
  summary: CompletionSummary;
  /** Period framing for the copy — drives "cette semaine" / "ce mois-ci". */
  periodLabel: 'semaine' | 'mois';
  className?: string;
}) {
  const periodNoun = periodLabel === 'semaine' ? 'la semaine' : 'le mois';

  if (!summary.hasActivity) {
    return (
      <Card className={`p-5 ${className}`.trim()} aria-label="Complétion et continuité">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
          >
            <CalendarCheck className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--t-3)]">Complétion &amp; continuité</span>
            <p className="t-body leading-[1.5] text-[var(--t-2)]">
              Aucun check-in enregistré sur {periodNoun}. Dès tes premiers check-ins, ta couverture
              et ta plus longue série apparaîtront ici, un repère honnête de régularité, jamais un
              quota à atteindre.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const metrics = buildMetrics(summary, periodNoun);

  return (
    <Card
      className={`p-5 ${className}`.trim()}
      aria-label="Complétion et continuité"
      data-slot="completion-overview"
    >
      <header className="mb-4 flex items-center gap-2">
        <CalendarCheck
          className="h-3.5 w-3.5 text-[var(--t-3)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <h2 className="t-eyebrow text-[var(--t-3)]">Complétion &amp; continuité</h2>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const Icon = METRIC_ICON[metric.key];
          return (
            <div
              key={metric.key}
              className="rounded-card flex min-w-0 flex-col gap-1.5 border border-[var(--b-default)] bg-[var(--bg-2)] p-3 transition-colors hover:border-[var(--b-acc)]"
              data-metric={metric.key}
            >
              <dt className="flex items-center gap-1.5">
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-[var(--t-3)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="t-cap min-w-0 truncate text-[var(--t-3)]">{metric.label}</span>
                <InfoDot label={metric.label} tip={metric.tip} />
              </dt>
              <dd>
                <span className="f-display text-[22px] leading-none font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
                  {metric.display}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="t-cap mt-4 leading-[1.5] text-[var(--t-3)]">
        Un état des lieux de ta régularité sur {periodNoun}, un repère, pas un verdict. La constance
        du process prime sur n&apos;importe quel chiffre isolé.
      </p>
    </Card>
  );
}
