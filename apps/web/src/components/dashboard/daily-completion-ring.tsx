'use client';

import { m, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { useAfterHydration } from '@/lib/hooks';
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
  const armed = useAfterHydration() && !prefersReduced;
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
            // Base SSR = anneau REMPLI, écrit à l'identique des deux côtés ; la
            // fermeture ne s'arme qu'après hydratation. Un `initial` calculé
            // depuis la préférence sérialisait deux `stroke-dashoffset`
            // différents (client 144.51 / serveur 216.77, mesuré le 2026-07-30).
            initial={false}
            animate={armed ? { strokeDashoffset: [CIRC, offset] } : { strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
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
 * Tour 12 (C) — anneau de métrique générique (0..max) qui se dessine juste après
 * l'hydratation (et NON plus à l'entrée du viewport, cf. plus bas). Réutilise l'anatomie de
 * `DailyCompletionRing` (SVG natif, hex WebView-safe, rotate -90) mais sans la
 * sémantique « gestes du jour » : sert le score de constance et toute jauge 0-100.
 *
 * SSR-safe : un seul arbre. Le rendu de base — serveur, premier rendu client,
 * sans JS, mouvement réduit — est la VALEUR FINALE ; le dessin s'arme juste après
 * l'hydratation, le temps d'une image. Il n'est plus gaté par `useInView` : le
 * dessin doit rembobiner l'anneau pour démarrer, et un rembobinage déclenché au
 * scroll se voyait (anneau juste, puis vidé d'un coup, puis redessiné).
 *
 * ⚠️ ET LE NOMBRE SUIT L'ANNEAU — `startOnView={false}`. Une revue en contexte
 * frais a relevé que déplacer le seul ARC à l'hydratation laissait la moitié du
 * défaut vivante : `AnimatedNumber` reste gaté au scroll (`once`, `amount: 0.4`)
 * et son compteur repart de zéro. Le membre scrollait donc jusqu'à un anneau
 * déjà plein dont le CHIFFRE se remettait à 0 pour recompter sous ses yeux.
 * Couper le compteur plutôt que le rembobiner : la valeur est juste dès le
 * premier rendu, l'anneau porte le mouvement, et plus rien ne ment.
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
  const radius = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * radius;
  const center = size / 2;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const offset = circ - fraction * circ;
  // Au repos — serveur, premier rendu client, sans JS, mouvement réduit —
  // l'anneau est directement à sa valeur finale ; le dessin s'arme après
  // hydratation (cf. l'en-tête : plus de gate `inView`, il se voyait).
  const armed = useAfterHydration() && !prefersReduced;

  return (
    <div
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
          // ⚠️ L'ARMEMENT NE DÉPEND PLUS DE `inView`, ET C'EST UN ARBITRAGE ASSUMÉ.
          //
          // Le rendu de base doit être la VALEUR FINALE (c'est ce que le serveur
          // écrit, et ce qu'un membre sans JS ou en mouvement réduit doit voir).
          // Un dessin « qui démarre vide » exige donc de REMBOBINER après coup.
          // Tant que ce rembobinage suit immédiatement l'hydratation il dure une
          // image et personne ne le voit ; gaté par `inView`, il pouvait survenir
          // plusieurs SECONDES plus tard — l'anneau s'affichait juste, puis se
          // vidait d'un coup sous les yeux du membre avant de se redessiner.
          //
          // Entre « le dessin se déclenche au scroll » et « l'anneau ne ment
          // jamais », on garde le second. Le déclencheur `useInView` disparaît
          // donc d'ici, et avec lui la seule chose qui l'utilisait.
          initial={false}
          animate={armed ? { strokeDashoffset: [circ, offset] } : { strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <AnimatedNumber
          value={Math.round(value)}
          // Voir l'en-tête : l'arc s'anime à l'hydratation, donc un compteur
          // encore gaté au scroll rembobinerait le chiffre bien après.
          startOnView={false}
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
