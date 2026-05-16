'use client';

import { Check, Search } from 'lucide-react';
import { useId } from 'react';

import { TRADING_PAIRS, assetClassOf, isTradingPair, type TradingPair } from '@/lib/trading/pairs';
import { cn } from '@/lib/utils';

interface PairAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  name?: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
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
 * Pair input avec native HTML5 datalist (J2, SPEC §7.3).
 *
 * Native `<datalist>` = simplest accessible combobox 2026 (built-in keyboard
 * nav, screen-reader, mobile rendering). Re-évalué J3+ pour fuzzy search.
 *
 * Élévation Sprint 1C : icon Search en prefix, valid Check icon en suffix
 * (visual cue), border tonalisée selon état (default/valid/error/warn),
 * input mono uppercase tracking pour signature trader pro.
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
    onChange(raw.toUpperCase().trim());
  };

  const isValid = isTradingPair(value);
  const showSoftWarning = !error && value.length > 0 && !isValid;
  const hasError = Boolean(error || (value.length > 0 && !isValid));

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="t-eyebrow-lg text-[var(--t-3)]">
        Paire
      </label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--t-4)]"
        >
          <Search className="h-4 w-4" strokeWidth={1.75} />
        </span>
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
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={errorId}
          onChange={(e) => handleChange(e.target.value)}
          className={cn(
            'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] py-2 pr-10 pl-10 text-[14px] tracking-[0.06em] text-[var(--t-1)] uppercase transition-[border-color,box-shadow] duration-150 outline-none',
            'placeholder:tracking-normal placeholder:text-[var(--t-4)] placeholder:normal-case',
            hasError
              ? error
                ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
                : 'border-[oklch(0.834_0.158_80_/_0.50)] focus-visible:border-[var(--warn)]'
              : isValid
                ? 'border-[oklch(0.804_0.181_145_/_0.50)] focus-visible:border-[var(--ok)]'
                : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {isValid ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ok)]"
          >
            <Check className="h-4 w-4" strokeWidth={2.5} />
          </span>
        ) : null}
      </div>
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
        <p id={errorId} className="text-[11px] text-[var(--bad)]" role="alert">
          {error}
        </p>
      ) : showSoftWarning ? (
        <p className="text-[11px] text-[var(--warn)]">
          Paire non reconnue. Choisis dans la liste des 12 paires autorisées.
        </p>
      ) : (
        <p className="t-cap text-[var(--t-4)]">
          12 paires autorisées (forex / métaux / indices US).
        </p>
      )}
    </div>
  );
}
