import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

import { localDateSchema } from './checkin';

/**
 * Off-day ("jour off") declaration schema (Tour 14, SPEC pont).
 *
 * A member declares that they will not trade a given day. The declaration
 * NEITHER counts NOR breaks the streak, drops out of the fill-rate denominator
 * and silences the reminder / forgot accusation for that day (the pressure is
 * removed, never a filled entry — a check-in actually filed on an off day still
 * counts 100 %).
 *
 * Single source of truth for the `declareOffDayAction` Server Action. Inputs
 * arrive as strings — we normalise then constrain, mirroring `checkin.ts`.
 *
 * Date window: an off day is a FORWARD-looking intent, so the schema allows
 * today up to +30 civil days. The bounds here are a first UTC pass (they absorb
 * the ±1-day browser/server timezone drift the same way `dateInWindow` does);
 * the exact member-local `today → today+30` clamp is re-asserted TZ-aware in the
 * action (Zod = UTC first pass, action = TZ-aware second pass — same split as
 * the check-in date validation).
 */

/**
 * Forward horizon (in civil days) a member may declare off ahead of today.
 * Exported so the action's TZ-aware clamp and any UI date picker share ONE
 * bound — no drift where the UI offers a day the submit would then reject.
 */
export const OFF_DAY_FORWARD_HORIZON_DAYS = 30;

/**
 * Backward horizon (in civil days) a member may CANCEL an off day. Declaring is
 * forward-only (today → +30), but a member who mislabelled a recent day off must
 * be able to take it back — otherwise that day is wrongly dropped from the
 * denominators with no recourse (review P2, Tour 14). Kept short (a week) so the
 * correction stays a "recent mistake" fix, not a rewrite of settled history.
 */
export const OFF_DAY_CANCEL_BACK_HORIZON_DAYS = 7;

/** Small backward tolerance to absorb browser/server timezone drift (±1 day). */
const OFF_DAY_PAST_TOLERANCE_DAYS = 1;

const offDayDateInWindow = localDateSchema
  .refine(
    (s) => {
      // Reject days more than a tolerance behind today (UTC first pass). The
      // real "no past day" rule is enforced TZ-aware in the action.
      const lower = new Date();
      lower.setUTCDate(lower.getUTCDate() - OFF_DAY_PAST_TOLERANCE_DAYS);
      return s >= lower.toISOString().slice(0, 10);
    },
    { message: 'Un jour off se déclare pour aujourd’hui ou plus tard.' },
  )
  .refine(
    (s) => {
      const upper = new Date();
      upper.setUTCDate(
        upper.getUTCDate() + OFF_DAY_FORWARD_HORIZON_DAYS + OFF_DAY_PAST_TOLERANCE_DAYS,
      );
      return s <= upper.toISOString().slice(0, 10);
    },
    { message: 'Un jour off se déclare au plus tôt un mois à l’avance.' },
  );

/**
 * Optional free-text reason for the off day. EXACT mirror of `checkin.ts`'s
 * `lateJustificationField`: max 500, empty/omitted → `null`, bidi/zero-width
 * control characters REJECTED (never silently stripped — same defensible
 * posture), then NFC-normalised via `safeFreeText`. Hardened because the reason
 * is member free-text that is persisted and may be rendered to an admin later.
 */
const offDayReasonField = z
  .string()
  .max(500, 'Motif trop long (500 max).')
  .optional()
  .refine((v) => v == null || !containsBidiOrZeroWidth(v), {
    message: 'Caractères de contrôle interdits.',
  })
  .transform((v): string | null => {
    if (v == null) return null;
    const cleaned = safeFreeText(v);
    return cleaned === '' ? null : cleaned;
  });

/**
 * Cancel-window date: cancelling is allowed a little into the PAST (up to
 * `OFF_DAY_CANCEL_BACK_HORIZON_DAYS`, minus the drift tolerance) as well as the
 * forward horizon. First UTC pass only — the exact member-local `[today−7,
 * today+30]` clamp is re-asserted TZ-aware in the cancel action.
 */
const offDayDateInCancelWindow = localDateSchema
  .refine(
    (s) => {
      const lower = new Date();
      lower.setUTCDate(
        lower.getUTCDate() - OFF_DAY_CANCEL_BACK_HORIZON_DAYS - OFF_DAY_PAST_TOLERANCE_DAYS,
      );
      return s >= lower.toISOString().slice(0, 10);
    },
    { message: 'On ne peut annuler un jour off que jusqu’à une semaine en arrière.' },
  )
  .refine(
    (s) => {
      const upper = new Date();
      upper.setUTCDate(
        upper.getUTCDate() + OFF_DAY_FORWARD_HORIZON_DAYS + OFF_DAY_PAST_TOLERANCE_DAYS,
      );
      return s <= upper.toISOString().slice(0, 10);
    },
    { message: 'Date hors de la fenêtre autorisée.' },
  );

/** Declare an off day: a date (today → +30 days) + an optional reason. */
export const declareOffDaySchema = z.object({
  date: offDayDateInWindow,
  reason: offDayReasonField,
});

export type DeclareOffDayInput = z.infer<typeof declareOffDaySchema>;

/**
 * Cancel an off day: just the date. Validity + the (widened) window are checked
 * above; the member-local `[today−7, today+30]` clamp is re-asserted in the action.
 */
export const cancelOffDaySchema = z.object({
  date: offDayDateInCancelWindow,
});

export type CancelOffDayInput = z.infer<typeof cancelOffDaySchema>;

/**
 * Declare a RANGE of off days (vacances) — an inclusive `[from, to]` span, both
 * today → +30, plus an optional shared reason. The action upserts one
 * `MemberOffDay` per civil day in the span (idempotent per day). Bounds reuse
 * `offDayDateInWindow` (same forward-only rule as a single declaration); a
 * cross-field refine enforces `from <= to` (ISO strings compare lexicographically
 * = calendar order) and caps the span so a fat-fingered range cannot fan out into
 * an unbounded transaction. The exact member-local clamp is re-asserted in the action.
 */
export const declareOffDayRangeSchema = z
  .object({
    from: offDayDateInWindow,
    to: offDayDateInWindow,
    reason: offDayReasonField,
  })
  .refine((v) => v.from <= v.to, {
    message: 'La date de début doit précéder la date de fin.',
    path: ['to'],
  })
  .refine(
    (v) => {
      // Span length in civil days (inclusive). Capped at the forward horizon so
      // the per-day upsert transaction is always bounded (≤ 31 rows).
      const fromMs = Date.parse(`${v.from}T00:00:00.000Z`);
      const toMs = Date.parse(`${v.to}T00:00:00.000Z`);
      const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
      return days >= 1 && days <= OFF_DAY_FORWARD_HORIZON_DAYS + 1;
    },
    { message: 'La plage est trop longue (un mois maximum).', path: ['to'] },
  );

export type DeclareOffDayRangeInput = z.infer<typeof declareOffDayRangeSchema>;
