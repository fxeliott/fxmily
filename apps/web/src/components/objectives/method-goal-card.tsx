import { Target } from 'lucide-react';

import type { DerivedMethodGoal } from '@/lib/objectives/derived-goals';
import { cn } from '@/lib/utils';

/**
 * S25 #2 — « Ton objectif du moment » : l'objectif de méthode DÉRIVÉ de la donnée
 * réelle du membre et ÉVOLUTIF (cf. `lib/objectives/derived-goals.ts`). Affiche la
 * règle dure où il est le plus faible (sur 30j) + un palier doux juste au-dessus,
 * sous forme d'une barre de progression calme `current → target`.
 *
 * Server Component présentationnel pur (pas d'îlot client) : tout arrive en props.
 * Rend `null` quand il n'y a pas d'objectif (pas assez de trades / déjà fidèle).
 *
 * POSTURE §2 : la règle est un objet de PROCESS (fenêtre, 1/jour, coupure, visée
 * RR) — jamais un signal de marché. §31.2 : un palier doux et encourageant, jamais
 * rouge, jamais un compte à rebours. Déterministe ⇒ pas de badge IA.
 */

export function MethodGoalCard({
  goal,
  variant = 'full',
  className,
}: {
  goal: DerivedMethodGoal | null;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  if (!goal) return null;
  const { label, hint, current, target, good, total, windowDays } = goal;

  // Largeurs de la barre (clampées) + position du repère cible.
  const fillPct = Math.max(0, Math.min(100, current));
  const targetPct = Math.max(0, Math.min(100, target));
  const compact = variant === 'compact';

  return (
    <section
      data-slot="method-goal-card"
      data-rule={goal.rule}
      aria-labelledby="method-goal-heading"
      className={cn(
        'rounded-card border border-[var(--b-acc)] bg-[var(--acc-dim)]',
        compact ? 'p-4' : 'p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
          <Target className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">Ton objectif du moment</span>
          <h2 id="method-goal-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            {label}
          </h2>
          {!compact ? <p className="t-cap leading-relaxed text-[var(--t-2)]">{hint}</p> : null}
        </div>
      </div>

      {/* Barre de progression current → target. role=progressbar pour les AT. */}
      <div className="mt-3.5 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="f-mono text-[22px] leading-none font-bold text-[var(--t-1)] tabular-nums">
            {current}
            <span className="text-[12px] font-medium text-[var(--t-3)]">%</span>
          </span>
          <span className="t-cap font-medium text-[var(--acc-hi)] tabular-nums">
            cible {target}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${current}% · objectif ${target}%`}
          aria-label={`Fidélité à la règle « ${label} » : ${current}%, objectif ${target}%`}
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-2)]"
        >
          <div
            className="h-full rounded-full bg-[var(--acc)] transition-[width] duration-500"
            style={{ width: `${fillPct}%` }}
          />
          {/* Repère cible (encoche claire), jamais rouge. */}
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--t-2)] opacity-70"
            style={{ left: `${targetPct}%` }}
          />
        </div>
        <p className="t-foot text-[var(--t-4)] tabular-nums">
          Dérivé de tes {windowDays} derniers jours · {good}/{total}
        </p>
      </div>
    </section>
  );
}
