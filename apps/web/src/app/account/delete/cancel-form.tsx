'use client';

import { useId, useState, useTransition } from 'react';

import { Btn } from '@/components/ui/btn';

import { cancelAccountDeletionAction } from './actions';

type ActionErrorCode = 'unauthorized' | 'not_pending' | null;

/**
 * Cancel button for a scheduled deletion. Lives in its own client island so
 * the parent Server Component can render the countdown / explanation in
 * pure RSC.
 *
 * Posture : friendly green-lime accent. No double-confirmation here — the
 * user clearly wants out of the destruction queue, never punish that path
 * with extra clicks.
 */
export function CancelDeletionForm(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<ActionErrorCode>(null);
  const errorRegionId = useId();

  return (
    <form
      action={() => {
        setErrorCode(null);
        startTransition(async () => {
          const result = await cancelAccountDeletionAction();
          if (!result.ok) setErrorCode(result.error);
        });
      }}
      noValidate
    >
      <Btn type="submit" kind="primary" size="l" loading={isPending}>
        Annuler la suppression
      </Btn>
      {/* Live region carrying the in-flight state explicitly for AT
          (J10 Phase G a11y B2 — `aria-busy` on the button is NOT
          reliably announced by NVDA/JAWS). */}
      <div role="status" aria-live="polite" className="sr-only">
        {isPending ? 'Annulation en cours…' : ''}
      </div>
      <div
        id={errorRegionId}
        role="status"
        aria-live="polite"
        className="mt-2 min-h-[1.25rem] text-xs text-[var(--bad)]"
      >
        {errorCode === 'not_pending'
          ? 'Aucune suppression en attente — la fenêtre de 24h est peut-être expirée.'
          : errorCode === 'unauthorized'
            ? 'Session expirée — recharge la page.'
            : null}
      </div>
    </form>
  );
}
