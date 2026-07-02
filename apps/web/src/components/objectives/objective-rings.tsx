'use client';

import { animate, m, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { Check } from 'lucide-react';
import { useEffect } from 'react';

import type { ProcessObjective } from '@/lib/objectives/service';
import { cn } from '@/lib/utils';

/**
 * Anneau de progression vers un objectif de PROCESS (jalon J4 « Où je vais »).
 *
 * Le remplissage de l'anneau = le score réel 0–100 (jamais fabriqué) ; une
 * encoche marque la CIBLE (Maîtrise, 85). Le gros chiffre est le score honnête,
 * la légende dit l'écart restant (« +13 → Maîtrise ») ou la réussite. Tons
 * alignés sur `ScoreGauge` (bad / warn / cy / acc) pour une lecture cohérente
 * avec « Où j'en suis ». Count-up Framer + `prefers-reduced-motion`. Hover :
 * légère élévation + halo accent.
 */

const SIZE = 132;
const STROKE = 11;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

interface Tone {
  stroke: string;
  glow: string;
  text: string;
  band: string;
}

function toneFor(score: number | null): Tone {
  if (score === null)
    return {
      stroke: 'var(--b-default)',
      glow: 'transparent',
      text: 'text-[var(--t-3)]',
      band: '—',
    };
  if (score < 50)
    return {
      stroke: 'var(--bad)',
      glow: 'var(--bad)',
      text: 'text-[var(--bad)]',
      band: 'À construire',
    };
  if (score < 70)
    return {
      stroke: 'var(--warn)',
      glow: 'var(--warn)',
      text: 'text-[var(--warn)]',
      band: 'À renforcer',
    };
  if (score < 85)
    return { stroke: 'var(--cy)', glow: 'var(--cy)', text: 'text-[var(--cy)]', band: 'Solide' };
  return { stroke: 'var(--acc)', glow: 'var(--acc)', text: 'text-[var(--acc)]', band: 'Maîtrise' };
}

/** Position d'un point sur le cercle à la fraction `f` (0 = haut, sens horaire).
 *  Arrondi à 3 décimales : `Math.cos/sin` peuvent différer au dernier ULP entre
 *  Node (SSR) et le navigateur (CSR) → l'arrondi garantit des attributs SVG
 *  byte-identiques des deux côtés (zéro hydration mismatch). */
function pointOnCircle(f: number, r: number): [number, number] {
  const theta = (-90 + f * 360) * (Math.PI / 180);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [round(CENTER + r * Math.cos(theta)), round(CENTER + r * Math.sin(theta))];
}

export function ObjectiveRing({ objective }: { objective: ProcessObjective }) {
  const { current, target, gap, reached, label, hint } = objective;
  const prefersReduced = useReducedMotion();
  const tone = toneFor(current);

  const motionScore = useMotionValue(current === null || prefersReduced ? (current ?? 0) : 0);
  const displayText = useTransform(motionScore, (v) => Math.round(v).toString());
  useEffect(() => {
    if (current === null) return;
    if (prefersReduced) {
      motionScore.set(current);
      return;
    }
    const controls = animate(motionScore, current, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [current, prefersReduced, motionScore]);

  const fraction = current === null ? 0 : Math.max(0, Math.min(100, current)) / 100;
  const targetOffset = CIRC - fraction * CIRC;
  const [tickIn, tickOut] = [
    pointOnCircle(target / 100, RADIUS - STROKE / 2 - 1),
    pointOnCircle(target / 100, RADIUS + STROKE / 2 + 1),
  ];

  const caption =
    current === null
      ? 'Données insuffisantes'
      : reached
        ? 'Maîtrise atteinte'
        : `+${gap} → Maîtrise`;

  // `role="img"` absorbe le sous-arbre (label/band/hint/caption) → on porte
  // l'info utile (dimension + leviers + palier + ecart) dans l'aria-label.
  const ariaLabel =
    current === null
      ? `${label}, ${hint} : données insuffisantes`
      : reached
        ? `${label}, ${hint} : ${current} sur 100, palier Maîtrise atteint`
        : `${label}, ${hint} : ${current} sur 100, ${tone.band}, ${gap} point${(gap ?? 0) > 1 ? 's' : ''} avant la Maîtrise`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="rounded-card-lg group relative flex flex-col items-center gap-2.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]"
    >
      <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
        {current !== null && (
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
            style={{ background: tone.glow }}
          />
        )}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {/* Piste */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            stroke="var(--b-default)"
            strokeWidth={STROKE}
            fill="none"
          />
          {/* Progression réelle */}
          {current !== null && (
            <m.circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              stroke={tone.stroke}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
              strokeDasharray={CIRC}
              initial={
                prefersReduced ? { strokeDashoffset: targetOffset } : { strokeDashoffset: CIRC }
              }
              animate={{ strokeDashoffset: targetOffset }}
              transition={{ duration: prefersReduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          {/* Encoche cible (Maîtrise) */}
          <line
            x1={tickIn[0]}
            y1={tickIn[1]}
            x2={tickOut[0]}
            y2={tickOut[1]}
            stroke="var(--t-2)"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.7}
          />
        </svg>
        {/* Texte central */}
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {current === null ? (
            <span className="t-mono-cap text-[var(--t-4)]">N/A</span>
          ) : reached ? (
            <span className={cn('grid h-9 w-9 place-items-center rounded-full', tone.text)}>
              <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
            </span>
          ) : (
            <>
              <m.span
                className={cn(
                  'f-mono text-[30px] font-semibold tracking-[-0.02em] tabular-nums',
                  tone.text,
                )}
              >
                {displayText}
              </m.span>
              <span className="t-mono-cap mt-1 text-[var(--t-4)]">/ 100</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="t-eyebrow">{label}</span>
        <span className={cn('t-h3 leading-tight', tone.text)}>{tone.band}</span>
        <span className="t-cap text-[var(--t-4)]">{hint}</span>
        <span
          className={cn(
            'mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums',
            reached
              ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc-hi)]'
              : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
          )}
        >
          {caption}
        </span>
      </div>
    </div>
  );
}

export function ObjectiveRings({ objectives }: { objectives: ReadonlyArray<ProcessObjective> }) {
  const prefersReduced = useReducedMotion();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {objectives.map((o, i) => (
        <m.div
          key={o.key}
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          <ObjectiveRing objective={o} />
        </m.div>
      ))}
    </div>
  );
}
