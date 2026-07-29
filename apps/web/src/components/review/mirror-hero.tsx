'use client';

import { m, useReducedMotion } from 'framer-motion';

import { useAfterHydration } from '@/lib/hooks';
import { useIsLightTheme } from '@/lib/use-chart-colors';

/**
 * V1.8 REFLECT — `MirrorHero` SVG illustration.
 *
 * Metaphor : "Le miroir de ton exécution" (M4=C). Two symmetric domes
 * facing a horizontal axis — the intent dome (top, brighter) and the
 * action dome (bottom, dimmer), with concentric pulse rings emanating
 * from the central axis and a single "introspection ray" drawing down
 * through the mirror plane and back up.
 *
 * Anti-pattern guarded against : literal mirror (clichéd, dated). Here
 * the mirror is the *axis itself* — a thin horizontal accent line —
 * with geometric reflection above and below. Glassmorphism light touch.
 *
 * Pure decorative — `aria-hidden="true"`. Animation honours
 * `prefers-reduced-motion` via `useReducedMotion()` (Framer Motion's
 * canonical hook).
 *
 * ViewBox 400×240 keeps the aspect ratio responsive — caller sets the
 * size via Tailwind utility classes (`w-full max-w-md` etc.).
 */
export function MirrorHero({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  // Même patron que `dashboard/drawn-rule.tsx` : `false` au rendu serveur ET
  // pendant l'hydratation, donc les deux côtés écrivent les mêmes attributs ;
  // l'entrée ne s'arme qu'ensuite, et seulement si le membre accepte le
  // mouvement. Un `initial` calculé à partir de `reduceMotion` se sérialise, lui,
  // et désynchronise l'hydratation (mesuré sur `/review` le 2026-07-29).
  const armed = useAfterHydration() && !reduceMotion;
  const isLight = useIsLightTheme();

  // Stagger draw animations across the SVG so the illustration "wakes up"
  // smoothly on first render rather than popping in. Reduced-motion users
  // get the final frame instantly.
  const baseDuration = reduceMotion ? 0.001 : 1.4;

  // S20 — theme-flipped decorative blues. DARK = bright-on-deep-space (original);
  // LIGHT = deepened so the arcs/axis/ray stay visible on the white
  // .light .v18-theme card (the old 0.74-0.82 stops washed to ~1.7-2.3:1). Hex
  // chosen at runtime → WebView-safe (no var() in SVG attr). Cool blue spectrum,
  // decorative aria-hidden (mono-accent untouched).
  const cBright1 = isLight ? 'oklch(0.55 0.2 260)' : 'oklch(0.82 0.115 247)';
  const cBright2 = isLight ? 'oklch(0.46 0.21 262)' : 'oklch(0.62 0.19 254)';
  const cMid = isLight ? 'oklch(0.5 0.2 260)' : 'oklch(0.74 0.16 250)';
  const cDeep = isLight ? 'oklch(0.42 0.21 263)' : 'oklch(0.46 0.21 263)';
  const pulse1 = isLight ? 'oklch(0.46 0.21 262 / 0.55)' : 'oklch(0.62 0.19 254 / 0.55)';
  const pulse2 = isLight ? 'oklch(0.5 0.2 260 / 0.4)' : 'oklch(0.74 0.16 250 / 0.4)';
  const rayStroke = isLight ? 'oklch(0.46 0.21 262 / 0.5)' : 'oklch(0.82 0.115 247 / 0.5)';

  return (
    <svg
      viewBox="0 0 400 240"
      role="img"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="v18-mirror-bright" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cBright1} stopOpacity="0.95" />
          <stop offset="100%" stopColor={cBright2} stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="v18-mirror-dim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cBright2} stopOpacity="0.55" />
          <stop offset="100%" stopColor={cDeep} stopOpacity="0.18" />
        </linearGradient>
        <radialGradient id="v18-mirror-center" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={cBright1} stopOpacity="0.85" />
          <stop offset="60%" stopColor={cBright2} stopOpacity="0.3" />
          <stop offset="100%" stopColor={cDeep} stopOpacity="0" />
        </radialGradient>
        <filter id="v18-mirror-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>

      {/* Center halo — radial glow behind the mirror plane */}
      <m.circle
        cx="200"
        cy="120"
        r="100"
        fill="url(#v18-mirror-center)"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: baseDuration, ease: 'easeOut' }}
      />

      {/* Intent dome (TOP — brighter, future-tense) */}
      <m.path
        d="M 100 120 A 100 100 0 0 1 300 120"
        fill="none"
        stroke="url(#v18-mirror-bright)"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: baseDuration, ease: 'easeInOut', delay: 0.1 }}
      />
      <m.path
        d="M 130 120 A 70 70 0 0 1 270 120"
        fill="none"
        stroke={cMid}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
        opacity="0.6"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: baseDuration, ease: 'easeInOut', delay: 0.4 }}
      />

      {/* Action dome (BOTTOM — dimmer, past-tense reflection) */}
      <m.path
        d="M 100 120 A 100 100 0 0 0 300 120"
        fill="none"
        stroke="url(#v18-mirror-dim)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: baseDuration, ease: 'easeInOut', delay: 0.25 }}
      />
      <m.path
        d="M 130 120 A 70 70 0 0 0 270 120"
        fill="none"
        stroke={cBright2}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="1 3"
        opacity="0.4"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: baseDuration, ease: 'easeInOut', delay: 0.55 }}
      />

      {/* Mirror axis — the horizontal accent line ("the plane of reflection") */}
      <m.line
        x1="40"
        y1="120"
        x2="360"
        y2="120"
        stroke={cMid}
        strokeWidth="1.5"
        strokeLinecap="round"
        filter="url(#v18-mirror-soft)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.85 }}
        transition={{ duration: baseDuration * 0.8, ease: 'easeOut' }}
      />

      {/* Center accent point — the introspection focal */}
      <m.circle
        cx="200"
        cy="120"
        r="4"
        // S19 — token (was fixed light blue → faint on white in light); --acc-hi
        // flips to a darker blue in light, staying the bright focal in dark.
        fill="var(--acc-hi)"
        initial={false}
        animate={armed ? { scale: [0, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 0.8, ease: 'backOut' }}
      />
      {/* Pulse ring around center — emits continuously (low cadence, anti-spam).
          ⚠️ RENDU INCONDITIONNELLEMENT, et c'est le correctif. Ces deux cercles
          étaient montés derrière `{!reduceMotion && …}` : une branche de FORME
          d'arbre sur une valeur que seul le client connaît. Le serveur les
          rendait (la préférence y vaut `null`), un membre en mouvement réduit
          ne les rendait pas → « Hydration failed because the server rendered
          HTML didn't match the client. As a result this tree will be
          regenerated on the client. » React jetait tout le sous-arbre.
          La réduction est déjà assurée par le CSS : `.v18-mirror-pulse` passe
          sous le filet global `prefers-reduced-motion` de `globals.css`. */}
      <circle
        cx="200"
        cy="120"
        r="6"
        fill="none"
        stroke={pulse1}
        strokeWidth="1"
        className="v18-mirror-pulse"
      />
      <circle
        cx="200"
        cy="120"
        r="6"
        fill="none"
        stroke={pulse2}
        strokeWidth="1"
        className="v18-mirror-pulse"
        style={{ animationDelay: '1.8s' }}
      />

      {/* Floating moment-dots along the axis (members' weekly moments) */}
      {[80, 130, 270, 320].map((cx, i) => (
        <m.circle
          key={cx}
          cx={cx}
          cy="120"
          r="2"
          // S19 — token (was fixed light gray → invisible on white in light);
          // --t-3 flips dark on light canvas, light on dark.
          fill="var(--t-3)"
          initial={false}
          animate={armed ? { opacity: [0, 0.75] } : { opacity: 0.75 }}
          transition={{ duration: 0.6, delay: 1 + i * 0.12 }}
        />
      ))}

      {/* Subtle drop-down ray from intent → mirror (introspective gesture) */}
      <m.line
        x1="200"
        y1="60"
        x2="200"
        y2="120"
        stroke={rayStroke}
        strokeWidth="1"
        strokeDasharray="2 3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: baseDuration, delay: 1, ease: 'easeOut' }}
      />
    </svg>
  );
}
