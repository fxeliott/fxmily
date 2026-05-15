'use client';

import { Lock, Mail, User } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

import { completeOnboardingAction, type OnboardingActionState } from './actions';

const initialState: OnboardingActionState = { ok: false };

interface OnboardingFormProps {
  token: string;
  email: string;
}

export function OnboardingForm({ token, email }: OnboardingFormProps) {
  const [state, formAction, pending] = useActionState(completeOnboardingAction, initialState);

  const topError = (() => {
    if (state.ok || state.error === 'invalid_input') return null;
    switch (state.error) {
      case 'invalid_token':
        return "Ce lien d'invitation n'est pas valide.";
      case 'expired':
        return 'Ce lien a expiré. Demande à Eliot une nouvelle invitation.';
      case 'already_used':
        return 'Ce lien a déjà été utilisé.';
      case 'email_taken':
        return 'Un compte existe déjà pour cet email.';
      case 'unknown':
        return 'Une erreur est survenue, réessaie.';
      default:
        return null;
    }
  })();

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />

      {topError ? <Alert tone="danger">{topError}</Alert> : null}

      {/* Email readonly avec icon — visible mais pas modifiable */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="onboarding-email"
          className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
        >
          Email
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--t-4)]">
            <Mail className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <input
            id="onboarding-email"
            name="email"
            type="email"
            value={email}
            readOnly
            aria-readonly="true"
            tabIndex={-1}
            className="rounded-input h-11 w-full border border-[var(--b-default)] bg-[var(--bg-2)] py-2 pr-3 pl-10 text-[14px] text-[var(--t-3)] outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          name="firstName"
          label="Prénom"
          required
          autoComplete="given-name"
          icon={<User className="h-4 w-4" strokeWidth={1.75} />}
          error={state.fieldErrors?.firstName}
          disabled={pending}
        />
        <Field
          name="lastName"
          label="Nom"
          required
          autoComplete="family-name"
          icon={<User className="h-4 w-4" strokeWidth={1.75} />}
          error={state.fieldErrors?.lastName}
          disabled={pending}
        />
      </div>

      <Field
        name="password"
        type="password"
        label="Mot de passe"
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

      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-[var(--t-2)]">
          <input
            type="checkbox"
            name="consentRgpd"
            required
            disabled={pending}
            className="mt-0.5 size-5 cursor-pointer accent-[var(--acc)]"
            aria-invalid={state.fieldErrors?.consentRgpd ? 'true' : undefined}
            aria-describedby="consent-error"
          />
          <span>
            J&apos;accepte la{' '}
            <Link
              href="/legal/privacy"
              className="text-[var(--acc)] underline decoration-[var(--b-acc)] underline-offset-2 hover:text-[var(--acc-hi)]"
            >
              politique de confidentialité
            </Link>{' '}
            et les{' '}
            <Link
              href="/legal/terms"
              className="text-[var(--acc)] underline decoration-[var(--b-acc)] underline-offset-2 hover:text-[var(--acc-hi)]"
            >
              conditions d&apos;utilisation
            </Link>
            .
          </span>
        </label>
        <p id="consent-error" role="alert" className="min-h-4 text-[11px] text-[var(--bad)]">
          {state.fieldErrors?.consentRgpd ?? ''}
        </p>
      </div>

      <Btn
        type="submit"
        kind="primary"
        size="l"
        loading={pending}
        kbd={pending ? undefined : '↵'}
        className="w-full"
      >
        {pending ? 'Création du compte…' : 'Créer mon compte'}
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
  const id = `onboarding-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
      >
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
          aria-describedby={describedBy}
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
      ) : hint ? (
        <p id={hintId} className="text-[11px] text-[var(--t-4)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
