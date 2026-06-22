'use client';

import { GraduationCap, Layers } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  createTrainingSessionAction,
  type CreateTrainingSessionActionState,
} from '@/app/training/sessions/actions';
import { Alert } from '@/components/alert';
import { PairAutocomplete } from '@/components/journal/pair-autocomplete';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import {
  TRAINING_SESSION_LABEL_MAX,
  TRAINING_SESSION_NOTES_MAX,
} from '@/lib/schemas/training-session';
import { cn } from '@/lib/utils';

/**
 * Create-a-backtest-session form (S8 Mode Entraînement — "crée une session de
 * backtest", brief §31 DoD#1). A session is a light context container (one
 * practice sitting: instrument / timeframe / period / notes); the actual
 * backtests are logged inside it via the existing 6-step wizard. So this stays
 * a single calm form, NOT a multi-step wizard.
 *
 * Cyan "MODE ENTRAÎNEMENT" identity (DS-v2 `--cy`), non-confusable with the
 * live journal (Mark Douglas discipline). Every field is OPTIONAL — a member
 * may open a session with just a label and fill the rest later.
 *
 * The Server Action redirects to the new session on success, so the only
 * client state we surface is the field/`server` error set.
 */

const inputClass =
  'rounded-input h-11 w-full border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-[var(--t-4)] hover:border-[var(--b-strong)] focus-visible:border-[var(--cy)] focus-visible:ring-2 focus-visible:ring-[var(--cy-dim)] disabled:cursor-not-allowed disabled:opacity-60';

function serverErrorMessage(state: CreateTrainingSessionActionState): string | null {
  switch (state.error) {
    case 'unauthorized':
      return 'Session expirée — reconnecte-toi puis réessaie.';
    case 'invalid_input':
      return 'Certains champs sont invalides — contrôle-les ci-dessous.';
    case 'unknown':
      return 'Erreur inattendue — réessaie dans un instant.';
    default:
      return null;
  }
}

export function TrainingSessionForm() {
  const [symbol, setSymbol] = useState('');
  const [state, formAction, pending] = useActionState<
    CreateTrainingSessionActionState | null,
    FormData
  >(createTrainingSessionAction, null);

  const fieldErrors = state?.fieldErrors ?? {};
  const serverError = state ? serverErrorMessage(state) : null;

  return (
    <section
      aria-labelledby="training-session-heading"
      className="mx-auto flex w-full max-w-xl flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <Link
          href="/training"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          ← Mes backtests
        </Link>
        <span className="t-eyebrow inline-flex w-fit items-center gap-1.5 text-[var(--cy)]">
          <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
          Mode entraînement — nouvelle séance
        </span>
        <div className="flex items-center gap-2.5">
          <div className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] text-[var(--cy)]">
            <Layers className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <h1
            id="training-session-heading"
            className="f-display text-[22px] leading-[1.1] font-bold tracking-[-0.02em] text-[var(--t-1)] sm:text-[26px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Ouvrir une session de backtest
          </h1>
        </div>
        <p className="t-body text-[var(--t-2)]">
          Une session regroupe les backtests d&apos;une même séance de replay (un instrument, une
          unité de temps, une période). Tu pourras y ajouter tes backtests juste après.
        </p>
      </header>

      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

      <form action={formAction} className="flex flex-col gap-5">
        <Card className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="label" className="t-eyebrow-lg text-[var(--t-3)]">
              Nom de la séance (optionnel)
            </label>
            <input
              id="label"
              name="label"
              type="text"
              maxLength={TRAINING_SESSION_LABEL_MAX}
              placeholder="Ex : Range GBPUSD — janvier 2024"
              disabled={pending}
              aria-invalid={fieldErrors.label ? 'true' : undefined}
              aria-describedby={fieldErrors.label ? 'label-error' : undefined}
              className={inputClass}
            />
            {fieldErrors.label ? (
              <p id="label-error" className="text-[11px] text-[var(--bad)]" role="alert">
                {fieldErrors.label}
              </p>
            ) : (
              <p className="t-cap text-[var(--t-4)]">
                Un titre pour t&apos;y retrouver. Tu peux le laisser vide.
              </p>
            )}
          </div>

          <PairAutocomplete
            value={symbol}
            onChange={setSymbol}
            name="symbol"
            error={fieldErrors.symbol}
            disabled={pending}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeframe" className="t-eyebrow-lg text-[var(--t-3)]">
              Unité de temps (optionnel)
            </label>
            <input
              id="timeframe"
              name="timeframe"
              type="text"
              maxLength={12}
              placeholder="M15, H1, H4, D1…"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-invalid={fieldErrors.timeframe ? 'true' : undefined}
              aria-describedby={fieldErrors.timeframe ? 'timeframe-error' : undefined}
              className={cn(inputClass, 'f-mono uppercase placeholder:normal-case')}
            />
            {fieldErrors.timeframe ? (
              <p id="timeframe-error" className="text-[11px] text-[var(--bad)]" role="alert">
                {fieldErrors.timeframe}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="notes" className="t-eyebrow-lg text-[var(--t-3)]">
              Notes de séance (optionnel)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              maxLength={TRAINING_SESSION_NOTES_MAX}
              placeholder="Le contexte de marché que tu rejoues, ton objectif de pratique pour cette séance…"
              disabled={pending}
              aria-invalid={fieldErrors.notes ? 'true' : undefined}
              aria-describedby={fieldErrors.notes ? 'notes-error' : undefined}
              className={cn(inputClass, 'h-auto')}
            />
            {fieldErrors.notes ? (
              <p id="notes-error" className="text-[11px] text-[var(--bad)]" role="alert">
                {fieldErrors.notes}
              </p>
            ) : null}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Btn kind="primary" size="m" type="submit" disabled={pending} loading={pending}>
            {pending ? 'Création…' : 'Ouvrir la session'}
          </Btn>
        </div>
      </form>
    </section>
  );
}
