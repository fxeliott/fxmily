import { Activity, Flag } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { TradeCloseEcho, TradeOpenEcho } from '@/lib/coaching/trade-echo';
import { cn } from '@/lib/utils';

/**
 * Tour 10 / Tour 11 — the living echo cards, rendered on the MEMBER trade
 * detail only (the page passes them through TradeDetailView's `echoSlot`; the
 * admin variant never builds one). Shows for {@link ECHO_WINDOW_HOURS} after
 * the moment it reads:
 *   - {@link TradeCloseEchoCard} — after a CLOSE, a reading of what THIS close
 *     says about the member's process.
 *   - {@link TradeOpenEchoCard} — after an OPEN (Tour 11 finding 1), we accueille
 *     the engagement (plan-respect / entry emotion / stop-loss already declared)
 *     while the position is still live.
 *
 * DETERMINISTIC copy (enum-derived, see lib/coaching/trade-echo.ts) → no
 * AIGeneratedBanner (AI Act §50 precedent: learning-stage.ts). POSTURE §31.2:
 * calm accents only — 'watch' renders in the ACCENT tone, never red (red is
 * reserved for trade OUTCOME, DS-v3 finance grammar).
 */

/** Both echo shapes are structurally identical — one renderer, two data-slots. */
type EchoLike = Pick<TradeCloseEcho, 'title' | 'tone' | 'lines'>;

function EchoCard({
  echo,
  slot,
  icon: Icon,
}: {
  echo: EchoLike;
  slot: string;
  icon: typeof Activity;
}) {
  const edge =
    echo.tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim-2)]'
      : echo.tone === 'watch'
        ? 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]'
        : 'border-[var(--b-default)] bg-[var(--bg-2)]/40';
  const iconTone =
    echo.tone === 'ok'
      ? 'text-[var(--ok)]'
      : echo.tone === 'watch'
        ? 'text-[var(--acc)]'
        : 'text-[var(--t-3)]';

  return (
    <Card data-slot={slot} className={cn('border p-4', edge)}>
      {/* role="status" — the echo is a live, non-urgent reaction to the member's
          own act; announced politely by AT without stealing focus. */}
      <div className="flex items-start gap-3" role="status">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)]',
            iconTone,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="t-eyebrow text-[var(--t-3)]">{echo.title}</h2>
          {echo.lines.map((line, i) => (
            <p
              key={i}
              className={cn(
                't-body leading-relaxed',
                i === 0 ? 'text-[var(--t-1)]' : 'text-[var(--t-2)]',
              )}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function TradeCloseEchoCard({ echo }: { echo: TradeCloseEcho }) {
  return <EchoCard echo={echo} slot="trade-close-echo" icon={Activity} />;
}

export function TradeOpenEchoCard({ echo }: { echo: TradeOpenEcho }) {
  return <EchoCard echo={echo} slot="trade-open-echo" icon={Flag} />;
}
