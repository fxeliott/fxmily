'use client';

import { Check, Mail, User } from 'lucide-react';
import { useActionState } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

import { requestAccessAction, type RequestAccessActionState } from '@/app/rejoindre/actions';

const initialState: RequestAccessActionState = { ok: false };

/**
 * Public self-service access-request form (V2.5 — `/rejoindre`).
 *
 * `useActionState` + `<form action>` + FormData, mirroring `login-form.tsx`.
 * On success the whole form is swapped for a calm "demande en attente" state
 * (mirror `invite-form.tsx` Alert tone="success") — no layout shift beyond the
 * intentional success swap, a11y wired via aria-invalid/aria-describedby.
 */
export function RequestAccessForm() {
  const [state, formAction, pending] = useActionState(requestAccessAction, initialState);

  // Success state: calm confirmation, no form. Mirror invite-form Alert tone.
  if (state.ok) {
    return (
      <Alert tone="success" className="flex items-start gap-2.5">
        <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>
          Ta demande est en attente de validation. Tu recevras un email dès qu&apos;elle est
          acceptée.
        </span>
      </Alert>
    );
  }

  const topError = (() => {
    if (state.error === 'rate_limited') {
      const wait = state.retryAfterSec ?? 900;
      const minutes = Math.max(1, Math.ceil(wait / 60));
      return `Trop de demandes. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
    }
    if (state.error === 'unknown') {
      return state.message ?? 'Une erreur est survenue, réessaie.';
    }
    return null;
  })();

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? <Alert tone="danger">{topError}</Alert> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="firstName"
          type="text"
          label="Prénom"
          autoComplete="given-name"
          required
          icon={<User className="h-4 w-4" strokeWidth={1.75} />}
          error={state.fieldErrors?.firstName}
          disabled={pending}
        />
        <Field
          name="lastName"
          type="text"
          label="Nom"
          autoComplete="family-name"
          required
          icon={<User className="h-4 w-4" strokeWidth={1.75} />}
          error={state.fieldErrors?.lastName}
          disabled={pending}
        />
      </div>

      <Field
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        icon={<Mail className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.email}
        disabled={pending}
      />

      <Btn
        type="submit"
        kind="primary"
        size="l"
        loading={pending}
        kbd={pending ? undefined : '↵'}
        className="w-full"
      >
        {pending ? 'Envoi…' : 'Envoyer ma demande'}
      </Btn>
    </form>
  );
}

interface FieldProps {
  name: string;
  type: 'email' | 'text';
  label: string;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  icon?: React.ReactNode | undefined;
}

function Field({ name, type, label, autoComplete, required, error, disabled, icon }: FieldProps) {
  const id = `field-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="t-eyebrow-lg text-[var(--t-3)]">
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--t-4)]">
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={errorId}
          className={cn(
            'rounded-input h-11 w-full border bg-[var(--bg-1)] py-2 pr-3 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            icon ? 'pl-10' : 'pl-3',
            error
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
      </div>
      {error ? (
        <p id={errorId} className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
