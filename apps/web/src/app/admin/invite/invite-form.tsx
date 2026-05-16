'use client';

import { Check, Mail, Send } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

import { createInvitationAction, type InviteActionState } from './actions';

const initialState: InviteActionState = { ok: false };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitationAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

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
        <label htmlFor="invite-email" className="t-eyebrow-lg text-[var(--t-3)]">
          Email du nouveau membre
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--t-4)]">
            <Mail className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            disabled={pending}
            placeholder="trader@example.com"
            aria-invalid={state.fieldErrors?.email ? 'true' : undefined}
            aria-describedby={state.fieldErrors?.email ? 'invite-email-error' : undefined}
            className={cn(
              'rounded-input h-11 w-full border bg-[var(--bg-1)] py-2 pr-3 pl-10 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
              'placeholder:text-[var(--t-4)]',
              state.fieldErrors?.email
                ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
                : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
        </div>
        {state.fieldErrors?.email ? (
          <p id="invite-email-error" className="text-[11px] text-[var(--bad)]">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <Btn
        type="submit"
        kind="primary"
        size="m"
        loading={pending}
        kbd={pending ? undefined : '↵'}
        className="w-full"
      >
        {pending ? (
          'Envoi…'
        ) : (
          <>
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
            Envoyer l&apos;invitation
          </>
        )}
      </Btn>

      <div id="invite-status" className="min-h-5">
        {state.ok && state.message ? (
          <Alert tone="success">
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{state.message}</span>
            </span>
          </Alert>
        ) : null}
        {!state.ok && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      </div>
    </form>
  );
}
