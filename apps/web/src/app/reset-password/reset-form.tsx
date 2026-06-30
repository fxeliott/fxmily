'use client';

import { Lock } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

import { resetPasswordAction, type ResetPasswordActionState } from './actions';

const initialState: ResetPasswordActionState = { ok: false };

interface ResetFormProps {
  token: string;
}

export function ResetForm({ token }: ResetFormProps) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  // A11y: after a failed submit, focus the first invalid field, else the banner.
  useEffect(() => {
    if (state.ok) return;
    if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else if (state.error) {
      errorBannerRef.current?.focus();
    }
  }, [state]);

  const topError = (() => {
    if (state.ok || state.error === 'invalid_input') return null;
    switch (state.error) {
      case 'invalid_token':
        return 'Ce lien de réinitialisation n’est pas valide. Refais une demande.';
      case 'expired':
        return 'Ce lien a expiré. Refais une demande de réinitialisation.';
      case 'already_used':
        return 'Ce lien a déjà servi. Refais une demande si besoin.';
      case 'inactive':
        return 'Ce compte n’est pas actif. Contacte Eliott.';
      case 'unknown':
        return 'Une erreur est survenue, réessaie.';
      default:
        return null;
    }
  })();

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />

      {topError ? (
        <div ref={errorBannerRef} tabIndex={-1} className="outline-none">
          <Alert tone="danger">{topError}</Alert>
        </div>
      ) : null}

      <Field
        name="password"
        type="password"
        label="Nouveau mot de passe"
        required
        autoComplete="new-password"
        icon={<Lock className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.password}
        disabled={pending}
        hint="12 caractères minimum, évite les mots de passe trop courants."
      />
      <Field
        name="passwordConfirm"
        type="password"
        label="Confirme le mot de passe"
        required
        autoComplete="new-password"
        icon={<Lock className="h-4 w-4" strokeWidth={1.75} />}
        error={state.fieldErrors?.passwordConfirm}
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
        {pending ? 'Enregistrement…' : 'Réinitialiser le mot de passe'}
      </Btn>
    </form>
  );
}

interface FieldProps {
  name: string;
  type?: 'text' | 'password' | undefined;
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
  type = 'text',
  label,
  autoComplete,
  required,
  error,
  disabled,
  hint,
  icon,
}: FieldProps) {
  const id = `reset-${name}`;
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
