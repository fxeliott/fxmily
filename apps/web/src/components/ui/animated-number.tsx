'use client';

import { animate, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * AnimatedNumber — DS-v3 count-up metric primitive.
 *
 * Renders a single `<span>` whose text content tweens from 0 → `value`
 * the first time it scrolls into view, giving KPI/stat surfaces a calm
 * "tallying up" reveal. Built for stat dashboards (track record, scoring,
 * objectives) where a static number lands flat.
 *
 * --- Rationale -------------------------------------------------------------
 * The count-up is driven imperatively by framer-motion's `animate()` and the
 * per-frame value is written straight into the DOM via `ref.textContent`.
 * This means ZERO React re-renders per frame — the component renders once,
 * then the browser compositor + a single text mutation carry the animation.
 * Writing `textContent` (not innerHTML) keeps it XSS-safe and layout-cheap.
 *
 * --- Invariants ------------------------------------------------------------
 * 1. SSR-correct & no flash: the server-rendered span already holds the FINAL
 *    `format(value)`. Users without JS, or with reduced-motion, see the true
 *    number immediately — never a flash of "0". `suppressHydrationWarning`
 *    absorbs the brief client divergence when the tween restarts from 0.
 * 2. Runs at most once (`useInView({ once: true })` + a `hasRun` ref guard),
 *    so re-entering the viewport never re-triggers the count-up.
 * 3. `useReducedMotion()` short-circuits ALL animation (WCAG 2.3.3): the
 *    final value stays put, nothing moves.
 * 4. `tabular-nums` pins glyph width so digits don't jitter sideways while
 *    the number changes — the span keeps a steady footprint.
 * 5. The visible text IS the accessible value (no `aria-label` needed); the
 *    span stays in the accessibility tree (no `aria-hidden`).
 */

const DEFAULT_FORMAT = (v: number): string => Math.round(v).toLocaleString('fr-FR');

/** Standard "ease-in-out" cubic-bezier (matches the DS motion curve). */
const EASE = [0.4, 0, 0.2, 1] as const;

export interface AnimatedNumberProps {
  value: number;
  /**
   * Formatteur fonction. Défaut: Math.round(v).toLocaleString('fr-FR').
   * ⚠️ Une fonction NE PEUT PAS franchir la frontière Server→Client Component
   * (Next.js RSC lève "Functions cannot be passed to Client Components"). Depuis
   * un Server Component, n'utilise PAS `format` : passe `decimals`/`prefix`/`suffix`
   * (sérialisables) ci-dessous — AnimatedNumber construit le formatteur côté client.
   */
  format?: ((v: number) => string) | undefined;
  /** Alt SÉRIALISABLE à `format` (server-safe) : nb de décimales fr-FR. Ignoré si `format` est fourni. */
  decimals?: number | undefined;
  /** Préfixe sérialisable (ex. ''). Ignoré si `format` est fourni. */
  prefix?: string | undefined;
  /** Suffixe sérialisable (ex. ' €', ' %'). Ignoré si `format` est fourni. */
  suffix?: string | undefined;
  className?: string;
  /** Durée du count-up en ms. Défaut 900. */
  durationMs?: number;
  /** Démarre quand l'élément entre dans le viewport (une seule fois). Défaut true. */
  startOnView?: boolean;
}

export function AnimatedNumber({
  value,
  format,
  decimals,
  prefix,
  suffix,
  className,
  durationMs = 900,
  startOnView = true,
}: AnimatedNumberProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const hasRun = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const isInView = useInView(ref, { once: true, amount: 0.4 });

  // Formatteur effectif. `format` (fonction) prime — mais ne peut venir que d'un
  // Client Component. Sinon on dérive un formatteur SÉRIALISABLE à partir de
  // decimals/prefix/suffix (le cas server-safe), avec fallback fr-FR entier.
  const fmt = useMemo<(v: number) => string>(() => {
    if (format) return format;
    if (decimals !== undefined || prefix !== undefined || suffix !== undefined) {
      const d = decimals ?? 0;
      return (v: number) =>
        `${prefix ?? ''}${v.toLocaleString('fr-FR', {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        })}${suffix ?? ''}`;
    }
    return DEFAULT_FORMAT;
  }, [format, decimals, prefix, suffix]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion) return;
    if (!startOnView) return;
    if (!isInView) return;
    if (hasRun.current) return;

    hasRun.current = true;

    const controls = animate(0, value, {
      duration: durationMs / 1000,
      ease: EASE,
      onUpdate: (latest) => {
        node.textContent = fmt(latest);
      },
    });

    return () => controls.stop();
  }, [isInView, value, fmt, durationMs, prefersReducedMotion, startOnView]);

  return (
    <span ref={ref} suppressHydrationWarning className={cn('tabular-nums', className)}>
      {fmt(value)}
    </span>
  );
}
