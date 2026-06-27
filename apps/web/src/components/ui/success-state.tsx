import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SuccessStateProps {
  /** Confirmation courte de ce qui vient d'aboutir ("Trade enregistré"). */
  headline: ReactNode;
  /** Phrase de suivi optionnelle — calme, orientée process, jamais hype. */
  children?: ReactNode;
  /** Icône lucide-react. Défaut `Check`. */
  icon?: LucideIcon;
  /** `inline` (bannière compacte, défaut) ou `block` (plus aéré). */
  size?: 'inline' | 'block';
  className?: string;
}

/**
 * SuccessState — 4e état "vivant" standardisé du design system (S9 §33bis-2),
 * pair de `EmptyState` / `ErrorState` / `Skeleton`. Confirme une action réussie
 * sobrement, là où chaque page recâblait jusqu'ici sa propre bannière (radius,
 * bordure et structure divergeaient entre `track` / `mindset` / `checkin`).
 *
 * `role="status"` ⇒ `aria-live="polite"` + `aria-atomic` implicites (ARIA) : la
 * confirmation est annoncée aux lecteurs d'écran sans voler le focus.
 *
 * Posture Mark Douglas — process > outcome : PAS de confetti, pas de "Bravo !",
 * pas de Black Hat gamification. Une coche calme + le rappel du prochain pas.
 *
 * Tokens canon uniques : `--b-acc` (bordure), `--acc-dim` (fond), `--acc`
 * (coche), `rounded-card`. Framework-neutre (aucun hook, pas de `'use client'`)
 * → utilisable depuis un Server Component (cas `track` / `mindset`) comme depuis
 * un îlot client.
 */
export function SuccessState({
  headline,
  children,
  icon: Icon = Check,
  size = 'inline',
  className,
}: SuccessStateProps) {
  return (
    <div
      role="status"
      data-slot="success-state"
      className={cn(
        'rounded-card border border-[var(--b-acc)] bg-[var(--acc-dim)]',
        size === 'block' ? 'p-4' : 'px-4 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="rounded-control mt-px grid h-6 w-6 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]"
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          {/* `.t-h3` ne bake AUCUNE couleur (unlayered, ≠ `.t-body`/`.t-cap`) →
              `text-[var(--t-1)]` peint réellement. */}
          <p className="t-h3 text-[var(--t-1)]">{headline}</p>
          {children ? (
            /* `.t-body` bake `--t-2` (unlayered) → on aligne explicitement la
               couleur pour éviter un override silencieusement mort. */
            <p className="t-body mt-1 text-[var(--t-2)]">{children}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
