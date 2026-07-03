import { Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { CheckinEcho } from '@/lib/coaching/checkin-echo';
import { cn } from '@/lib/utils';

/**
 * Tour 11 — the living check-in echo card, rendered on `/checkin?done=1` ABOVE
 * the DoneBanner confirmation. Shows an immediate, member-specific reading of
 * what the member just declared this morning / this evening.
 *
 * DETERMINISTIC copy (enum/boolean-derived, see lib/coaching/checkin-echo.ts) →
 * no AIGeneratedBanner (AI Act precedent: trade-echo.ts). POSTURE §31.2: calm
 * accents only — 'watch' renders in the ACCENT tone, never red (red is reserved
 * for trade OUTCOMES, DS-v3 finance grammar). Mirror of the journal
 * TradeCloseEchoCard so both living surfaces read the same.
 *
 * a11y: the decorative glyph is aria-hidden; the reading itself is plain text
 * (never color-only). The card is additive context, NOT the confirmation — the
 * DoneBanner below keeps its own role="status" for assistive tech.
 */
export function CheckinEchoCard({ echo }: { echo: CheckinEcho }) {
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
    <Card data-slot="checkin-echo" className={cn('border p-4', edge)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)]',
            iconTone,
          )}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
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
