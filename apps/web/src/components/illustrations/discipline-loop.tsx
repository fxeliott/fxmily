import type { CSSProperties } from 'react';

/**
 * DisciplineLoop — schéma pédagogique animé de la boucle quotidienne du
 * trader discipliné (Mark Douglas / SPEC §2 : process répétable, jamais un
 * conseil de marché).
 *
 * Le geste central de l'app n'est PAS « prédire la prochaine bougie » — c'est
 * répéter, chaque jour, le même cycle : Check-in matin → Plan / Pré-trade →
 * Exécution & journal → Revue du soir, qui ré-alimente le matin suivant. Ce
 * composant ENSEIGNE cette boucle : un schéma SVG circulaire à 4 étapes,
 * relié par des arcs fléchés, qu'un point lumineux (`--acc`) parcourt
 * doucement pendant que chaque étape s'illumine en séquence.
 *
 * Pédagogie, pas décoration → il PORTE du sens :
 *  - `role="img"` + `aria-label` décrivant la boucle complète (lecteur d'écran).
 *  - Une légende ordonnée `<ol>` en équivalent texte sous le schéma (visible,
 *    donc le sens survit même sans le SVG ni la couleur — WCAG 1.4.1).
 *
 * Accessibilité mouvement :
 *  - 100 % compositor-only : seules `opacity` et `transform` sont animées
 *    (aucune prop de layout/paint coûteuse), `transform-box: fill-box` pour
 *    que les `transform` SVG pivotent autour du nœud lui-même.
 *  - `prefers-reduced-motion: reduce` : le filet global de globals.css
 *    (`animation-duration: 0.01ms`) fige tout. Les keyframes sont conçues pour
 *    que l'état figé reste LISIBLE — toutes les étapes pleinement visibles,
 *    le point lumineux au repos sur l'étape de départ. Double-garde locale
 *    explicite ci-dessous (defensive, indépendante de l'ordre de cascade).
 *  - `forced-colors: active` : les halos/glows (box-shadow/drop-shadow) sont
 *    neutralisés par l'UA ; le schéma reste lisible via les traits `stroke`.
 *
 * Tokens DS-v3 uniquement (`--acc` bleu de marque, `--t-*`, `--b-*`). Aucun
 * cyan ici : §21.7 réserve `--cy` au mode entraînement/backtest — ceci est la
 * boucle du QUOTIDIEN (réel), donc accent bleu.
 *
 * `tone` est volontairement absent : ce schéma décrit la routine réelle, qui
 * est toujours en accent de marque. Largeur intrinsèque fluide (`max-width`),
 * `aspect-ratio` carré pour ne jamais sauter au resize.
 */

interface Step {
  readonly n: number;
  readonly label: string;
  readonly hint: string;
  /** Angle on the cycle (deg, 0 = top, clockwise). */
  readonly angle: number;
}

const STEPS: readonly Step[] = [
  { n: 1, label: 'Check-in matin', hint: 'État, sommeil, routine — avant le marché.', angle: 0 },
  { n: 2, label: 'Plan & pré-trade', hint: 'Ton intention, ton edge, tes limites.', angle: 90 },
  {
    n: 3,
    label: 'Exécution & journal',
    hint: 'Tu trades, tu logges, sans te raconter d’histoires.',
    angle: 180,
  },
  {
    n: 4,
    label: 'Revue du soir',
    hint: 'Process respecté ? Ce que tu emportes demain.',
    angle: 270,
  },
] as const;

// Geometry — square viewBox, single source of truth so SVG + offset-path align.
const VB = 320;
const C = VB / 2; // center
const R = 104; // orbit radius of the step nodes
const NODE = 30; // node circle radius

