'use client';

import { useId, useMemo } from 'react';

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
 * Le `draw` est animé via stroke-dasharray locked sync count-up
 * (cf. globals.css `.spark-draw-1400`). Honore prefers-reduced-motion.
 *
 * Usage typical : KPI cell strip (140×20), hero splash bento (300×36),
 * R cumulé chart (720×88).
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

  if (data.length < 2) return null;

  return (
    <svg
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
        style={{
          strokeDasharray: 2000,
          strokeDashoffset: shouldDraw ? 0 : reduced ? 0 : 2000,
          transition: shouldDraw
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
          style={{
            opacity: reduced ? 1 : 0,
            animation: reduced ? undefined : `sparkDot 200ms ${duration - 100}ms forwards`,
          }}
        />
      )}
      <style>{`@keyframes sparkDot { to { opacity: 1 } }`}</style>
    </svg>
  );
}
