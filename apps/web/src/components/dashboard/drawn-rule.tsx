'use client';

import { m, useReducedMotion } from 'framer-motion';

import { useAfterHydration } from '@/lib/hooks';

/**
 * DrawnRule — DS-v3 (J3) SVG path-draw accent under the masthead.
 *
 * A single luminous rule that draws left-to-right once on mount via
 * Framer Motion `pathLength` (0 → 1). A small filled dot rides the
 * leading edge. Hex stops (not `var()`) keep the gradient stable on
 * iOS WebView (the documented Recharts/SVG quirk).
 *
 * ⚠️ L'ÉTAT FINAL EST LA BASE SSR — ne pas revenir à un `initial` calculé.
 *
 * Ce composant faisait `initial={{ pathLength: prefersReducedMotion ? 1 : 0 }}`.
 * Or `initial` EST sérialisé (`pathLength` devient un `strokeDasharray`), et le
 * serveur ne peut pas connaître la préférence : il écrivait donc l'état NON
 * dessiné pendant que le client en mouvement réduit rendait l'état dessiné.
 * React 19 ne répare pas les attributs — le trait restait donc **invisible**
 * pour exactement les membres qui ont demandé moins d'animation. Diff mesuré le
 * 2026-07-29 sur `/mindset` : `- strokeDasharray="0 1"` / `+ "1 1"`, plus
 * `opacity` et `transform` sur le point.
 *
 * Le rendu de base — serveur, premier rendu client, sans JS, et sous mouvement
 * réduit — est donc le trait COMPLET. Le dessin ne s'arme qu'après hydratation,
 * et seulement si le membre accepte le mouvement. Même patron que
 * `components/ui/sparkline.tsx` (« 'final' = trait complet (SSR + no-JS +
 * reduced) »), déjà éprouvé dans ce dépôt.
 *
 * `tone` defaults to `'blue'` (app-wide :root accent). `tone="cyan"` swaps
 * the gradient + dot to the §21.7 training "Mode entraînement" cyan. The
 * gradient `id` is tone-scoped so a blue and a cyan rule can coexist on the
 * same page without one re-using the other's `<defs>`.
 *
 * Decorative only (`aria-hidden`). Premium-but-professional : a calm
 * one-shot reveal, not a looping flourish.
 */
const DRAW_EASE = [0.22, 1, 0.36, 1] as const;

const TONE_STOPS = {
  blue: { from: '#60a5fa', mid: '#3b82f6', dot: '#60a5fa' },
  cyan: { from: '#67e8f9', mid: '#22d3ee', dot: '#67e8f9' },
} as const;

export function DrawnRule({
  className,
  tone = 'blue',
}: {
  className?: string;
  tone?: 'blue' | 'cyan';
}) {
  const prefersReducedMotion = useReducedMotion();
  // `false` au rendu serveur ET pendant l'hydratation : serveur et client
  // écrivent donc exactement les mêmes attributs. La préférence n'est lue
  // qu'ENSUITE (cf. `useAfterHydration`).
  const drawing = useAfterHydration() && !prefersReducedMotion;

  const stops = TONE_STOPS[tone];
  const gradId = `ds-rule-grad-${tone}`;

  return (
    <svg
      className={className}
      width="100%"
      height="3"
      viewBox="0 0 220 3"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="220" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops.from} />
          <stop offset="0.45" stopColor={stops.mid} />
          <stop offset="1" stopColor={stops.mid} stopOpacity="0" />
        </linearGradient>
      </defs>
      <m.line
        x1="1"
        y1="1.5"
        x2="219"
        y2="1.5"
        stroke={`url(#${gradId})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        // `initial={false}` : aucun état d'entrée n'est sérialisé, Framer peint
        // directement `animate`. Le trait est donc complet au premier rendu,
        // identique serveur/client.
        initial={false}
        animate={drawing ? { pathLength: [0, 1] } : { pathLength: 1 }}
        transition={{ duration: 0.9, ease: DRAW_EASE, delay: 0.1 }}
      />
      <m.circle
        cx="219"
        cy="1.5"
        r="2"
        fill={stops.dot}
        initial={false}
        animate={drawing ? { opacity: [0, 1], scale: [0, 1] } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.9 }}
      />
    </svg>
  );
}
