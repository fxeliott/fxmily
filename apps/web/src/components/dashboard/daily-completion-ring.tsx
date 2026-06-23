'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

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
      aria-label={`Complétude du jour : ${done} sur ${total} geste${total > 1 ? 's' : ''} fait${done > 1 ? 's' : ''}${complete ? ' — tout est fait pour ce moment' : ''}.`}
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
            transition={{ duration: prefersReduced ? 0 : 1, ease: [0.22, 1, 0.36, 1] }}
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
