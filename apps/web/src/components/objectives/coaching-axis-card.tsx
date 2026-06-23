import { Target } from 'lucide-react';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { cn } from '@/lib/utils';

/**
 * S24 — « Ton axe de coaching cette semaine ».
 *
 * Surfaces the member's PERSONAL priority axis (from their onboarding profile,
 * `MemberProfile.axesPrioritaires`, rotated weekly by `pickWeeklyAxis`). Before
 * S24 this lived inline ONLY on `/objectifs`; extracted here as ONE shared,
 * AI-labelled component so the dashboard hub can surface it too — the member
 * meets their own "thing to work on" without having to navigate.
 *
 * POSTURE §2: descriptive process/discipline focus, never a market call. AI Act
 * §50: the axis is Claude-derived → carries `AIGeneratedBanner`. Renders NOTHING
 * when there is no axis (no profile yet) — no fabricated state.
 *
 * `full` — the standalone section used on /objectifs (links to all axes).
 * `compact` — a slimmer card for the dense dashboard hub.
 */
export function CoachingAxisCard({
  axis,
  variant = 'full',
  className = '',
}: {
  axis: string | null;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  if (!axis) return null;

  return (
    <div
      data-slot="coaching-axis-card"
      className={cn(
        'rounded-card-lg flex flex-col gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)]',
        variant === 'compact' ? 'p-4' : 'p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="rounded-control mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)]/50 text-[var(--acc)]"
        >
          <Target className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          {/* --acc-hi clears WCAG 1.4.3 AA on the --acc-dim tinted surface
              (--acc is ~3.15:1 on tints; --acc-hi ≥4.5:1). */}
          <span className="t-eyebrow text-[var(--acc-hi)]">Ton axe de coaching cette semaine</span>
          <h2
            id="coaching-axis-heading"
            className="t-body leading-[1.5] font-semibold break-words text-[var(--t-1)]"
          >
            {axis}
          </h2>
          <p className="t-cap text-[var(--t-3)]">
            Issu de ton profil.{' '}
            <a
              href="/profile"
              className="font-medium text-[var(--acc-hi)] underline decoration-[var(--b-acc)] decoration-2 underline-offset-2 transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              Voir tous tes axes →
            </a>
          </p>
        </div>
      </div>
      <AIGeneratedBanner variant="badge" />
    </div>
  );
}
