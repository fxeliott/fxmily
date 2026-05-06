'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';

import { EMOTION_MAX_PER_MOMENT, EMOTION_TAGS, type EmotionCluster } from '@/lib/trading/emotions';
import { cn } from '@/lib/utils';

const CLUSTER_LABEL: Record<EmotionCluster, string> = {
  'douglas-fears': 'Peurs (Mark Douglas)',
  states: 'États émotionnels',
  biases: 'Biais comportementaux',
};

interface EmotionPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  name: string;
  label: string;
  hintId?: string;
  disabled?: boolean | undefined;
}

/**
 * Multi-select grid for the 15 curated emotion tags (J2, SPEC §6.2).
 *
 * Cap = 3 (`EMOTION_MAX_PER_MOMENT`). Une fois atteint, les tags non-sélectionnés
 * deviennent inert (visuel hatch + aria-disabled="true").
 *
 * Élévation Sprint 1C : chips lime accent quand sélectionné, hover lift + check
 * icon, cluster headlines en eyebrow, counter live avec tone warn quand cap.
 */
export function EmotionPicker({
  value,
  onChange,
  name,
  label,
  hintId,
  disabled,
}: EmotionPickerProps) {
  const groupId = useId();
  const counterId = `${groupId}-counter`;

  const selectedSet = new Set(value);
  const atCap = value.length >= EMOTION_MAX_PER_MOMENT;

  const toggle = (slug: string) => {
    if (disabled) return;
    if (selectedSet.has(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else if (!atCap) {
      onChange([...value, slug]);
    }
  };

  const clusters = {
    'douglas-fears': EMOTION_TAGS.filter((t) => t.cluster === 'douglas-fears'),
    states: EMOTION_TAGS.filter((t) => t.cluster === 'states'),
    biases: EMOTION_TAGS.filter((t) => t.cluster === 'biases'),
  } satisfies Record<EmotionCluster, ReadonlyArray<(typeof EMOTION_TAGS)[number]>>;

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={`${counterId}${hintId ? ` ${hintId}` : ''}`}
    >
      <legend className="flex w-full items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]">
          {label}
        </span>
        <span
          id={counterId}
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums',
            atCap ? 'text-[var(--warn)]' : 'text-[var(--t-4)]',
          )}
          aria-live="polite"
        >
          <span className={cn(atCap && 'font-semibold')}>{value.length}</span>
          <span className="text-[var(--t-4)]">/</span>
          <span>{EMOTION_MAX_PER_MOMENT}</span>
          {atCap ? <span className="ml-1 text-[10px]">· limite</span> : null}
        </span>
      </legend>

      {(Object.keys(clusters) as EmotionCluster[]).map((cluster) => {
        const tags = clusters[cluster] ?? [];
        if (tags.length === 0) return null;
        return (
          <div key={cluster} className="flex flex-col gap-1.5">
            <span className="t-eyebrow">{CLUSTER_LABEL[cluster]}</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const isSelected = selectedSet.has(tag.slug);
                const inert = !isSelected && atCap;
                const isFormDisabled = Boolean(disabled);
                return (
                  <button
                    type="button"
                    key={tag.slug}
                    onClick={() => {
                      if (inert) return;
                      toggle(tag.slug);
                    }}
                    disabled={isFormDisabled}
                    aria-pressed={isSelected}
                    aria-disabled={inert ? 'true' : undefined}
                    aria-label={tag.hint ? `${tag.label} — ${tag.hint}` : tag.label}
                    title={tag.hint}
                    className={cn(
                      'rounded-pill inline-flex min-h-9 items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium transition-all',
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

      {/* Hidden inputs — drive FormData.getAll(name). */}
      {value.map((slug) => (
        <input key={slug} type="hidden" name={name} value={slug} />
      ))}
    </fieldset>
  );
}
