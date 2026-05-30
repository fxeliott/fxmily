import { z } from 'zod';

/**
 * V1.7 §30 — Meeting attendance declaration Zod schema (J-M1 data layer).
 *
 * Single source of truth for the J-M2 wizard's validation AND the Server
 * Action re-validation. Server is the only authority (carbon-copy V1.5 §27
 * mindset-check / V2.3 pre-trade-check Zod pattern).
 *
 * A member self-declares, for one past `Meeting`, two components (SPEC §30.3):
 *   - `attendanceMode` : how they attended (live Zoom OR Drive replay)
 *   - `contentReviewed`: did they read the associated Ichor content
 *                        (analyse@12h / bilan@20h)?
 *
 * A complete attendance (counts toward the rate numerator) = `attendanceMode`
 * set AND `contentReviewed === true`.
 *
 * `meetingId` is part of the payload because — unlike `userId`, which the
 * Server Action derives from `auth()` — the target meeting is UNTRUSTED member
 * input and must be validated (capped length = anti heap-amplification, mirror
 * V1.10 `userIdSchema.max(40)` sec hardening). The service then re-checks the
 * meeting is past / not-cancelled / in-window before persisting (J-M2 guard).
 *
 * **No free-text fields → no `safeFreeText` / `containsBidiOrZeroWidth` import,
 * no crisis surface, no injection surface, no EU AI Act banner.** Adding any
 * "just in case" would be dead code against the scope-locked instrument
 * (the only free-text in §30 is the admin `cancelledReason`, J-M3).
 *
 * Posture §2: structure-only, the app NEVER stores/displays the Ichor content
 * — `contentReviewed` is a boolean, never the analysis itself.
 */

/** The two attendance modes — exported for UI re-use + anti-regression asserts. */
export const MEETING_ATTENDANCE_MODES = ['live', 'replay'] as const;
export type MeetingAttendanceModeName = (typeof MEETING_ATTENDANCE_MODES)[number];

/**
 * Target meeting id. cuid is 25 chars; cap at 40 (cuid 25 + margin) to reject
 * oversized payloads at the Zod boundary before any DB hit.
 */
export const meetingIdSchema = z
  .string()
  .trim()
  .min(1, { error: 'Réunion requise.' })
  .max(40, { error: 'Identifiant de réunion invalide.' });

/**
 * Strict 3-field declaration. `.strict()` rejects unknown keys
 * defense-in-depth against a future UI bug adding an extra payload field.
 */
export const meetingAttendanceDeclarationSchema = z
  .object({
    meetingId: meetingIdSchema,
    attendanceMode: z.enum(MEETING_ATTENDANCE_MODES, { error: 'Mode de présence invalide.' }),
    contentReviewed: z.boolean({ error: 'Réponse oui/non requise pour la lecture du contenu.' }),
  })
  .strict();

export type MeetingAttendanceDeclarationInput = z.infer<typeof meetingAttendanceDeclarationSchema>;
