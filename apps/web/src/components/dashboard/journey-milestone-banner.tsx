'use client';

import { m, useReducedMotion } from 'framer-motion';
import { NotebookPen, CalendarCheck } from 'lucide-react';
import { useState } from 'react';

import type { JourneyMilestone } from '@/lib/coaching/journey-milestone';

/**
 * JourneyMilestoneBanner (Tour 11) — calm PROCESS milestone acknowledgement on
 * the dashboard: journaled-trade counts (10/25/50/100) or the first-month
 * anniversary. Server-gated ONE-DAY-ONLY upstream (`getTodayJourneyMilestone`),
 * shown only if the streak milestone (`getTodayMilestone`) is null so a single
 * celebration ever appears at once.
 *
 * Twin of `MilestoneBanner` (S11) — same discipline, same posture:
 *   - Compositor-only entrance (opacity + y + scale); the glyph halo is the CSS
 *     `.celebrate-halo` ::after pulse (2× then settles, never an infinite throb).
 *   - useReducedMotion(): fade-only entrance; the halo is suppressed by the
 *     globals.css reduced-motion guard. SINGLE JSX tree — reduction rides the
 *     animation props only, never the structure (SSR hydration lesson).
 *   - Dismissible / non-blocking. role="status" is safe here (the dashboard has
 *     no competing live region).
 *
 * Posture §2 + anti-Black-Hat (§31.2): it names a real accomplishment with Mark
 * Douglas framing (process over outcome — the TRACE, not the number), never a
 * trophy to defend, never FOMO, never a score, never a countdown, never red.
 */
export function JourneyMilestoneBanner({ milestone }: { milestone: JourneyMilestone }) {
  const prefersReducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const Icon = milestone.kind === 'first-month' ? CalendarCheck : NotebookPen;

  return (
    <m.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.2 : 0.42, ease: [0.34, 1.56, 0.64, 1] }}
      className="glass-panel glow-edge rounded-card-lg relative overflow-hidden p-5"
    >
      <div className="flex items-start gap-3.5">
        <m.span
          aria-hidden
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: prefersReducedMotion ? 0 : 0.12,
            duration: prefersReducedMotion ? 0.2 : 0.46,
            ease: [0.34, 1.56, 0.64, 1],
          }}
          className="celebrate-halo grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--acc)] text-[var(--acc-fg)] shadow-[0_0_24px_-4px_oklch(0.62_0.19_254_/_0.6)]"
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </m.span>

        <div className="flex flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">{milestone.eyebrow}</span>
          <p className="text-[15px] leading-snug font-semibold text-[var(--t-1)]">
            {milestone.title}
          </p>
          {/* Process-over-outcome body: the trace, never a trophy (§2/§31.2). */}
          <p className="t-body text-[var(--t-2)]">{milestone.body}</p>
          <span className="sr-only" role="status">
            {milestone.title}. {milestone.body}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Fermer le message de jalon"
          className="rounded-control -mt-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </m.div>
  );
}
