'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { Check, Info, ThumbsUp } from 'lucide-react';
import { useState } from 'react';

import { TRADE_TAGS_MAX_PER_TRADE, type TradeTagSlug } from '@/lib/schemas/trade';
import { cn } from '@/lib/utils';

interface TradeTagsPickerProps {
  /** Controlled selected tags (parent-managed state). */
  value: readonly TradeTagSlug[];
  /** Called whenever the selection changes. */
  onChange: (next: TradeTagSlug[]) => void;
  /** Disabled state (e.g. while submitting). */
  disabled?: boolean;
}

interface TagMeta {
  slug: TradeTagSlug;
  label: string;
  source: string;
  description: string;
  /** Pré-outcome (decided before knowing result) or post-outcome (reflective). */
  phase: 'pre' | 'post';
}

/**
 * 8 V1.8 LESSOR + Steenbarger slugs with FR labels + academic source +
 * one-line description. Order = priority (pre-outcome first so the wizard
 * step reads "did I let bias drive the entry?" before "did I bias the exit?").
 */
const TAG_METAS: readonly TagMeta[] = [
  {
    slug: 'overconfidence',
    label: 'Sur-confiance',
    source: 'CFA LESSOR-O',
    description: `J'ai pris ce trade en pensant que je ne pouvais pas me tromper.`,
    phase: 'pre',
  },
  {
    slug: 'status-quo',
    label: 'Statu quo',
    source: 'CFA LESSOR-S',
    description: `J'ai gardé une position par inertie plutôt que par décision.`,
    phase: 'pre',
  },
  {
    slug: 'loss-aversion',
    label: 'Aversion à la perte',
    source: 'CFA LESSOR-L',
    description: `J'ai coupé un gain trop tôt OU laissé courir une perte par peur.`,
    phase: 'post',
  },
  {
    slug: 'regret-aversion',
    label: 'Aversion au regret',
    source: 'CFA LESSOR-R',
    description: `J'ai suivi la foule pour éviter de me sentir bête après coup.`,
    phase: 'post',
  },
  {
    slug: 'endowment',
    label: 'Effet de dotation',
    source: 'CFA LESSOR-E',
    description: `J'ai sur-valorisé une position que je tenais vs sa valeur objective.`,
    phase: 'post',
  },
  {
    slug: 'self-control-fail',
    label: 'Manque de discipline',
    source: 'CFA LESSOR-S',
    description: `Le court terme a gagné contre le plan long terme.`,
    phase: 'post',
  },
  {
    slug: 'revenge-trade',
    label: 'Revenge trade',
    source: 'Steenbarger',
    description: `Entrée pour compenser une perte précédente, pas pour le setup.`,
    phase: 'post',
  },
  {
    slug: 'discipline-high',
    label: 'Discipline solide',
    source: 'Steenbarger',
    description: `J'ai exécuté mon process malgré la tentation. Force à entretenir.`,
    phase: 'post',
  },
];

/**
 * V1.8 REFLECT — `<TradeTagsPicker>` for the close-trade wizard.
 *
 * Multi-select up to `TRADE_TAGS_MAX_PER_TRADE` (3) tags from the LESSOR +
 * Steenbarger allowlist (validated server-side by `tradeTagsSchema`). Each
 * tag exposes a tooltip with academic source + one-line FR description so
 * members learn the framework while they tag.
 *
 * Form integration : renders `<input type="hidden" name="tags" value="…">`
 * for each selected tag. The Server Action picks them up via
 * `formData.getAll('tags')`.
 *
 * Posture (Mark Douglas) : tags are post-mortem classification, not labels
 * of "good" or "bad" trades. `discipline-high` is the strengths-based
 * counterpoint (Steenbarger 2025 reverse-journaling).
 */
