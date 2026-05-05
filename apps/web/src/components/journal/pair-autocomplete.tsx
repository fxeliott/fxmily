'use client';

import { useId } from 'react';

import { TRADING_PAIRS, assetClassOf, isTradingPair, type TradingPair } from '@/lib/trading/pairs';

interface PairAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  name?: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
  /** Auto-focus when the wizard reveals this step on mobile. */
  autoFocus?: boolean | undefined;
}

const ASSET_LABEL: Record<ReturnType<typeof assetClassOf>, string> = {
  forex: 'Forex',
  metal: 'Métaux',
  index: 'Indices',
};

const GROUPED_PAIRS: Record<string, TradingPair[]> = TRADING_PAIRS.reduce<
  Record<string, TradingPair[]>
>((acc, pair) => {
  const klass = assetClassOf(pair);
  acc[klass] ??= [];
  acc[klass].push(pair);
  return acc;
}, {});

/**
 * Pair input with native HTML5 datalist (J2, SPEC §7.3).
 *
 * Native `<datalist>` is the simplest accessible combobox in 2026 — it ships
 * with built-in keyboard nav, screen-reader announcements, and consistent
 * mobile rendering. Custom comboboxes are tempting visually but expensive
 * to keep WAI-ARIA-compliant; we re-evaluate at J3 if real members ask for
 * fuzzy search across more symbols.
 *
 * The visible options are grouped by asset class for skim-readability; the
 * grouping is purely cosmetic (datalist option groups aren't standardised).
 */
export function PairAutocomplete({
  value,
  onChange,
  name = 'pair',
  error,
  disabled,
  autoFocus,
}: PairAutocompleteProps) {
  const inputId = useId();
  const listId = `${inputId}-pairs`;
  const errorId = error ? `${inputId}-error` : undefined;

  const handleChange = (raw: string) => {
    // Normalise: uppercase + trim, but allow partial matches while typing.
    onChange(raw.toUpperCase().trim());
  };

  const isValid = isTradingPair(value);
  const showSoftWarning = !error && value.length > 0 && !isValid;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-foreground text-sm font-medium">
        Paire
      </label>
      <input
        id={inputId}
        name={name}
        type="text"
        value={value}
        list={listId}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        placeholder="EURUSD, XAUUSD, US30…"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error || (value.length > 0 && !isValid) ? 'true' : undefined}
        aria-describedby={errorId}
        onChange={(e) => handleChange(e.target.value)}
        className={[
          'bg-card text-foreground focus-visible:ring-accent/40 placeholder:text-muted/70 rounded-md border px-3 py-2 font-mono text-sm uppercase tracking-wide outline-none focus-visible:ring-2 disabled:opacity-60',
          error || (value.length > 0 && !isValid)
            ? 'border-warning/60 focus-visible:border-warning'
            : isValid
              ? 'border-success/40 focus-visible:border-accent'
              : 'focus-visible:border-accent border-[var(--border)]',
        ].join(' ')}
      />
      <datalist id={listId}>
        {(Object.keys(GROUPED_PAIRS) as ReturnType<typeof assetClassOf>[]).map((klass) => (
          <optgroup key={klass} label={ASSET_LABEL[klass]}>
            {GROUPED_PAIRS[klass]?.map((pair) => (
              <option key={pair} value={pair} />
            ))}
          </optgroup>
        ))}
      </datalist>
      {error ? (
        <p id={errorId} className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : showSoftWarning ? (
        <p className="text-warning text-xs">
          Paire non reconnue. Choisis dans la liste des 12 paires autorisées.
        </p>
      ) : (
        <p className="text-muted text-xs">12 paires autorisées (forex / métaux / indices).</p>
      )}
    </div>
  );
}
