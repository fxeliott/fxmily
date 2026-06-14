'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useState } from 'react';

/**
 * FirstCheckinCelebration — S9.1 "wave wow", non-toxic Mark Douglas moment.
 *
 * Shown on the first-check-in landing (countCheckins === 1, right after a
 * member completes their very first check-in). A calm spring pops a brand-blue
 * checkmark with a breathing halo, paired with a grounded copy ("Tu as posé ta
 * routine") — celebrating a REAL first action, never a score, never a streak
 * warning, never FOMO.
 *
 * Not strictly once: because the submit is an idempotent upsert, re-editing the
 * very first slot on day 1 keeps countCheckins === 1, so this can re-appear on
 * that same-day re-edit. Benign and dismissible — we accept it rather than
 * tracking a "seen" flag for a transient day-1 edge.
 *
 * Discipline (frontend-elite + posture):
 *   - Compositor-only: framer animates scale + opacity only; the halo is a CSS
 *     `::after` pulse (opacity+scale) over a once-painted shadow. The card glow
 *     (box-shadow) is painted once, never looped.
 *   - useReducedMotion(): AT users get a fade-only entrance (no scale/translate),
 *     and the breathing ring is suppressed via the `.celebrate-halo` reduced-
 *     motion guard in globals.css.
 *   - Dismissible / non-blocking: a tap-to-dismiss close button; nothing here
 *     gates navigation, and the StreakCard + slot cards render underneath
 *     regardless. role="status" so it's announced, not alarming.
 */
export function FirstCheckinCelebration({ slot }: { slot: 'morning' | 'evening' }) {
  const prefersReducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const word = slot === 'morning' ? 'matin' : 'soir';

  return (
    <m.div
      role="status"
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: prefersReducedMotion ? 0.2 : 0.42,
        ease: [0.34, 1.56, 0.64, 1],
      }}
      className="glass-panel glow-edge rounded-card-lg relative overflow-hidden p-5"
    >
      <div className="flex items-start gap-3.5">
        {/* Spring checkmark with breathing brand halo. The `.celebrate-halo`
            pulse + `.celebrate-pop` keyframes settle (no infinite throb). */}
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
          <Check className="h-5 w-5" strokeWidth={2.5} />
        </m.span>

        <div className="flex flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">Premier check-in</span>
          <p className="text-[15px] leading-snug font-semibold text-[var(--t-1)]">
            Tu as posé ta routine.
          </p>
          {/* Mark Douglas posture: name the action, not a reward. No streak
              pressure, no "ne casse pas la chaîne". Just: tu as commencé. */}
          <p className="t-body text-[var(--t-2)]">
            {`Ce ${word} est enregistré — le premier d'une pratique qui t'appartient. La régularité se construit un jour à la fois, sans te juger.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Fermer le message de bienvenue"
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
