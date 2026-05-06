import { Flame } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
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
 * Streak readout (J5, SPEC §7.4 + J6 engagement).
 *
 * UX rules:
 *   - 0 streak → encourage start ("Démarre aujourd'hui").
 *   - todayFilled = true → "🔥 N jours consécutifs".
 *   - todayFilled = false but streak > 0 → "🔥 N jours • à confirmer aujourd'hui".
 *
 * The flame intensifies past 7 days (visual reward without flagrant gamification).
 */
export function StreakCard({ streak, todayFilled, compact }: StreakCardProps) {
  const noStreak = streak === 0;
  const ablaze = streak >= 7;

  const flameColor = noStreak
    ? 'text-[var(--t-4)]'
    : ablaze
      ? 'text-[var(--warn)]'
      : 'text-[var(--acc)]';

  const flameFilter = noStreak
    ? undefined
    : ablaze
      ? 'drop-shadow(0 0 12px oklch(0.78 0.18 70 / 0.50))'
      : 'drop-shadow(0 0 8px oklch(0.879 0.231 130 / 0.45))';

  if (compact) {
    return (
      <div className="flex items-center gap-2.5">
        <Flame
          className={cn('h-4 w-4 shrink-0', flameColor)}
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
          <span className="t-mono-cap text-[var(--t-4)]">
            {noStreak ? 'à démarrer' : todayFilled ? 'consécutifs' : 'à confirmer aujourd’hui'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card primary className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <span className="t-eyebrow">Streak check-in</span>
          {ablaze ? (
            <Pill tone="warn" dot="live">
              EN FEU
            </Pill>
          ) : null}
        </div>
        <Flame
          className={cn('h-5 w-5 shrink-0', flameColor)}
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

      <p className="t-body text-[var(--t-2)]">
        {noStreak
          ? 'Démarre ton premier check-in aujourd’hui — le matin ou le soir suffit pour lancer la chaîne.'
          : todayFilled
            ? `Tu enchaînes ${streak} jour${streak > 1 ? 's' : ''} d’affilée. La régularité construit le score discipline.`
            : `${streak} jour${streak > 1 ? 's' : ''} d’affilée derrière toi. Confirme aujourd’hui pour continuer.`}
      </p>
    </Card>
  );
}
