/**
 * V2.3 ext #2 — Session HH frontend pure formatters (Server Component-safe).
 *
 * Extracted to a separate module so we can RTL-test the formatters without
 * dragging an `async` Server Component into the Vitest runtime (which would
 * require `@testing-library/react/server` or jsdom Server-Side hydration
 * tricks). Carbone pattern J6 / V2.1.3 helpers extraction.
 *
 * Pure functions only — no React, no `'use client'`, no `Date.now()`, no
 * locale leak (formatters explicitly receive `fr-FR` for SPEC §16 Europe/Paris).
 */

import type { ReasonCounts } from '@/lib/pre-trade/analytics';

/**
 * Label FR canonique des 4 raisons (carbone ADR-003 enum PreTradeReason).
 * Mark Douglas posture (SPEC §2) : observation neutre, jamais punition.
 */
export const REASON_LABEL_FR: Record<keyof ReasonCounts, string> = {
  edge: 'Edge',
  fomo: 'FOMO',
  revenge: 'Revanche',
  boredom: 'Ennui',
};

/**
 * Tone DS-v2 par raison. **DECISION VERROUILLÉE** (Mark Douglas + Yu-kai Chou
 * anti-Black-Hat) : seul `edge` reçoit l'accent lime ; les 3 autres reçoivent
 * un ton neutre (`t-3` slate). JAMAIS rouge sur `fomo`/`revenge`/`boredom`
 * — le membre observe ses patterns, il ne se fait pas punir visuellement.
 */
export const REASON_TONE: Record<keyof ReasonCounts, 'acc' | 'mute'> = {
  edge: 'acc',
  fomo: 'mute',
  revenge: 'mute',
  boredom: 'mute',
};

/**
 * Ordre canonique d'affichage. `edge` en tête (le seul accentué) puis les 3
 * neutres dans l'ordre Mark Douglas / Steenbarger : peur de rater (FOMO) →
 * revanche post-perte → boredom (extension Steenbarger Daily Trading Coach
 * Lesson 23, ADR-003 §Honesty disclaimer).
 */
export const REASON_ORDER: ReadonlyArray<keyof ReasonCounts> = [
  'edge',
  'fomo',
  'revenge',
  'boredom',
] as const;

/**
 * Formate un ratio `[0, 1]` en pourcentage entier FR (jamais de décimal au-delà
 * de 30 membres — bruit > signal). `0.7833` → `"78 %"`. Espace insécable géré
 * par `Intl.NumberFormat`. Clamp défensif au cas où un caller passe un ratio
 * hors `[0, 1]`.
 */
export function formatRatePercent(rate: number): string {
  const safe = Math.max(0, Math.min(1, rate));
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(safe);
}

/**
 * Sample size label FR : `"n = 23"`. Garde l'espace fine insécable autour du
 * `=` (typographie FR). Cap à 999 → `"n ≥ 999"` (V2 si jamais quelqu'un
 * dépasse).
 */
export function formatSampleSize(n: number): string {
  if (n >= 999) return 'n ≥ 999';
  return `n = ${n}`;
}

/**
 * Copy pédagogique pour les 2 variants `insufficient_data`. Distincts pour
 * que l'UI guide le membre :
 *   - `no_checks` (n=0) → invite à faire son 1er check
 *   - `below_threshold` (1 ≤ n < 8) → décompte vers le seuil
 *
 * Posture Mark Douglas : phrase factuelle, jamais culpabilisante.
 */
export function emptyCopyForReason(
  reason: 'no_checks' | 'below_threshold',
  sampleSize: number,
  minSample: number,
): { title: string; subtitle: string } {
  if (reason === 'no_checks') {
    return {
      title: 'Pas encore de pré-trade check',
      subtitle: `Fais ton premier check avant un trade pour commencer à voir tes patterns. Il en faut ${minSample} pour des stats honnêtes.`,
    };
  }
  const remaining = Math.max(0, minSample - sampleSize);
  return {
    title: `Encore ${remaining} check${remaining > 1 ? 's' : ''} pour tes stats`,
    subtitle: `${sampleSize} check${sampleSize > 1 ? 's' : ''} fait${sampleSize > 1 ? 's' : ''}, ${minSample} minimum pour calculer un pourcentage qui veut dire quelque chose.`,
  };
}

/**
 * Pourcentage de chaque raison dans la distribution. Utilisé pour les bars
 * largeurs visuelles. Returns 0 si `sampleSize === 0` (safe pour éviter
 * division par zéro).
 */
export function distributionPercents(
  distribution: ReasonCounts,
  sampleSize: number,
): Record<keyof ReasonCounts, number> {
  if (sampleSize <= 0) return { edge: 0, fomo: 0, revenge: 0, boredom: 0 };
  return {
    edge: (distribution.edge / sampleSize) * 100,
    fomo: (distribution.fomo / sampleSize) * 100,
    revenge: (distribution.revenge / sampleSize) * 100,
    boredom: (distribution.boredom / sampleSize) * 100,
  };
}
