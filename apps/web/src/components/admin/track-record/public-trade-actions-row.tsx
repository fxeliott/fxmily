'use client';

import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { deletePublicTradeAction, setPublishedAction } from '@/app/admin/track-record/actions';
import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

interface PublicTradeActionsRowProps {
  publicTradeId: string;
  initialPublished: boolean;
  ordinal: number;
  instrument: string;
}

/**
 * Inline admin row controls pour `/admin/track-record` — pattern carbone J7
 * `<CardActionsRow>` (J7.5 polish hardening) :
 *   - Optimistic publish toggle avec `aria-live` announcement.
 *   - Double-confirm delete (4s window) avec `aria-live` au confirmation state.
 *   - `useEffect`/`useRef` cleanup pour les timeouts (anti setState-on-unmount).
 *   - Touch targets ≥44×44 (WCAG 2.5.5 AAA J7 audit B6).
 *
 * Le lien Edit utilise `<Link>` + `btnVariants` ghost (pattern WCAG B2 J10).
 */
export function PublicTradeActionsRow({
  publicTradeId,
  initialPublished,
  ordinal,
  instrument,
}: PublicTradeActionsRowProps) {
  const [published, setPublishedState] = useState(initialPublished);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const label = `#${ordinal} ${instrument}`;

  // Auto-cancel confirmation après 4 s.
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

  // Cleanup announce timeout au unmount.
  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 1500);
  }

  function togglePublished() {
    const next = !published;
    setPublishedState(next);
    announceFor(next ? `Trade ${label} publié` : `Trade ${label} dépublié`);
    startTransition(async () => {
      const r = await setPublishedAction(publicTradeId, next);
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
        `Confirmation requise pour supprimer le trade ${label}. Clique à nouveau dans 4 secondes.`,
      );
      return;
    }
    startTransition(async () => {
      const r = await deletePublicTradeAction(publicTradeId);
      if (!r.ok) {
        setConfirmingDelete(false);
        announceFor('Échec de la suppression');
      } else {
        announceFor('Trade supprimé');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>

      <Link
        href={`/admin/track-record/${publicTradeId}/edit`}
        aria-label={`Modifier le trade ${label}`}
        className={cn(btnVariants({ kind: 'ghost', size: 's' }), 'gap-1.5')}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
        <span>Modifier</span>
      </Link>

      <button
        type="button"
        onClick={togglePublished}
        disabled={pending}
        aria-pressed={published}
        title={published ? 'Dépublier' : 'Publier'}
        className={cn(
          'rounded-pill inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all',
          published
            ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
            : 'border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
          'disabled:opacity-50',
        )}
      >
        {published ? (
          <Eye className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
        ) : (
          <EyeOff className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
        )}
        <span>{published ? 'Publié' : 'Brouillon'}</span>
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Supprimer le trade ${label}`}
        className={cn(
          'rounded-pill inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all',
          confirmingDelete
            ? 'border-[var(--bad)] bg-[var(--bad-dim)] text-[var(--bad)]'
            : 'border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)] hover:border-[oklch(0.7_0.165_22_/_0.35)] hover:text-[var(--bad)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bad)]',
          'disabled:opacity-50',
        )}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
        <span>{confirmingDelete ? 'Confirmer ?' : 'Supprimer'}</span>
      </button>
    </div>
  );
}
