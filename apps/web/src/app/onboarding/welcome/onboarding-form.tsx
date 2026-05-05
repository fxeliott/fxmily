'use client';

import { useActionState } from 'react';
import Link from 'next/link';

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

      {topError ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {topError}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboarding-email" className="text-sm font-medium text-[var(--foreground)]">
          Email
        </label>
        <input
          id="onboarding-email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
          tabIndex={-1}
          className="rounded-md border border-[var(--border)] bg-[color:rgb(15_22_38)] px-3 py-2 text-sm text-[var(--muted)]"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          name="firstName"
          label="Prénom"
          required
          autoComplete="given-name"
          error={state.fieldErrors?.firstName}
          disabled={pending}
        />
        <Field
          name="lastName"
          label="Nom"
          required
          autoComplete="family-name"
          error={state.fieldErrors?.lastName}
          disabled={pending}
        />
      </div>

      <Field
        name="password"
        type="password"
        label="Mot de passe (12 caractères min)"
        required
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        disabled={pending}
      />
      <Field
        name="passwordConfirm"
        type="password"
        label="Confirme le mot de passe"
        required
        autoComplete="new-password"
        error={state.fieldErrors?.passwordConfirm}
        disabled={pending}
      />

      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            name="consentRgpd"
            required
            disabled={pending}
            className="mt-1 size-5 cursor-pointer accent-[var(--primary)]"
            aria-invalid={state.fieldErrors?.consentRgpd ? 'true' : undefined}
            aria-describedby={state.fieldErrors?.consentRgpd ? 'consent-error' : undefined}
          />
          <span>
            J&apos;accepte la{' '}
            <Link href="/legal/privacy" className="text-[var(--accent)] underline">
              politique de confidentialité
            </Link>{' '}
            et les{' '}
            <Link href="/legal/terms" className="text-[var(--accent)] underline">
              conditions d&apos;utilisation
            </Link>
            .
          </span>
        </label>
        <p
          id="consent-error"
          role="alert"
          aria-live="polite"
          className="min-h-4 text-xs text-red-300"
        >
          {state.fieldErrors?.consentRgpd ?? ''}
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Création du compte…' : 'Créer mon compte'}
      </button>
    </form>
  );
}

function Field({
  name,
  type = 'text',
  label,
  autoComplete,
  required,
  error,
  disabled,
}: {
  name: string;
  type?: 'text' | 'password' | undefined;
  label: string;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = `onboarding-${name}`;
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
