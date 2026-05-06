import { Flame } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StreakCardProps {
  /** Current consecutive streak (0+). */
  streak: number;
  /** True iff a check-in already exists for today. */
  todayFilled: boolean;
  /** Compact = inline KPI in the dashboard ; full = standalone card on /checkin. */
  compact?: boolean;
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

const MILESTONES = [7, 14, 30, 100] as const;

export function StreakCard({ streak, todayFilled, compact }: StreakCardProps) {
  const noStreak = streak === 0;
  const ablaze = streak >= 7;
  const deepHabit = streak >= 30;

  const flameColor = noStreak
    ? 'text-[var(--t-3)]'
    : ablaze
      ? 'text-[var(--warn)]'
      : 'text-[var(--acc)]';

  const flameFilter = noStreak
    ? undefined
    : ablaze
      ? 'drop-shadow(0 0 12px oklch(0.78 0.18 70 / 0.50))'
      : 'drop-shadow(0 0 8px oklch(0.879 0.231 130 / 0.45))';

  // Reuse the keyframes already defined in globals.css (flame-flicker /
  // flame-pulse). Skipped automatically by the global @media (prefers-reduced-
  // motion: reduce) override.
  const flameAnim = deepHabit ? 'flame-pulse' : ablaze ? 'flame-flicker' : '';

  if (compact) {
    return (
      <div className="flex items-center gap-2.5">
        <Flame
          className={cn('h-4 w-4 shrink-0', flameColor, flameAnim)}
          strokeWidth={1.75}
          style={flameFilter ? { filter: flameFilter } : undefined}
          aria-hidden
        />
        <div className="flex flex-col leading-tight">
          <span
            className={cn(
              'f-mono text-[14px] font-semibold tabular-nums',
              noStreak ? 'text-[var(--t-3)]' : 'text-[var(--t-1)]',
            )}
          >
            {streak} jour{streak > 1 ? 's' : ''}
          </span>
          <span className="t-mono-cap text-[var(--t-3)]">
            {noStreak ? 'à démarrer' : todayFilled ? 'consécutifs' : 'à confirmer aujourd’hui'}
          </span>
        </div>
      </div>
    );
  }

  // Compute next milestone for the progress strip.
  const nextMilestone = MILESTONES.find((m) => streak < m) ?? null;
  const previousMilestone = [0, ...MILESTONES].filter((m) => m <= streak).at(-1) ?? 0;

  return (
    <Card primary className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <span className="t-eyebrow">Streak check-in</span>
        <Flame
          className={cn('h-5 w-5 shrink-0', flameColor, flameAnim)}
          strokeWidth={1.75}
          style={flameFilter ? { filter: flameFilter } : undefined}
          aria-hidden
        />
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'f-mono text-[44px] font-bold tabular-nums leading-none tracking-[-0.04em]',
            noStreak ? 'text-[var(--t-3)]' : 'text-[var(--acc)]',
          )}
          style={
            noStreak ? undefined : { filter: 'drop-shadow(0 0 12px oklch(0.879 0.231 130 / 0.40))' }
          }
        >
          {streak}
        </span>
        <span className="t-eyebrow">
          jour{streak > 1 ? 's' : ''} consécutif{streak > 1 ? 's' : ''}
        </span>
      </div>

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
        <div className="flex justify-between font-mono text-[10px] tabular-nums text-[var(--t-3)]">
          {MILESTONES.map((m) => (
            <span key={m} className={streak >= m ? 'text-[var(--acc)]' : ''}>
              {m}j
            </span>
          ))}
        </div>
      </div>

      <p className="t-body text-[var(--t-2)]">
        {noStreak
          ? 'Démarre ton premier check-in aujourd’hui — le matin ou le soir suffit pour lancer la chaîne.'
          : todayFilled
            ? `Tu enchaînes ${streak} jour${streak > 1 ? 's' : ''} d’affilée. La régularité construit le score discipline.`
            : `${streak} jour${streak > 1 ? 's' : ''} d’affilée derrière toi. Confirme aujourd’hui pour continuer.`}
      </p>

      {nextMilestone && !noStreak ? (
        <p className="t-cap text-[var(--t-3)]">
          <span className="font-mono tabular-nums text-[var(--t-2)]">{nextMilestone - streak}</span>{' '}
          jour{nextMilestone - streak > 1 ? 's' : ''} avant le palier{' '}
          <span className="font-mono tabular-nums text-[var(--t-2)]">{nextMilestone} j</span>.
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
