'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { HabitKind } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

import { HABIT_KIND_ENTRIES } from './habit-kinds';

/**
 * V2.2 TRACK — per-kind correlation picker.
 *
 * V2.1.3 wired only `sleep`; this lets the member correlate any of the
 * 5 pillars against realized R. A single mutually-exclusive *parameter*
 * choice that re-renders ONE chart → semantically an APG **radiogroup**
 * (not `tablist`: there is no per-tab panel; not independent toggles:
 * exactly-one-is-always-selected).
 *
 * Drives the `?corr=<kind>` URL search param — deliberately NOT `?kind=`,
 * which is already the post-log confirmation-banner param on `/track`
 * (`?done=1&kind=sleep`); reusing it would make that banner lie. The
 * host page reads `?corr=`, validates it via `habitKindSchema`
 * (fallback `sleep`), passes it to `<HabitCorrelationSection habitKind>`
 * wrapped in `<Suspense key={corr}>` so the section re-mounts — honest
 * skeleton during the new fetch, and Recharts gets a clean first draw
 * (no client dataset-swap animation pitfalls). The picker sits OUTSIDE
 * that Suspense so it stays interactive while the card skeletons.
 *
 * URL composition is server-driven: the page passes `pathname` +
 * `preservedQuery` (params kept across a pillar switch — `/dashboard`
 * keeps `?range=`, `/track` drops the transient banner params). The
 * picker stays generic and needs no `useSearchParams` (hence no extra
 * Suspense boundary / CLS).
 *
 * **Selection does NOT follow focus (deliberate, a11y-reviewed).** The
 * canonical APG radiogroup checks the focused radio on arrow. APG
 * explicitly carves this out when selecting has a *significant
 * consequence*: here it is a server navigation (`router.push` →
 * Server-Component re-render → `<Suspense key>` remount → a fresh DB
 * fetch). Selection-follows-focus would fire one server round-trip per
 * arrow keypress (4 to reach the 5th pillar) and desync
 * `tabIndex`/`aria-checked` against the still-stale server prop during
 * the in-flight transition. So: **arrows / Home / End move focus only
 * (roving via synchronous local `focusIdx`); Space / Enter / click
 * commit the selection + navigate.** This is the conformant
 * radiogroup-without-selection-follows-focus variant.
 *
 * Focus survives the post-navigation re-render because the picker has
 * no `key` and keeps its position in the tree (same component
 * instance, `btnRefs` survive, the browser preserves DOM focus);
 * `focusIdx` is reconciled to the new server `selected` via an effect.
 * Do not add a `key` to this picker or move it across the tree without
 * re-checking focus order (WCAG 2.4.3).
 *
 * Re-entrancy: `select()` no-ops while a transition is in flight, so
 * the `opacity-70` + `aria-busy` pending state is *honest* (the control
 * is genuinely inert until the fetch resolves) without `disabled`
 * (which would yank focus off the active radio mid-keyboard-nav). A
 * polite `role="status"` live region announces the load to SR users
 * (WCAG 4.1.3 — `aria-busy` alone is not reliably verbalized).
 *
 * Anti-Black-Hat (Mark Douglas / Yu-kai Chou), consistent with the
 * V2.1.4 FAB doctrine: the only motion is a CSS `active:` press
 * response to a deliberate touch — no entrance / idle / pulse;
 * reduced-motion is handled by the global `prefers-reduced-motion`
 * net. The loading cue is a calm opacity dim, never a spinner.
 */

interface HabitKindTabPickerProps {
  /** Server-validated active kind (host parsed `?corr=` via `habitKindSchema`). */
  selected: HabitKind;
  /** `id` of the visible group label this radiogroup is described by. */
  labelId: string;
  /** Host route pathname (e.g. `/track`, `/dashboard`). */
  pathname: string;
  /**
   * Encoded query string the host wants preserved across a pillar
   * switch, WITHOUT `corr` (e.g. `"range=3m"` or `""`). The picker
   * appends/overrides `corr`.
   */
  preservedQuery: string;
}

export function HabitKindTabPicker({
  selected,
  labelId,
  pathname,
  preservedQuery,
}: HabitKindTabPickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Host validates `selected` to a real kind (schema fallback), so this
  // is always >= 0; the guard keeps a tab stop even if that ever breaks.
  const selectedIndex = Math.max(
    0,
    HABIT_KIND_ENTRIES.findIndex((e) => e.kind === selected),
  );

  // Roving-tabindex pointer. Starts on the selected radio; arrows move
  // it WITHOUT selecting. Reconciled to the new selection once a
  // navigation commits — React's render-time "adjust state when a prop
  // changes" pattern (NOT an effect: that is the derived-state-in-effect
  // smell `react-hooks/set-state-in-effect` rejects).
  const [focusIdx, setFocusIdx] = useState(selectedIndex);
  const [syncedSel, setSyncedSel] = useState(selectedIndex);
  if (syncedSel !== selectedIndex) {
    setSyncedSel(selectedIndex);
    setFocusIdx(selectedIndex);
  }

  // SR status: `aria-busy` is not reliably announced, so announce the
  // load explicitly (WCAG 4.1.3). "loading" on commit; "shown" when the
  // transition resolves.
  const [liveMsg, setLiveMsg] = useState('');
  const pendingLabel = useRef<string | null>(null);
  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !isPending && pendingLabel.current) {
      setLiveMsg(`Corrélation ${pendingLabel.current} affichée.`);
      pendingLabel.current = null;
    }
    prevPending.current = isPending;
  }, [isPending]);

  const select = (kind: HabitKind, label: string) => {
    if (kind === selected || isPending) return; // re-entrancy guard
    const params = new URLSearchParams(preservedQuery);
    params.set('corr', kind);
    pendingLabel.current = label;
    setLiveMsg(`Corrélation ${label} en cours de chargement…`);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  // Arrows / Home / End: move focus ONLY (roving), never select.
  // Space / Enter: commit the focused pillar.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = HABIT_KIND_ENTRIES.length - 1;
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
        const entry = HABIT_KIND_ENTRIES[index]!;
        select(entry.kind, entry.label);
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
      {HABIT_KIND_ENTRIES.map((entry, i) => {
        const active = entry.kind === selected;
        return (
          <button
            key={entry.kind}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => {
              setFocusIdx(i);
              select(entry.kind, entry.label);
            }}
            onKeyDown={(ev) => onKeyDown(ev, i)}
            className={cn(
              'rounded-pill inline-flex min-h-11 items-center gap-2 border px-3.5 py-2 text-[12px] font-medium transition-[color,background-color,border-color,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] active:scale-[0.97]',
              active
                ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
                : 'border-[var(--b-subtle)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] hover:text-[var(--t-1)]',
            )}
          >
            <entry.Icon className="h-4 w-4 shrink-0" aria-hidden />
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
