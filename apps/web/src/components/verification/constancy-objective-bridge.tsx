import { ArrowRight, Target } from 'lucide-react';
import Link from 'next/link';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import type { ProcessObjective } from '@/lib/objectives/service';
import type { ConstancyScoreView } from '@/lib/verification/constancy';

/**
 * S4 (CONTEXTE GLOBAL « Scoring ») — « chaque score […] le relie à l'objectif
 * personnel correspondant, cause → effet → prochain pas ».
 *
 * The constancy score was a dead-end on `/verification` : a number with no bridge
 * back to what the member is working toward. This calm card closes that loop —
 * cause (ta constance) → effet (le levier de process qu'elle nourrit) → prochain
 * pas (un lien vers /objectifs). Read-only, presentational, server component.
 *
 * Posture §2 : the objective is a PROCESS lever (discipline / stabilité /
 * constance / engagement) or the member's STATED coaching axis — never a P&L
 * target. §33.2 : encouraging, never punitive, never red — a bridge, not a verdict.
 *
 * AI Act §50 : the derived `focus.label` is deterministic, but the fallback
 * `coachingAxis` is Claude-derived (`MemberProfile.axesPrioritaires`), so any
 * surface that shows it must carry the `AIGeneratedBanner` (invariant documented
 * on the field, objectives/service.ts) — mirrored from the canonical
 * `CoachingAxisCard`. The badge renders ONLY when the coachingAxis branch runs.
 *
 * Renders `null` when there's nothing honest to bridge: no score yet (§33.5 — no
 * fabricated 100), or no objective signal to point at.
 */
export function ConstancyObjectiveBridge({
  score,
  focus,
  coachingAxis,
}: {
  score: ConstancyScoreView | null;
  /** Weakest behavioural lever — the priority work. */
  focus: ProcessObjective | null;
  /** Member's STATED coaching axis (onboarding profile), fallback target. */
  coachingAxis: string | null;
}) {
  // No score → nothing to relate (honesty §33.5). No objective → no bridge.
  if (!score) return null;
  const objectiveLabel = focus?.label ?? coachingAxis;
  if (!objectiveLabel) return null;

  // STATED axis (free text) is phrased lower-case mid-sentence; the derived
  // focus label is a proper noun (« Discipline ») kept as-is.
  const effet = focus
    ? `elle nourrit ton levier du moment : ${focus.label}`
    : `elle soutient ce sur quoi tu travailles : ${coachingAxis}`;
  // The fallback branch surfaces the Claude-derived coachingAxis → AI Act §50.
  const showsAiAxis = !focus;

  return (
    <Link
      href="/objectifs"
      data-slot="constancy-objective-bridge"
      className="rounded-card group flex items-start gap-3.5 border border-[var(--cy-edge)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <span className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--cy-edge)] bg-[var(--bg-2)] text-[var(--cy)]">
        <Target className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="t-eyebrow text-[var(--t-3)]">Ce que ta constance change</span>
        <p className="t-body leading-[1.5] text-[var(--t-2)]">
          Ta constance ({Math.round(score.value)}/100) mesure ta régularité et ton honnêteté,{' '}
          {effet}. Prochain pas : voir comment progresser dessus.
        </p>
        {showsAiAxis ? <AIGeneratedBanner variant="badge" className="mt-0.5 self-start" /> : null}
        <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--t-3)] transition-colors group-hover:text-[var(--t-1)]">
          Mes objectifs
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}
