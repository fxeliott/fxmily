import {
  caffeineValueSchema,
  type HabitKind,
  meditationValueSchema,
  nutritionValueSchema,
  sleepValueSchema,
  sportValueSchema,
} from '@/lib/schemas/habit-log';

/**
 * J5.2 — shared presentation metadata + aggregation for the TRACK habit pillars.
 *
 * The aggregation lives HERE (habit domain), NOT in the report builder: the
 * §21.5/§25.7 firewall forbids the report generator (`weekly-report/builder.ts`,
 * `monthly-debrief/builder.ts`) from coupling to `@/lib/analytics` or `@/lib/habit`.
 * The SANCTIONED loader calls `summarizeHabitPillars` and hands the pure builder an
 * already-finished, already-bounded summary. Pure, no I/O.
 */

/** Bound — at most one summary per HabitKind (the enum has exactly 5 members). */
export const HABIT_PILLARS_MAX = 5;

/** Deterministic render order for the pillars (SPEC habit taxonomy). */
export const HABIT_PILLAR_ORDER: readonly HabitKind[] = [
  'sleep',
  'nutrition',
  'caffeine',
  'sport',
  'meditation',
];

/** Unit of the per-pillar average scalar. */
export type HabitPillarUnit = 'h' | 'min' | 'repas' | 'cafés';
export const HABIT_PILLAR_UNIT: Record<HabitKind, HabitPillarUnit> = {
  sleep: 'h',
  nutrition: 'repas',
  caffeine: 'cafés',
  sport: 'min',
  meditation: 'min',
};

/** Member-facing FR label for each pillar. */
export const HABIT_PILLAR_LABEL: Record<HabitKind, string> = {
  sleep: 'Sommeil',
  nutrition: 'Nutrition',
  caffeine: 'Caféine',
  sport: 'Sport',
  meditation: 'Méditation',
};

/** One TRACK pillar summarised over the report window. */
export interface HabitPillarSummary {
  kind: HabitKind;
  daysLogged: number;
  average: number;
  unit: HabitPillarUnit;
}

/**
 * Pull the pillar's comparable scalar (natural unit) out of a raw `HabitLog.value`.
 * Sleep -> hours ; sport / meditation -> minutes ; nutrition -> meals ; caffeine ->
 * cups. Returns `null` (never throws) when the payload doesn't match the canonical
 * per-kind Zod shape — a malformed row is dropped, not crashed. Habit-domain twin of
 * the correlation layer's `extractHabitScalar`, kept here so the report modules never
 * import `@/lib/analytics`.
 */
function pillarScalar(kind: HabitKind, value: unknown): number | null {
  switch (kind) {
    case 'sleep': {
      const r = sleepValueSchema.safeParse(value);
      return r.success ? r.data.durationMin / 60 : null;
    }
    case 'nutrition': {
      const r = nutritionValueSchema.safeParse(value);
      return r.success ? r.data.mealsCount : null;
    }
    case 'caffeine': {
      const r = caffeineValueSchema.safeParse(value);
      return r.success ? r.data.cups : null;
    }
    case 'sport': {
      const r = sportValueSchema.safeParse(value);
      return r.success ? r.data.durationMin : null;
    }
    case 'meditation': {
      const r = meditationValueSchema.safeParse(value);
      return r.success ? r.data.durationMin : null;
    }
    default:
      return null;
  }
}

/**
 * J5.2 — aggregate raw TRACK logs (one per (date, kind), DB-unique) into a BOUNDED
 * per-pillar summary: the average of the pillar scalar + the number of days logged,
 * in canonical order, capped at `HABIT_PILLARS_MAX`. A pillar with no valid scalar is
 * dropped. §2-safe (COUNT-ONLY lifestyle). Pure / fixture-replayable.
 */
export function summarizeHabitPillars(
  logs: readonly { kind: HabitKind; value: unknown }[],
): HabitPillarSummary[] {
  const byKind = new Map<HabitKind, number[]>();
  for (const log of logs) {
    const scalar = pillarScalar(log.kind, log.value);
    if (scalar === null) continue;
    const bucket = byKind.get(log.kind);
    if (bucket) bucket.push(scalar);
    else byKind.set(log.kind, [scalar]);
  }
  const pillars: HabitPillarSummary[] = [];
  for (const kind of HABIT_PILLAR_ORDER) {
    const values = byKind.get(kind);
    if (!values || values.length === 0) continue;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const average = Math.round((sum / values.length) * 10) / 10;
    pillars.push({ kind, daysLogged: values.length, average, unit: HABIT_PILLAR_UNIT[kind] });
  }
  return pillars.slice(0, HABIT_PILLARS_MAX);
}
