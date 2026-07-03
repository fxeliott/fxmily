import { Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { SubmitEcho } from '@/lib/coaching/submit-echo';
import { cn } from '@/lib/utils';

/**
 * Tour 11 (finding 3) — the REFLECT submit echo card.
 *
 * Renders the living, member-specific confirmation returned by
 * `buildReflectSubmitEcho` / `buildReviewSubmitEcho` (deterministic, enum-derived
 * FR copy — no AI call, so no AIGeneratedBanner, precedent trade-close-echo).
 * Mirrors the `TradeCloseEchoCard` grammar: an icon chip + a title eyebrow + the
 * echo lines, wrapped in `role="status"` so assistive tech announces the calm,
 * non-urgent reaction without stealing focus.
 *
 * POSTURE §31.2 / Mark Douglas: calm accents only. 'ok' reads in the positive
 * `--ok` tone (a completed act), 'neutral' stays plain. RED is never produced
 * here (reserved for trade outcomes).
 */
export function SubmitEchoCard({ echo }: { echo: SubmitEcho }) {
  const surface =
    echo.tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim-2)]'
      : 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]';
  const iconTone = echo.tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--acc)]';

  return (
    <Card data-slot="submit-echo" className={cn('wow-rise border p-4', surface)}>
      <div className="flex items-start gap-3" role="status">
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
