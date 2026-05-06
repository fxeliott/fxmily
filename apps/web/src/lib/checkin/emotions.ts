/**
 * Emotion tags for daily check-ins (J5, SPEC §6.4 + §7.4).
 *
 * Distinct from `lib/trading/emotions.ts` because the daily check-in shape is
 * broader than the trade moment: it covers state/mood vocabulary used outside
 * a specific trade. We anchor the `pressure` cluster on Mark Douglas's four
 * core fears from *Trading in the Zone* (being wrong, losing money, missing
 * out, leaving money on the table — slugs `fearful`, `fomo`, `greedy`,
 * `doubt`/`overwhelmed`/`frustrated`) so the check-in surface vocabulary
 * mirrors the trade emotion picker. The `mood` cluster also exposes positive
 * counterparts (`disciplined`, `confident`) so a member can journal a good
 * day, not just a hard one.
 *
 * Slugs persisted in `DailyCheckin.emotionTags` (Postgres `text[]`). Labels FR.
 */

export const CHECKIN_EMOTION_CLUSTERS = ['vitality', 'mood', 'pressure'] as const;
export type CheckinEmotionCluster = (typeof CHECKIN_EMOTION_CLUSTERS)[number];

interface CheckinEmotionTag {
  /** DB slug, never localised. */
  slug: string;
  /** FR label shown in the UI. */
  label: string;
  /** Optional ≤80-char hint for tooltips / aria-label. */
  hint?: string;
  cluster: CheckinEmotionCluster;
}

export const CHECKIN_EMOTION_TAGS: readonly CheckinEmotionTag[] = [
  // Vitality — physical/energetic state. Mostly relevant in the morning slot.
  { slug: 'rested', label: 'Reposé', cluster: 'vitality' },
  { slug: 'energetic', label: 'Énergique', cluster: 'vitality' },
  { slug: 'tired', label: 'Fatigué', cluster: 'vitality' },
  { slug: 'foggy', label: 'Brouillard mental', cluster: 'vitality', hint: 'Manque de clarté.' },

  // Mood — baseline state, positive + neutral. Both slots.
  { slug: 'calm', label: 'Calme', cluster: 'mood' },
  { slug: 'focused', label: 'Concentré', cluster: 'mood' },
  {
    slug: 'confident',
    label: 'Confiant',
    cluster: 'mood',
    hint: 'Sûr de ton edge, pas euphorique.',
  },
  { slug: 'disciplined', label: 'Discipliné', cluster: 'mood', hint: 'Aligné avec ton plan.' },
  { slug: 'irritable', label: 'Irritable', cluster: 'mood' },
  { slug: 'anxious', label: 'Anxieux', cluster: 'mood' },

  // Pressure — Douglas-aligned fears + emotional load (evening retrospective).
  {
    slug: 'fearful',
    label: 'Craintif',
    hint: 'Peur active de perdre — Douglas, peur n°2.',
    cluster: 'pressure',
  },
  {
    slug: 'fomo',
    label: 'FOMO',
    hint: 'Peur de manquer une opportunité — Douglas, peur n°3.',
    cluster: 'pressure',
  },
  {
    slug: 'greedy',
    label: 'Avide',
    hint: 'Tentation de pousser ou sur-sizer — Douglas, peur n°4 (laisser sur la table).',
    cluster: 'pressure',
  },
  {
    slug: 'overwhelmed',
    label: 'Submergé',
    hint: 'Trop d’infos, trop d’émotions.',
    cluster: 'pressure',
  },
  { slug: 'frustrated', label: 'Frustré', cluster: 'pressure' },
  {
    slug: 'tilted',
    label: 'En tilt',
    hint: 'Réactif émotionnellement, hors du plan.',
    cluster: 'pressure',
  },
  {
    slug: 'doubt',
    label: 'Doute',
    cluster: 'pressure',
    hint: 'Peur d’être dans l’erreur — Douglas, peur n°1.',
  },
] as const;

export const CHECKIN_EMOTION_SLUGS = CHECKIN_EMOTION_TAGS.map((t) => t.slug) as readonly string[];

const SLUGS_SET: ReadonlySet<string> = new Set(CHECKIN_EMOTION_SLUGS);

export function isCheckinEmotionSlug(value: string): boolean {
  return SLUGS_SET.has(value);
}

const TAG_BY_SLUG: Record<string, CheckinEmotionTag> = Object.fromEntries(
  CHECKIN_EMOTION_TAGS.map((t) => [t.slug, t]),
);

export function checkinEmotionLabel(slug: string): string {
  return TAG_BY_SLUG[slug]?.label ?? slug;
}

/** Cap on tags selectable per check-in slot (matches trade emotions). */
export const CHECKIN_EMOTION_MAX_PER_SLOT = 3;

export const CHECKIN_EMOTION_CLUSTER_LABEL: Record<CheckinEmotionCluster, string> = {
  vitality: 'Vitalité',
  mood: 'Humeur',
  pressure: 'Pression',
};
