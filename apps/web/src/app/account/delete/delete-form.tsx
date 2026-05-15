'use client';

import { useId, useState, useTransition } from 'react';

import { Btn } from '@/components/ui/btn';
import { Code } from '@/components/ui/code';

import { requestAccountDeletionAction } from './actions';

type ActionErrorCode =
  | 'unauthorized'
  | 'bad_confirmation'
  | 'already_requested'
  | 'not_pending'
  | null;

const REQUIRED_PHRASE = 'SUPPRIMER';

/**
 * Type-to-confirm form for the destructive request action. Client island
 * ONLY for the typed-validation feedback — the actual deletion happens
 * server-side via the `requestAccountDeletionAction` Server Action.
 *
 * UX :
 *   - Live validation : the submit button stays disabled until the user
 *     types `SUPPRIMER` exactly (case-sensitive). Avoids the case where a
 *     muscle-memory click on a primary button lands a 24h cancel timer
 *     unintentionally.
 *   - Pending state : the submit button shows a spinner during the action
 *     so a slow network doesn't tempt the user into double-clicking.
 *   - Error feedback : `aria-live="polite"` region; the page revalidates
 *     on success so the parent Server Component re-renders the
 *     "scheduled" UI without an extra round-trip.
 */
export function DeleteAccountForm(): React.ReactElement {
  const [phrase, setPhrase] = useState('');
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<ActionErrorCode>(null);
  const inputId = useId();
  const errorRegionId = useId();

  const isMatch = phrase === REQUIRED_PHRASE;

  return (
    <form
      action={(formData) => {
        setErrorCode(null);
        startTransition(async () => {
          const result = await requestAccountDeletionAction(formData);
          if (!result.ok) setErrorCode(result.error);
        });
      }}
      noValidate
    >
      <label htmlFor={inputId} className="block text-sm font-medium text-[var(--t-1)]">
        Tape <Code>SUPPRIMER</Code> pour confirmer
      </label>
      <p className="mt-1 text-[11px] text-[var(--t-3)]">
        Une fois validée, ta demande lance un compte à rebours de 24h. Tu pourras toujours
        l&apos;annuler depuis cette page tant que le compte à rebours n&apos;est pas écoulé.
      </p>
      <input
        id={inputId}
        name="confirmation"
        type="text"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="characters"
        inputMode="text"
        className="mt-3 h-11 w-full rounded-md border border-[var(--b-strong)] bg-[var(--bg-2)] px-3 font-mono text-sm tracking-widest text-[var(--t-1)] placeholder:text-[var(--t-4)] focus:border-[var(--b-acc)] focus:ring-2 focus:ring-[var(--acc)] focus:outline-none"
        // J10 Phase G — code-reviewer H7 : the placeholder must NOT match
        // the expected phrase. Some mobile keyboards offer the placeholder
        // as a one-tap autocomplete, which would defeat the anti-impulsivity
        // gate. Asking the user to type matches their intent.
        placeholder="Tape ici"
        value={phrase}
        onChange={(e) => {
          setPhrase(e.target.value);
          if (errorCode) setErrorCode(null);
        }}
        aria-describedby={errorRegionId}
        disabled={isPending}
      />
      {/*
        `role="alert"` (J10 Phase I — a11y H5) for assertive SR announcement
        on submission failure. `aria-live="assertive"` is implicit on alerts
        and the right pick here because the user just clicked a destructive
        action — they should be interrupted, not "polite".
      */}
      <div
        id={errorRegionId}
        role="alert"
        aria-atomic="true"
        className="mt-2 min-h-[1.25rem] text-xs text-[var(--bad)]"
      >
        {errorCode === 'bad_confirmation'
          ? 'Le texte ne correspond pas. Tape `SUPPRIMER` exactement.'
          : errorCode === 'already_requested'
            ? 'Une demande de suppression est déjà en cours.'
            : errorCode === 'unauthorized'
              ? 'Session expirée — recharge la page.'
              : null}
      </div>
      {/*
        Live region for the pending state (J10 Phase G a11y B2). NVDA / JAWS
        do NOT reliably announce `aria-busy` transitions on a `<button>`,
        so screen-reader users can't tell the difference between idle and
        in-flight. A dedicated polite live region carries the message
        explicitly during the action — sighted users see the spinner,
        AT users hear "Suppression en cours…".
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {isPending ? 'Demande de suppression en cours…' : ''}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn type="submit" kind="danger" size="l" disabled={!isMatch} loading={isPending}>
          Demander la suppression
        </Btn>
      </div>
    </form>
  );
}
