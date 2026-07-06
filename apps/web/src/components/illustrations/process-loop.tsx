/**
 * ProcessLoop — boucle du process trader (Mark Douglas) : 4 nœuds reliés en
 * cercle par des arcs fléchés, illuminés en séquence (pulse séquentiel).
 * Cousine minimale de DisciplineLoop : ici aucun texte interne, juste le geste
 * cyclique — un accent visuel pour un hero, pas un schéma pédagogique complet.
 *
 * Sens : le process se REPÈTE. On ne prédit pas, on répète le même cycle. Le
 * pulse qui tourne dit "vivant, en boucle", sans jamais promettre un résultat.
 *
 * Grammaire DisciplineLoop copiée : viewBox carré, polar()/arc() identiques,
 * marker flèche, `--acc`, animations `opacity`/`transform` compositor-only,
 * double-garde `prefers-reduced-motion`. ids préfixés `pl-` (zéro collision).
 * `aria-hidden` (décoratif). Aucun cyan (quotidien réel §21.7).
 */
import type { CSSProperties } from 'react';

const VB = 200;
const C = VB / 2;
const R = 66; // rayon d'orbite des nœuds
const NODE = 17; // rayon d'un nœud

/** Polaire -> cartésien, 0deg = haut (12 h), sens horaire. */
function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

/** Arc horaire entre deux angles, avec padding pour dégager les têtes de flèche. */
function arc(from: number, to: number): string {
  const pad = 24;
  const p0 = polar(from + pad, R);
  const p1 = polar(to - pad, R);
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

const ANGLES = [0, 90, 180, 270] as const;

export function ProcessLoop({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      className={`pl-root block h-auto w-full ${className ?? ''}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="pl-spark" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity="1" />
          <stop offset="55%" stopColor="var(--acc)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
        <marker
          id="pl-arrow"
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--acc)" opacity="0.8" />
        </marker>
      </defs>

      {/* Anneau de guidage — la "piste" du cycle. */}
      <circle
        cx={C}
        cy={C}
        r={R}
        stroke="var(--b-strong)"
        strokeWidth="1.25"
        strokeDasharray="2 6"
        opacity="0.7"
      />

      {/* Arcs connecteurs fléchés (4 segments). */}
      {ANGLES.map((a, i) => {
        const next = ANGLES[(i + 1) % ANGLES.length]!;
        return (
          <path
            key={`pl-arc-${a}`}
            d={arc(a, next + (next < a ? 360 : 0))}
            stroke="var(--b-acc-strong)"
            strokeWidth="1.5"
            strokeLinecap="round"
            markerEnd="url(#pl-arrow)"
            opacity="0.85"
          />
        );
      })}

      {/* Cœur constant — le process, l'ancre immobile. */}
      <circle
        className="pl-core"
        cx={C}
        cy={C}
        r="20"
        fill="var(--acc-dim-2)"
        stroke="var(--b-acc)"
        strokeWidth="1"
      />
      <circle className="pl-core-dot" cx={C} cy={C} r="4" fill="var(--acc-hi)" />

      {/* Nœuds — s'illuminent en séquence. */}
      {ANGLES.map((a, i) => {
        const p = polar(a, R);
        return (
          <g
            key={`pl-node-${a}`}
            className="pl-node"
            style={{ '--i': i } as CSSProperties}
            transform={`translate(${p.x} ${p.y})`}
          >
            <circle className="pl-node-halo" r={NODE} fill="var(--acc)" opacity="0" />
            <circle r={NODE} fill="var(--bg-2)" stroke="var(--b-acc)" strokeWidth="1.25" />
            <circle
              className="pl-node-ring"
              r={NODE}
              fill="none"
              stroke="var(--acc)"
              strokeWidth="1.5"
              opacity="0"
            />
            <circle className="pl-node-dot" r="3.5" fill="var(--acc-hi)" opacity="0.55" />
          </g>
        );
      })}

      {/* Étincelle voyageuse — parcourt l'orbite, le curseur "vivant" du cycle. */}
      <g className="pl-spark-orbit">
        <circle r="7" fill="url(#pl-spark)" />
        <circle r="2.5" fill="var(--acc-hi)" />
      </g>

      <style>{`
        .pl-root { line-height: 0; }
        .pl-node { transform-box: fill-box; }
        .pl-node-halo, .pl-node-ring, .pl-node-dot { will-change: opacity, transform; }
        .pl-node-halo {
          transform-box: fill-box; transform-origin: center;
          animation: plNodePulse 8s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 2s);
        }
        .pl-node-ring {
          transform-box: fill-box; transform-origin: center;
          animation: plNodeRing 8s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 2s);
        }
        .pl-node-dot {
          animation: plNodeDot 8s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 2s);
        }
        @keyframes plNodePulse {
          0%, 100% { opacity: 0; transform: scale(0.9); }
          6% { opacity: 0.18; transform: scale(1.06); }
          22% { opacity: 0.05; transform: scale(1); }
          25% { opacity: 0; transform: scale(0.96); }
        }
        @keyframes plNodeRing {
          0%, 100% { opacity: 0; }
          5% { opacity: 0.9; }
          24% { opacity: 0; }
        }
        @keyframes plNodeDot {
          0%, 100% { opacity: 0.55; }
          6% { opacity: 1; }
          24% { opacity: 0.55; }
        }

        /* Étincelle : parcourt le même cercle (r = ${R}) centré au viewBox. */
        .pl-spark-orbit {
          offset-path: path('M ${C} ${C - R} A ${R} ${R} 0 1 1 ${(C - 0.01).toFixed(2)} ${C - R} Z');
          offset-rotate: 0deg;
          will-change: offset-distance;
          animation: plSparkRun 8s linear infinite;
        }
        @keyframes plSparkRun {
          from { offset-distance: 0%; }
          to { offset-distance: 100%; }
        }

        .pl-core { transform-box: fill-box; transform-origin: center; will-change: opacity; animation: plCoreBreathe 6s var(--e-smooth) infinite; }
        .pl-core-dot { will-change: opacity; animation: plSparkBreathe 6s var(--e-smooth) infinite; }
        @keyframes plCoreBreathe { 0%, 100% { opacity: 0.92; } 50% { opacity: 1; } }
        @keyframes plSparkBreathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

        /* Reduced-motion : tout figé lisible, étincelle au repos sur le nœud 1. */
        @media (prefers-reduced-motion: reduce) {
          .pl-node-halo, .pl-node-ring { animation: none; opacity: 0; }
          .pl-node-dot { animation: none; opacity: 0.55; }
          .pl-spark-orbit { animation: none; offset-distance: 0%; }
          .pl-core, .pl-core-dot { animation: none; opacity: 1; }
        }
      `}</style>
    </svg>
  );
}
