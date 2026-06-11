'use client';

import { useActionState } from 'react';

import { Btn } from '@/components/ui/btn';
import {
  submitDiscrepancyReasonAction,
  type SubmitDiscrepancyReasonActionState,
} from '@/app/verification/actions';

/**
 * S3 — « motif valable » form on an écart (DoD §29: an excused gap is not
 * indiscipline). Native <details> disclosure (0-JS open/close), calm copy.
 */
export function DiscrepancyReasonForm({ discrepancyId }: { discrepancyId: string }) {
  const [state, formAction, isPending] = useActionState<
    SubmitDiscrepancyReasonActionState | null,
    FormData
  >(submitDiscrepancyReasonAction, null);

  return (
    <details className="group">
      <summary className="rounded-control inline-flex h-9 cursor-pointer list-none items-center px-2 text-[12px] text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]">
        Donner un motif
      </summary>
      <form action={formAction} className="flex flex-col gap-2 pt-2">
        <input type="hidden" name="discrepancyId" value={discrepancyId} />
        <label className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-[var(--t-3)]">Ce qui s&apos;est passé</span>
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={500}
            rows={2}
            disabled={isPending}
            placeholder="J'étais malade, panne internet, semaine off déclarée…"
            className="rounded-control border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2 text-[13px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          />
          {state && !state.ok && state.fieldErrors?.reason ? (
            <span role="alert" className="text-[11px] text-[var(--bad)]">
              {state.fieldErrors.reason}
            </span>
          ) : null}
        </label>
        {state && !state.ok && !state.fieldErrors ? (
          <span role="alert" className="text-[11px] text-[var(--bad)]">
            Envoi impossible, réessaie.
          </span>
        ) : null}
        <Btn type="submit" kind="secondary" size="s" loading={isPending} className="self-start">
          Envoyer le motif
        </Btn>
      </form>
    </details>
  );
}
