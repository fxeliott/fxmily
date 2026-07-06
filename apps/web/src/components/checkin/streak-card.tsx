import { Flame } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { STREAK_MILESTONES as MILESTONES } from '@/lib/checkin/streak';
import { cn } from '@/lib/utils';

interface StreakCardProps {
  /** Current consecutive streak (0+). */
  streak: number;
  /** True iff a check-in already exists for today. */
  todayFilled: boolean;
  /** Compact = inline KPI in the dashboard ; full = standalone card on /checkin. */
  compact?: boolean;
  /**
   * S9.1 "wave wow" — set to the milestone threshold (7/14/30) the member
   * JUST crossed with their latest check-in, to play a one-time calm entrance
   * celebration (CSS `.milestone-settle`, no loop). `null`/undefined = no
   * celebration. Non-toxic: this marks an accomplishment, it NEVER warns about
   * a streak about to break.
   */
  justCrossed?: number | null;
}

/**
 * Streak readout (J5, SPEC §7.4 + J6 engagement scoring).
 *
 * Posture (Mark Douglas-aligned, content audit fix):
 * Discipline = consistency, NOT a trophy chase. We deliberately avoid the
 * "EN FEU" / Snapchat-style label — the visual reward is the flame intensity
 * + glow that grows past the 7-day milestone, no shouting badge required.
 * The rationale (mercy infrastructure, Yu-kai Chou's ethical streak design):
 *   - 0 streak → invitation to start, mute tone (no guilt).
 *   - 1+ streak filled today → calm lime confirmation (you held the line).
 *   - 1+ streak NOT filled today → "à confirmer" (signal, not panic).
 *   - 7+ streak → flame in warn tone with halo + flame-flicker animation.
 *   - 30+ streak → flame in warn tone with stronger flame-pulse (subtle "deep
 *     habit" signal — never blocks the user, no ratcheting bar).
 *
 * Milestones (7 / 14 / 30 / 100) are surfaced as a 4-tick progress bar so
 * the member sees the next anchor without needing a leaderboard.
 *
 * Compact variant lives in the dashboard KPI strip; full variant on /checkin.
 */

