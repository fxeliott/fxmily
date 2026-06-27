'use client';

import { Mail, Lock } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { RevealGroup } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

import { signInAction, type SignInActionState } from './actions';

const initialState: SignInActionState = { ok: false };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  // A11y: after a FAILED submit, move focus straight to what needs fixing — the
  // first invalid field, or the error banner for credential/rate-limit errors.
  // No-op on the initial render and on success (initialState carries neither
  // `error` nor `fieldErrors`), so the form never steals focus unprompted.
  useEffect(() => {
    if (state.ok) return;
    const hasFieldError = state.fieldErrors && Object.keys(state.fieldErrors).length > 0;
    if (hasFieldError) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else if (state.error) {
      errorBannerRef.current?.focus();
    }
  }, [state]);

  const topError = (() => {
    if (state.ok) return null;
    if (state.error === 'invalid_credentials') return 'Email ou mot de passe incorrect.';
    if (state.error === 'rate_limited') {
      const wait = state.retryAfterSec ?? 60;
      const minutes = Math.max(1, Math.ceil(wait / 60));
      return `Trop d'essais. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
    }
    if (state.error === 'unknown') return 'Une erreur est survenue, réessaie.';
    return null;
  })();

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? (
        <div ref={errorBannerRef} tabIndex={-1} className="outline-none">
          <Alert tone="danger">{topError}</Alert>
        </div>
      ) : null}

      <RevealGroup className="flex flex-col gap-5" stagger={90} y={10}>
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
      </RevealGroup>

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

      {/* Self-service recourse for a private cohort: no public reset route exists
          (admin-managed access) — point to the official contact email instead of
          a dead link. Confidentiality-safe: only fxeliott@fxmily.fr is exposed. */}
      <a
        href="mailto:fxeliott@fxmily.fr?subject=Acc%C3%A8s%20Fxmily%20%E2%80%94%20mot%20de%20passe%20oubli%C3%A9"
        className="self-center rounded-[3px] text-[11px] text-[var(--t-4)] underline-offset-2 transition-colors hover:text-[var(--acc)] hover:underline focus-visible:text-[var(--acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        Mot de passe oublié&nbsp;?
      </a>
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
      <label htmlFor={id} className="t-eyebrow-lg text-[var(--t-3)]">
        {label}
      </label>
      <div className="group relative">
        {icon ? (
          <span className="pointer-events-none absolute top-1/2 left-3 z-[1] -translate-y-1/2 text-[var(--t-4)] transition-colors duration-150 group-focus-within:text-[var(--acc)] group-hover:text-[var(--acc)]">
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
              : 'border-[var(--b-default)] hover:border-[var(--b-acc)] hover:shadow-[0_0_0_3px_var(--acc-dim)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-[var(--b-default)] disabled:hover:shadow-none',
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
