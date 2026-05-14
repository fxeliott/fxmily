'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * V1.8 REFLECT — `ABCDHero` SVG illustration for the CBT Ellis wizard.
 *
 * Four connected nodes (A → B → C → D) representing the cognitive-
 * restructuring frame :
 *
 *   A — Activating event (deepest blue, the trigger)
 *   B — Belief (automatic thought)
 *   C — Consequence (emotion / behaviour)
 *   D — Disputation (the reframe / climax — brightest blue)
 *
 * Color progresses from blue-700 → blue-300 to convey "darkness to
 * resolution". Connecting paths draw sequentially via `pathLength` so
 * the eye follows the chain naturally on first render.
 *
 * Each node has a small bouncing entrance via `motion.circle scale 0→1`
 * with stagger. The whole figure is decorative — `aria-hidden="true"`.
 *
 * Reduced-motion : single-frame final state via `useReducedMotion()`.
 */
export function ABCDHero({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const dur = reduceMotion ? 0.001 : 0.7;

  // Node coordinates — placed on a soft sine curve for visual rhythm
  const nodes = [
    { label: 'A', cx: 60, cy: 130, color: 'oklch(0.46 0.21 263)', r: 22 },
    { label: 'B', cx: 145, cy: 90, color: 'oklch(0.53 0.21 259)', r: 22 },
    { label: 'C', cx: 230, cy: 130, color: 'oklch(0.62 0.19 254)', r: 22 },
    { label: 'D', cx: 320, cy: 90, color: 'oklch(0.82 0.115 247)', r: 26 },
  ] as const;

  return (
    <svg
      viewBox="0 0 380 200"
      role="img"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="v18-abcd-node" cx="0.3" cy="0.3" r="0.7">
          <stop offset="0%" stopColor="oklch(0.95 0.01 247)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="oklch(0.62 0.19 254)" stopOpacity="0" />
        </radialGradient>
        <filter id="v18-abcd-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connecting paths — drawn sequentially */}
      {nodes.slice(0, 3).map((from, i) => {
        const to = nodes[i + 1]!;
        // Quadratic curve with subtle midpoint elevation for organic feel
        const midX = (from.cx + to.cx) / 2;
        const midY = (from.cy + to.cy) / 2 - (i % 2 === 0 ? 24 : -8);
        const d = `M ${from.cx} ${from.cy} Q ${midX} ${midY} ${to.cx} ${to.cy}`;
        return (
          <motion.path
            key={`path-${i}`}
            d={d}
            fill="none"
            stroke="oklch(0.74 0.16 250 / 0.5)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={i === 2 ? '0 0' : '0 0'}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              pathLength: { duration: dur * 1.3, ease: 'easeInOut', delay: 0.3 + i * 0.35 },
              opacity: { duration: 0.2, delay: 0.3 + i * 0.35 },
            }}
          />
        );
      })}

      {/* Nodes — entrance with overshoot */}
      {nodes.map((n, i) => (
        <g key={n.label}>
          {/* Halo backplate */}
          <motion.circle
            cx={n.cx}
            cy={n.cy}
            r={n.r + 6}
            fill="url(#v18-abcd-node)"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.35, ease: 'backOut' }}
          />
          {/* Outer ring */}
          <motion.circle
            cx={n.cx}
            cy={n.cy}
            r={n.r}
            fill="oklch(0.18 0.03 254 / 0.85)"
            stroke={n.color}
            strokeWidth="2"
            filter={i === 3 ? 'url(#v18-abcd-glow)' : undefined}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.25 + i * 0.35, ease: 'backOut' }}
          />
          {/* Label */}
          <motion.text
            x={n.cx}
            y={n.cy + 5}
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontSize="15"
            fontWeight="700"
            fill={i === 3 ? 'oklch(0.95 0.01 247)' : 'oklch(0.84 0.01 250)'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.5 + i * 0.35 }}
          >
            {n.label}
          </motion.text>
        </g>
      ))}

      {/* Climax accent ring on D — subtle continuous breathing */}
      {!reduceMotion && (
        <circle
          cx={nodes[3].cx}
          cy={nodes[3].cy}
          r={nodes[3].r + 10}
          fill="none"
          stroke="oklch(0.82 0.115 247 / 0.45)"
          strokeWidth="1"
          className="v18-mirror-pulse"
          style={{ transformOrigin: `${nodes[3].cx}px ${nodes[3].cy}px` }}
        />
      )}
    </svg>
  );
}
