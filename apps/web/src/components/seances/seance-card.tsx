import { CalendarX, FileText, LineChart, PlayCircle } from 'lucide-react';
import Link from 'next/link';

import { Pill } from '@/components/ui/pill';
import { assetCountLabel, slotMeta } from '@/lib/seances/derive';
import type { SeanceListItem } from '@/lib/seances/service';
import { cn } from '@/lib/utils';

/**
 * One séance in the hub listing (Server Component). A `done` séance is a
 * clickable Link card; a `cancelled` one is an INERT `<article>` (no href),
 * greyed, with the cancel reason in place of the summary — state carried by
 * text + icon, never colour alone (WCAG 1.4.1). `scheduled` is never listed.
 * Slot accent maps onto DS-v3 tokens (analyse→--acc, debrief→--acc-2).
 */
export function SeanceCard({ item, isLatest }: { item: SeanceListItem; isLatest: boolean }) {
  const meta = slotMeta(item.slot);
  const isCancelled = item.status === 'cancelled';
  const SlotIcon = item.slot === 'analyse' ? LineChart : FileText;

  const inner = (
    <>
      {/* Left accent rail (slot colour), hidden on a cancelled card. */}
      {!isCancelled ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-0 w-0.5 rounded-full"
          style={{ background: meta.accentVar }}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span
          className="t-eyebrow inline-flex items-center gap-1.5"
          style={{ color: isCancelled ? 'var(--t-3)' : meta.accentText }}
        >
          <SlotIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {meta.label}
        </span>
        <span className="t-cap font-mono text-[var(--t-3)] tabular-nums">{item.time}</span>
      </div>

      <h3
        className={cn(
          't-body mt-2 font-medium',
          isCancelled ? 'text-[var(--t-3)]' : 'text-[var(--t-1)]',
        )}
      >
        {item.title}
      </h3>

      {isCancelled ? (
        item.cancelReason ? (
          <p className="t-cap mt-1 text-[var(--t-3)]">{item.cancelReason}</p>
        ) : null
      ) : item.summary ? (
        <p className="t-cap mt-1 line-clamp-2 text-[var(--t-3)]">{item.summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {isCancelled ? (
          <span className="t-cap inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarX className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Séance annulée
          </span>
        ) : (
          <>
            {isLatest ? (
              <Pill tone="acc" dot="live">
                Dernière séance
              </Pill>
            ) : null}
            {item.hasVideo ? (
              <Pill tone="mute">
                <PlayCircle className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
                Replay
              </Pill>
            ) : null}
            {item.assetCount > 0 ? (
              <Pill tone="mute">{assetCountLabel(item.assetCount)}</Pill>
            ) : null}
          </>
        )}
      </div>
    </>
  );

  const base =
    'rounded-card relative flex flex-col border border-[var(--b-default)] bg-[var(--bg-1)] p-4';

  if (isCancelled) {
    // De-emphasis is carried by the muted `--t-3` text + "Séance annulée" label
    // + icon + missing accent rail — NEVER by `opacity` on the article, which
    // would drag the (already tertiary) text under 4.5:1 (WCAG 1.4.3). All text
    // stays ≥5:1 on the unchanged `--bg-1` surface.
    return (
      <article className={base} data-status="cancelled">
        {inner}
      </article>
    );
  }

  return (
    <Link
      href={item.href}
      data-status="done"
      className={cn(
        base,
        'group shadow-[var(--sh-card)] transition-[border-color,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:border-[var(--b-strong)] hover:shadow-[var(--sh-card-hover)]',
        'focus-visible:ring-2 focus-visible:ring-[var(--acc-edge)] focus-visible:outline-none',
      )}
    >
      {inner}
    </Link>
  );
}
