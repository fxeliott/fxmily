'use client';

import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { deleteCardAction, setPublishedAction } from '@/app/admin/cards/actions';
import { cn } from '@/lib/utils';

interface CardActionsRowProps {
  cardId: string;
  initialPublished: boolean;
  cardTitle: string;
}

/**
 * Inline admin row controls for `/admin/cards`: toggle publish + delete.
 *
 * J7.5 polish :
 *   - Optimistic publish toggle with `aria-live` announcement (a11y H5).
 *   - Double-confirm delete with `aria-live` status when entering confirmation
 *     state (a11y H4 — `setTimeout` cleanup via `useEffect` cleanup so a
 *     unmount during the 4s window doesn't leak setState (CR-#12 fix).
 */
export function CardActionsRow({ cardId, initialPublished, cardTitle }: CardActionsRowProps) {
  const [published, setPublishedState] = useState(initialPublished);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-cancel confirmation after 4s — useEffect ensures cleanup on unmount.
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

  // Cleanup announce timeout on unmount.
  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    // Clear after 1.5s so a re-announce of the same message will fire.
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 1500);
  }

  function togglePublished() {
    const next = !published;
    setPublishedState(next); // optimistic
    announceFor(next ? `Fiche « ${cardTitle} » publiée` : `Fiche « ${cardTitle} » dépubliée`);
    startTransition(async () => {
      const r = await setPublishedAction(cardId, next);
      if (!r.ok) {
        setPublishedState(!next);
        announceFor('Échec, essaie à nouveau');
      }
    });
  }

  function onDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      announceFor(
        `Confirmation requise pour supprimer la fiche « ${cardTitle} ». Clique à nouveau dans 4 secondes.`,
      );
      return;
    }
    startTransition(async () => {
      const r = await deleteCardAction(cardId);
      if (!r.ok) {
        setConfirmingDelete(false);
        announceFor('Échec de la suppression');
      } else {
        announceFor('Fiche supprimée');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {/* Live region for screen readers — announces optimistic state changes. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>

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
