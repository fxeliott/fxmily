/**
 * MorningEveningBridge — pont matin/soir : un arc relie deux pôles stylisés
 * (soleil à gauche, lune à droite) ; une particule le parcourt en boucle,
 * du matin vers le soir. Illustration maison, même grammaire que DisciplineLoop.
 *
 * Sens : la journée du trader discipliné a DEUX temps reliés — le check-in du
 * matin cadre, la revue du soir referme ; l'arc est le fil qui les relie, la
 * particule le passage du jour. Rien de prédictif, juste le rythme.
 *
 * Grammaire copiée : traits fins, tokens DS-v3, `offset-path` pour la particule
 * (motion-path GPU), `opacity`/`transform` uniquement, double-garde
 * `prefers-reduced-motion`. ids préfixés `meb-`. `aria-hidden` (décoratif).
 * Le soleil est en `--acc` (jour), la lune en `--t-3` neutre (nuit calme) —
 * aucun cyan (réservé backtest §21.7).
 */

const VBW = 240;
const VBH = 132;

// Deux pôles + l'arc qui les relie (demi-cercle aplati, concave vers le haut).
const SUN = { x: 40, y: 92 };
const MOON = { x: 200, y: 92 };
// Arc du pont : quadratique, sommet remonté au centre.
const BRIDGE = `M ${SUN.x} ${SUN.y} Q ${VBW / 2} 24 ${MOON.x} ${MOON.y}`;

export function MorningEveningBridge({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      className={`meb-root block h-auto w-full ${className ?? ''}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="meb-particle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity="1" />
          <stop offset="55%" stopColor="var(--acc)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="meb-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--t-3)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* L'arc du pont, tracé pointillé fin. */}
      <path
        d={BRIDGE}
        stroke="url(#meb-arc)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 5"
        opacity="0.75"
      />

      {/* Base sol commune, discrète. */}
      <line
        x1="24"
        y1="108"
        x2="216"
        y2="108"
        stroke="var(--b-strong)"
        strokeWidth="1"
        strokeDasharray="1 6"
        opacity="0.5"
      />

      {/* Soleil (matin) — cercle + rayons fins. */}
      <g className="meb-sun" transform={`translate(${SUN.x} ${SUN.y})`}>
        <circle r="13" fill="var(--acc-dim-2)" stroke="var(--b-acc)" strokeWidth="1.25" />
        <circle r="6.5" fill="var(--acc)" opacity="0.9" />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * 45 * Math.PI) / 180;
          const r0 = 15;
          const r1 = 20;
          return (
            <line
              key={`meb-ray-${i}`}
              x1={(Math.cos(a) * r0).toFixed(2)}
              y1={(Math.sin(a) * r0).toFixed(2)}
              x2={(Math.cos(a) * r1).toFixed(2)}
              y2={(Math.sin(a) * r1).toFixed(2)}
              stroke="var(--acc)"
              strokeWidth="1.25"
              strokeLinecap="round"
              opacity="0.7"
            />
          );
        })}
      </g>

      {/* Lune (soir) — croissant stylisé par deux cercles. */}
      <g className="meb-moon" transform={`translate(${MOON.x} ${MOON.y})`}>
        <circle r="13" fill="var(--bg-2)" stroke="var(--b-strong)" strokeWidth="1.25" />
        <path d="M 4 -8 A 9 9 0 1 0 4 8 A 7 7 0 1 1 4 -8 Z" fill="var(--t-3)" opacity="0.85" />
      </g>

      {/* Particule — parcourt le pont, du matin vers le soir. */}
      <g className="meb-travel">
        <circle r="6" fill="url(#meb-particle)" />
        <circle r="2.5" fill="var(--acc-hi)" />
      </g>

      <style>{`
        .meb-root { line-height: 0; }
        .meb-sun { transform-box: fill-box; transform-origin: center; will-change: opacity; animation: mebSun 6s var(--e-smooth) infinite; }
        .meb-moon { transform-box: fill-box; transform-origin: center; will-change: opacity; animation: mebMoon 6s var(--e-smooth) infinite; }
        @keyframes mebSun { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
        @keyframes mebMoon { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }

        /* Particule sur le pont : même quadratique que l'arc (offset-path). */
        .meb-travel {
          offset-path: path('${BRIDGE}');
          offset-rotate: 0deg;
          will-change: offset-distance, opacity;
          animation: mebTravel 5.5s var(--e-smooth) infinite;
        }
        @keyframes mebTravel {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }

        /* Reduced-motion : pont statique, particule posée au sommet (mi-parcours). */
        @media (prefers-reduced-motion: reduce) {
          .meb-sun, .meb-moon { animation: none; opacity: 1; }
          .meb-travel { animation: none; offset-distance: 50%; opacity: 1; }
        }
      `}</style>
    </svg>
  );
}
