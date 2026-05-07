'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';

import {
  CHECKIN_EMOTION_CLUSTER_LABEL,
  CHECKIN_EMOTION_MAX_PER_SLOT,
  CHECKIN_EMOTION_TAGS,
  type CheckinEmotionCluster,
} from '@/lib/checkin/emotions';
import { cn } from '@/lib/utils';

interface EmotionCheckinPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  name: string;
  label: string;
  disabled?: boolean | undefined;
}

/**
 * Multi-select grid for daily-checkin emotion tags (J5).
 *
 * Mirrors the trade emotion-picker: capped selection, lime-accent chips when
 * selected, hatch-disabled when at cap. Distinct tag list (vitality / mood /
 * pressure clusters) — the trade picker is anchored on Mark Douglas fears,
 * which would feel weird in a "how do you feel this morning?" context.
 *
 * Selection is OPTIONAL here (vs trade where ≥1 is required) — mood score is
 * the required signal; emotions are flavour. The schema validates ≤3 tags.
 */
export function EmotionCheckinPicker({
  value,
  onChange,
  name,
  label,
  disabled,
}: EmotionCheckinPickerProps) {
  const groupId = useId();
  const counterId = `${groupId}-counter`;

  const selectedSet = new Set(value);
  const atCap = value.length >= CHECKIN_EMOTION_MAX_PER_SLOT;

  const toggle = (slug: string) => {
    if (disabled) return;
    if (selectedSet.has(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else if (!atCap) {
      onChange([...value, slug]);
    }
  };

  const clusters = {
    vitality: CHECKIN_EMOTION_TAGS.filter((t) => t.cluster === 'vitality'),
    mood: CHECKIN_EMOTION_TAGS.filter((t) => t.cluster === 'mood'),
    pressure: CHECKIN_EMOTION_TAGS.filter((t) => t.cluster === 'pressure'),
  } satisfies Record<CheckinEmotionCluster, ReadonlyArray<(typeof CHECKIN_EMOTION_TAGS)[number]>>;

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={counterId}>
      <legend className="flex w-full items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]">
          {label}
        </span>
        {/* Visual counter — silent for SR. Only the cap-reached transition
            is announced once via the sr-only block below (audit B4). */}
        <span
          id={counterId}
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums',
            atCap ? 'text-[var(--warn)]' : 'text-[var(--t-3)]',
          )}
          aria-hidden
        >
          <span className={cn(atCap && 'font-semibold')}>{value.length}</span>
          <span className="text-[var(--t-3)]">/</span>
          <span>{CHECKIN_EMOTION_MAX_PER_SLOT}</span>
          {atCap ? <span className="ml-1 text-[10px]">· limite</span> : null}
        </span>
        <span className="sr-only" aria-live="polite">
          {atCap ? `Limite ${CHECKIN_EMOTION_MAX_PER_SLOT} émotions atteinte.` : ''}
        </span>
      </legend>

      {(Object.keys(clusters) as CheckinEmotionCluster[]).map((cluster) => {
        const tags = clusters[cluster] ?? [];
        if (tags.length === 0) return null;
        return (
          <div key={cluster} className="flex flex-col gap-1.5">
            <span className="t-eyebrow">{CHECKIN_EMOTION_CLUSTER_LABEL[cluster]}</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const isSelected = selectedSet.has(tag.slug);
                const inert = !isSelected && atCap;
                return (
                  <button
                    type="button"
                    key={tag.slug}
                    onClick={() => {
                      if (inert) return;
                      toggle(tag.slug);
                    }}
                    disabled={Boolean(disabled)}
                    aria-pressed={isSelected}
                    aria-disabled={inert ? 'true' : undefined}
                    aria-label={tag.hint ? `${tag.label} — ${tag.hint}` : tag.label}
                    title={tag.hint}
                    // Inert chips (cap reached, not selected) are removed
                    // from the tab order — audit J5 H7. The button is still
                    // visible (hatch-disabled) and announced as
                    // "aria-disabled" by the SR; we just don't waste a Tab
                    // stop on a control the user can't activate.
                    tabIndex={inert ? -1 : 0}
                    className={cn(
                      // min-h-11 (44px) clears WCAG 2.5.5 AAA target size +
                      // matches the project's mobile-first touch budget
                      // (`Btn` size m). Was min-h-9 (36px) — audit J5 H1.
                      'rounded-pill inline-flex min-h-11 items-center gap-1.5 border px-3 py-2 text-[12px] font-medium transition-all',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                      isSelected
                        ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[0_0_0_2px_oklch(0.879_0.231_130_/_0.10)]'
                        : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]',
                      'disabled:cursor-not-allowed disabled:opacity-40',
                      'aria-disabled:hatch-disabled aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
                    )}
                  >
                    {isSelected ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Hidden inputs drive FormData.getAll(name). */}
      {value.map((slug) => (
        <input key={slug} type="hidden" name={name} value={slug} />
      ))}
    </fieldset>
  );
}
