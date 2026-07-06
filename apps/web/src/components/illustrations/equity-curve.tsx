/**
 * EquityCurve — courbe d'équité stylisée qui se dessine (stroke-dashoffset),
 * traverse un drawdown, puis récupère au-dessus du départ. Illustration maison
 * (aucune image bitmap), même grammaire que DisciplineLoop : traits fins,
 * tokens DS-v3, animations compositor-only, `prefers-reduced-motion` = état
 * final figé et lisible.
 *
 * Sens (pas décoration) : le récit visuel d'un parcours de trader discipliné —
 * ça monte, ça corrige (le drawdown est NORMAL, "anything can happen"), puis le
 * process ramène au-dessus. La grille discrète ancre l'échelle sans bruit.
 *
 * Accessibilité : `aria-hidden` (décoratif, le sens porteur vit dans le texte de
 * la page qui l'accompagne). 100 % `opacity` / `stroke-dashoffset` (compositor).
 * `forced-colors` : les glows sautent, les traits `stroke` restent lisibles.
 *
 * Tokens : `--acc` (courbe réelle, quotidien §21.7), `--b-strong` (grille),
 * `--acc-hi` (point vif). Aucun cyan (réservé backtest).
 */

// viewBox rectangulaire — une courbe respire mieux en paysage qu'en carré.
const VBW = 320;
const VBH = 180;

// Tracé de la courbe : montée, drawdown marqué, récupération au-dessus du départ.
// Un seul path, longueur ~parcourue par le stroke-dashoffset (pathLength=1 normalise).
const CURVE =
  'M 12 132 C 44 120, 66 96, 92 88 C 116 80, 132 92, 152 116 C 170 138, 188 140, 210 118 C 234 94, 258 66, 308 30';

export function EquityCurve({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      className={`ec-root block h-auto w-full ${className ?? ''}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ec-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.55" />
          <stop offset="60%" stopColor="var(--acc)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--acc-hi)" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="ec-spark" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity="1" />
          <stop offset="55%" stopColor="var(--acc)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Grille discrète — 3 lignes horizontales + baseline de départ pointillée. */}
      <g stroke="var(--b-strong)" strokeWidth="1" opacity="0.5">
        <line x1="12" y1="44" x2="308" y2="44" strokeDasharray="2 6" />
        <line x1="12" y1="88" x2="308" y2="88" strokeDasharray="2 6" />
        <line x1="12" y1="132" x2="308" y2="132" strokeDasharray="2 6" />
      </g>
      {/* Repère du niveau de départ — la courbe finit franchement au-dessus. */}
      <line
        x1="12"
        y1="132"
        x2="308"
        y2="132"
        stroke="var(--b-acc)"
        strokeWidth="1"
        strokeDasharray="1 5"
        opacity="0.6"
      />

      {/* La courbe qui se dessine. */}
      <path
        className="ec-curve"
        d={CURVE}
        pathLength={1}
        stroke="url(#ec-line)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Point vif au sommet final — arrive quand le tracé est complet. */}
      <g className="ec-head" transform="translate(308 30)">
        <circle r="8" fill="url(#ec-spark)" />
        <circle r="3" fill="var(--acc-hi)" />
      </g>

      <style>{`
        .ec-root { line-height: 0; }
        /* Le tracé se dessine : dashoffset 1 -> 0 sur un pathLength normalisé. */
        .ec-curve {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          will-change: stroke-dashoffset;
          animation: ecDraw 3.4s var(--e-smooth) forwards;
        }
        .ec-head {
          transform-box: fill-box;
          transform-origin: center;
          opacity: 0;
          will-change: opacity, transform;
          animation: ecHead 3.4s var(--e-smooth) forwards;
        }
        @keyframes ecDraw {
          from { stroke-dashoffset: 1; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes ecHead {
          0%, 82% { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
        /* Reduced-motion : courbe entièrement dessinée + point présent, statique. */
        @media (prefers-reduced-motion: reduce) {
          .ec-curve { animation: none; stroke-dashoffset: 0; }
          .ec-head { animation: none; opacity: 1; transform: scale(1); }
        }
      `}</style>
    </svg>
  );
}
