'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { deleteTrainingAnnotationAction } from '@/app/admin/members/[id]/training/[trainingTradeId]/actions';
import { Spinner } from '@/components/spinner';

/**
 * Delete-training-correction CTA (J-T3 — carbon mirror of
 * `delete-annotation-button.tsx`). Two-step confirm (idle → confirming →
 * pending). Only rendered when the current admin authored the correction;
 * the Server Action re-enforces it via `deleteMany({ id, adminId })`.
 */

interface DeleteTrainingAnnotationButtonProps {
  trainingAnnotationId: string;
}

export function DeleteTrainingAnnotationButton({
  trainingAnnotationId,
}: DeleteTrainingAnnotationButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const onDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteTrainingAnnotationAction(trainingAnnotationId);
      if (!res.ok) {
        setError(
          res.error === 'not_found'
            ? 'Correction introuvable (déjà supprimée ?).'
            : res.error === 'unauthorized'
              ? 'Session expirée.'
              : res.error === 'forbidden'
                ? 'Action refusée.'
                : 'Erreur inattendue.',
        );
      }
      // On success the parent page revalidates via the action.
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control inline-flex h-11 min-w-[44px] items-center gap-1.5 px-3 text-[12px] text-[var(--t-3)] transition-colors hover:bg-[var(--bad-dim)] hover:text-[var(--bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Supprimer
      </button>
    );
  }

  const promptId = `delete-training-annotation-${trainingAnnotationId}-prompt`;

  return (
    <div
      role="alertdialog"
      aria-labelledby={promptId}
      aria-describedby={promptId}
      className="rounded-control flex w-full flex-col gap-2 border border-[oklch(0.7_0.165_22_/_0.30)] bg-[var(--bad-dim)] p-3"
    >
      <p id={promptId} className="t-cap text-[var(--t-2)]">
        Supprimer cette correction définitivement ? Le membre ne la verra plus.
      </p>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-control inline-flex h-11 min-w-[44px] items-center px-3 text-[12px] text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onDelete}
          disabled={pending}
          aria-busy={pending || undefined}
          className="rounded-control inline-flex h-11 items-center gap-1.5 bg-[var(--bad)] px-4 text-[12px] font-semibold text-[var(--acc-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Spinner size={12} /> : null}
          {pending ? 'Suppression…' : 'Confirmer'}
        </button>
      </div>
    </div>
  );
}
