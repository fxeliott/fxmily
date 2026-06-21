'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { type EmotionPhase } from '@/lib/patterns/emotion-phase';
import { cn } from '@/lib/utils';

/**
 * V2 PATTERNS — emotion-moment picker (SPEC §7.5, master prompt §22).
 *
 * Switches the `EmotionPerfTable` between the three captured emotional
 * moments — avant / pendant / après. A single mutually-exclusive *parameter*
 * choice that re-renders ONE table → an APG **radiogroup** (exactly-one-is-
 * always-selected; no per-tab panel). Modelled tightly on
 * `HabitKindTabPicker`: same roving-tabindex, same
 * selection-does-NOT-follow-focus rule (the commit is a server navigation,
 * so arrows move focus only; Space / Enter / click commit + navigate), same
 * calm opacity-dim pending cue (no spinner — anti-Black-Hat / Mark Douglas).
 *
 * Drives the `?phase=` URL search param. The host page validates it
 * (fallback `before`) and passes the matching pre-aggregated rows to the
 * single `EmotionPerfTable`, wrapped in `<Suspense key={phase}>` so the
 * table re-mounts with an honest skeleton during the new fetch. The picker
 * sits OUTSIDE that Suspense so it stays interactive while the table loads.
 */

const PHASE_ENTRIES: ReadonlyArray<{ phase: EmotionPhase; label: string }> = [
  { phase: 'before', label: 'Avant' },
  { phase: 'during', label: 'Pendant' },
  { phase: 'after', label: 'Après' },
];

interface EmotionPhasePickerProps {
  /** Server-validated active phase (host parsed `?phase=`, fallback `before`). */
  selected: EmotionPhase;
  /** `id` of the visible group label this radiogroup is described by. */
  labelId: string;
  /** Host route pathname (e.g. `/patterns`). */
  pathname: string;
  /**
   * Query string the host wants preserved across a phase switch, WITHOUT
   * `phase` (e.g. `"range=3m"` or `""`). The picker appends/overrides `phase`.
   */
  preservedQuery: string;
}

export function EmotionPhasePicker({
  selected,
  labelId,
  pathname,
  preservedQuery,
}: EmotionPhasePickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(
    0,
    PHASE_ENTRIES.findIndex((e) => e.phase === selected),
  );

  // Roving-tabindex pointer. Arrows move it WITHOUT selecting; reconciled to
  // the new selection once a navigation commits (render-time prop-change
  // pattern, NOT an effect — avoids `set-state-in-effect`).
  const [focusIdx, setFocusIdx] = useState(selectedIndex);
  const [syncedSel, setSyncedSel] = useState(selectedIndex);
  if (syncedSel !== selectedIndex) {
    setSyncedSel(selectedIndex);
    setFocusIdx(selectedIndex);
  }

  // `aria-busy` is not reliably announced — announce the load explicitly.
  const [liveMsg, setLiveMsg] = useState('');
  const pendingLabel = useRef<string | null>(null);
  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !isPending && pendingLabel.current) {
      setLiveMsg(`Phase ${pendingLabel.current} affichée.`);
      pendingLabel.current = null;
    }
    prevPending.current = isPending;
  }, [isPending]);

  const select = (phase: EmotionPhase, label: string) => {
    if (phase === selected || isPending) return; // re-entrancy guard
    const params = new URLSearchParams(preservedQuery);
    params.set('phase', phase);
    pendingLabel.current = label;
    setLiveMsg(`Phase ${label} en cours de chargement…`);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = PHASE_ENTRIES.length - 1;
    let next = index;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case ' ':
      case 'Enter': {
        e.preventDefault();
        const entry = PHASE_ENTRIES[index]!;
        select(entry.phase, entry.label);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    setFocusIdx(next);
    btnRefs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-busy={isPending || undefined}
      className={cn('flex flex-wrap gap-2 transition-opacity', isPending && 'opacity-70')}
    >
      {PHASE_ENTRIES.map((entry, i) => {
        const active = entry.phase === selected;
        return (
          <button
            key={entry.phase}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => {
              setFocusIdx(i);
              select(entry.phase, entry.label);
            }}
            onKeyDown={(ev) => onKeyDown(ev, i)}
            className={cn(
              'rounded-pill inline-flex min-h-11 items-center gap-2 border px-3.5 py-2 text-[12px] font-medium transition-[color,background-color,border-color,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] active:scale-[0.97]',
              active
                ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
                : 'border-[var(--b-subtle)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] hover:text-[var(--t-1)]',
            )}
          >
            {entry.label}
          </button>
        );
      })}
      <span role="status" aria-live="polite" className="sr-only">
        {liveMsg}
      </span>
    </div>
  );
}
