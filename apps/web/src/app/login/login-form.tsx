'use client';

import { useActionState } from 'react';

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
      {topError ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {topError}
        </div>
      ) : null}

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
        className="min-h-11 rounded-md bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Connexion…' : 'Se connecter'}
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
      <label htmlFor={id} className="text-sm font-medium text-[var(--foreground)]">
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
        className="focus-visible:ring-[var(--accent)]/40 rounded-md border border-[var(--border)] bg-[color:rgb(15_22_38)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 disabled:opacity-60"
      />
      {error ? (
        <p id={errorId} className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
