'use client';

import { Check, Link2, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

import { closeTradeAction, type CloseTradeActionState } from '@/app/journal/actions';
import { Alert } from '@/components/alert';
import { EmotionPicker } from '@/components/journal/emotion-picker';
import { TradeTagsPicker } from '@/components/journal/trade-tags-picker';
import { Btn, btnVariants } from '@/components/ui/btn';
import type { TradeTagSlug } from '@/lib/schemas/trade';
import { isTradingViewUrl } from '@/lib/schemas/tradingview-url';
import { formatDateTimeLocalInput } from '@/lib/timezones';
import { cn } from '@/lib/utils';

interface CloseTradeFormProps {
  tradeId: string;
  /** Entry instant (ISO UTC) — the exit default is derived from it. */
  enteredAtIso: string;
  /** F2 — member's set timezone; drives the exit-time default + the server
   * wall-clock → UTC conversion (symmetric with the entry wizard). */
  timezone: string;
}

const initialState: CloseTradeActionState = { ok: false };

/**
 * Default exit value = max(now, entry + 1h), rendered as a `datetime-local`
 * wall-clock in the member's SET timezone.
 *
 * F2 — the member's set timezone (settings), not the device's, is authoritative
 * end to end: this default is built in it, and the server re-interprets the
 * submitted wall-clock in the same set timezone (see `memberWallClock` in
 * journal/actions.ts). The two are offset-symmetric, so closing « now » with the
 * default untouched stores exactly the displayed instant. (Supersedes the S2
 * audit B1 fix, which relied on the BROWSER timezone matching the member's.)
 */
function defaultExitLocalFrom(enteredAtIso: string, timezone: string): string {
  const entered = new Date(enteredAtIso);
  const proposed = new Date(Math.max(Date.now(), entered.getTime() + 60 * 60 * 1000));
  return formatDateTimeLocalInput(proposed, timezone);
}

export function CloseTradeForm({ tradeId, enteredAtIso, timezone }: CloseTradeFormProps) {
  const action = closeTradeAction.bind(null, tradeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [emotionDuring, setEmotionDuring] = useState<string[]>([]);
  const [emotionAfter, setEmotionAfter] = useState<string[]>([]);
  // J1 — mandatory TradingView exit link (replaces the exit screenshot upload).
  const [tradingViewExitUrl, setTradingViewExitUrl] = useState<string>('');
  const [tags, setTags] = useState<TradeTagSlug[]>([]);
  // SSR-safe : empty on the server render, filled with the BROWSER-local
  // default after mount (canon hydration pattern — setState in effect is the
  // only way to deliver a client-clock value without an SSR mismatch).
  const [exitedAtLocal, setExitedAtLocal] = useState<string>('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExitedAtLocal(defaultExitLocalFrom(enteredAtIso, timezone));
  }, [enteredAtIso, timezone]);

  const topError = state.ok
    ? null
    : state.error === 'not_found'
      ? "Ce trade n'existe pas ou a été supprimé."
      : state.error === 'already_closed'
        ? 'Ce trade est déjà clôturé.'
        : state.error === 'unauthorized'
          ? 'Session expirée, reconnecte-toi.'
          : state.error === 'invalid_input'
            ? 'Vérifie les champs en rouge.'
            : state.error === 'unknown'
              ? 'Erreur inattendue, réessaie.'
              : null;

  const submitDisabled =
    pending ||
    tradingViewExitUrl.trim().length === 0 ||
    emotionDuring.length === 0 ||
    emotionAfter.length === 0;

  // F2 — the raw `datetime-local` wall-clock is POSTed verbatim and converted to
  // a UTC instant SERVER-side in the member's SET timezone (see `memberWallClock`
  // in journal/actions.ts), symmetric with the entry wizard. The previous
  // client-side `new Date(raw).toISOString()` baked in the DEVICE timezone, which
  // diverged from the member's set timezone for anyone not on Paris-time hardware.
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? <Alert tone="danger">{topError}</Alert> : null}

      {/* Date sortie */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="exitedAt" className="t-eyebrow-lg text-[var(--t-3)]">
          Date et heure de sortie
        </label>
        <input
          id="exitedAt"
          name="exitedAt"
          type="datetime-local"
          value={exitedAtLocal}
          onChange={(e) => setExitedAtLocal(e.currentTarget.value)}
          required
          disabled={pending}
          aria-invalid={state.fieldErrors?.exitedAt ? 'true' : undefined}
          className={cn(
            'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            state.fieldErrors?.exitedAt
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {state.fieldErrors?.exitedAt ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {state.fieldErrors.exitedAt}
          </p>
        ) : null}
      </div>

      {/* Prix sortie */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="exitPrice" className="t-eyebrow-lg text-[var(--t-3)]">
          Prix de sortie
        </label>
        <input
          id="exitPrice"
          name="exitPrice"
          type="number"
          step="any"
          inputMode="decimal"
          required
          disabled={pending}
          placeholder="0.00000"
          aria-invalid={state.fieldErrors?.exitPrice ? 'true' : undefined}
          className={cn(
            'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] tabular-nums transition-[border-color,box-shadow] duration-150 outline-none',
            'placeholder:text-[var(--t-4)]',
            state.fieldErrors?.exitPrice
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {state.fieldErrors?.exitPrice ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {state.fieldErrors.exitPrice}
          </p>
        ) : null}
      </div>

      {/* Outcome — 3 cards radio */}
      <fieldset className="flex flex-col gap-2">
        <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">Résultat</legend>
        <div role="radiogroup" aria-label="Résultat du trade" className="grid grid-cols-3 gap-2">
          <OutcomeCard value="win" label="Gain" icon="up" tone="ok" disabled={pending} />
          <OutcomeCard value="loss" label="Perte" icon="down" tone="bad" disabled={pending} />
          <OutcomeCard value="break_even" label="BE" icon="flat" tone="mute" disabled={pending} />
        </div>
        {state.fieldErrors?.outcome ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {state.fieldErrors.outcome}
          </p>
        ) : null}
      </fieldset>

      {/* Émotion pendant le trade (master prompt §22 — recalled at close,
          chronologically before "après la sortie"). */}
      <EmotionPicker
        value={emotionDuring}
        onChange={setEmotionDuring}
        name="emotionDuring"
        label="Émotion(s) pendant le trade"
        disabled={pending}
      />
      {state.fieldErrors?.emotionDuring ? (
        <p className="text-[11px] text-[var(--bad)]" role="alert">
          {state.fieldErrors.emotionDuring}
        </p>
      ) : null}

      {/* Émotion après la sortie */}
      <EmotionPicker
        value={emotionAfter}
        onChange={setEmotionAfter}
        name="emotionAfter"
        label="Émotion(s) après la sortie"
        disabled={pending}
      />
      {state.fieldErrors?.emotionAfter ? (
        <p className="text-[11px] text-[var(--bad)]" role="alert">
          {state.fieldErrors.emotionAfter}
        </p>
      ) : null}

      {/* SPEC §28/§21 — "oublis" axis. As-tu suivi tout ton process, sans rien
          oublier ? OPTIONAL (no submit gate — a new required field would break
          the shared-wizard e2e, CANON). Positive framing (anti-Black-Hat):
          tracks the ACT of completeness/forgetting, never the trade itself. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">
          As-tu suivi tout ton process, sans rien oublier ?{' '}
          <span className="font-normal text-[var(--t-4)] normal-case">(optionnel)</span>
        </legend>
        <div
          role="radiogroup"
          aria-label="Process suivi sans oubli"
          className="grid grid-cols-2 gap-2"
        >
          <ProcessCompleteCard value="true" label="Oui, rien oublié" disabled={pending} />
          <ProcessCompleteCard value="false" label="J'ai oublié des choses" disabled={pending} />
        </div>
      </fieldset>

      {/* S26 — « Fidélité à ta gestion » : les 3 règles de gestion dures de la
          méthode (stop selon la règle, break-even à RR1, sécurisation 90/10 au
          TP). Toutes OPTIONNELLES (no submit gate, CANON). Posture §2 : on note
          l'ACTE d'avoir suivi TA propre règle d'exécution, jamais un signal de
          marché. §31.2 : cadre calme, jamais punitif. */}
      <div className="rounded-card flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-2)]/40 p-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="t-eyebrow-lg text-[var(--t-3)]">
            Fidélité à ta gestion{' '}
            <span className="font-normal text-[var(--t-4)] normal-case">(optionnel)</span>
          </span>
          <span className="t-foot text-[var(--t-4)]">
            As-tu tenu tes règles de gestion sur ce trade ? Un miroir, pas un jugement.
          </span>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="t-foot mb-1 text-[var(--t-3)]">
            Stop placé selon ta règle (au-delà de ton dernier extrême) ?
          </legend>
          <div
            role="radiogroup"
            aria-label="Stop placé selon ta règle"
            className="grid grid-cols-2 gap-2"
          >
            <ManagementAdherenceCard
              name="slPerRule"
              value="true"
              label="Oui, selon ma règle"
              disabled={pending}
            />
            <ManagementAdherenceCard
              name="slPerRule"
              value="false"
              label="Non, au hasard"
              disabled={pending}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="t-foot mb-1 text-[var(--t-3)]">
            Passage au break-even dès le RR 1 ?
          </legend>
          <div role="radiogroup" aria-label="Break-even à RR 1" className="grid grid-cols-2 gap-2">
            <ManagementAdherenceCard
              name="movedToBe"
              value="true"
              label="Oui, BE à RR 1"
              disabled={pending}
            />
            <ManagementAdherenceCard
              name="movedToBe"
              value="false"
              label="Non"
              disabled={pending}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="t-foot mb-1 text-[var(--t-3)]">
            Sécurisation au TP (90 % clôturés, 10 % jusqu’à 20h) ?
          </legend>
          <div
            role="radiogroup"
            aria-label="Sécurisation partielle au TP"
            className="grid grid-cols-2 gap-2"
          >
            <ManagementAdherenceCard
              name="partialAtTarget"
              value="true"
              label="Oui, 90/10"
              disabled={pending}
            />
            <ManagementAdherenceCard
              name="partialAtTarget"
              value="false"
              label="Non"
              disabled={pending}
            />
          </div>
        </fieldset>
      </div>

      {/* V1.8 — Post-outcome bias tags (LESSOR + Steenbarger) */}
      <TradeTagsPicker value={tags} onChange={setTags} disabled={pending} />
      {state.fieldErrors?.tags ? (
        <p className="text-[11px] text-[var(--bad)]" role="alert">
          {state.fieldErrors.tags}
        </p>
      ) : null}

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="t-eyebrow-lg text-[var(--t-3)]">
          Notes (optionnel)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          disabled={pending}
          placeholder="Comment tu t'es senti ? Ce qui a marché / pas marché ?"
          className={cn(
            'rounded-input w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            'placeholder:text-[var(--t-4)]',
            'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
      </div>

      {/* J1 — TradingView exit link (replaces the exit screenshot upload) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tradingViewExitUrl" className="t-eyebrow-lg text-[var(--t-3)]">
          Lien TradingView de sortie
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--t-4)]"
          >
            <Link2 className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <input
            id="tradingViewExitUrl"
            name="tradingViewExitUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.tradingview.com/x/…"
            value={tradingViewExitUrl}
            onChange={(e) => setTradingViewExitUrl(e.target.value)}
            disabled={pending}
            aria-invalid={state.fieldErrors?.tradingViewExitUrl ? 'true' : undefined}
            className={cn(
              'rounded-input h-11 w-full border bg-[var(--bg-1)] pr-10 pl-9 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
              state.fieldErrors?.tradingViewExitUrl
                ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
                : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
          {tradingViewExitUrl.trim().length > 0 && isTradingViewUrl(tradingViewExitUrl.trim()) ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--good)]"
            >
              <Check className="h-4 w-4" strokeWidth={2} />
            </span>
          ) : null}
        </div>
        {state.fieldErrors?.tradingViewExitUrl ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {state.fieldErrors.tradingViewExitUrl}
          </p>
        ) : (
          <p className="t-cap text-[var(--t-4)]">
            Lien <code className="font-mono">tradingview.com</code> de ta sortie : la preuve de ta
            gestion jusqu&apos;au bout.
          </p>
        )}
      </div>

      {/* Submit gate hint */}
      {submitDisabled && !pending ? (
        <p id="close-submit-hint" className="text-right text-[11px] text-[var(--t-4)] tabular-nums">
          Lien {tradingViewExitUrl.trim().length === 0 ? '✗' : '✓'} · Pendant{' '}
          {emotionDuring.length === 0 ? '✗' : '✓'} · Après {emotionAfter.length === 0 ? '✗' : '✓'}
        </p>
      ) : null}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--b-subtle)] pt-4">
        <Link
          href={`/journal/${tradeId}`}
          className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
        >
          Annuler
        </Link>
        <Btn
          type="submit"
          kind="primary"
          size="m"
          loading={pending}
          disabled={submitDisabled}
          kbd={pending || submitDisabled ? undefined : '↵'}
          aria-describedby={submitDisabled ? 'close-submit-hint' : undefined}
        >
          {pending ? 'Clôture en cours…' : 'Clôturer le trade'}
        </Btn>
      </div>
    </form>
  );
}

function OutcomeCard({
  value,
  label,
  icon,
  tone,
  disabled,
}: {
  value: 'win' | 'loss' | 'break_even';
  label: string;
  icon: 'up' | 'down' | 'flat';
  tone: 'ok' | 'bad' | 'mute';
  disabled?: boolean;
}) {
  const Icon = icon === 'up' ? TrendingUp : icon === 'down' ? TrendingDown : Minus;

  // Tailwind 4 has-[:checked] : when the radio inside is checked, apply
  // the tone-specific colors. Fallback states for disabled/hover.
  const toneChecked =
    tone === 'ok'
      ? 'has-[:checked]:border-[var(--ok)] has-[:checked]:bg-[var(--ok-dim-2)] has-[:checked]:text-[var(--ok)]'
      : tone === 'bad'
        ? 'has-[:checked]:border-[var(--bad)] has-[:checked]:bg-[var(--bad-dim-2)] has-[:checked]:text-[var(--bad)]'
        : 'has-[:checked]:border-[var(--b-acc)] has-[:checked]:bg-[var(--acc-dim)] has-[:checked]:text-[var(--t-1)]';

  return (
    <label
      className={cn(
        'rounded-card relative flex min-h-12 cursor-pointer flex-col items-center justify-center gap-1 border bg-[var(--bg-1)] px-3 py-3 text-[12px] font-semibold tracking-[0.10em] text-[var(--t-3)] uppercase transition-all',
        'border-[var(--b-default)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
        'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--acc)]',
        toneChecked,
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name="outcome"
        value={value}
        required
        disabled={disabled}
        className="peer sr-only"
      />
      <span aria-hidden className="absolute top-2 right-2 hidden peer-checked:inline">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      <span>{label}</span>
    </label>
  );
}

/**
 * SPEC §28/§21 — "oublis" axis radio card. Two options (true / false), but the
 * radios are NOT `required`: the member can submit without answering (the field
 * maps to `null` server-side). Positive option keeps the accent tone, the
 * "forgot" option stays neutral (anti-Black-Hat: no shaming red on a self-report).
 */
function ProcessCompleteCard({
  value,
  label,
  disabled,
}: {
  value: 'true' | 'false';
  label: string;
  disabled?: boolean;
}) {
  const toneChecked =
    value === 'true'
      ? 'has-[:checked]:border-[var(--ok)] has-[:checked]:bg-[var(--ok-dim-2)] has-[:checked]:text-[var(--ok)]'
      : 'has-[:checked]:border-[var(--b-acc)] has-[:checked]:bg-[var(--acc-dim)] has-[:checked]:text-[var(--t-1)]';

  return (
    <label
      className={cn(
        'rounded-card relative flex min-h-12 cursor-pointer items-center justify-center gap-1.5 border bg-[var(--bg-1)] px-3 py-3 text-center text-[12px] font-semibold tracking-[0.06em] text-[var(--t-3)] uppercase transition-all',
        'border-[var(--b-default)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
        'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--acc)]',
        toneChecked,
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name="processComplete"
        value={value}
        disabled={disabled}
        className="peer sr-only"
      />
      <span aria-hidden className="absolute top-2 right-2 hidden peer-checked:inline">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <span>{label}</span>
    </label>
  );
}

/**
 * S26 — radio card for a management-fidelity act. Parametrised by `name` (one
 * radiogroup per act). Exact visual clone of {@link ProcessCompleteCard}: green
 * tone on the positive answer, accent on the negative — calm (§31.2), never red.
 */
function ManagementAdherenceCard({
  name,
  value,
  label,
  disabled,
}: {
  name: string;
  value: 'true' | 'false';
  label: string;
  disabled?: boolean;
}) {
  const toneChecked =
    value === 'true'
      ? 'has-[:checked]:border-[var(--ok)] has-[:checked]:bg-[var(--ok-dim-2)] has-[:checked]:text-[var(--ok)]'
      : 'has-[:checked]:border-[var(--b-acc)] has-[:checked]:bg-[var(--acc-dim)] has-[:checked]:text-[var(--t-1)]';

  return (
    <label
      className={cn(
        'rounded-card relative flex min-h-12 cursor-pointer items-center justify-center gap-1.5 border bg-[var(--bg-1)] px-3 py-3 text-center text-[12px] font-semibold tracking-[0.06em] text-[var(--t-3)] uppercase transition-all',
        'border-[var(--b-default)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
        'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--acc)]',
        toneChecked,
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input type="radio" name={name} value={value} disabled={disabled} className="peer sr-only" />
      <span aria-hidden className="absolute top-2 right-2 hidden peer-checked:inline">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <span>{label}</span>
    </label>
  );
}
