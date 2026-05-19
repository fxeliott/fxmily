import { z } from 'zod';

import { localDateOf, shiftLocalDate } from '@/lib/checkin/timezone';
import {
  getMindsetInstrument,
  MINDSET_LIKERT_MAX,
  MINDSET_LIKERT_MIN,
} from '@/lib/mindset/instrument';

/**
 * V1.5 — `MindsetCheck` Zod schema (SPEC §27, jalon #3 séquence §21.6).
 *
 * Single source of truth for the wizard's per-step validation AND the Server
 * Action re-validation. Server is the only authority (SPEC §27.4).
 *
 * Mirrors `training-debrief.ts` for the `weekStart` Monday/window validator
 * (§27.7 invariant, carbon of §23.7). DELIBERATE divergence from that
 * template: the instrument is 100 % closed (Likert only) — there is ZERO
 * free-text, hence NO `safeFreeText`/`containsBidiOrZeroWidth` import and NO
 * crisis/injection corpus (SPEC §27.6/§27.7: closed instrument ⇒ no
 * `detectCrisis`/`detectInjection` surface at all). Adding an empty-corpus
 * helper "just in case" would be dead code against a scenario §27 forbids.
 *
 * Cross-field rule: `responses` is validated STRICTLY against the frozen
 * instrument identified by `instrumentVersion` — every item of that version
 * must be answered, no unknown item id, each value an integer in [1, 5]
 * (SPEC §27.3/§27.4). Longitudinal validity is the aggregator's job
 * (intra-version segmentation, SPEC §27.7) — here we only gate one payload.
 *
 * Posture §2: structure-only validation, zero P&L, zero market analysis,
 * never references the Lhedge system.
 */

// =============================================================================
// Constants
// =============================================================================

export const MINDSET_WEEK_PAST_HORIZON_DAYS = 35; // 5 weeks back
export const MINDSET_WEEK_FUTURE_HORIZON_DAYS = 7; // 1 week forward

const MIN_DATE = '2020-01-01';

// =============================================================================
// Field-level schemas
// =============================================================================

/**
 * `weekStart` validator: ISO `YYYY-MM-DD` that
 *   (1) is a calendar-valid date,
 *   (2) is a Monday,
 *   (3) falls within `[-35d, +7d]` of *today in Europe/Paris*.
 *
 * Carbon of `trainingDebriefWeekStartSchema` (§23.7). Monday check uses an
 * explicit `Date.UTC(y, m-1, d)` construction from the validated integer
 * parts + `getUTCDay()` — NOT a naive `new Date(string).getUTCDay()`, which
 * the §27.7 invariant (PR#96 nocturnal flake) forbids. The window anchors
 * "today" via `localDateOf(now, 'Europe/Paris')` + `shiftLocalDate`, NEVER
 * `new Date().toISOString().slice(0, 10)`. Europe/Paris is the V1 cohort
 * timezone (all members FR); a multi-tz V2 would thread `User.timezone`.
 */
export const mindsetWeekStartSchema = z
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
  )
  .refine(
    (s) => {
      const [yearStr, monthStr, dayStr] = s.split('-');
      const d = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
      // JS: 1 = Monday (Mon=1, Sun=0). Explicit UTC construction → deterministic.
      return d.getUTCDay() === 1;
    },
    { message: 'La semaine doit commencer un lundi.' },
  )
  .refine((s) => s >= MIN_DATE, { message: 'Date trop ancienne.' })
  .refine(
    (s) => {
      const todayParis = localDateOf(new Date(), 'Europe/Paris');
      const upper = shiftLocalDate(todayParis, MINDSET_WEEK_FUTURE_HORIZON_DAYS);
      return s <= upper;
    },
    { message: 'Date dans le futur.' },
  )
  .refine(
    (s) => {
      const todayParis = localDateOf(new Date(), 'Europe/Paris');
      const lower = shiftLocalDate(todayParis, -MINDSET_WEEK_PAST_HORIZON_DAYS);
      return s >= lower;
    },
    { message: `Date trop ancienne (>${MINDSET_WEEK_PAST_HORIZON_DAYS} j).` },
  );

/** Likert frequency anchor: an integer in [1, 5] (SPEC §27.3). */
const likertValueSchema = z
  .number()
  .int('Réponse invalide.')
  .min(MINDSET_LIKERT_MIN, 'Réponse invalide.')
  .max(MINDSET_LIKERT_MAX, 'Réponse invalide.');

// =============================================================================
// Main schema — Server Action input
// =============================================================================

export const mindsetCheckSchema = z
  .object({
    weekStart: mindsetWeekStartSchema,
    instrumentVersion: z.number().int().positive(),
    /** Map `itemId → Likert 1..5`. Exhaustively validated below. */
    responses: z.record(z.string(), likertValueSchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    const instrument = getMindsetInstrument(data.instrumentVersion);
    if (!instrument) {
      ctx.addIssue({
        code: 'custom',
        path: ['instrumentVersion'],
        message: "Version d'instrument inconnue.",
      });
      return;
    }
    const expectedIds = new Set(instrument.items.map((item) => item.id));
    for (const key of Object.keys(data.responses)) {
      if (!expectedIds.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['responses', key],
          message: 'Item inconnu pour cette version.',
        });
      }
    }
    for (const id of expectedIds) {
      if (!(id in data.responses)) {
        ctx.addIssue({
          code: 'custom',
          path: ['responses', id],
          message: 'Réponse manquante.',
        });
      }
    }
  });

export type MindsetCheckInput = z.infer<typeof mindsetCheckSchema>;
