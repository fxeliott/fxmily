'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Coffee, Dumbbell, Moon, UtensilsCrossed } from 'lucide-react';
import type { ComponentType, CSSProperties, SVGProps } from 'react';

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
 *   - Pentagon layout : center node + 5 nodes radial
 *   - Entrance : Framer Motion `pathLength`/scale stagger — FINITE
 *     (≤ 0.8 s, no `repeat`), gated by `animate` (= !reduceMotion)
 *
 * V2.1.5 premium enrich (ambient layer) :
 *   - Center pulse : 2 expanding rings (double-guarded like
 *     `mirror-hero.tsx` — `{!reduceMotion ? … : null}` JS conditional
 *     PLUS the CSS class `.track-pulse-ring`)
 *   - Concentric echo rings (`.track-echo-ring`) + a 10-particle drift
 *     field (`.track-particle`, deterministic positions, no Math.random
 *     at render → SSR-safe)
 *
 * Reduced-motion correctness (V2.1.5 code-review TIER 2 fix) : the
 * infinite ambient loops are **CSS-class driven**, NOT framer
 * `repeat: Infinity`. Framer's WAAPI/inline-style animations are NOT
 * neutralised by the global `@media (prefers-reduced-motion: reduce)`
 * filet (globals.css) — only CSS `animation`/`transition` are. So the
 * ambient uses `.track-*` classes which that filet genuinely kills →
 * reduced-motion users get the crisp static composition (faint static
 * echo rings + static particles, no pulse). This is the proven
 * `mirror-hero` `.v18-mirror-pulse` pattern. The `useReducedMotion()`
 * JS gate is kept as a second guard on the pulse rings (defense in
 * depth, robust even if the hook value is SSR-frozen).
 *
 * NO Black Hat gamification :
 *   - Pas de "X/5 piliers complétés aujourd'hui" counter visible ici
 *   - Pas de couleur rouge sur les piliers non-logués (calm slate)
 *   - États logged vs pending indiqués subtilement (opacité + halo
 *     lime sur logged) sans signal de manque
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

/**
 * Deterministic ambient drift field — fixed positions/timings so SSR and
 * client render identically (no `Math.random` at render = no hydration
 * mismatch). Each particle slow-drifts on its own CSS loop ; static
 * opacity ≤ 0.32 so the field reads as texture, never clutter (Eliot
 * "ultra premium mais ultra simple"). Positioned by polar angle/radius,
 * kept clear of the central "TOI" glyph zone (r ≥ 60).
 */
const PARTICLES = [
  { a: -60, r: 92, s: 2.2, dx: 14, dy: -10, dur: 17, delay: 0.0, op: 0.28 },
  { a: 12, r: 150, s: 1.6, dx: -10, dy: 12, dur: 20, delay: 1.2, op: 0.18 },
  { a: 75, r: 78, s: 2.6, dx: 12, dy: 14, dur: 15, delay: 0.6, op: 0.3 },
  { a: 110, r: 165, s: 1.4, dx: -14, dy: -8, dur: 22, delay: 2.0, op: 0.16 },
  { a: 150, r: 100, s: 2.0, dx: 8, dy: -16, dur: 18, delay: 0.3, op: 0.24 },
  { a: 200, r: 145, s: 1.8, dx: -12, dy: 10, dur: 19, delay: 1.6, op: 0.2 },
  { a: 235, r: 70, s: 2.4, dx: 16, dy: 8, dur: 14, delay: 0.9, op: 0.32 },
  { a: 285, r: 158, s: 1.5, dx: -8, dy: -12, dur: 21, delay: 2.4, op: 0.16 },
  { a: 320, r: 110, s: 2.0, dx: 10, dy: 14, dur: 16, delay: 0.4, op: 0.26 },
  { a: 30, r: 64, s: 1.7, dx: -14, dy: -10, dur: 18, delay: 1.0, op: 0.22 },
] as const;

// Faint concentric echo rings between the centre and the pillar ring —
// a structural depth cue (slow opacity breathing via `.track-echo-ring`).
const ECHO_RINGS = [
  { r: 72, base: 0.14 },
  { r: 104, base: 0.1 },
] as const;

export interface TrackHeroProps {
  /** Set of habit kinds logged today — drives the "completed" halo style. */
  loggedToday?: ReadonlySet<HabitKind>;
}

export function TrackHero({ loggedToday }: TrackHeroProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  return (
    <div className="relative mx-auto w-full max-w-xl" aria-hidden="true">
      {/* Decorative — the "5 piliers" information is conveyed by the <h1>
          "Tes 5 piliers de pratique" + the TodayHabitCards. The wrapper
          `aria-hidden` already removes this subtree from the a11y tree, so
          NO `role="img"`/`aria-label` on the svg (would be dead code never
          read by SR — a11y audit V2.1.0 TIER 3). */}
      <svg viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} className="h-auto w-full">
        <defs>
          {/* Radial glow gradient for the center node — lime → transparent. */}
          {/* `--acc-glow` is a box-shadow token (globals.css), NOT a color —
              feeding it to `stopColor` yields an invalid value (ui-designer
              audit V2.1.0 §1). Use `--acc` directly ; the per-stop
              `stopOpacity` ramp is what produces the glow falloff. */}
          <radialGradient id="track-center-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.45" />
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

        {/* V2.1.5 ambient — concentric echo rings (CSS-class breathing,
            killed by the global reduced-motion filet → static at base). */}
        {ECHO_RINGS.map((ring) => (
          <circle
            key={`echo-${ring.r}`}
            className="track-echo-ring"
            cx={CENTER}
            cy={CENTER}
            r={ring.r}
            fill="none"
            stroke="var(--b-acc)"
            strokeWidth={1}
            style={{ ['--echo-op']: ring.base } as CSSProperties}
          />
        ))}

        {/* V2.1.5 ambient — deterministic drift field (CSS-class drift,
            killed by the reduced-motion filet → static at translate(0,0)
            with its inline opacity). */}
        {PARTICLES.map((p) => {
          const pos = polar(p.a, p.r);
          return (
            <circle
              key={`particle-${p.a}-${p.r}`}
              className="track-particle"
              cx={pos.x}
              cy={pos.y}
              r={p.s}
              fill="var(--acc)"
              style={
                {
                  '--pdx': `${p.dx}px`,
                  '--pdy': `${p.dy}px`,
                  '--pdur': `${p.dur}s`,
                  animationDelay: `${p.delay}s`,
                  opacity: p.op,
                } as CSSProperties
              }
            />
          );
        })}

        {/* V2.1.5 ambient — center pulse rings. Double-guarded exactly like
            `mirror-hero.tsx` : NOT rendered when `reduceMotion` (JS gate)
            AND the `.track-pulse-ring` loop is itself killed by the global
            reduced-motion @media filet (robust even if the hook value is
            SSR-frozen). */}
        {!reduceMotion ? (
          <g>
            <circle
              className="track-pulse-ring"
              cx={CENTER}
              cy={CENTER}
              r={CENTER_RADIUS}
              fill="none"
              stroke="var(--acc)"
              strokeWidth={1.5}
            />
            <circle
              className="track-pulse-ring"
              cx={CENTER}
              cy={CENTER}
              r={CENTER_RADIUS}
              fill="none"
              stroke="var(--acc)"
              strokeWidth={1.5}
              style={{ animationDelay: '1.8s' }}
            />
          </g>
        ) : null}

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
