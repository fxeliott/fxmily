'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { Spinner } from '@/components/spinner';
import { deleteTradeAction } from '@/app/journal/actions';

interface DeleteTradeButtonProps {
  tradeId: string;
}

export function DeleteTradeButton({ tradeId }: DeleteTradeButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus into the confirmation block so keyboard / SR users notice it.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const onDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteTradeAction(tradeId);
      if (!res.ok) {
        setError(
          res.error === 'not_found'
            ? 'Trade introuvable.'
            : res.error === 'unauthorized'
              ? 'Session expirée.'
              : 'Erreur inattendue.',
        );
      }
      // On success, the action redirects via Next so we never reach here.
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-muted hover:text-danger focus-visible:outline-accent rounded text-xs underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Supprimer ce trade
      </button>
    );
  }

  return (
    <div className="border-danger/30 bg-danger/5 flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-foreground text-sm">
        Supprimer ce trade définitivement ? Cette action ne peut pas être annulée.
      </p>
      {error ? (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={confirmRef}
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="bg-danger focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Spinner size={14} /> <span>Suppression…</span>
            </>
          ) : (
            <span>Confirmer la suppression</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-foreground hover:border-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-3 py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
