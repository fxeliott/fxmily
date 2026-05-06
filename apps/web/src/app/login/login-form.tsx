'use client';

import { Mail, Lock } from 'lucide-react';
import { useActionState } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

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
        icon={<Mail className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.email}
        disabled={pending}
      />
      <Field
        name="password"
        type="password"
        label="Mot de passe"
        autoComplete="current-password"
        required
        icon={<Lock className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.password}
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
        {pending ? 'Connexion…' : 'Se connecter'}
      </Btn>
    </form>
  );
}

interface FieldProps {
  name: string;
  type: 'email' | 'password' | 'text';
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
      <label
        htmlFor={id}
        className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]"
      >
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-4)]">
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
            'rounded-input h-11 w-full border bg-[var(--bg-1)] py-2 pr-3 text-[14px] text-[var(--t-1)] outline-none transition-[border-color,box-shadow] duration-150',
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