/** Polar → cartesian, 0deg = top (12 o'clock), clockwise. */
function polar(angle: number, radius: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

/**
 * Arc path between two consecutive steps, drawn slightly OUTSIDE the node
 * radius so the arrow heads breathe and never overlap the node glow.
 */
function arc(from: number, to: number): string {
  const rArc = R; // arc rides the orbit
  const pad = 22; // angular padding (deg) so the arc starts/ends clear of nodes
  const a0 = from + pad;
  const a1 = to - pad;
  const p0 = polar(a0, rArc);
  const p1 = polar(a1, rArc);
  // large-arc-flag 0, sweep-flag 1 (clockwise)
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${rArc} ${rArc} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export function DisciplineLoop({ className }: { className?: string }) {
  const ariaLabel =
    'Schéma de la boucle quotidienne du trader discipliné : étape 1 check-in du matin, ' +
    'étape 2 plan et pré-trade, étape 3 exécution et journal, étape 4 revue du soir, ' +
    'puis retour à l’étape 1 le lendemain. Un cycle qui se répète chaque jour.';

  return (
    <figure className={className}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="dl-root relative mx-auto w-full max-w-[340px]"
      >
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          className="block h-auto w-full"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* Travelling-dot glow */}
            <radialGradient id="dl-spark" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity="1" />
              <stop offset="55%" stopColor="var(--acc)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
            </radialGradient>
            {/* Arrow head reused on every connector */}
            <marker
              id="dl-arrow"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--acc)" opacity="0.8" />
            </marker>
          </defs>

          {/* Faint guide ring — the "track" the cycle runs on. */}
          <circle
            cx={C}
            cy={C}
            r={R}
            stroke="var(--b-strong)"
            strokeWidth="1.25"
            strokeDasharray="2 6"
            opacity="0.7"
          />

          {/* Connector arcs (4 segments, each with an arrow head). */}
          {STEPS.map((s, i) => {
            const next = STEPS[(i + 1) % STEPS.length]!;
            return (
              <path
                key={`arc-${s.n}`}
                d={arc(s.angle, next.angle + (next.angle < s.angle ? 360 : 0))}
                stroke="var(--b-acc-strong)"
                strokeWidth="1.75"
                strokeLinecap="round"
                markerEnd="url(#dl-arrow)"
                opacity="0.85"
              />
            );
          })}

          {/* Centre — the constant: process > prédiction. */}
          <g className="dl-core">
            <circle
              cx={C}
              cy={C}
              r="34"
              fill="var(--acc-dim-2)"
              stroke="var(--b-acc)"
              strokeWidth="1"
            />
            <text
              x={C}
              y={C - 4}
              textAnchor="middle"
              className="dl-core-t"
              fontSize="11"
              fontWeight="600"
              fill="var(--acc-hi)"
            >
              Le même
            </text>
            <text
              x={C}
              y={C + 10}
              textAnchor="middle"
              className="dl-core-t"
              fontSize="11"
              fontWeight="600"
              fill="var(--acc-hi)"
            >
              process
            </text>
          </g>

          {/* Step nodes — illuminate in sequence. */}
          {STEPS.map((s, i) => {
            const p = polar(s.angle, R);
            return (
              <g
                key={`node-${s.n}`}
                className="dl-node"
                style={{ '--i': i } as CSSProperties}
                transform={`translate(${p.x} ${p.y})`}
              >
                <circle className="dl-node-halo" r={NODE} fill="var(--acc)" opacity="0" />
                <circle r={NODE} fill="var(--bg-2)" stroke="var(--b-acc)" strokeWidth="1.25" />
                <circle
                  className="dl-node-ring"
                  r={NODE}
                  fill="none"
                  stroke="var(--acc)"
                  strokeWidth="1.5"
                  opacity="0"
                />
                <text
                  textAnchor="middle"
                  dy="0.36em"
                  fontSize="15"
                  fontWeight="700"
                  fill="var(--acc-hi)"
                  className="dl-node-n"
                >
                  {s.n}
                </text>
              </g>
            );
          })}

          {/* Travelling spark — circles the orbit, the "live" cursor of the loop. */}
          <g className="dl-spark-orbit">
            <circle r="9" fill="url(#dl-spark)" />
            <circle r="3" fill="var(--acc-hi)" className="dl-spark-core" />
          </g>
        </svg>
      </div>

      {/* Equivalent texte visible — le sens survit sans SVG ni couleur. */}
      <figcaption className="mt-5">
        <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="rounded-pill mt-0.5 grid h-6 w-6 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] font-mono text-[11px] font-semibold text-[var(--acc)]"
              >
                {s.n}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="t-cap font-semibold text-[var(--t-1)]">{s.label}</span>
                <span className="text-[12px] leading-snug text-[var(--t-3)]">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-center text-[12px] text-[var(--t-3)]">
          Puis on recommence le lendemain. C’est la répétition qui construit, pas un trade isolé.
        </p>
      </figcaption>

      {/*
        Scoped, compositor-only keyframes. The global reduced-motion filet
        (globals.css `* { animation-duration: 0.01ms }`) freezes all of this;
        the `dl-reduce` block below is a defensive double-guard so the frozen
        state is explicitly legible regardless of cascade order. Only `opacity`
        and `transform` are animated. `offset-path` drives the spark along the
        exact orbit circle (motion-path, GPU compositor).
      */}
      <style>{`
        .dl-root { line-height: 0; }
        .dl-node text { font-family: var(--font-mono, ui-monospace, monospace); }
        .dl-core-t { font-family: var(--font-display, ui-sans-serif, system-ui); letter-spacing: -0.01em; }

        /* Each node lights up on its slot of a 8s cycle (4 steps × 2s window),
           then dims back. transform-box: fill-box → scale pivots on the node. */
        .dl-node { transform-box: fill-box; }
        .dl-node-halo,
        .dl-node-ring,
        .dl-node-n { will-change: opacity, transform; }
        .dl-node-halo {
          transform-box: fill-box;
          transform-origin: center;
          animation: dlNodePulse 8s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 2s);
        }
        .dl-node-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: dlNodeRing 8s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 2s);
        }

        @keyframes dlNodePulse {
          0%, 100% { opacity: 0; transform: scale(0.9); }
          6% { opacity: 0.16; transform: scale(1.04); }
          22% { opacity: 0.05; transform: scale(1); }
          25% { opacity: 0; transform: scale(0.96); }
        }
        @keyframes dlNodeRing {
          0%, 100% { opacity: 0; }
          5% { opacity: 0.9; }
          24% { opacity: 0; }
        }

        /* Travelling spark — runs the orbit via motion-path. The path is the
           same circle (r = ${R}) centred at the viewBox centre. */
        .dl-spark-orbit {
          offset-path: path('M ${C} ${C - R} A ${R} ${R} 0 1 1 ${(C - 0.01).toFixed(2)} ${C - R} Z');
          offset-rotate: 0deg;
          animation: dlSparkRun 8s linear infinite;
          will-change: offset-distance;
        }
        .dl-spark-core { will-change: opacity; animation: dlSparkBreathe 8s var(--e-smooth) infinite; }

        @keyframes dlSparkRun {
          from { offset-distance: 0%; }
          to { offset-distance: 100%; }
        }
        @keyframes dlSparkBreathe {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }

        /* Core breathes very gently — the steady anchor of the loop. */
        .dl-core { transform-box: fill-box; transform-origin: center; animation: dlCoreBreathe 6s var(--e-smooth) infinite; will-change: opacity; }
        @keyframes dlCoreBreathe {
          0%, 100% { opacity: 0.92; }
          50% { opacity: 1; }
        }

        /* Defensive double-guard: explicit, cascade-independent frozen state.
           Spark rests on step 1 (top); rings/halos off; everything legible. */
        @media (prefers-reduced-motion: reduce) {
          .dl-node-halo,
          .dl-node-ring { animation: none; opacity: 0; }
          .dl-spark-orbit { animation: none; offset-distance: 0%; }
          .dl-spark-core,
          .dl-core { animation: none; opacity: 1; }
        }
      `}</style>
    </figure>
  );
}
