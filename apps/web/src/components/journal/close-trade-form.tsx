'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Alert } from '@/components/alert';
import { Spinner } from '@/components/spinner';
import { EmotionPicker } from '@/components/journal/emotion-picker';
import { ScreenshotUploader } from '@/components/journal/screenshot-uploader';
import { closeTradeAction, type CloseTradeActionState } from '@/app/journal/actions';

interface CloseTradeFormProps {
  tradeId: string;
  /** Pre-filled with the entry timestamp + 1h for convenience. */
  defaultExitedAt: string;
}

const initialState: CloseTradeActionState = { ok: false };

export function CloseTradeForm({ tradeId, defaultExitedAt }: CloseTradeFormProps) {
  const action = closeTradeAction.bind(null, tradeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [emotionAfter, setEmotionAfter] = useState<string[]>([]);
  const [screenshotKey, setScreenshotKey] = useState<string>('');

  const topError = state.ok
    ? null
    : state.error === 'not_found'
      ? "Ce trade n'existe pas ou a été supprimé."
      : state.error === 'already_closed'
        ? 'Ce trade est déjà clôturé.'
        : state.error === 'unauthorized'
          ? 'Session expirée — reconnecte-toi.'
          : state.error === 'invalid_input'
            ? 'Vérifie les champs en rouge.'
            : state.error === 'unknown'
              ? 'Erreur inattendue, réessaie.'
              : null;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? <Alert tone="danger">{topError}</Alert> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="exitedAt" className="text-foreground text-sm font-medium">
          Date et heure de sortie
        </label>
        <input
          id="exitedAt"
          name="exitedAt"
          type="datetime-local"
          defaultValue={defaultExitedAt}
          required
          disabled={pending}
          aria-invalid={state.fieldErrors?.exitedAt ? 'true' : undefined}
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
        {state.fieldErrors?.exitedAt ? (
          <p className="text-danger text-xs" role="alert">
            {state.fieldErrors.exitedAt}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="exitPrice" className="text-foreground text-sm font-medium">
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
          aria-invalid={state.fieldErrors?.exitPrice ? 'true' : undefined}
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 rounded-md border border-[var(--border)] px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
        {state.fieldErrors?.exitPrice ? (
          <p className="text-danger text-xs" role="alert">
            {state.fieldErrors.exitPrice}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground mb-1 text-sm font-medium">Résultat</legend>
        <div role="radiogroup" aria-label="Résultat du trade" className="grid grid-cols-3 gap-2">
          {(
            [
              {
                value: 'win',
                label: 'Gain',
                tone: 'has-[:checked]:bg-success/15 has-[:checked]:border-success has-[:checked]:text-success',
              },
              {
                value: 'loss',
                label: 'Perte',
                tone: 'has-[:checked]:bg-danger/15 has-[:checked]:border-danger has-[:checked]:text-danger',
              },
              {
                value: 'break_even',
                label: 'Break-even',
                tone: 'has-[:checked]:bg-accent/15 has-[:checked]:border-accent has-[:checked]:text-foreground',
              },
            ] as const
          ).map((opt, i) => (
            <label
              key={opt.value}
              className={[
                'bg-card focus-within:outline-accent flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                opt.tone,
              ].join(' ')}
            >
              <input
                type="radio"
                name="outcome"
                value={opt.value}
                required
                disabled={pending}
                tabIndex={i === 0 ? 0 : -1}
                className="peer sr-only"
              />
              <span aria-hidden="true" className="hidden peer-checked:inline">
                ✓
              </span>
              {opt.label}
            </label>
          ))}
        </div>
        {state.fieldErrors?.outcome ? (
          <p className="text-danger text-xs" role="alert">
            {state.fieldErrors.outcome}
          </p>
        ) : null}
      </fieldset>

      <EmotionPicker
        value={emotionAfter}
        onChange={setEmotionAfter}
        name="emotionAfter"
        label="Émotion(s) après la sortie"
        disabled={pending}
      />
      {state.fieldErrors?.emotionAfter ? (
        <p className="text-danger text-xs" role="alert">
          {state.fieldErrors.emotionAfter}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-foreground text-sm font-medium">
          Notes (optionnel)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          disabled={pending}
          placeholder="Comment tu t’es senti ? Ce qui a marché / pas marché ?"
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 placeholder:text-muted/70 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-foreground text-sm font-medium">Capture après sortie</span>
        <ScreenshotUploader
          kind="trade-exit"
          name="screenshotExitKey"
          disabled={pending}
          error={state.fieldErrors?.screenshotExitKey}
          onUploaded={({ key }) => setScreenshotKey(key)}
          onCleared={() => setScreenshotKey('')}
        />
      </div>

      {screenshotKey.length === 0 || emotionAfter.length === 0 ? (
        <p id="close-submit-hint" className="text-muted text-right text-xs">
          Capture après sortie et au moins une émotion sont nécessaires.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/journal/${tradeId}`}
          className="text-muted hover:text-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Annuler
        </Link>
        <button
          type="submit"
          disabled={pending || screenshotKey.length === 0 || emotionAfter.length === 0}
          aria-describedby={
            screenshotKey.length === 0 || emotionAfter.length === 0
              ? 'close-submit-hint'
              : undefined
          }
          className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Spinner />
              <span>Clôture en cours…</span>
            </>
          ) : (
            <span>Clôturer le trade</span>
          )}
        </button>
      </div>
    </form>
  );
}
