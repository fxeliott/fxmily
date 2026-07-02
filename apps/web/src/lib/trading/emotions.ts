/**
 * Emotion tags tracked on each trade (J2, SPEC §6.2 + §7.3).
 *
 * Curated set of 15 tags inspired by:
 *   - Mark Douglas, *Trading in the Zone* — the four core fears
 *   - Brett Steenbarger's emotional state framework
 *   - Tradervue / Edgewonk industry tagging conventions (2025–2026)
 *
 * Design notes:
 *   - Slugs are EN, kebab-cased, persisted in `Trade.emotionBefore` /
 *     `emotionDuring` / `emotionAfter` (Postgres `text[]`). Labels are FR (UI
 *     lang). The three moments capture the "avant / pendant / après" axis
 *     (master prompt §22). Same allowlist for all three.
 *   - The wizard caps a selection to 3 tags per moment to force priorisation.
 *     We don't enforce in DB; the SPEC §7.3 says "tags multiples", so future
 *     features (admin tagging, retro-edits) may exceed 3.
 *   - Tags are ordered by cluster, NOT alphabetically — ordering is part of
 *     the UX (peurs en premier comme ancre Mark Douglas, biais en dernier).
 */

import { checkinEmotionLabel } from '@/lib/checkin/emotions';

export const EMOTION_CLUSTERS = ['douglas-fears', 'states', 'biases'] as const;
export type EmotionCluster = (typeof EMOTION_CLUSTERS)[number];

interface EmotionTagDefinition {
  /** Stable DB slug, never localised. */
  slug: string;
  /** FR label shown in the UI. */
  label: string;
  /** Optional hint shown on hover/long-press (≤ 80 chars). */
  hint?: string;
  cluster: EmotionCluster;
}

export const EMOTION_TAGS: readonly EmotionTagDefinition[] = [
  // The four core fears (Mark Douglas) — anchor of the Fxmily psychology framework
  {
    slug: 'fear-loss',
    label: 'Peur de perdre',
    hint: 'Crainte de voir le compte baisser, attachement au capital.',
    cluster: 'douglas-fears',
  },
  {
    slug: 'fear-wrong',
    label: 'Peur de se tromper',
    hint: "Besoin d'avoir raison, pression de l'ego.",
    cluster: 'douglas-fears',
  },
  {
    slug: 'fomo',
    label: 'FOMO',
    hint: "Peur de manquer l'opportunité.",
    cluster: 'douglas-fears',
  },
  {
    slug: 'fear-leaving-money',
    label: 'Peur de laisser sur la table',
    hint: 'Peur de couper trop tôt un trade gagnant.',
    cluster: 'douglas-fears',
  },
  // Emotional states
  {
    slug: 'calm',
    label: 'Calme',
    cluster: 'states',
  },
  {
    slug: 'confident',
    label: 'Confiance',
    cluster: 'states',
  },
  {
    slug: 'anxious',
    label: 'Anxiété',
    cluster: 'states',
  },
  {
    slug: 'frustrated',
    label: 'Frustration',
    cluster: 'states',
  },
  {
    slug: 'bored',
    label: 'Ennui',
    cluster: 'states',
  },
  {
    slug: 'euphoric',
    label: 'Euphorie',
    cluster: 'states',
  },
  {
    slug: 'doubt',
    label: 'Doute',
    cluster: 'states',
  },
  {
    slug: 'hesitant',
    label: 'Hésitation',
    cluster: 'states',
  },
  // Behavioural biases
  {
    slug: 'revenge-trade',
    label: 'Vengeance',
    hint: 'Volonté de récupérer rapidement une perte précédente.',
    cluster: 'biases',
  },
  {
    slug: 'overconfident',
    label: 'Sur-confiance',
    hint: 'Sensation d’infaillibilité après une série gagnante.',
    cluster: 'biases',
  },
  {
    slug: 'impatient',
    label: 'Impatience',
    cluster: 'biases',
  },
] as const;

export const EMOTION_SLUGS = EMOTION_TAGS.map((t) => t.slug) as readonly string[];

const EMOTION_SLUGS_SET: ReadonlySet<string> = new Set(EMOTION_SLUGS);

export function isEmotionSlug(value: string): boolean {
  return EMOTION_SLUGS_SET.has(value);
}

const EMOTION_BY_SLUG: Record<string, EmotionTagDefinition> = Object.fromEntries(
  EMOTION_TAGS.map((t) => [t.slug, t]),
);

export function emotionLabel(slug: string): string {
  // Trade rows can carry check-in vocabulary (seed/legacy data was observed in
  // prod rendering raw slugs like `focused`) — fall back to the check-in
  // referential before surfacing the bare slug.
  return EMOTION_BY_SLUG[slug]?.label ?? checkinEmotionLabel(slug);
}

/** Maximum tags selectable for a single emotional moment (before / after). */
export const EMOTION_MAX_PER_MOMENT = 3;

/**
 * S15 #5 — semantic poles for the "emotion-arc degradation" signal (entering a
 * trade composed, then losing composure during/after — the Mark Douglas marker
 * of a psychologically mishandled trade, independent of P&L).
 *
 * NEGATIVE = the four core fears + all behavioural biases + the negative
 * `states` (anxious/frustrated/euphoric/doubt/hesitant). `euphoric` counts as
 * negative (loss-of-discipline pole). `bored` is intentionally EXCLUDED: boredom
 * is a pre-trade restlessness axis, not a "contrarié" exit state.
 */
export const NEGATIVE_TRADING_EMOTIONS: ReadonlySet<string> = new Set<string>([
  'fear-loss',
  'fear-wrong',
  'fomo',
  'fear-leaving-money',
  'anxious',
  'frustrated',
  'euphoric',
  'doubt',
  'hesitant',
  'revenge-trade',
  'overconfident',
  'impatient',
]);

/** SERENE = a composed entry ("entered calm"). */
export const SERENE_ENTRY_EMOTIONS: ReadonlySet<string> = new Set<string>(['calm', 'confident']);
