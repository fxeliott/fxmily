'use client';

import { Check, EyeOff } from 'lucide-react';
import { useState, useTransition } from 'react';

import { dismissDeliveryAction, markDeliverySeenAction } from '@/app/library/actions';
import { cn } from '@/lib/utils';

interface DeliveryItemActionsProps {
  deliveryId: string;
}

/**
 * Gestion d'une fiche reçue NON lue dans /library/inbox (f1).
 *
 * Deux contrôles SECONDAIRES, posés HORS du <Link> overlay de la carte pour
 * ne pas voler le clic d'ouverture :
 *   - « Marquer comme lue » → markDeliverySeenAction (la carte sort de la
 *     section « Non lues » au prochain rendu serveur revalidé).
 *   - « Masquer » → dismissDeliveryAction (retire la fiche du flux).
 *
 * UI optimiste (même pattern que FavoriteToggle) : on masque la rangée
 * immédiatement via `useState`, la Server Action tourne dans une `useTransition`,
 * on restaure la rangée en cas d'échec. `role="status"` `aria-live="polite"`
 * sr-only annonce le résultat aux lecteurs d'écran.
 */
export function DeliveryItemActions({ deliveryId }: DeliveryItemActionsProps) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');

  function run(
    action: (id: string) => Promise<{ ok: boolean }>,
    optimisticMsg: string,
    failMsg: string,
  ) {
    setHidden(true); // optimistic
    setAnnounce(optimisticMsg);
    startTransition(async () => {
      const r = await action(deliveryId);
      if (!r.ok) {
        setHidden(false);
        setAnnounce(failMsg);
      }
    });
  }

  if (hidden) {
    return (
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    );
  }

  const baseBtn =
    'rounded-pill inline-flex h-9 items-center gap-1.5 border px-3 text-xs font-medium ' +
    'transition-[border-color,background-color,color,transform] duration-200 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="relative z-10 flex items-center gap-2">
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(markDeliverySeenAction, 'Marquée comme lue', 'Échec, essaie à nouveau')}
        className={cn(
          baseBtn,
          'border-[var(--b-strong)] bg-transparent text-[var(--t-1)] hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] hover:text-[var(--acc-hi)]',
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        <span>Marquer comme lue</span>
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(dismissDeliveryAction, 'Fiche masquée', 'Échec, essaie à nouveau')}
        aria-label="Masquer cette fiche"
        className={cn(
          baseBtn,
          'border-transparent bg-transparent text-[var(--t-3)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]',
        )}
      >
        <EyeOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        <span>Masquer</span>
      </button>
    </div>
  );
}
