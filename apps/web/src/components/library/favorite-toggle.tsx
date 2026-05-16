'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { toggleFavoriteAction } from '@/app/library/actions';
import { cn } from '@/lib/utils';

interface FavoriteToggleProps {
  cardId: string;
  initialFavorited: boolean;
  /** "icon-only" pour la grid, "labeled" pour le reader. */
  variant?: 'icon-only' | 'labeled';
}

/**
 * Toggle a card favorite (J7 + J7.5 polish premium).
 *
 * Optimistic UI : the heart fills immediately, the Server Action runs in a
 * transition, and we revert on failure.
 *
 * a11y H5 : `role="status"` `aria-live="polite"` sr-only region announces
 * "Ajouté aux favoris" / "Retiré des favoris" so SR users get optimistic
 * feedback (not just `aria-pressed` toggle).
 *
 * J7.5 polish : Framer Motion spring on click ([1, 1.3, 1] burst) + heart
 * fill animation. Respects `prefers-reduced-motion` (skips animation).
 *
 * `aria-pressed` reflects the current state for screen readers (ARIA APG
 * 2026 §toggle-button).
 */
export function FavoriteToggle({
  cardId,
  initialFavorited,
  variant = 'icon-only',
}: FavoriteToggleProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prefersReducedMotion = useReducedMotion();

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

  function onClick() {
    const next = !favorited;
    setFavorited(next); // optimistic
    announceFor(next ? 'Ajouté aux favoris' : 'Retiré des favoris');
    startTransition(async () => {
      const r = await toggleFavoriteAction(cardId);
      if (!r.ok) {
        setFavorited(!next);
        announceFor('Échec, essaie à nouveau');
      } else if (typeof r.favorited === 'boolean') {
        setFavorited(r.favorited);
      }
    });
  }

  const label = favorited ? 'Retirer des favoris' : 'Ajouter aux favoris';

  // Spring burst animation on toggle (skipped when reduced-motion).
  const heartScale = prefersReducedMotion
    ? { scale: 1 }
    : { scale: favorited ? [1, 1.35, 1] : [1, 0.85, 1] };
  const heartTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const };

  if (variant === 'icon-only') {
    return (
      <>
        <span role="status" aria-live="polite" className="sr-only">
          {announce}
        </span>
        <m.button
          type="button"
          onClick={onClick}
          disabled={pending}
          aria-pressed={favorited}
          aria-label={label}
          {...(prefersReducedMotion ? {} : { whileTap: { scale: 0.92 } })}
          className={cn(
            'inline-flex h-11 w-11 items-center justify-center rounded-full',
            'border border-[var(--b-default)] bg-[var(--bg-1)]/60 backdrop-blur',
            'transition-[border-color,box-shadow] duration-200 hover:border-[var(--b-acc)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
            'disabled:opacity-50',
            favorited && 'shadow-[0_0_16px_-2px_var(--acc-glow)]',
          )}
          data-favorited={favorited}
        >
          <m.span
            animate={heartScale}
            transition={heartTransition}
            className="inline-flex"
            aria-hidden
          >
            <Heart
              className={cn(
                'h-4 w-4',
                favorited ? 'fill-[var(--acc)] text-[var(--acc)]' : 'text-[var(--t-3)]',
              )}
              strokeWidth={1.75}
            />
          </m.span>
        </m.button>
      </>
    );
  }

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <m.button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={favorited}
        {...(prefersReducedMotion ? {} : { whileTap: { scale: 0.96 } })}
        className={cn(
          'rounded-pill inline-flex h-11 items-center gap-2 px-4 text-sm font-medium',
          'border transition-[border-color,background-color,box-shadow] duration-200',
          favorited
            ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[0_0_20px_-4px_var(--acc-glow)]'
            : 'border-[var(--b-default)] bg-[var(--bg-1)]/60 text-[var(--t-1)] hover:border-[var(--b-acc)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
          'disabled:opacity-50',
        )}
      >
        <m.span
          animate={heartScale}
          transition={heartTransition}
          className="inline-flex"
          aria-hidden
        >
          <Heart className={cn('h-4 w-4', favorited && 'fill-current')} strokeWidth={1.75} />
        </m.span>
        <span>{favorited ? 'Favori' : 'Ajouter aux favoris'}</span>
      </m.button>
    </>
  );
}
