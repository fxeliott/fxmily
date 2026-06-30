'use client';

import { MailCheck, Mail } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Btn, btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

import { requestPasswordResetAction, type ForgotPasswordActionState } from './actions';

const initialState: ForgotPasswordActionState = { status: 'idle' };

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  // A11y: after a failed submit, move focus to the invalid field or the error
  // banner. No-op on the initial render and on the neutral `sent` success.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'sent') return;
    if (state.fieldErrors?.email) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else if (state.status === 'rate_limited') {
      errorBannerRef.current?.focus();
    }
  }, [state]);

  // Neutral success: shown WHETHER OR NOT the email matched an account
  // (anti-enumeration — the form must never confirm an address exists).
  if (state.status === 'sent') {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative">
          <div aria-hidden className="absolute inset-0 rounded-full bg-[var(--acc-dim)] blur-xl" />
          <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]">
            <MailCheck className="h-5 w-5" strokeWidth={1.75} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="t-body text-[var(--t-2)]">
            Si un compte existe pour cette adresse, un lien de réinitialisation vient d&apos;être
            envoyé. Vérifie ta boîte mail (et les indésirables).
          </p>
          <p className="text-[12px] text-[var(--t-4)]">
            Le lien est valable 30&nbsp;minutes et ne sert qu&apos;une seule fois.
          </p>
        </div>
        <Link href="/login" className={cn(btnVariants({ kind: 'secondary', size: 'm' }), 'w-full')}>
          Retour à la connexion
        </Link>
      </div>
    );
  }

  const topError =
    state.status === 'rate_limited'
      ? (() => {
          const wait = state.retryAfterSec ?? 900;
          const minutes = Math.max(1, Math.ceil(wait / 60));
          return `Trop de demandes. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
        })()
      : null;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? (
        <div ref={errorBannerRef} tabIndex={-1} className="outline-none">
          <Alert tone="danger">{topError}</Alert>
        </div>
      ) : null}

      <Field
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        icon={<Mail className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.email}
        disabled={pending}
        hint="On t'enverra un lien pour choisir un nouveau mot de passe."
      />

      <Btn
        type="submit"
        kind="primary"
        size="l"
        loading={pending}
        kbd={pending ? undefined : '↵'}
        className="w-full"
      >
        {pending ? 'Envoi…' : 'Envoyer le lien'}
      </Btn>

      <Link
        href="/login"
        className="self-center rounded-[3px] text-[11px] text-[var(--t-4)] underline-offset-2 transition-colors hover:text-[var(--acc)] hover:underline focus-visible:text-[var(--acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        Revenir à la connexion
      </Link>
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
  hint?: string | undefined;
  icon?: React.ReactNode | undefined;
}

function Field({
  name,
  type,
  label,
  autoComplete,
  required,
  error,
  disabled,
  hint,
  icon,
}: FieldProps) {
  const id = `field-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
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
          aria-describedby={describedBy}
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
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11px] text-[var(--t-4)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
