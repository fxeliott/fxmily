import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import { TRADING_PAIRS } from '@/lib/trading/pairs';

/**
 * Backtest-session schema (S8 Mode Entraînement — "crée une session de
 * backtest", brief §31 DoD#1). A `TrainingSession` groups the `TrainingTrade`
 * entries logged during one practice sitting (one instrument / timeframe /
 * replay period). It is a pure ORGANISATIONAL container that lives 100% inside
 * the §21.5 training world: NO link to any real-edge model.
 *
 * STATISTICAL ISOLATION (SPEC §21.5): this module references no real-edge
 * schema; a `TrainingSession` never reaches `/journal`, scoring, expectancy or
 * the Habit×Trade correlation. The activity signal that feeds the real edge
 * stays `countRecentTrainingActivity` (counts BACKTESTS, never sessions) — a
 * session container changes nothing on that channel.
 *
 * Every field is OPTIONAL (the model columns are all nullable): a member can
 * open a session with just a label, or with the full instrument/timeframe/notes
 * context. All free text is hardened at the Zod edge (`safeFreeText` + reject
 * bidi/zero-width = Trojan-Source canon Fxmily), exactly like
 * `training-trade.ts` / `training-annotation.ts`.
 */

/** Hard upper bound on the session label. ~120 chars = a descriptive title
 * ("Backtest GBPUSD — range janvier 2024"). */
export const TRAINING_SESSION_LABEL_MAX = 120;

/** Hard upper bound on the session notes free text (mirror
 * `TRAINING_LESSON_MAX`). */
export const TRAINING_SESSION_NOTES_MAX = 2000;

/** Hard upper bound on the timeframe label ("M15", "H1", "D1"). Short free
 * string, no enum (mirror the `pair` rationale: the list evolves without a
 * migration). */
export const TRAINING_SESSION_TIMEFRAME_MAX = 12;

/**
 * Optional hardened free text. Empty / whitespace-only → `null` (the column is
 * nullable). When present: trim → reject bidi/zero-width → `safeFreeText`
 * (NFC + strip), then enforce the max.
 */
function optionalHardenedText(max: number, tooLongMsg: string) {
  return z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .transform((v) => (v.length === 0 ? null : v))
    .refine((v) => v === null || !containsBidiOrZeroWidth(v), 'Caractères de contrôle interdits.')
    .transform((v) => (v === null ? null : safeFreeText(v)))
    .refine((v) => v === null || v.length <= max, tooLongMsg);
}

/** Optional instrument — allowlisted uppercase pair (mirror `TrainingTrade.
 * pair`) or empty → null. Reusing the same allowlist keeps the session symbol
 * consistent with the backtests logged inside it. */
const symbolSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
  .transform((v) => (v.length === 0 ? null : v))
  .refine(
    (v): v is null | (typeof TRADING_PAIRS)[number] =>
      v === null || (TRADING_PAIRS as readonly string[]).includes(v),
    { message: 'Paire non autorisée.' },
  );

/** Optional timeframe — short free token (uppercased, alnum), or empty → null. */
const timeframeSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''))
  .transform((v) => (v.length === 0 ? null : v))
  .refine(
    (v) => v === null || /^[A-Z0-9]{1,12}$/.test(v),
    `Timeframe invalide (max ${TRAINING_SESSION_TIMEFRAME_MAX} caractères alphanumériques).`,
  );

export const trainingSessionCreateSchema = z.object({
  label: optionalHardenedText(
    TRAINING_SESSION_LABEL_MAX,
    `Maximum ${TRAINING_SESSION_LABEL_MAX} caractères.`,
  ),
  symbol: symbolSchema,
  timeframe: timeframeSchema,
  notes: optionalHardenedText(
    TRAINING_SESSION_NOTES_MAX,
    `Maximum ${TRAINING_SESSION_NOTES_MAX} caractères.`,
  ),
});

export type TrainingSessionCreateInput = z.infer<typeof trainingSessionCreateSchema>;

/**
 * A backtest trade may be logged inside a session. The wizard passes the
 * parent session id as an opaque cuid; the Server Action re-checks OWNERSHIP
 * (the session must belong to the acting member) before attaching. Empty /
 * absent → null (a standalone backtest, unchanged behaviour).
 */
export const trainingSessionIdSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim() : ''))
  .transform((v) => (v.length === 0 ? null : v))
  .refine((v) => v === null || /^[a-z0-9]{20,40}$/i.test(v), 'Session invalide.');
