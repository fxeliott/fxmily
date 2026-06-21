/**
 * Emotion-moment phase — the captured emotional moment a `/patterns`
 * emotion×outcome table is sliced by (SPEC §7.5): `before` / `during` / `after`.
 *
 * Lives in a NEUTRAL module (no `'use client'`, no `server-only`) so BOTH the
 * server route (`app/patterns/page.tsx`, which validates the `?phase=` search
 * param) and the client picker (`components/patterns/emotion-phase-picker.tsx`)
 * import it. A client module may not export a function that the server calls —
 * doing so throws "Attempted to call isEmotionPhase() from the server but it is
 * on the client" at render time (RSC boundary). This shared module is the fix.
 */

export const EMOTION_PHASES = ['before', 'during', 'after'] as const;
export type EmotionPhase = (typeof EMOTION_PHASES)[number];

/** Narrow an untrusted `?phase=` value to a valid `EmotionPhase`. */
export function isEmotionPhase(value: string | undefined): value is EmotionPhase {
  return value === 'before' || value === 'during' || value === 'after';
}
