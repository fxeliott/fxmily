/**
 * MirrorReflection — le déclaré face au réel. Deux formes symétriques autour
 * d'un axe médian : à gauche la forme pleine (ce que je déclare / mon
 * intention), à droite son reflet en pointillés qui s'ALIGNE progressivement
 * sur elle (le réel qui rejoint le déclaré quand le mindset est juste).
 * Illustration maison, même grammaire que DisciplineLoop.
 *
 * Sens : le travail de mindset, c'est réduire l'écart entre ce qu'on se dit et
 * ce qu'on fait. Le reflet en pointillés converge vers le trait plein sans
 * jamais "gagner" — c'est un ajustement continu, pas une victoire finale.
 *
 * Grammaire copiée : traits fins, tokens DS-v3, `opacity`/`transform`
 * uniquement, double-garde `prefers-reduced-motion` (reflet aligné à l'arrivée).
 * ids préfixés `mr-`. `aria-hidden` (décoratif). Accent `--acc`, axe neutre
 * `--b-strong`. Aucun cyan (réservé backtest §21.7).
 */

const VB = 200;
const AXIS = VB / 2; // axe de symétrie vertical

// Silhouette de base (côté gauche = le déclaré, x < AXIS). Le côté droit (le
// réel) est le MIROIR pré-calculé en JS (x -> 2*AXIS - x), tout en coordonnées
// viewBox : aucun `transform` d'attribut, l'animation ne touche donc qu'un
// `translateX`/`opacity` scalaire (pas de mélange de repères SVG/CSS, pas de
// conflit attribut/keyframe).
const BASE_PTS: readonly (readonly [number, number])[] = [
  [58, 52],
  [84, 40],
  [92, 84],
  [78, 150],
  [54, 150],
  [46, 96],
];
const toStr = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y]) => `${x},${y}`).join(' ');
// Léger écart de 6px de part et d'autre de l'axe pour aérer.
const LEFT = toStr(BASE_PTS.map(([x, y]) => [x - 6, y] as const));
const RIGHT = toStr(BASE_PTS.map(([x, y]) => [2 * AXIS - x + 6, y] as const));

export function MirrorReflection({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      className={`mr-root block h-auto w-full ${className ?? ''}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="mr-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Axe médian — la ligne du miroir. */}
      <line
        x1={AXIS}
        y1="26"
        x2={AXIS}
        y2="174"
        stroke="var(--b-strong)"
        strokeWidth="1.25"
        strokeDasharray="3 5"
        opacity="0.7"
      />
      {/* Petits repères de l'axe (haut/bas). */}
      <circle cx={AXIS} cy="26" r="2.5" fill="var(--acc)" opacity="0.7" />
      <circle cx={AXIS} cy="174" r="2.5" fill="var(--acc)" opacity="0.7" />

      {/* Côté gauche — le DÉCLARÉ : forme pleine, trait net (l'ancre stable). */}
      <polygon
        className="mr-declared"
        points={LEFT}
        fill="url(#mr-fill)"
        stroke="var(--acc)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Côté droit — le RÉEL : reflet en pointillés qui s'aligne (pré-miroité). */}
      <polygon
        className="mr-real"
        points={RIGHT}
        fill="none"
        stroke="var(--acc-hi)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeDasharray="4 4"
      />

      <style>{`
        .mr-root { line-height: 0; }

        /* Le réel (reflet pointillé) part écarté de l'axe et atténué, puis
           s'ALIGNE : translateX vers l'axe + opacity qui monte, en boucle douce
           (ajustement continu, jamais figé "gagné"). transform-box: fill-box →
           le translate est un pur décalage compositor, aucun repère SVG mêlé. */
        .mr-real {
          transform-box: fill-box;
          transform-origin: center;
          will-change: transform, opacity;
          animation: mrAlign 6s var(--e-smooth) infinite;
        }
        @keyframes mrAlign {
          0%, 100% { opacity: 0.4; transform: translateX(10px); }
          50% { opacity: 1; transform: translateX(0); }
        }

        /* Le déclaré respire très légèrement : l'ancre stable. */
        .mr-declared {
          transform-box: fill-box;
          transform-origin: center;
          will-change: opacity;
          animation: mrBreathe 6s var(--e-smooth) infinite;
        }
        @keyframes mrBreathe { 0%, 100% { opacity: 0.92; } 50% { opacity: 1; } }

        /* Reduced-motion : reflet parfaitement aligné (écart nul), tout lisible. */
        @media (prefers-reduced-motion: reduce) {
          .mr-real { animation: none; opacity: 1; transform: translateX(0); }
          .mr-declared { animation: none; opacity: 1; }
        }
      `}</style>
    </svg>
  );
}
