'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useState } from 'react';

import { useCountUp } from '@/lib/hooks';

/**
 * MilestoneBanner — S11 "Wow/Vivacité" calm streak-milestone acknowledgement on
 * the dashboard, shown only the day a check-in lands the streak exactly on a
 * 7/14/30/100 anchor (server-gated upstream via `getTodayMilestone`).
 *
 * It is the prominent, dismissible echo of the subtle in-hero StreakCard halo —
 * a single celebratory MOMENT, not a permanent badge. Posture §2 + anti-Black-Hat
 * (§31.2): it names a real accomplishment with Mark Douglas framing (process over
 * outcome), never a "don't break the chain" threat, never FOMO, never a score.
 *
 * Discipline (frontend-elite, mirrors FirstCheckinCelebration):
 *   - Compositor-only entrance (opacity + y + scale); the flame halo is the CSS
 *     `.celebrate-halo` ::after pulse (2× then stops, never an infinite throb).
 *   - useReducedMotion(): fade-only entrance; the count-up returns the target
 *     instantly; the halo is suppressed by the globals.css reduced-motion guard.
 *   - Dismissible / non-blocking. role="status" is safe here (unlike on /checkin,
 *     the dashboard has no competing confirmation live region).
 */
export function MilestoneBanner({ milestone, streak }: { milestone: number; streak: number }) {
  const prefersReducedMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const count = useCountUp(streak, 900);

  if (dismissed) return null;

  return (
    <m.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.2 : 0.42, ease: [0.34, 1.56, 0.64, 1] }}
      className="glass-panel glow-edge rounded-card-lg relative overflow-hidden p-5"
    >
      <div className="flex items-start gap-3.5">
        {/* Flame with breathing brand halo (.celebrate-halo — 2 pulses, settles). */}
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
          <Flame className="h-5 w-5" strokeWidth={2.25} />
        </m.span>

        <div className="flex flex-1 flex-col gap-1">
          <span className="t-eyebrow text-[var(--acc-hi)]">Palier {milestone} jours</span>
          <p className="text-[15px] leading-snug font-semibold text-[var(--t-1)]">
            {/* Animated digits are visual-only; AT read the stable final streak
                (a mid-animation "3 jours" would misreport the milestone). */}
            <span aria-hidden className="f-mono tabular-nums">
              {Math.round(count)}
            </span>
            <span className="sr-only">{streak}</span> jours consécutifs de check-in.
          </p>
          {/* Mark Douglas posture: name the process, not a trophy. No "ne casse
              pas la chaîne", no streak-loss anxiety — the regularity is the point. */}
          <p className="t-body text-[var(--t-2)]">
            Ce n’est pas un trophée à défendre : c’est la preuve que la régularité t’appartient. La
            discipline se construit un jour à la fois, continue à ton rythme.
          </p>
          <span className="sr-only" role="status">
            Palier de {milestone} jours de check-in franchi. La régularité construit le process.
          </span>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Fermer le message de palier"
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
