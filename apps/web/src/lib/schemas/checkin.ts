import { z } from 'zod';

import { CHECKIN_EMOTION_MAX_PER_SLOT, isCheckinEmotionSlug } from '@/lib/checkin/emotions';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * Daily check-in schemas (J5, SPEC §6.4 + §7.4).
 *
 * Single source of truth for the morning + evening Server Actions and the
 * wizards' per-step validation. Inputs come as `FormData` strings — we use
 * `z.coerce` to normalise then constrain.
 *
 * The DB shape is permissive (most fields nullable) so a future "fill what
 * you remember" flow keeps working. The schemas are strict per slot:
 *   - Morning : sleep + routine + mood mandatory.
 *   - Evening : plan respect + stress + mood mandatory.
 * Optional fields (sport, gratitude, journal note) accept empty strings and
 * collapse to null/undefined to keep the wizard's HTML form simple.
 */

const TODAY_HORIZON_DAYS = 1;
const PAST_HORIZON_DAYS = 60; // members can backfill up to 2 months ago
const MIN_DATE = '2020-01-01';

/** YYYY-MM-DD with calendar validity check. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
  .refine(
    (s) => {
      const [yearStr, monthStr, dayStr] = s.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const d = new Date(Date.UTC(year, month - 1, day));
      return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
    },
    { message: 'Date calendaire invalide.' },
  );

const dateInWindow = localDateSchema
  .refine((s) => s >= MIN_DATE, { message: 'Date trop ancienne.' })
  .refine(
    (s) => {
      // Accept up to TODAY+1 to absorb timezone drift between the browser and
      // server. Reject anything further in the future.
      const today = new Date();
      today.setUTCDate(today.getUTCDate() + TODAY_HORIZON_DAYS);
      const upper = today.toISOString().slice(0, 10);
      return s <= upper;
    },
    { message: 'Date dans le futur.' },
  )
  .refine(
    (s) => {
      const horizon = new Date();
      horizon.setUTCDate(horizon.getUTCDate() - PAST_HORIZON_DAYS);
      const lower = horizon.toISOString().slice(0, 10);
      return s >= lower;
    },
    { message: 'Date trop ancienne (>60 j).' },
  );

const triStateBoolean = z
  .union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('na')])
  .transform((v) => {
    if (v === 'na') return null;
    if (typeof v === 'string') return v === 'true';
    return v;
  });

/**
 * `z.coerce.boolean()` is a footgun: `Boolean("false")` is `true`. We accept
 * the FormData strings "true"/"false" explicitly and the native boolean.
 */
const formBoolean = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

const optionalCoercedInt = (max: number) =>
  z
    .union([
      z.literal(''),
      z.coerce
        .number({ message: 'Nombre invalide.' })
        .int({ message: 'Entier requis.' })
        .min(0)
        .max(max),
    ])
    .transform((v) => (v === '' ? null : v));

const optionalCoercedDecimal = (max: number) =>
  z
    .union([z.literal(''), z.coerce.number({ message: 'Nombre invalide.' }).min(0).max(max)])
    .transform((v) => (v === '' ? null : v));

const intRange = (min: number, max: number, message: string) =>
  z.coerce
    .number({ message })
    .int({ message: 'Entier requis.' })
    .min(min, message)
    .max(max, message);

const checkinEmotionTags = z
  .array(z.string())
  .max(CHECKIN_EMOTION_MAX_PER_SLOT, `Max ${CHECKIN_EMOTION_MAX_PER_SLOT} émotions.`)
  .refine((tags) => tags.every(isCheckinEmotionSlug), { message: 'Émotion inconnue.' })
  .refine((tags) => new Set(tags).size === tags.length, { message: 'Doublons interdits.' });

// =============================================================================
// Morning slot
// =============================================================================

