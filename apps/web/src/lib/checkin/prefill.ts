/**
 * Check-in "Reprendre" prefill mappers (P3 fix, #463 pattern parity).
 *
 * Runtime-proof defect: the check-in hub's "Voir / éditer" link on a slot the
 * member ALREADY submitted re-opened the wizard EMPTY, and a re-submission
 * silently overwrote the stored answers (the service is an UPSERT). The member
 * could neither SEE his check-in nor edit it without destroying it blind.
 *
 * Fix (mirrors `/review/new` #463 + `/mindset/new`): the slot host page loads
 * the check-in of the effective day if it exists and passes a PREFILL to the
 * wizard so it opens seeded with the existing answers. Re-submitting is then an
 * EXPLICIT update (the upsert stays the server story), never a silent overwrite.
 *
 * These mappers turn a persisted {@link SerializedCheckin} into the exact shape
 * each wizard seeds its `DraftState` from. Pure + client-safe (no `server-only`
 * import) so they stay unit-testable in the plain node vitest environment and
 * can be reused by the wizard's own draft merge if needed.
 */

import { isCheckinEmotionSlug } from '@/lib/checkin/emotions';
import type { SerializedCheckin } from '@/lib/checkin/service';
import { MEDITATION_MAX_MIN } from '@/lib/habit/bounds';

/**
 * Seed values for the morning wizard when editing an existing check-in. Field
 * names + types mirror the wizard's `DraftState` (minus the transient
 * `date`/`lateJustification` the host page owns). Numeric fields are strings
 * because the wizard binds them to `<input type="number">` (empty string = the
 * field was never filled).
 */
export interface MorningCheckinPrefill {
  sleepHours: string;
  sleepQuality: number;
  morningRoutineCompleted: boolean | null;
  marketAnalysisDone: boolean | null;
  meditationMin: string;
  sportType: string;
  sportDurationMin: string;
  moodScore: number;
  emotionTags: string[];
  intention: string;
}

/** Seed values for the evening wizard when editing an existing check-in. */
export interface EveningCheckinPrefill {
  planRespectedToday: boolean | null;
  hedgeRespectedToday: 'true' | 'false' | 'na' | '';
  intentionKept: 'true' | 'false' | '';
  formationFollowed: 'true' | 'false' | '';
  caffeineMl: string;
  waterLiters: string;
  stressScore: number;
  moodScore: number;
  emotionTags: string[];
  journalNote: string;
  gratitudeItems: [string, string, string];
}

/** Serialize a nullable number back to the wizard's string field value. */
function numToField(value: number | null): string {
  return value == null ? '' : String(value);
}

/**
 * Clamp a persisted meditation duration to the current domain bound before it
 * seeds the edit wizard. A value stored under the old 240 cap would otherwise
 * fail the wizard's now-180 validation and block the WHOLE morning form on an
 * untouched historical field. Clamping converges that legacy value onto the
 * bound TRACK already displays for it (the J5.2 cross-surface fix), keeping the
 * edit savable. New over-bound input is still rejected live as the member types.
 */
function clampMeditationMin(value: number | null): number | null {
  return value == null ? null : Math.min(value, MEDITATION_MAX_MIN);
}

/**
 * Keep only slugs the current picker still knows (a slug retired between the
 * fill and the edit would otherwise seed a ghost selection). Cap mirrors the
 * schema's per-slot max implicitly — we never seed more than were persisted.
 */
function keepKnownEmotionSlugs(slugs: readonly string[]): string[] {
  return slugs.filter((s) => isCheckinEmotionSlug(s));
}

/** Map a persisted morning check-in to the wizard prefill shape. */
export function toMorningPrefill(checkin: SerializedCheckin): MorningCheckinPrefill {
  return {
    sleepHours: checkin.sleepHours ?? '',
    // The slider is 1–10; fall back to the empty-draft default (6) if somehow
    // null so the control never renders out of range.
    sleepQuality: checkin.sleepQuality ?? 6,
    morningRoutineCompleted: checkin.morningRoutineCompleted,
    marketAnalysisDone: checkin.marketAnalysisDone,
    meditationMin: numToField(clampMeditationMin(checkin.meditationMin)),
    sportType: checkin.sportType ?? '',
    sportDurationMin: numToField(checkin.sportDurationMin),
    moodScore: checkin.moodScore ?? 6,
    emotionTags: keepKnownEmotionSlugs(checkin.emotionTags),
    intention: checkin.intention ?? '',
  };
}

/** Serialize a nullable boolean back to the evening tri-state string value. */
function boolToTriState(value: boolean | null): 'true' | 'false' | '' {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

/** Map a persisted evening check-in to the wizard prefill shape. */
export function toEveningPrefill(checkin: SerializedCheckin): EveningCheckinPrefill {
  // The DB stores hedge as a plain nullable boolean; the wizard tri-state adds
  // an explicit "N/A". A null hedge that the member consciously answered "N/A"
  // and a null hedge that was never answered are indistinguishable at the
  // column level, so a null seeds as "" (unanswered) — the safest default that
  // forces the member to re-affirm rather than silently claiming "N/A".
  const g = checkin.gratitudeItems;
  return {
    planRespectedToday: checkin.planRespectedToday,
    hedgeRespectedToday: boolToTriState(checkin.hedgeRespectedToday),
    intentionKept: boolToTriState(checkin.intentionKept),
    formationFollowed: boolToTriState(checkin.formationFollowed),
    caffeineMl: numToField(checkin.caffeineMl),
    waterLiters: checkin.waterLiters ?? '',
    stressScore: checkin.stressScore ?? 5,
    moodScore: checkin.moodScore ?? 6,
    emotionTags: keepKnownEmotionSlugs(checkin.emotionTags),
    journalNote: checkin.journalNote ?? '',
    gratitudeItems: [g[0] ?? '', g[1] ?? '', g[2] ?? ''],
  };
}
