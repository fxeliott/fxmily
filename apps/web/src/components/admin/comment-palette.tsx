'use client';

import { MessageSquareQuote, Plus } from 'lucide-react';

import { COMMENT_PRESET_GROUPS } from '@/lib/admin/comment-presets';
import { cn } from '@/lib/utils';

/**
 * S7 §33-#1 — the admin comment palette: one-tap reusable coaching reframes
 * (Mark Douglas register) dropped into the correction field, then editable.
 *
 * Shared by the two annotation Sheets (`annotate-trade-button`,
 * `annotate-training-trade-button`) — both keep their `comment` in controlled
 * state, so we just call `onInsert(text)` and let the parent append + clamp.
 *
 * Compact by default: a native `<details>` disclosure keeps the Sheet light on
 * mobile (no-JS + reduced-motion safe). Chips mirror the audited `emotion-picker`
 * button pattern (min-h-11 touch target, token states, global focus ring).
 *
 * 🚨 GARDE-FOU §2: the content is sourced from `comment-presets.ts` — strictly
 * psychological/discipline, never trade-analysis advice (enforced by its test).
 */
interface CommentPaletteProps {
  /** Append the chosen preset phrase to the comment field. */
  onInsert: (text: string) => void;
  /** Disable every chip while the form is submitting. */
  disabled?: boolean;
}

export function CommentPalette({ onInsert, disabled = false }: CommentPaletteProps) {
  return (
    <details className="rounded-card group/palette border border-[var(--b-default)] bg-[var(--bg)]">
      <summary
        className="t-eyebrow flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[var(--t-2)] transition-colors hover:text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] [&::-webkit-details-marker]:hidden"
        aria-label="Afficher les recadrages rapides à insérer"
      >
        <MessageSquareQuote
          className="h-3.5 w-3.5 text-[var(--acc-hi)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        Recadrages rapides
        <span className="t-cap ml-auto font-normal tracking-normal text-[var(--t-4)] normal-case">
          appuie pour insérer
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-[var(--b-subtle)] px-3 py-3">
        {COMMENT_PRESET_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-1.5">
            <span className="t-eyebrow text-[var(--t-3)]">{group.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-slot="comment-preset"
                  data-preset-id={preset.id}
                  disabled={disabled}
                  onClick={() => onInsert(preset.text)}
                  title={preset.text}
                  aria-label={`Insérer le recadrage : ${preset.label}`}
                  className={cn(
                    'rounded-pill inline-flex min-h-11 items-center gap-1 border px-3 py-2 text-[12px] font-medium transition-all',
                    'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim)] hover:text-[var(--acc-hi)]',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                >
                  <Plus className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
