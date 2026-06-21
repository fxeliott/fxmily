import { Activity, ArrowRight } from 'lucide-react';

import type { EmotionArcDegradation } from '@/lib/scoring/pattern-rhythms';
import { EMOTION_ARC_MIN_TO_SURFACE } from '@/lib/scoring/pattern-rhythms';
import { emotionLabel } from '@/lib/trading/emotions';

/**
 * S15 #5 — surfaces the intra-trade emotion-arc degradation as ONE calm line:
 * trades the member entered composed but exited contrarié. This is the Mark
 * Douglas marker of a psychologically mishandled trade — independent of P&L.
 *
 * Posture §2 / anti-Black-Hat: a factual, non-judgmental mirror ("voici un
 * pattern", not "tu as mal fait"). Renders NOTHING below
 * EMOTION_ARC_MIN_TO_SURFACE (a single occurrence is not a pattern — never a
 * verdict on a thin sample). The example transitions are real (from the
 * member's own tags), never fabricated.
 */
export function EmotionArcNote({ arc }: { arc: EmotionArcDegradation }) {
  if (arc.count < EMOTION_ARC_MIN_TO_SURFACE) return null;

  return (
    <aside
      className="rounded-card-lg flex items-start gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 lg:col-span-2"
      aria-label="Contrôle émotionnel intra-trade"
    >
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
      >
        <Activity className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="t-eyebrow text-[var(--t-3)]">Contrôle émotionnel</span>
        <p className="t-body text-[var(--t-1)]">
          <span className="font-semibold tabular-nums">{arc.count}</span> trade
          {arc.count > 1 ? 's' : ''} où tu es entré serein et sorti contrarié sur cette période.
        </p>
        {arc.examples.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Exemples de bascule émotionnelle">
            {arc.examples.map((ex, i) => (
              <li
                key={`${ex.from}-${ex.to}-${i}`}
                className="rounded-pill inline-flex items-center gap-1 border border-[var(--b-subtle)] bg-[var(--bg-2)] px-2 py-0.5 text-[11px] text-[var(--t-2)]"
              >
                {emotionLabel(ex.from)}
                <ArrowRight className="h-3 w-3 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden />
                {emotionLabel(ex.to)}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="t-cap text-[var(--t-3)]">
          Le contrôle intra-trade se travaille. Le nommer, c’est déjà le voir — pas un verdict.
        </p>
      </div>
    </aside>
  );
}