export function StreakCard({ streak, todayFilled, compact, justCrossed }: StreakCardProps) {
  const noStreak = streak === 0;
  const ablaze = streak >= 7;
  const deepHabit = streak >= 30;
  // Celebrate in BOTH variants (S11 — the dashboard compact strip now carries
  // the calm "palier franchi" acknowledgement too), and only when the crossed
  // milestone actually matches the current streak (defence against stale props).
  // Still anti-Black-Hat (§31.2): a one-time calm settle, never a looping fanfare.
  const celebrating = justCrossed != null && justCrossed === streak;

  const flameColor = noStreak
    ? 'text-[var(--t-3)]'
    : ablaze
      ? 'text-[var(--warn)]'
      : 'text-[var(--acc)]';

  const flameFilter = noStreak
    ? undefined
    : ablaze
      ? 'drop-shadow(0 0 12px oklch(0.78 0.18 70 / 0.50))'
      : 'drop-shadow(0 0 8px oklch(0.62 0.19 254 / 0.45))';

  // Reuse the keyframes already defined in globals.css (flame-flicker /
  // flame-pulse). Skipped automatically by the global @media (prefers-reduced-
  // motion: reduce) override.
  const flameAnim = deepHabit ? 'flame-pulse' : ablaze ? 'flame-flicker' : '';

  if (compact) {
    return (
      <div className="flex items-center gap-2.5">
        {/* S11 — on the crossing day the flame gets a calm 2-pulse halo
            (.celebrate-halo, compositor-only, then stops). No looping fanfare. */}
        <span className={cn('inline-flex shrink-0', celebrating && 'celebrate-halo')} aria-hidden>
          <Flame
            className={cn('h-4 w-4', flameColor, flameAnim)}
            strokeWidth={1.75}
            style={flameFilter ? { filter: flameFilter } : undefined}
          />
        </span>
        <div className="flex flex-col leading-tight">
          <span
            className={cn(
              'f-mono text-[14px] font-semibold tabular-nums',
              noStreak ? 'text-[var(--t-3)]' : 'text-[var(--t-1)]',
            )}
          >
            {streak} jour{streak > 1 ? 's' : ''}
          </span>
          <span
            className={cn(
              't-mono-cap',
              celebrating ? 'font-semibold text-[var(--acc-hi)]' : 'text-[var(--t-3)]',
            )}
          >
            {celebrating
              ? `palier ${justCrossed} j franchi`
              : noStreak
                ? 'à démarrer'
                : todayFilled
                  ? streak > 1
                    ? 'consécutifs'
                    : 'consécutif'
                  : 'à confirmer aujourd’hui'}
          </span>
        </div>
        {celebrating ? (
          <span className="sr-only" role="status">
            Palier de {justCrossed} jours franchi. Belle régularité.
          </span>
        ) : null}
      </div>
    );
  }

  // Compute next milestone for the progress strip.
  const nextMilestone = MILESTONES.find((m) => streak < m) ?? null;
  const previousMilestone = [0, ...MILESTONES].filter((m) => m <= streak).at(-1) ?? 0;

  return (
    <Card primary className="wow-hover-soft relative flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="t-eyebrow">Streak check-in</span>
        <div className="flex items-center gap-2">
          {/* S9.1 — calm "palier franchi" acknowledgement on the crossing
              check-in only. Brand blue, no exclamation, dismissed on next load. */}
          {celebrating ? (
            <span className="milestone-settle rounded-pill inline-flex items-center gap-1 border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--acc-hi)] uppercase">
              Palier {justCrossed} j franchi
            </span>
          ) : null}
          <Flame
            className={cn('h-5 w-5 shrink-0', flameColor, flameAnim)}
            strokeWidth={1.75}
            style={flameFilter ? { filter: flameFilter } : undefined}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'f-mono text-[44px] leading-none font-bold tracking-[-0.04em] tabular-nums',
            noStreak ? 'text-[var(--t-3)]' : 'text-[var(--acc)]',
            celebrating && 'milestone-settle',
          )}
          style={
            noStreak ? undefined : { filter: 'drop-shadow(0 0 12px oklch(0.62 0.19 254 / 0.40))' }
          }
        >
          {streak}
        </span>
        <span className="t-eyebrow">
          jour{streak > 1 ? 's' : ''} consécutif{streak > 1 ? 's' : ''}
        </span>
      </div>

      {/* Accessible, non-visual confirmation of the milestone for AT users. */}
      {celebrating ? (
        <span className="sr-only" role="status">
          Palier de {justCrossed} jours franchi. Belle régularité.
        </span>
      ) : null}

      {/* Milestone progress strip — 4 ticks at 7 / 14 / 30 / 100 days. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1" aria-hidden>
          {MILESTONES.map((m) => {
            const reached = streak >= m;
            return (
              <div
                key={m}
                className={cn(
                  'rounded-pill h-1 flex-1 transition-colors duration-300',
                  reached ? 'bg-[var(--acc)]' : 'bg-[var(--b-default)]',
                )}
              />
            );
          })}
        </div>
        <div className="flex justify-between font-mono text-[10px] text-[var(--t-3)] tabular-nums">
          {MILESTONES.map((m) => (
            <span key={m} className={streak >= m ? 'text-[var(--acc)]' : ''}>
              {m}j
            </span>
          ))}
        </div>
      </div>

      <p className="t-body text-[var(--t-2)]">
        {noStreak
          ? 'Démarre ton premier check-in aujourd’hui, le matin ou le soir suffit pour lancer la chaîne.'
          : todayFilled
            ? `Tu enchaînes ${streak} jour${streak > 1 ? 's' : ''} d’affilée. La régularité construit le score discipline.`
            : `${streak} jour${streak > 1 ? 's' : ''} d’affilée derrière toi. Confirme aujourd’hui pour continuer.`}
      </p>

      {nextMilestone && !noStreak ? (
        <p className="t-cap text-[var(--t-3)]">
          <span className="font-mono text-[var(--t-2)] tabular-nums">{nextMilestone - streak}</span>{' '}
          jour{nextMilestone - streak > 1 ? 's' : ''} avant le palier{' '}
          <span className="font-mono text-[var(--t-2)] tabular-nums">{nextMilestone} j</span>.
        </p>
      ) : null}

      {/* Mute the visual difference 0-streak vs filled with an icon-state cue
          when needed (a11y B3 audit recommendation). */}
      {!noStreak && previousMilestone > 0 ? (
        <span className="sr-only">Palier {previousMilestone} jours franchi.</span>
      ) : null}
    </Card>
  );
}
