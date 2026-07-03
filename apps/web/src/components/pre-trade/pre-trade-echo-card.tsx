import { ShieldCheck } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { PreTradeEcho } from '@/lib/coaching/pre-trade-echo';
import { cn } from '@/lib/utils';

/**
 * Tour 11 — the living pre-trade echo card, rendered on `/pre-trade/done/[id]`
 * right after the discipline pause. Shows an immediate, member-specific reading
 * of what the member just declared (reason, emotion, plan alignment, stop-loss).
 *
 * DETERMINISTIC copy (enum/boolean-derived, see lib/coaching/pre-trade-echo.ts)
 * → no AIGeneratedBanner (AI Act precedent: trade-echo.ts). POSTURE §31.2 +
 * ADR-003: calm accents only — 'watch' renders in the ACCENT tone, never red
 * (the pause is a mirror, never a barrier or a verdict). Mirror of the journal
 * TradeCloseEchoCard so every living surface reads the same.
 *
 * a11y: decorative glyph aria-hidden; the reading is plain text (never
 * color-only).
 */
export function PreTradeEchoCard({ echo }: { echo: PreTradeEcho }) {
  const edge =
    echo.tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim-2)]'
      : 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]';
  const iconTone = echo.tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--acc)]';

  return (
    <Card data-slot="pre-trade-echo" className={cn('border p-4', edge)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)]',
            iconTone,
          )}
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
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
