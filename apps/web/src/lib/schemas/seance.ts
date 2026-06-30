import { z } from 'zod';

import {
  SEANCE_CANCEL_REASON_MAX,
  SEANCE_SLOTS,
  SEANCE_STATUSES,
} from '@/lib/seances/admin-derive';

/**
 * Réunion hub (séances) — admin go/no-go Zod schema (J3).
 *
 * Single source of truth for the `/admin/seances` go/no-go control's validation
 * AND the Server Action re-validation. The server is the only authority (carbon
 * copy of `lib/schemas/meeting.ts` — the `meetingCancelSchema` mindset).
 *
 * The admin declares, per `(date, slot)`, the session `status` plus the two
 * fields the admin OWNS (static hub: the admin is the producer of `time`):
 *   - `time`    : the real start time ("HH:MM", optional → slot default),
 *   - `reason`  : the cancel note (free-text, only meaningful when cancelled),
 *                 `safeFreeText`-sanitised at the SERVICE boundary (NFC + bidi/
 *                 zero-width stripping) — the schema only bounds its length.
 *
 * `.strict()` rejects unknown keys (defence-in-depth against a future UI bug).
 * Posture §2 / PII-free: no member identity, no Ichor analysis — only the slot
 * coordinates + the admin's go/no-go intent reach the audit ({date, slot,
 * status}, never the reason text).
 */

/** Civil day `YYYY-MM-DD` — validated as a real calendar date by the service. */
export const seanceDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date invalide.' });

/** `<input type="time">` value: 24h "HH:MM". Optional (→ slot default). */
export const seanceTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { error: 'Heure invalide (HH:MM).' });

export const seanceGoNoGoSchema = z
  .object({
    date: seanceDateSchema,
    slot: z.enum(SEANCE_SLOTS, { error: 'Créneau invalide.' }),
    status: z.enum(SEANCE_STATUSES, { error: 'Statut invalide.' }),
    // Omit when empty so the optional field stays undefined (not '').
    time: seanceTimeSchema.optional(),
    reason: z
      .string()
      .trim()
      .max(SEANCE_CANCEL_REASON_MAX, {
        error: `Motif trop long (max ${SEANCE_CANCEL_REASON_MAX} caractères).`,
      })
      .optional(),
  })
  .strict();

export type SeanceGoNoGoInput = z.infer<typeof seanceGoNoGoSchema>;

/**
 * Regenerate-content request (J3 contract; J4 executes the real re-run). The
 * admin targets one `(date, slot)` to re-arm the AI step on a held session.
 */
export const seanceRegenerateSchema = z
  .object({
    date: seanceDateSchema,
    slot: z.enum(SEANCE_SLOTS, { error: 'Créneau invalide.' }),
  })
  .strict();

export type SeanceRegenerateInput = z.infer<typeof seanceRegenerateSchema>;
