'use client';

import { useId } from 'react';

import { EMOTION_MAX_PER_MOMENT, EMOTION_TAGS, type EmotionCluster } from '@/lib/trading/emotions';

const CLUSTER_LABEL: Record<EmotionCluster, string> = {
  'douglas-fears': 'Peurs (Mark Douglas)',
  states: 'États émotionnels',
  biases: 'Biais comportementaux',
};

interface EmotionPickerProps {
  /**
   * Selected slugs. Keep a stable reference outside this component (e.g. via
   * RHF `watch()` + `setValue()`) so we don't re-render on every parent tick.
   */
  value: string[];
  onChange: (next: string[]) => void;
  /** Form field name. Each chip ends up as a separate `<input type="hidden">`. */
  name: string;
  /** Used to render the "Émotion avant" / "Émotion après" headline. */
  label: string;
  /** Wired to `aria-describedby` for screen-reader feedback. */
  hintId?: string;
  /** Disabled state during pending submissions. */
  disabled?: boolean | undefined;
}

/**
 * Multi-select grid for the 15 curated emotion tags (J2, SPEC §6.2).
 *
 * Caps the selection at `EMOTION_MAX_PER_MOMENT` (3) — once the cap is hit,
 * unchecked chips become inert. Hidden `<input>`s mirror the selection so
 * the form's `FormData` carries a `name=slug` entry per selected tag, ready
 * for `formData.getAll(name)` on the server.
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
      <legend className="text-foreground flex w-full items-center justify-between text-sm font-medium">
        <span>{label}</span>
        <span
          id={counterId}
          className={['text-xs', atCap ? 'text-warning' : 'text-muted'].join(' ')}
          aria-live="polite"
        >
          {value.length}/{EMOTION_MAX_PER_MOMENT}
          {atCap ? ' · limite atteinte' : ''}
        </span>
      </legend>

      {(Object.keys(clusters) as EmotionCluster[]).map((cluster) => {
        const tags = clusters[cluster] ?? [];
        if (tags.length === 0) return null;
        return (
          <div key={cluster} className="flex flex-col gap-1.5">
            <span className="text-muted text-xs uppercase tracking-wider">
              {CLUSTER_LABEL[cluster]}
            </span>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = selectedSet.has(tag.slug);
                const inert = !isSelected && atCap;
                // We split `disabled` (form pending) from `aria-disabled` (cap
                // reached): the latter keeps the button in the tab order so
                // screen-reader users hear "limite atteinte" via the
                // `aria-describedby` on the counter.
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
                    className={[
                      'focus-visible:outline-accent inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
                      isSelected
                        ? 'border-accent bg-accent/15 text-foreground hover:bg-accent/25'
                        : 'text-muted hover:text-foreground hover:border-accent border-[var(--border)] disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
                    ].join(' ')}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Hidden inputs — one per selected tag — drive FormData.getAll(name). */}
      {value.map((slug) => (
        <input key={slug} type="hidden" name={name} value={slug} />
      ))}
    </fieldset>
  );
}
