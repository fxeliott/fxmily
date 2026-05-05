'use client';

import { useActionState, useEffect, useRef } from 'react';

import { createInvitationAction, type InviteActionState } from './actions';

const initialState: InviteActionState = { ok: false };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitationAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the input on a successful send.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok, state.message]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
      aria-describedby="invite-status"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-email" className="text-sm font-medium text-[var(--foreground)]">
          Email du nouveau membre
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          disabled={pending}
          aria-invalid={state.fieldErrors?.email ? 'true' : undefined}
          aria-describedby={state.fieldErrors?.email ? 'invite-email-error' : undefined}
          className="focus-visible:ring-[var(--accent)]/40 rounded-md border border-[var(--border)] bg-[color:rgb(15_22_38)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 disabled:opacity-60"
        />
        {state.fieldErrors?.email ? (
          <p id="invite-email-error" className="text-xs text-red-300">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Envoi…' : "Envoyer l'invitation"}
      </button>

      <div id="invite-status" role="status" aria-live="polite" className="min-h-5">
        {state.ok && state.message ? (
          <p className="text-sm text-emerald-300">{state.message}</p>
        ) : null}
        {!state.ok && state.message ? (
          <p className="text-sm text-red-300">{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
