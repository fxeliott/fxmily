'use client';

import { Plus } from 'lucide-react';
import { useActionState, useEffect, useRef } from 'react';

import { Btn } from '@/components/ui/btn';
import {
  createBrokerAccountAction,
  type CreateBrokerAccountActionState,
} from '@/app/verification/actions';
import { PROOF_ACCOUNT_TYPES, type ProofAccountType } from '@/lib/schemas/verification';

const ACCOUNT_TYPE_LABELS: Record<ProofAccountType, string> = {
  prop_firm: 'Prop firm',
  personal: 'Compte perso',
};

const TOP_ERROR_LABELS: Record<string, string> = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  invalid_input: 'Vérifie les champs ci-dessous.',
  limit_reached: 'Tu as atteint la limite de comptes — contacte Eliot si besoin.',
  unknown: 'Échec de l’enregistrement, réessaie.',
};

/**
 * S3 — declare a broker account (`/verification`, SPEC §33). Plain
 * `useActionState` form (pattern `/reunions` J-M2): the Server Action is the
 * only validation authority, field errors render inline.
 */
export function AccountCreateForm() {
  const [state, formAction, isPending] = useActionState<
    CreateBrokerAccountActionState | null,
    FormData
  >(createBrokerAccountAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form after a successful create so the member can chain
  // declarations without stale input.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const topError = state && !state.ok && state.error ? TOP_ERROR_LABELS[state.error] : null;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Nom du compte</span>
          <input
            type="text"
            name="label"
            required
            maxLength={80}
            placeholder="FTMO 100k, Compte perso IC Markets…"
            disabled={isPending}
            aria-invalid={fieldErrors.label ? 'true' : undefined}
            className="rounded-control h-11 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          />
          {fieldErrors.label ? (
            <span role="alert" className="text-[11px] text-[var(--bad)]">
              {fieldErrors.label}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Broker (optionnel)</span>
          <input
            type="text"
            name="brokerName"
            maxLength={80}
            placeholder="FTMO, IC Markets…"
            disabled={isPending}
            aria-invalid={fieldErrors.brokerName ? 'true' : undefined}
            className="rounded-control h-11 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          />
          {fieldErrors.brokerName ? (
            <span role="alert" className="text-[11px] text-[var(--bad)]">
              {fieldErrors.brokerName}
            </span>
          ) : null}
        </label>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="t-eyebrow text-[var(--t-3)]">Type de compte</legend>
        <div className="flex flex-wrap gap-2 pt-1.5">
          {PROOF_ACCOUNT_TYPES.map((t) => (
            <label
              key={t}
              className="rounded-control inline-flex h-11 cursor-pointer items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-2)] transition-colors has-[:checked]:border-[var(--b-acc)] has-[:checked]:bg-[var(--acc-dim-2)] has-[:checked]:text-[var(--t-1)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--acc)]"
            >
              <input
                type="radio"
                name="type"
                value={t}
                required
                disabled={isPending}
                className="sr-only"
              />
              {ACCOUNT_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
        {fieldErrors.type ? (
          <span role="alert" className="text-[11px] text-[var(--bad)]">
            Choisis le type de compte.
          </span>
        ) : null}
      </fieldset>

      {topError ? (
        <p role="alert" className="text-[12px] text-[var(--bad)]">
          {topError}
        </p>
      ) : null}

      <Btn type="submit" kind="secondary" size="m" loading={isPending} className="self-start">
        <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        Déclarer ce compte
      </Btn>
    </form>
  );
}
