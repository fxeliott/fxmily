'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/alert';
import { Spinner } from '@/components/spinner';

import { signInAction, type SignInActionState } from './actions';

const initialState: SignInActionState = { ok: false };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  const topError = (() => {
    if (state.ok) return null;
    if (state.error === 'invalid_credentials') return 'Email ou mot de passe incorrect.';
    if (state.error === 'unknown') return 'Une erreur est survenue, réessaie.';
    return null;
  })();

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? <Alert tone="danger">{topError}</Alert> : null}

      <Field
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
        disabled={pending}
      />
      <Field
        name="password"
        type="password"
        label="Mot de passe"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
        disabled={pending}
      />

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Spinner />
            <span>Connexion…</span>
          </>
        ) : (
          <span>Se connecter</span>
        )}
      </button>
    </form>
  );
}

function Field({
  name,
  type,
  label,
  autoComplete,
  required,
  error,
  disabled,
}: {
  name: string;
  type: 'email' | 'password' | 'text';
  label: string;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = `field-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
      />
      {error ? (
        <p id={errorId} className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
