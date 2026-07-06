/**
 * FocusTarget — cible / focus : cercles concentriques calmes + un point qui
 * converge doucement vers le centre. Illustration maison, même grammaire que
 * DisciplineLoop. Pas une mire agressive : un recentrage lent, apaisé.
 *
 * Sens : revenir au centre. La bibliothèque (Mark Douglas) sert à recentrer
 * l'attention sur le process quand l'esprit dérive ; le point qui converge dit
 * "on se recentre", sans urgence ni compte-à-rebours.
 *
 * Grammaire copiée : anneaux fins pointillés, tokens DS-v3, `opacity`/`transform`
 * uniquement, double-garde `prefers-reduced-motion` (point au centre à l'arrêt).
 * ids préfixés `ft-`. `aria-hidden` (décoratif). Accent `--acc`, anneaux neutres
 * `--b-strong`. Aucun cyan (réservé backtest §21.7).
 */
import type { CSSProperties } from 'react';

const VB = 200;
const C = VB / 2;
const RINGS = [78, 56, 34] as const; // rayons décroissants des anneaux

export function FocusTarget({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      className={`ft-root block h-auto w-full ${className ?? ''}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="ft-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity="1" />
          <stop offset="55%" stopColor="var(--acc)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Croix de visée discrète — repères fins, jamais agressifs. */}
      <g stroke="var(--b-strong)" strokeWidth="1" opacity="0.4" strokeLinecap="round">
        <line x1={C} y1="14" x2={C} y2="42" />
        <line x1={C} y1={VB - 14} x2={C} y2={VB - 42} />
        <line x1="14" y1={C} x2="42" y2={C} />
        <line x1={VB - 14} y1={C} x2={VB - 42} y2={C} />
      </g>

      {/* Anneaux concentriques — pulsent en séquence vers l'intérieur (calme). */}
      {RINGS.map((r, i) => (
        <circle
          key={`ft-ring-${r}`}
          className="ft-ring"
          style={{ '--i': i } as CSSProperties}
          cx={C}
          cy={C}
          r={r}
          stroke="var(--b-acc)"
          strokeWidth="1.25"
          strokeDasharray="3 6"
          opacity="0.55"
        />
      ))}

      {/* Point convergent — descend d'un anneau extérieur vers le centre, calmement.
          Positionné au centre par un transform d'ATTRIBUT SVG ; l'animation CSS ne
          touche qu'un translateY relatif + opacity (aucun repère SVG/CSS mêlé). */}
      <g className="ft-dot-orbit" transform={`translate(${C} ${C})`}>
        <circle r="8" fill="url(#ft-core)" />
        <circle r="3" fill="var(--acc-hi)" />
      </g>

      {/* Centre — le point d'ancrage, glow doux. */}
      <circle cx={C} cy={C} r="9" fill="url(#ft-core)" className="ft-center-glow" />
      <circle cx={C} cy={C} r="3.5" fill="var(--acc-hi)" className="ft-center" />

      <style>{`
        .ft-root { line-height: 0; }

        /* Anneaux : léger battement séquentiel vers l'intérieur (respiration lente). */
        .ft-ring {
          transform-box: fill-box;
          transform-origin: center;
          will-change: opacity, transform;
          animation: ftRing 5s var(--e-smooth) infinite;
          animation-delay: calc(var(--i) * 0.5s);
        }
        @keyframes ftRing {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.75; transform: scale(0.97); }
        }

        /* Point convergent : parcourt un court segment radial (haut -> centre),
           en boucle, via un translateY relatif (le centrage vit dans le transform
           d'attribut SVG). transform-box: fill-box pour que le translate soit un
           pur décalage compositor autour du groupe. Il "revient au centre". */
        .ft-dot-orbit {
          transform-box: fill-box;
          transform-origin: center;
          will-change: transform, opacity;
          animation: ftConverge 5s var(--e-smooth) infinite;
        }
        @keyframes ftConverge {
          0% { transform: translateY(-62px); opacity: 0; }
          20% { opacity: 1; }
          70% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(0); opacity: 0; }
        }

        .ft-center-glow { will-change: opacity; animation: ftPulse 5s var(--e-smooth) infinite; }
        .ft-center { will-change: opacity; animation: ftPulse 5s var(--e-smooth) infinite; }
        @keyframes ftPulse { 0%, 100% { opacity: 0.85; } 50% { opacity: 1; } }

        /* Reduced-motion : anneaux statiques, point posé au centre, tout lisible. */
        @media (prefers-reduced-motion: reduce) {
          .ft-ring { animation: none; opacity: 0.55; transform: scale(1); }
          .ft-dot-orbit { animation: none; transform: translateY(0); opacity: 1; }
          .ft-center-glow, .ft-center { animation: none; opacity: 1; }
        }
      `}</style>
    </svg>
  );
}
