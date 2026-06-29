'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Mail, User } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { Reveal } from '@/components/ui/reveal';
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
  const formRef = useRef<HTMLFormElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  // A11y: after a FAILED submit, move focus to the first invalid field (or the
  // error banner for rate-limit/unknown). Hooks must run before the success
  // early return below; no-op on initial render and on success.
  useEffect(() => {
    if (state.ok) return;
    const hasFieldError = state.fieldErrors && Object.keys(state.fieldErrors).length > 0;
    if (hasFieldError) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else if (state.error) {
      errorBannerRef.current?.focus();
    }
  }, [state]);

  // Success state: a real calm moment. A check that draws itself inside a soft
  // accent halo, then settles — NO confetti, no fanfare (Mark Douglas posture).
  // The draw completes under ~600ms and stops; the message reveals just after.
  if (state.ok) {
    return <RequestAccessSuccess />;
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
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      {topError ? (
        <div ref={errorBannerRef} tabIndex={-1} className="outline-none">
          <Alert tone="danger">{topError}</Alert>
        </div>
      ) : null}

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

/**
 * Calm success moment — the inverse of gamified fanfare (Mark Douglas posture).
 *
 * A single check strokes itself inside a soft accent halo (compositor-only:
 * the SVG `pathLength` + `opacity`/`scale` are GPU-driven, no layout), the draw
 * lands in ~520ms and STOPS — no loop, no confetti, no streak. The confirming
 * sentence reveals just after, polite (`role="status"` via Alert tone).
 * Reduced-motion users get the final, fully-drawn state instantly.
 */
function RequestAccessSuccess() {
  const reduced = useReducedMotion();

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="relative grid h-14 w-14 place-items-center">
        {/* Soft accent halo — a posed glow, not a pulse. Decorative. */}
        <m.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[var(--acc-dim)]"
          initial={reduced ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        />
        <span className="relative grid h-11 w-11 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <m.path
              d="M5 12.5l4.2 4.2L19 7"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
            />
          </svg>
        </span>
      </div>

      <Reveal delay={reduced ? 0 : 360} y={8} className="w-full">
        <Alert tone="success" className="text-center">
          Ta demande est en attente de validation. Tu recevras un email dès qu&apos;elle est
          acceptée.
        </Alert>
      </Reveal>
    </div>
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
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
