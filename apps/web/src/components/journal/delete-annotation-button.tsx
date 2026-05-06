'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Spinner } from '@/components/spinner';
import { deleteAnnotationAction } from '@/app/admin/members/[id]/trades/[tradeId]/actions';

/**
 * Delete-annotation CTA (J4).
 *
 * Two-step confirm UX (idle → confirming → pending) — same pattern as
 * `<DeleteTradeButton />`. Only ever rendered when the current user
 * authored the annotation; the Server Action enforces the same constraint
 * via `deleteMany({ where: { id, adminId } })` server-side.
 */

interface DeleteAnnotationButtonProps {
  annotationId: string;
}

export function DeleteAnnotationButton({ annotationId }: DeleteAnnotationButtonProps) {
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
      const res = await deleteAnnotationAction(annotationId);
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
      // On success the parent page revalidates via the action; nothing more
      // to do client-side.
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control inline-flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--t-3)] transition-colors hover:bg-[var(--bad-dim)] hover:text-[var(--bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <Trash2 className="h-3 w-3" strokeWidth={1.75} />
        Supprimer
      </button>
    );
  }

  return (
    <div className="rounded-control flex w-full flex-col gap-2 border border-[oklch(0.7_0.165_22_/_0.30)] bg-[var(--bad-dim)] p-2.5">
      <p className="t-cap text-[var(--t-2)]">
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
          className="rounded-control inline-flex h-8 items-center px-2.5 text-[11px] text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded-control inline-flex h-8 items-center gap-1.5 bg-[var(--bad)] px-3 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Spinner size={12} /> : null}
          {pending ? 'Suppression…' : 'Confirmer'}
        </button>
      </div>
    </div>
  );
}
