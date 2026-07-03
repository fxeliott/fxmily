import { Compass } from 'lucide-react';

import type { EchoLearningStage } from '@/lib/coaching/trade-echo';
import { cn } from '@/lib/utils';

/**
 * StageAwareLine (Tour 11, FINDING 3) — a discrete "La ou tu en es" line on the
 * hub so the member SEES that the app knows their learning stage (before, the
 * stage only lived on /journal/[id] for 24h and on /profile — the most-visited
 * surface was stage-blind).
 *
 * DETERMINISTIC, ZERO AI: the copy is FIXED per stage (enum-derived), coherent
 * with `STAGE_ANCHOR` in trade-echo.ts (same frame, not copied identically) and
 * with `STAGE_HINT` in objectives/learning-stage.ts. No raw AI text surfaced →
 * no AIGeneratedBanner (AI Act §50 precedent: learning-stage.ts).
 *
 * FIREWALL §21.5: stage ONLY — never `weakSignals`, never fed back into a score.
 * The page passes `null` when there is no profile → this renders nothing (never
 * fabricates a stage). POSTURE §2 / Mark Douglas: descriptive, encouraging,
 * never clinical, never a market call. French, tutoiement, no em-dash.
 *
 * Sobriety: ONE discrete line (a thin bordered strip, not a card block) so it
 * adds the personalisation signal without weighing on the dense bento.
 */

const STAGE_LABEL: Record<EchoLearningStage, string> = {
  mechanical: 'Stade mécanique',
  subjective: 'Stade subjectif',
  intuitive: 'Stade intuitif',
};

/** Fixed member-facing line per stage. Same frame as `STAGE_ANCHOR`, distinct
 *  wording (this is the ambient "where you are" line, not a trade post-mortem). */
const STAGE_LINE: Record<EchoLearningStage, string> = {
  mechanical: 'On ancre les règles, une à la une. La discipline d’abord, la lecture ensuite.',
  subjective: 'Ton cadre reste ton garde-fou pendant que ta lecture du marché s’affine.',
  intuitive: 'La constance de ton process est ce qui transforme ta lecture en edge durable.',
};

export function StageAwareLine({ stage }: { stage: EchoLearningStage | null }) {
  if (!stage) return null;

  return (
    <div
      data-slot="stage-aware-line"
      data-stage={stage}
      className={cn(
        'rounded-card flex items-start gap-2.5 border border-[var(--b-default)] bg-[var(--bg-2)]/40 px-3.5 py-2.5',
      )}
    >
      <Compass
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-3)]"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="text-[13px] leading-relaxed text-[var(--t-2)]">
        <span className="font-semibold text-[var(--t-1)]">{STAGE_LABEL[stage]}</span>
        <span className="text-[var(--t-3)]"> · </span>
        {STAGE_LINE[stage]}
      </p>
    </div>
  );
}
