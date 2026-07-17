import { MEDITATION_MAX_MIN, type HabitLogInput } from '@/lib/schemas/habit-log';

/**
 * Minimal projection source: the subset of morning check-in fields that also
 * live in TRACK as habit logs. `MorningCheckinInput` is structurally assignable
 * to this shape, which keeps the mapper decoupled from the full check-in schema
 * and pure — no timezone or date-window logic here. The write-through host
 * (`submitMorningCheckin`) is responsible for civil-window gating, fill-only
 * fusion, and best-effort error isolation before/around calling this.
 */
export interface CheckinHabitSource {
  readonly date: string;
  readonly sleepHours: number;
  readonly sleepQuality: number;
  readonly meditationMin: number;
  readonly sportType: string | null;
  readonly sportDurationMin: number | null;
}

// HabitLog per-pillar duration bounds (mirror the target Zod schemas in
// `@/lib/schemas/habit-log`). A check-in value beyond a bound is clamped so the
// projection still succeeds (best-effort) instead of being rejected by the
// target schema and dropped.
const SLEEP_MAX_MIN = 1440;
const SPORT_MAX_MIN = 600;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type CanonicalSportKind = 'cardio' | 'strength' | 'mixed' | 'flexibility' | 'other';

/**
 * Keyword → canonical sport kind. The check-in captures sport as free text
 * (FR-first members), while TRACK stores a closed enum. We map on a normalized
 * (accent-stripped, lowercased) string and fall back to `'other'`; the original
 * label is preserved verbatim in the habit log `notes`, so nothing is lost.
 */
// Keywords are activity-word STEMS matched at a word boundary (`\b`), so
// `muscu` catches `musculation` but `nage` (swim) does NOT falsely catch
// `jardinage` (gardening). First match wins; order = strength > flexibility >
// mixed > cardio (a "cardio muscu" entry reads as strength-led).
const SPORT_KEYWORDS: ReadonlyArray<readonly [RegExp, CanonicalSportKind]> = [
  [
    /\b(muscu|force|strength|poids|weight|halt|fonte|press|squat|deadlift|souleve|renfo)/,
    'strength',
  ],
  [/\b(yoga|stretch|etir|souplesse|mobil|pilates|assoupliss)/, 'flexibility'],
  [/\b(crossfit|cross-fit|circuit|hyrox|mixte|mixed|fonctionn|wod|hiit)/, 'mixed'],
  [
    /\b(cardio|cours|run|jog|velo|cycl|natation|nage|swim|marche|walk|corde|rameur|row|boxe|foot|tennis)/,
    'cardio',
  ],
];

function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase();
}

function mapSportType(raw: string): CanonicalSportKind {
  const norm = normalize(raw);
  for (const [pattern, kind] of SPORT_KEYWORDS) {
    if (pattern.test(norm)) {
      return kind;
    }
  }
  return 'other';
}

/**
 * Project a morning check-in into the habit logs it duplicates in TRACK.
 *
 * Pure and deterministic. Emits at most one log per pillar (sleep, meditation,
 * sport), each shaped as a valid `HabitLogInput`:
 * - **sleep** always projects (required in the check-in);
 * - **meditation** only when `meditationMin > 0` (0 = nothing to log);
 * - **sport** only when declared (`sportType !== null`; both-or-none is
 *   guaranteed upstream by the check-in schema).
 *
 * Durations are clamped to each pillar's HabitLog bound. Optional value keys
 * the check-in does not carry (`quality` for meditation, `intensityRating` for
 * sport) are omitted, never set to `undefined` (`exactOptionalPropertyTypes`).
 */
export function mapCheckinToHabitLogs(input: CheckinHabitSource): HabitLogInput[] {
  const logs: HabitLogInput[] = [];

  logs.push({
    kind: 'sleep',
    date: input.date,
    value: {
      durationMin: clamp(Math.round(input.sleepHours * 60), 0, SLEEP_MAX_MIN),
      quality: clamp(Math.round(input.sleepQuality), 1, 10),
    },
  });

  if (input.meditationMin > 0) {
    logs.push({
      kind: 'meditation',
      date: input.date,
      value: {
        durationMin: clamp(Math.round(input.meditationMin), 0, MEDITATION_MAX_MIN),
      },
    });
  }

  if (input.sportType !== null) {
    logs.push({
      kind: 'sport',
      date: input.date,
      value: {
        type: mapSportType(input.sportType),
        durationMin: clamp(Math.round(input.sportDurationMin ?? 0), 0, SPORT_MAX_MIN),
      },
      notes: input.sportType,
    });
  }

  return logs;
}
