'use client';

import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { deleteCardAction, setPublishedAction } from '@/app/admin/cards/actions';
import { cn } from '@/lib/utils';

interface CardActionsRowProps {
  cardId: string;
  initialPublished: boolean;
  cardTitle: string;
}

/**
 * Inline admin row controls for `/admin/cards`: toggle publish + delete.
 * Optimistic UI for publish; double-confirm for delete.
 */
export function CardActionsRow({ cardId, initialPublished, cardTitle }: CardActionsRowProps) {
  const [published, setPublishedState] = useState(initialPublished);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function togglePublished() {
    const next = !published;
    setPublishedState(next); // optimistic
    startTransition(async () => {
      const r = await setPublishedAction(cardId, next);
      if (!r.ok) setPublishedState(!next);
    });
  }

  function onDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      // Auto-cancel confirmation after 4 seconds.
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    startTransition(async () => {
      const r = await deleteCardAction(cardId);
      if (!r.ok) {
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={togglePublished}
        disabled={pending}
        aria-pressed={published}
        title={published ? 'Dépublier' : 'Publier'}
        className={cn(
          'rounded-pill inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all',
          published
            ? 'border-acc/40 bg-acc/15 text-acc'
            : 'border-border bg-bg-1 text-muted hover:border-acc/40 hover:text-foreground',
          'focus-visible:outline-acc focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'disabled:opacity-50',
        )}
      >
        {published ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        <span>{published ? 'Publié' : 'Brouillon'}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Supprimer la fiche « ${cardTitle} »`}
        className={cn(
          'rounded-pill inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all',
          confirmingDelete
            ? 'border-bad bg-bad/15 text-bad'
            : 'border-border bg-bg-1 text-muted hover:border-bad/40 hover:text-bad',
          'focus-visible:outline-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'disabled:opacity-50',
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>{confirmingDelete ? 'Confirmer ?' : 'Supprimer'}</span>
      </button>
    </div>
  );
}
