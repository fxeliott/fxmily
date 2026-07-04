'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useReducedMotion } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  /** Data points (any numeric range — auto-normalized). */
  data: number[];
  /** Width in CSS pixels. Default 140. */
  width?: number;
  /** Height in CSS pixels. Default 36. */
  height?: number;
  /** Stroke color (token or CSS color). Default `var(--acc)`. */
  color?: string;
  /** Stroke width. Default 1.5. */
  strokeWidth?: number;
  /** Adds gradient area fill below the line. */
  fill?: boolean;
  /** Adds a dot marker on the last point (after draw animation). */
  showLastDot?: boolean;
  /** Whether to play the draw animation. Default true. */
  animate?: boolean;
  /** Animation duration in ms. Default 1400. */
  duration?: number;
  className?: string;
  /** Optional ARIA label for screen readers (chart description). */
  ariaLabel?: string;
}

/**
 * Sparkline — micro-chart SVG inline. Custom impl, zéro dépendance
 * (Tremor sera ajouté à J6 pour les vrais graphes analytics).
 *
 * Tour 12 (C) — « data-viz vivante » : le tracé se DESSINE quand il entre dans
 * le viewport (IntersectionObserver, une fois), pas au simple mount ; le point
 * terminal PULSE doucement en continu (livePulse) au lieu d'un fade unique ;
 * le fill dégradé reste optionnel.
 *
 * SSR-safe (leçon reduced-motion-hydration, PR #457) : un SEUL arbre JSX, la
 * réduction et l'état de dessin vivent dans les STYLES, jamais dans la structure.
 * Le trait est rendu à son ÉTAT FINAL (offset 0) côté serveur ET au 1er render
 * client (aucun flash, visible sans JS) ; un `useEffect` « arme » ensuite le
 * dessin (reset à 2000 puis draw vers 0 à l'entrée du viewport). `suppressHydration
 * Warning` absorbe la brève divergence de style au démarrage du draw. Sous
 * `prefers-reduced-motion`, on ne réarme jamais : le trait reste dessiné, immobile.
 */
export function Sparkline({
  data,
  width = 140,
  height = 36,
  color = 'var(--acc)',
  strokeWidth = 1.5,
  fill = false,
  showLastDot = false,
  animate = true,
  duration = 1400,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradId = useId();
  const reduced = useReducedMotion();
  const shouldDraw = animate && !reduced;

  const svgRef = useRef<SVGSVGElement>(null);
  // Draw phase: 'final' = trait complet (SSR + no-JS + reduced), 'pending' =
  // armé mais pas encore visible (offset plein), 'drawing' = transition en cours.
  const [phase, setPhase] = useState<'final' | 'pending' | 'drawing'>('final');

  const { d, dFill, lastPoint } = useMemo(() => {
    if (data.length < 2) {
      return { d: '', dFill: '', lastPoint: null };
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const points = data.map<[number, number]>((v, i) => [
      (i / (data.length - 1)) * width,
      height - ((v - min) / range) * (height - pad * 2) - pad,
    ]);
    const path = points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    const fillPath = `${path} L${width} ${height} L0 ${height} Z`;
    return { d: path, dFill: fillPath, lastPoint: points[points.length - 1] ?? null };
  }, [data, width, height]);

  // Arme le dessin à l'entrée du viewport (une seule fois). On part de l'état
  // final (rendu SSR), on masque le trait (phase 'pending' = offset plein), puis
  // on lance la transition vers 0 quand l'élément est visible.
  useEffect(() => {
    if (!shouldDraw) return;
    const node = svgRef.current;
    if (!node) return;

    // Reset immédiat à l'état masqué (un seul frame invisible max, jamais servi
    // au SSR ni sans JS).
    setPhase('pending');

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // rAF pour garantir que 'pending' (offset plein, sans transition) est
          // peint avant de basculer sur 'drawing' (transition vers 0).
          requestAnimationFrame(() => setPhase('drawing'));
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [shouldDraw]);

  if (data.length < 2) return null;

  // offset : 0 = dessiné, 2000 = masqué. La transition n'est active qu'en phase
  // 'drawing'. Reduced / no-JS restent en 'final' → trait visible immobile.
  const drawOffset = phase === 'pending' ? 2000 : 0;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn('block overflow-visible', className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={dFill} fill={`url(#${gradId})`} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        suppressHydrationWarning
        style={{
          strokeDasharray: 2000,
          strokeDashoffset: drawOffset,
          transition:
            phase === 'drawing'
              ? `stroke-dashoffset ${duration}ms cubic-bezier(0.4,0,0.2,1)`
              : undefined,
        }}
      />
      {showLastDot && lastPoint && (
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r="2.5"
          fill={color}
          suppressHydrationWarning
          style={{
            // Terminal pulse (livePulse) — un point vivant, pas un simple fade.
            // Immobile et visible sous reduced-motion / no-JS.
            transformOrigin: `${lastPoint[0]}px ${lastPoint[1]}px`,
            animation: reduced
              ? undefined
              : `sparkDotPulse 2.4s cubic-bezier(0.4,0,0.2,1) infinite`,
          }}
        />
      )}
      {/* Terminal-dot pulse keyframe. Les boucles reduced-motion sont neutralisées
          par le filet global (globals.css ~1705 : iteration-count 1) + la garde
          `reduced ? undefined` au call-site : point figé visible, jamais clignotant. */}
      <style>{`@keyframes sparkDotPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </svg>
  );
}
