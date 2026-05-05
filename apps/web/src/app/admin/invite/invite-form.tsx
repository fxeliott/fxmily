'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Spinner } from '@/components/spinner';

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
        <label htmlFor="invite-email" className="text-foreground text-sm font-medium">
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
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
        {state.fieldErrors?.email ? (
          <p id="invite-email-error" className="text-danger text-xs">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Spinner />
            <span>Envoi…</span>
          </>
        ) : (
          <span>Envoyer l&apos;invitation</span>
        )}
      </button>

      <div id="invite-status" className="min-h-5">
        {state.ok && state.message ? (
          <Alert tone="success">
            <span className="inline-flex items-center gap-2">
              <CheckIcon />
              <span>{state.message}</span>
            </span>
          </Alert>
        ) : null}
        {!state.ok && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      </div>
    </form>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
