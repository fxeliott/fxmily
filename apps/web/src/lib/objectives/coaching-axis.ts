import { safeFreeText } from '@/lib/text/safe';

/**
 * S24 — derivation of the member's personalised COACHING AXIS surfaced in the
 * objectives view. The axes come from the onboarding interview (Claude analysis
 * → `MemberProfile.axesPrioritaires`), i.e. the member's OWN "things to work on".
 * Until S24 they were only reachable as one weekly-rotated line on `/objectifs`,
 * with the coercion/rotation logic living page-local; this module is the single
 * pure, tested seam consumed by BOTH `/objectifs` and the dashboard hub.
 *
 * Pure (no `server-only`, no DB) so it is unit-testable in isolation. The DB read
 * (`getProfileForUser`) stays in the server-only `service.ts`.
 *
 * POSTURE §2: an axis is a PROCESS/discipline focus, never a market call — the
 * copy that frames it is descriptive. AI Act §50: the axis is AI-derived, so the
 * surfaces that render it carry the `AIGeneratedBanner`.
 */

/** Max axes kept (mirrors `monthly-debrief/loader` PROFILE_AXES_MAX). */
const AXES_MAX = 5;
/** Per-axis character cap (mirrors `monthly-debrief/loader` PROFILE_AXIS_MAX_CHARS). */
const AXIS_MAX_CHARS = 200;
/** One rotation step per ISO-ish week (7 days), in ms. */
const WEEK_MS = 7 * 86_400_000;

/**
 * Coerce the Prisma JSON `axesPrioritaires` blob (`unknown`) into a clean list.
 * Filters on the REAL sanitisation (`safeFreeText`), not a bare `.trim()`, so a
 * zero-width/bidi-only axis (which survives `.trim()` but renders blank) is
 * dropped here rather than surfacing as an empty line. Malformed input → `[]`
 * (never fabricated). Same contract as `monthly-debrief/loader.toMemberProfileReference`.
 */
export function coerceAxes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is string => typeof a === 'string' && safeFreeText(a).length > 0)
    .slice(0, AXES_MAX)
    .map((a) => a.trim().slice(0, AXIS_MAX_CHARS));
}

/**
 * Pick ONE axis to surface, rotating weekly so every axis is seen over time
 * (the member meets each of their priorities across the weeks, not just the
 * first). Deterministic for a given `now` — no `Math.random`. `now = new Date()`
 * default param keeps the clock read out of any render body (purity). Empty list
 * → `null` (the surface then renders nothing — no fabricated axis).
 */
export function pickWeeklyAxis(axes: string[], now: Date = new Date()): string | null {
  if (axes.length === 0) return null;
  const week = Math.floor(now.getTime() / WEEK_MS);
  return axes[week % axes.length] ?? null;
}
