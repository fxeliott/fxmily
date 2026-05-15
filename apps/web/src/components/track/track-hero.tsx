'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Coffee, Dumbbell, Moon, UtensilsCrossed } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import type { HabitKind } from '@/lib/schemas/habit-log';

/**
 * V2.1 TRACK — Hero illustration "5 piliers de pratique sous le miroir".
 *
 * Métaphore : extension du `<MirrorHero>` V1.8 (M4 tranché). Le miroir
 * reflète l'exécution ; les 5 piliers (sommeil, nutrition, café, sport,
 * méditation) sont les conditions BIOLOGIQUES qui alimentent l'exécution.
 * Cohérent avec V2-MASTER §A.2 TRACK "contexte de vie élargi".
 *
 * Design canon (subagent V2.1 research) :
 *   - SVG inline > Lottie (bundle, indexable, GPU-cheap, Framer-friendly)
 *   - Lime accent DS-v2 + deep-space gradient (PAS V18 blue/black overlay,
 *     TRACK reste aligné app principale lime/discipline forte)
 *   - Pentagon layout : center node + 5 nodes radial, angles
 *     -90/-18/54/126/198 (perfect pentagon clockwise from top)
 *   - Path animations Framer Motion `pathLength` 0→1 stagger entrance
 *   - `useReducedMotion()` SSR-safe via `useEffect(setHasMounted)` —
 *     skip animation if user prefers reduced motion (WCAG 2.3.3)
 *
 * NO Black Hat gamification :
 *   - Pas de "X/5 piliers complétés aujourd'hui" counter visible ici
 *   - Pas de couleur rouge sur les piliers non-logués (calm slate)
 *   - Les états logged vs pending sont indiqués subtilement (opacité +
 *     halo lime sur logged) sans signal de manque
 */

const VIEWBOX_SIZE = 400;
const CENTER = VIEWBOX_SIZE / 2; // 200
const RADIUS = 130;
const NODE_RADIUS = 30;
const CENTER_RADIUS = 36;

interface Pillar {
  kind: HabitKind;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  angleDeg: number; // 0 = right, 90 = down (SVG y-axis convention)
}

// Pentagon clockwise from top : sleep (top) → nutrition (upper-right) →
// caffeine (lower-right) → sport (lower-left) → meditation (upper-left).
// Angles in SVG convention : -90 = up, 0 = right, 90 = down, 180 = left.
const PILLARS: Pillar[] = [
  { kind: 'sleep', label: 'Sommeil', Icon: Moon, angleDeg: -90 },
  { kind: 'nutrition', label: 'Nutrition', Icon: UtensilsCrossed, angleDeg: -18 },
  { kind: 'caffeine', label: 'Café', Icon: Coffee, angleDeg: 54 },
  { kind: 'sport', label: 'Sport', Icon: Dumbbell, angleDeg: 126 },
  { kind: 'meditation', label: 'Méditation', Icon: Brain, angleDeg: 198 },
];

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

export interface TrackHeroProps {
  /** Set of habit kinds logged today — drives the "completed" halo style. */
  loggedToday?: ReadonlySet<HabitKind>;
}

export function TrackHero({ loggedToday }: TrackHeroProps) {
  const prefersReducedMotion = useReducedMotion();
  const animate = !prefersReducedMotion;

  return (
    <div className="relative mx-auto w-full max-w-xl" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        className="h-auto w-full"
        role="img"
        aria-label="Cinq piliers de pratique en cercle autour du centre."
      >
        <defs>
          {/* Radial glow gradient for the center node — lime → transparent. */}
          <radialGradient id="track-center-glow" cx="50%" cy="50%" r="50%">
            <stop
              offset="0%"
              stopColor="var(--acc-glow, oklch(0.84 0.18 130))"
              stopOpacity="0.45"
            />
            <stop offset="60%" stopColor="var(--acc)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
          </radialGradient>

          {/* Soft inner shadow on nodes for premium depth. */}
          <filter id="track-node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="2" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.4" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Center halo + node */}
        <motion.circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS - 10}
          fill="url(#track-center-glow)"
          initial={animate ? { scale: 0.7, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Connecting paths — drawn from center to each pillar node */}
        {PILLARS.map((p, i) => {
          const end = polar(p.angleDeg, RADIUS - NODE_RADIUS - 6);
          const start = polar(p.angleDeg, CENTER_RADIUS + 4);
          return (
            <motion.line
              key={`line-${p.kind}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="var(--b-acc)"
              strokeWidth={1.5}
              strokeDasharray="4 6"
              initial={animate ? { pathLength: 0, opacity: 0 } : false}
              animate={{ pathLength: 1, opacity: 0.6 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.08, ease: 'easeOut' }}
            />
          );
        })}

        {/* Center node */}
        <motion.circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER_RADIUS}
          fill="var(--bg-2)"
          stroke="var(--acc)"
          strokeWidth={2}
          filter="url(#track-node-shadow)"
          initial={animate ? { scale: 0, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        />
        <text
          x={CENTER}
          y={CENTER + 5}
          textAnchor="middle"
          className="fill-[var(--acc)] font-mono"
          fontSize="14"
          fontWeight="600"
          letterSpacing="0.1em"
        >
          TOI
        </text>

        {/* Pillar nodes */}
        {PILLARS.map((p, i) => {
          const pos = polar(p.angleDeg, RADIUS);
          const logged = loggedToday?.has(p.kind) ?? false;
          // Position label outward from the node along the radial direction.
          const labelOffsetR = NODE_RADIUS + 18;
          const labelPos = polar(p.angleDeg, RADIUS + labelOffsetR - NODE_RADIUS);
          return (
            <motion.g
              key={`pillar-${p.kind}`}
              initial={animate ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                duration: 0.5,
                delay: 0.4 + i * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {/* Logged halo (subtle lime glow) — only when habit is logged today */}
              {logged ? (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_RADIUS + 6}
                  fill="none"
                  stroke="var(--acc)"
                  strokeWidth={1.5}
                  opacity={0.4}
                />
              ) : null}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_RADIUS}
                fill="var(--bg-2)"
                stroke={logged ? 'var(--acc)' : 'var(--b-default)'}
                strokeWidth={logged ? 2 : 1.5}
                filter="url(#track-node-shadow)"
              />
              {/* Icon centered in the node. lucide icons are 24x24 by default. */}
              <foreignObject
                x={pos.x - 12}
                y={pos.y - 12}
                width={24}
                height={24}
                style={{ pointerEvents: 'none' }}
              >
                <p.Icon
                  width={24}
                  height={24}
                  style={{
                    color: logged ? 'var(--acc)' : 'var(--t-2)',
                  }}
                />
              </foreignObject>
              {/* Label — positioned radially outward from the node */}
              <text
                x={labelPos.x}
                y={labelPos.y + 4}
                textAnchor="middle"
                className="fill-[var(--t-2)]"
                fontSize="12"
                fontWeight="500"
              >
                {p.label}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