export const morningCheckinSchema = z
  .object({
    date: dateInWindow,

    sleepHours: z.coerce
      .number({ message: 'Heures de sommeil invalides.' })
      .min(0, 'Au moins 0.')
      .max(24, 'Maximum 24h.'),
    sleepQuality: intRange(1, 10, 'Qualité de sommeil entre 1 et 10.'),

    morningRoutineCompleted: formBoolean,
    meditationMin: z.coerce
      .number({ message: 'Méditation invalide.' })
      .int('Entier requis.')
      .min(0, 'Au moins 0.')
      .max(240, 'Maximum 240 min.'),

    sportType: z
      .string()
      .max(80)
      .optional()
      .or(z.literal(''))
      .refine((v) => v == null || v === '' || !containsBidiOrZeroWidth(v), {
        message: 'Caractères de contrôle interdits.',
      })
      .transform((v) => (v == null || v === '' ? '' : safeFreeText(v))),
    sportDurationMin: z
      .union([z.literal(''), z.coerce.number().int().min(0).max(600)])
      .transform((v) => (v === '' ? null : v)),

    moodScore: intRange(1, 10, 'Humeur entre 1 et 10.'),
    // J5 audit M5 fix — strip bidi/zero-width controls + NFC normalize.
    // Critical: this string is injected into the J8 weekly Claude prompt.
    intention: z
      .string()
      .max(200, 'Intention trop longue (200 max).')
      .optional()
      .refine((v) => v == null || !containsBidiOrZeroWidth(v), {
        message: 'Caractères de contrôle interdits.',
      })
      .transform((v) => {
        if (v == null) return undefined;
        const cleaned = safeFreeText(v);
        return cleaned === '' ? undefined : cleaned;
      }),

    emotionTags: checkinEmotionTags,
  })
  .superRefine((data, ctx) => {
    // Sport: both fields together or neither. We check this BEFORE the
    // collapse-empty-to-null transform so the user-supplied combination is
    // still visible.
    const trimmedType = (data.sportType ?? '').trim();
    const hasType = trimmedType.length > 0;
    const hasDuration = data.sportDurationMin !== null;
    if (hasType && !hasDuration) {
      ctx.addIssue({
        code: 'custom',
        path: ['sportDurationMin'],
        message: 'Indique la durée du sport.',
      });
    }
    if (!hasType && hasDuration) {
      ctx.addIssue({
        code: 'custom',
        path: ['sportType'],
        message: 'Indique le type de sport.',
      });
    }
  })
  .transform((data) => {
    // Collapse the sport pair to a clean shape downstream.
    const trimmed = (data.sportType ?? '').trim();
    if (trimmed === '') {
      return { ...data, sportType: null, sportDurationMin: null };
    }
    return { ...data, sportType: trimmed };
  });

export type MorningCheckinInput = z.infer<typeof morningCheckinSchema>;

// =============================================================================
// Evening slot
// =============================================================================

export const eveningCheckinSchema = z.object({
  date: dateInWindow,

  planRespectedToday: formBoolean,
  hedgeRespectedToday: triStateBoolean,

  caffeineMl: optionalCoercedInt(2000),
  waterLiters: optionalCoercedDecimal(10),

  stressScore: intRange(1, 10, 'Stress entre 1 et 10.'),
  moodScore: intRange(1, 10, 'Humeur entre 1 et 10.'),

  emotionTags: checkinEmotionTags,

  // J5 audit M5 fix — same hardening as morning.intention. journalNote
  // grows up to 4000 chars and lands in the J8 weekly Claude prompt; a
  // hidden RTL override here would silently reorder the LLM's output.
  journalNote: z
    .string()
    .max(4000, 'Note trop longue (4000 max).')
    .optional()
    .refine((v) => v == null || !containsBidiOrZeroWidth(v), {
      message: 'Caractères de contrôle interdits.',
    })
    .transform((v) => {
      if (v == null) return undefined;
      const cleaned = safeFreeText(v);
      return cleaned === '' ? undefined : cleaned;
    }),

  gratitudeItems: z
    // Bound the array size first so a malicious caller can't ship 10 000
    // empty strings to bloat parsing (audit L4 + part of M5 hardening).
    .array(z.string().max(500))
    .max(20, 'Trop de gratitudes envoyées.')
    // Drop empties + bidi-clean each surviving entry before length-checking.
    .transform((items) => items.map((s) => safeFreeText(s)).filter((s) => s.length > 0))
    .pipe(
      z.array(z.string().max(200, 'Gratitude trop longue (200 max).')).max(3, 'Max 3 gratitudes.'),
    ),
});

export type EveningCheckinInput = z.infer<typeof eveningCheckinSchema>;
