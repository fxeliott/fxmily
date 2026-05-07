'use client';

import { Heart } from 'lucide-react';
import { useState, useTransition } from 'react';

import { toggleFavoriteAction } from '@/app/library/actions';
import { cn } from '@/lib/utils';

interface FavoriteToggleProps {
  cardId: string;
  initialFavorited: boolean;
  /** "icon-only" pour la grid, "labeled" pour le reader. */
  variant?: 'icon-only' | 'labeled';
}

/**
 * Toggle a card favorite. Optimistic UI: the heart fills immediately, the
 * Server Action runs in a transition, and we revert on failure.
 *
 * `aria-pressed` reflects the current state for screen readers (toggle button
 * pattern, ARIA APG 2026 §toggle-button).
 */
export function FavoriteToggle({
  cardId,
  initialFavorited,
  variant = 'icon-only',
}: FavoriteToggleProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  function onClick() {
    const next = !favorited;
    setFavorited(next); // optimistic
    startTransition(async () => {
      const r = await toggleFavoriteAction(cardId);
      if (!r.ok) {
        // revert on failure
        setFavorited(!next);
      } else if (typeof r.favorited === 'boolean') {
        setFavorited(r.favorited);
      }
    });
  }

  const label = favorited ? 'Retirer des favoris' : 'Ajouter aux favoris';

  if (variant === 'icon-only') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={favorited}
        aria-label={label}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-full',
          'border-border bg-background/60 border backdrop-blur',
          'hover:border-acc/40 transition-all hover:scale-110',
          'focus-visible:outline-acc focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'disabled:opacity-50',
        )}
        data-favorited={favorited}
      >
        <Heart
          className={cn('h-4 w-4 transition-all', favorited ? 'fill-acc text-acc' : 'text-muted')}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={favorited}
      className={cn(
        'rounded-pill inline-flex h-11 items-center gap-2 px-4 text-sm font-medium',
        'border transition-all',
        favorited
          ? 'border-acc/40 bg-acc/10 text-acc'
          : 'border-border bg-background/60 text-foreground hover:border-acc/40',
        'focus-visible:outline-acc focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:opacity-50',
      )}
    >
      <Heart className={cn('h-4 w-4', favorited && 'fill-current')} />
      <span>{favorited ? 'Favori' : 'Ajouter aux favoris'}</span>
    </button>
  );
}
