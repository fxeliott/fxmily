'use client';

import { m, useInView, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useRef } from 'react';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { useChartColors } from '@/lib/use-chart-colors';

/**
 * Anneau de complétude du jour (jalon 2b — style « Apple Activity » honnête).
 *
 * Visualise la fraction des gestes du jour DÉJÀ faits (done / total), dérivée
 * du guidage quotidien réel (`getDailyGuidance`). C'est la version VISUELLE de
 * l'état déjà rendu en texte par le hero (« tout fait » / prochaine action) —
 * pas une nouvelle source de vérité, aucune requête ajoutée.
 *
 * Posture §2 / anti-Black-Hat (BLOQUANT) :
 *  - se ferme en accent bleu, devient vert calme quand tout est fait ; JAMAIS
 *    de rouge « pas fait » ni de compte à rebours ;
 *  - les actions d'INFO (ni à faire ni faites) sont exclues du dénominateur en
 *    amont (la page ne passe que les gestes actionnables) ;
 *  - jamais rendu avec `total === 0` (le parent garde l'affichage) — pas de
 *    « 0/0 » trompeur.
 *
 * SVG natif (cercle + dashoffset) → aucun Recharts, aucun `var()` en attribut
 * SVG (hex `C.*`, iOS WebView-safe). `role="img"` + aria-label. Animation de
 * fermeture compositor-only, désactivée sous `prefers-reduced-motion`.
 */

const SIZE = 76;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

export function DailyCompletionRing({ done, total }: { done: number; total: number }) {
  const prefersReduced = useReducedMotion();
  const C = useChartColors();

  // `total === 0` ne doit jamais arriver (le parent ne rend pas l'anneau dans
  // ce cas) — garde défensive pour ne jamais diviser par zéro / fabriquer 100 %.
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const complete = total > 0 && done >= total;
  const offset = CIRC - fraction * CIRC;
  const stroke = complete ? C.ok : C.acc;

  return (
    <div
      role="img"
      aria-label={`Complétude du jour : ${done} sur ${total} geste${total > 1 ? 's' : ''} fait${done > 1 ? 's' : ''}${complete ? ', tout est fait pour ce moment' : ''}.`}
      className="flex flex-col items-center gap-1.5"
    >
      <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {/* Piste neutre (jamais rouge) */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={C.bStrong}
            strokeWidth={STROKE}
          />
          {/* Progression réelle — se ferme à l'entrée */}
          <m.circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            strokeDasharray={CIRC}
            initial={prefersReduced ? { strokeDashoffset: offset } : { strokeDashoffset: CIRC }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: prefersReduced ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {complete ? (
            <Check className="h-6 w-6 text-[var(--ok)]" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <span className="f-mono text-[16px] leading-none font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
              {done}
              <span className="text-[11px] font-medium text-[var(--t-4)]">/{total}</span>
            </span>
          )}
        </div>
      </div>
      <span className="t-eyebrow text-[var(--t-3)]">Aujourd’hui</span>
    </div>
  );
}

/**
 * Tour 12 (C) — anneau de métrique générique (0..max) qui SE DESSINE à l'entrée
 * du viewport, avec un count-up de la valeur au centre. Réutilise l'anatomie de
 * `DailyCompletionRing` (SVG natif, hex WebView-safe, rotate -90) mais sans la
 * sémantique « gestes du jour » : sert le score de constance et toute jauge 0-100.
 *
 * SSR-safe : un seul arbre. Le tracé démarre plein (offset = CIRC) et se dessine
 * quand l'élément entre dans le viewport (`useInView`, once) ; sous reduced-motion
 * il est rendu directement à sa valeur finale (offset cible), immobile. La valeur
 * numérique est portée par `AnimatedNumber` (déjà SSR-correct + once-on-view).
 */
export function MetricRing({
  value,
  max = 100,
  size = 64,
  stroke: strokeWidth = 6,
  suffix,
  ariaLabel,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  /** Petit suffixe sous/après la valeur (ex. « /100 »). */
  suffix?: string;
  ariaLabel: string;
}) {
  const prefersReduced = useReducedMotion();
  const C = useChartColors();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });

  const radius = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * radius;
  const center = size / 2;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const offset = circ - fraction * circ;
  // Se dessine seulement une fois visible ; reduced-motion → directement plein.
  const animateOffset = prefersReduced || inView ? offset : circ;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={C.bStrong}
          strokeWidth={strokeWidth}
        />
        <m.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={C.acc}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          strokeDasharray={circ}
          initial={{ strokeDashoffset: prefersReduced ? offset : circ }}
          animate={{ strokeDashoffset: animateOffset }}
          transition={{ duration: prefersReduced ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <AnimatedNumber
          value={Math.round(value)}
          durationMs={1200}
          className="f-mono text-[17px] leading-none font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums"
        />
        {suffix ? (
          <span className="f-mono ml-px text-[10px] font-medium text-[var(--t-4)]">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}
