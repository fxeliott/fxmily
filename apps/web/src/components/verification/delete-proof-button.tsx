'use client';

import { Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { deleteProofAction } from '@/app/verification/actions';

/**
 * S3 — remove one of the member's own MT5 proofs (`/verification`). Calm,
 * two-step confirm inline (no modal): first click arms, second click deletes.
 * Already-extracted positions survive by design (SetNull — §33 honesty).
 */
export function DeleteProofButton({ proofId }: { proofId: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteProofAction(proofId, null);
      if (!result.ok) {
        setError('Suppression impossible, réessaie.');
      }
      setArmed(false);
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending || undefined}
        className="rounded-control inline-flex h-9 items-center gap-1.5 border border-transparent px-2 text-[11px] text-[var(--t-3)] transition-colors hover:border-[var(--b-danger)] hover:bg-[var(--bad-dim)] hover:text-[var(--bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        {isPending ? 'Suppression…' : armed ? 'Confirmer la suppression' : 'Retirer'}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