export function TradeTagsPicker({ value, onChange, disabled }: TradeTagsPickerProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState<TradeTagSlug | null>(null);
  const selected = new Set<TradeTagSlug>(value);
  const remaining = TRADE_TAGS_MAX_PER_TRADE - selected.size;

  function toggle(slug: TradeTagSlug) {
    if (disabled) return;
    if (selected.has(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else if (selected.size < TRADE_TAGS_MAX_PER_TRADE) {
      onChange([...value, slug]);
    }
    // Silently no-op if at cap and trying to add — the visual disabled state
    // surfaces the cap (a11y aria-disabled below).
  }

  return (
    <fieldset className="flex flex-col gap-2.5" data-slot="trade-tags-picker">
      <legend className="mb-1 flex items-baseline justify-between gap-3">
        <span className="t-eyebrow-lg text-[var(--t-3)]">
          Étiquettes comportementales (optionnel)
        </span>
        <span className="t-cap font-mono text-[var(--t-3)] tabular-nums">
          {selected.size} / {TRADE_TAGS_MAX_PER_TRADE}
        </span>
      </legend>
      <p className="t-cap text-[var(--t-3)]">
        Classifie le biais dominant (max 3). Cadre CFA LESSOR + Steenbarger — voir le descriptif au
        tap d&apos;une étiquette.
      </p>

      {/* Hidden inputs — one per selected tag */}
      {value.map((slug) => (
        <input key={`hidden-${slug}`} type="hidden" name="tags" value={slug} />
      ))}

      <div role="group" aria-label="Étiquettes comportementales" className="flex flex-wrap gap-2">
        {TAG_METAS.map((meta) => {
          const isOn = selected.has(meta.slug);
          const isAtCap = !isOn && selected.size >= TRADE_TAGS_MAX_PER_TRADE;
          const isPositive = meta.slug === 'discipline-high';
          return (
            <button
              key={meta.slug}
              type="button"
              role="switch"
              aria-checked={isOn}
              aria-disabled={isAtCap || disabled || undefined}
              data-phase={meta.phase}
              onClick={() => toggle(meta.slug)}
              onMouseEnter={() => setOpen(meta.slug)}
              onMouseLeave={() => setOpen((cur) => (cur === meta.slug ? null : cur))}
              onFocus={() => setOpen(meta.slug)}
              onBlur={() => setOpen((cur) => (cur === meta.slug ? null : cur))}
              className={cn(
                'rounded-pill group relative inline-flex min-h-11 items-center gap-1.5 border px-3.5 py-2 text-[12px] font-semibold tracking-[0.06em] uppercase transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                isOn
                  ? isPositive
                    ? 'border-[var(--ok)] bg-[var(--ok-dim-2)] text-[var(--ok)] shadow-[0_0_0_3px_oklch(0.804_0.181_145_/_0.12)]'
                    : 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc-hi)] shadow-[0_0_0_3px_oklch(0.62_0.19_254_/_0.12)]'
                  : 'border-[var(--b-default)] bg-transparent text-[var(--t-2)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]',
                isAtCap && 'hatch-disabled cursor-not-allowed opacity-40 hover:bg-transparent',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <span>{meta.label}</span>
              {/* a11y B5 fix (WCAG 1.4.1 Use of Color) — strengths-based
                  `discipline-high` tag uses ThumbsUp icon when selected, so
                  color-blind sighted users (deutéranopie ~5% mâles) ne
                  perçoivent pas seulement la couleur verte vs blue accent
                  pour distinguer "force" vs "biais". Le label seul OK pour
                  SR, l'icône comble pour sighted. */}
              {isOn ? (
                isPositive ? (
                  <ThumbsUp size={13} strokeWidth={2.5} aria-hidden="true" />
                ) : (
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                )
              ) : (
                <Info size={11} strokeWidth={2} aria-hidden="true" className="opacity-60" />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {open ? (
          <m.aside
            key={open}
            role="note"
            aria-live="polite"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
          >
            {(() => {
              const m = TAG_METAS.find((t) => t.slug === open);
              if (!m) return null;
              return (
                <>
                  <p className="t-eyebrow flex items-baseline gap-2 text-[var(--t-3)]">
                    <span>{m.source}</span>
                    <span aria-hidden="true">·</span>
                    <span>{m.phase === 'pre' ? 'pré-entrée' : 'post-outcome'}</span>
                  </p>
                  <p className="t-h3 mt-1 text-[var(--t-1)]">{m.label}</p>
                  <p className="t-body mt-1 text-[var(--t-2)]">{m.description}</p>
                </>
              );
            })()}
          </m.aside>
        ) : null}
      </AnimatePresence>

      {remaining === 0 ? (
        <p className="t-cap text-[var(--t-3)]">
          Maximum atteint. Désélectionne une étiquette pour en choisir une autre.
        </p>
      ) : null}
    </fieldset>
  );
}
