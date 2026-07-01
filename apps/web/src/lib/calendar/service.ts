import 'server-only';

import { cache } from 'react';

import { Prisma } from '@/generated/prisma/client';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  CALENDAR_INSTRUMENT_V1,
  CURRENT_CALENDAR_INSTRUMENT_VERSION,
} from '@/lib/calendar/instrument-v1';
import { buildCalendarSnapshot, type CalendarSnapshot } from '@/lib/calendar/snapshot';
import {
  deriveDominantBlockCategory,
  type AdaptiveCalendarOutput,
  type CalendarBlockCategoryValue,
} from '@/lib/schemas/adaptive-calendar';
import type {
  SubmitWeeklyScheduleInput,
  WeeklyScheduleResponses,
} from '@/lib/schemas/weekly-schedule-questionnaire';
// D3 — read-only adaptive dimensions from the onboarding profile. Parsed with
// the SAME strict Zod schemas used at write time so a null/legacy/garbage Json?
// value safely degrades to "no modulation" instead of throwing. weakSignals is
// DELIBERATELY not imported: it is admin-only and must never cross the member
// boundary (firewall §21.5 — these two dimensions only TUNE copy/blocks, they
// are never fed to the behavioural score).
import { coachingToneSchema, learningStageSchema } from '@/lib/schemas/onboarding-interview';
import type { CalendarSlotValue } from '@/lib/calendar/instrument-v1';
// §21.5 — the ONLY sanctioned training read: a count-only primitive. The
// calendar never imports a training value, only "how many backtests recently".
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
// Pseudonymisation hash — shared prompt-boundary primitive (the §25 monthly
// debrief loader imports the same one). Pure, reads no P&L.
import { pseudonymizeMember } from '@/lib/weekly-report/builder';

const PARIS = 'Europe/Paris';
const TRADES_WINDOW_DAYS = 30;
const CHECKINS_WINDOW_DAYS = 14;
const TRAINING_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// =============================================================================
// Serialized shapes (Decimal → string, Date → YYYY-MM-DD / ISO) for any RSC /
// client boundary.
// =============================================================================

export interface SerializedWeeklyScheduleQuestionnaire {
  id: string;
  userId: string;
  weekStart: string; // YYYY-MM-DD (Monday Europe/Paris)
  instrumentVersion: number;
  energyPeakSlot: CalendarSlotValue;
  responses: WeeklyScheduleResponses;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SerializedAdaptiveCalendar {
  id: string;
  userId: string;
  weekStart: string; // YYYY-MM-DD
  schedule: AdaptiveCalendarOutput;
  primaryCategory: CalendarBlockCategoryValue | null;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  costEur: string;
  aiDisclosureShownAt: string | null; // ISO
  calendarInstrumentVersion: number;
  generatedAt: string; // ISO
}

export interface SubmitQuestionnaireResult {
  questionnaire: SerializedWeeklyScheduleQuestionnaire;
  /** true on first submission of this week, false on a correction (upsert). */
  wasNew: boolean;
}

/** Input to persist a Claude-generated calendar (J-C2 batch calls this). */
export interface PersistAdaptiveCalendarInput {
  userId: string;
  weekStart: string; // YYYY-MM-DD
  /** Already validated by `adaptiveCalendarOutputSchema.strict()` upstream. */
  output: AdaptiveCalendarOutput;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  /** EUR cost — a number or a 6-decimal string; wrapped in Prisma.Decimal. */
  costEur: number | string;
  calendarInstrumentVersion: number;
  /**
   * Instant the snapshot data was FROZEN (the batch pull `ranAt`). When provided,
   * it becomes the calendar's `generatedAt` — the freshness clock the batch loader
   * compares against `questionnaire.updatedAt`. This closes the pull→re-submit→
   * persist lost-update race (S6 pass-4 finding B): a questionnaire re-submitted
   * AFTER the snapshot was pulled but BEFORE the (minutes-later) persist would,
   * with the old `generatedAt = new Date()`, be stamped fresher than the re-submit
   * → silently excluded next run → plan stale all week. Anchoring `generatedAt` to
   * the snapshot instant means a later `updatedAt` correctly re-includes the member
   * (worst case = one redundant regen, never a lost update). Omitted → `new Date()`
   * (back-compat: an older local script that doesn't send it keeps prior behaviour).
   */
  generatedAt?: Date;
}

// =============================================================================
// Serializers
// =============================================================================

function serializeQuestionnaire(row: {
  id: string;
  userId: string;
  weekStart: Date;
  instrumentVersion: number;
  energyPeakSlot: string;
  responses: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): SerializedWeeklyScheduleQuestionnaire {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    instrumentVersion: row.instrumentVersion,
    energyPeakSlot: row.energyPeakSlot as CalendarSlotValue,
    // Written through `.strict()` Zod validation — cast-safe on read.
    responses: row.responses as unknown as WeeklyScheduleResponses,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeCalendar(row: {
  id: string;
  userId: string;
  weekStart: Date;
  schedule: Prisma.JsonValue;
  primaryCategory: string | null;
  claudeModel: string;
  inputTokens: number;
  outputTokens: number;
  costEur: Prisma.Decimal;
  aiDisclosureShownAt: Date | null;
  calendarInstrumentVersion: number;
  generatedAt: Date;
}): SerializedAdaptiveCalendar {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart.toISOString().slice(0, 10),
    // Written through `adaptiveCalendarOutputSchema.strict()` — cast-safe.
    schedule: row.schedule as unknown as AdaptiveCalendarOutput,
    primaryCategory: (row.primaryCategory as CalendarBlockCategoryValue | null) ?? null,
    claudeModel: row.claudeModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costEur: row.costEur.toString(),
    aiDisclosureShownAt: row.aiDisclosureShownAt ? row.aiDisclosureShownAt.toISOString() : null,
    calendarInstrumentVersion: row.calendarInstrumentVersion,
    generatedAt: row.generatedAt.toISOString(),
  };
}

// =============================================================================
// Questionnaire — submit + read
// =============================================================================

/**
 * Upsert the member's weekly-schedule questionnaire on `(userId, weekStart)`
 * (idempotent — a correction overwrites). `weekStart` is re-pinned to
 * UTC-midnight via `parseLocalDate` so the `@db.Date` column never drifts a day
 * (anti-flake PR#96 — never trust a client instant). Audit is emitted by the
 * J-C3 Server Action (`calendar.questionnaire.submitted`), not here.
 */
export async function submitWeeklyScheduleQuestionnaire(
  userId: string,
  input: SubmitWeeklyScheduleInput,
): Promise<SubmitQuestionnaireResult> {
  const weekStartDb = parseLocalDate(input.weekStart);
  const energyPeakSlot = input.responses.energyPeak;
  const responsesJson = input.responses as unknown as Prisma.InputJsonValue;

  const existing = await db.weeklyScheduleQuestionnaire.findUnique({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    select: { id: true },
  });

  const row = await db.weeklyScheduleQuestionnaire.upsert({
    where: { userId_weekStart: { userId, weekStart: weekStartDb } },
    create: {
      userId,
      weekStart: weekStartDb,
      instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
      energyPeakSlot,
      responses: responsesJson,
    },
    update: {
      instrumentVersion: CURRENT_CALENDAR_INSTRUMENT_VERSION,
      energyPeakSlot,
      responses: responsesJson,
    },
  });

  return { questionnaire: serializeQuestionnaire(row), wasNew: existing === null };
}

/**
 * `cache()`-wrapped so the dashboard render tree dedupes the read: both
 * `getDailyGuidance` and `CalendarStatusWidget` ask for the SAME
 * `(userId, weekStart)` in one pass — React de-duplicates to a single query
 * per request (S6 audit). No-op outside an RSC request scope.
 */
export const getQuestionnaireForUser = cache(
  async (
    userId: string,
    weekStart: string,
  ): Promise<SerializedWeeklyScheduleQuestionnaire | null> => {
    const row = await db.weeklyScheduleQuestionnaire.findUnique({
      where: { userId_weekStart: { userId, weekStart: parseLocalDate(weekStart) } },
    });
    return row ? serializeQuestionnaire(row) : null;
  },
);

export async function getLatestQuestionnaireForUser(
  userId: string,
): Promise<SerializedWeeklyScheduleQuestionnaire | null> {
  const row = await db.weeklyScheduleQuestionnaire.findFirst({
    where: { userId },
    orderBy: { weekStart: 'desc' },
  });
  return row ? serializeQuestionnaire(row) : null;
}

// =============================================================================
// Calendar — read + persist + disclosure
// =============================================================================

/** `cache()`-wrapped — same dashboard de-dup rationale as
 * {@link getQuestionnaireForUser} (read by `getDailyGuidance` + the calendar
 * page in one render pass). */
export const getCalendarForUser = cache(
  async (userId: string, weekStart: string): Promise<SerializedAdaptiveCalendar | null> => {
    const row = await db.adaptiveCalendar.findUnique({
      where: { userId_weekStart: { userId, weekStart: parseLocalDate(weekStart) } },
    });
    return row ? serializeCalendar(row) : null;
  },
);

export async function getLatestCalendarForUser(
  userId: string,
): Promise<SerializedAdaptiveCalendar | null> {
  const row = await db.adaptiveCalendar.findFirst({
    where: { userId },
    orderBy: { weekStart: 'desc' },
  });
  return row ? serializeCalendar(row) : null;
}

/**
 * Persist a Claude-generated calendar — the raw data-layer upsert on
 * `(userId, weekStart)`. The 6 batch gates (active-user, crisis routing, Zod
 * `.strict()`, etc.) run UPSTREAM in J-C2 before calling this. `primaryCategory`
 * is derived here from the validated schedule (admin week-at-a-glance).
 */
export async function persistAdaptiveCalendar(
  input: PersistAdaptiveCalendarInput,
): Promise<SerializedAdaptiveCalendar> {
  const weekStartDb = parseLocalDate(input.weekStart);
  const scheduleJson = input.output as unknown as Prisma.InputJsonValue;
  const primaryCategory = deriveDominantBlockCategory(input.output);
  const costEur = new Prisma.Decimal(input.costEur);
  // Freshness clock = the snapshot instant when provided (finding B), else now().
  // Used for BOTH create and update so a re-submit during a FIRST-generation run
  // is covered too (no calendar yet → still a candidate by the gate).
  const generatedAt = input.generatedAt ?? new Date();

  const row = await db.adaptiveCalendar.upsert({
    where: { userId_weekStart: { userId: input.userId, weekStart: weekStartDb } },
    create: {
      userId: input.userId,
      weekStart: weekStartDb,
      schedule: scheduleJson,
      primaryCategory,
      claudeModel: input.claudeModel,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costEur,
      calendarInstrumentVersion: input.calendarInstrumentVersion,
      // Anchor `generatedAt` to the snapshot instant (vs the `@default(now())`)
      // so a re-submit racing a first-generation persist re-includes correctly.
      generatedAt,
    },
    update: {
      schedule: scheduleJson,
      primaryCategory,
      claudeModel: input.claudeModel,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costEur,
      calendarInstrumentVersion: input.calendarInstrumentVersion,
      // DoD#1 freshness convergence (Session 5 defect-D + S6 pass-4 finding B) —
      // `generatedAt` is `@default(now())`, which only fires on INSERT, so an
      // upsert UPDATE would leave it FROZEN at the first generation. The batch
      // loader re-includes a member when `questionnaire.updatedAt >
      // calendar.generatedAt` (a stale plan). We set it to the SNAPSHOT instant
      // (`input.generatedAt`, the pull `ranAt`) rather than `new Date()`: the
      // persist runs minutes after the snapshot was frozen, so `new Date()` could
      // stamp the row fresher than a questionnaire re-submitted DURING the batch
      // window → that re-submit would be silently lost (plan stale all week).
      // Anchoring to the snapshot instant means a later `updatedAt` re-triggers a
      // regeneration next run (converges: worst case one redundant regen). On the
      // happy path `updatedAt <= snapshot instant` so the member stays excluded
      // (idempotence preserved). Falls back to `new Date()` when not provided.
      generatedAt,
      // Preserve `aiDisclosureShownAt` — a re-generation must not reset the
      // EU AI Act 50(1) disclosure timestamp the member already saw.
    },
  });

  return serializeCalendar(row);
}

/**
 * EU AI Act 50(1) — stamp the AI-generated banner as shown (first view, J-C4).
 * Idempotent: only sets the timestamp when still null. Returns the serialized
 * calendar, or null if no calendar exists for that week.
 */
export async function markAdaptiveCalendarDisclosureShown(
  userId: string,
  weekStart: string,
  now: Date = new Date(),
): Promise<SerializedAdaptiveCalendar | null> {
  const weekStartDb = parseLocalDate(weekStart);
  // Idempotent stamp: `WHERE aiDisclosureShownAt IS NULL` means a re-call never
  // overwrites the timestamp the member already saw. Whether the row was just
  // stamped, already stamped, or absent, the caller wants the current state.
  await db.adaptiveCalendar.updateMany({
    where: {
      userId,
      weekStart: weekStartDb,
      aiDisclosureShownAt: null,
    },
    data: { aiDisclosureShownAt: now },
  });
  return getCalendarForUser(userId, weekStart);
}

// =============================================================================
// Snapshot loader — count-only (§2 / §21.5 isolation boundary)
// =============================================================================

/**
 * Build the count-only Claude snapshot for one member's week. Returns null when
 * the member has no questionnaire for `weekStart` (nothing to generate from).
 *
 * Every read here is a COUNT or a date — never a P&L field. The training count
 * goes through the sanctioned `countRecentTrainingActivity` primitive (§21.5).
 * `profileSummary` is the member's onboarding profile text (psychology/process,
 * posture §2); the J-C2 prompt builder wraps it in `wrapUntrustedMemberInput`
 * before embedding (the only free-text reaching Claude).
 */
export async function loadCalendarSnapshotForUser(
  userId: string,
  weekStart: string,
  now: Date = new Date(),
): Promise<CalendarSnapshot | null> {
  const questionnaire = await getQuestionnaireForUser(userId, weekStart);
  if (questionnaire === null) return null;

  const tradesSince = new Date(now.getTime() - TRADES_WINDOW_DAYS * MS_PER_DAY);
  const trainingSince = new Date(now.getTime() - TRAINING_WINDOW_DAYS * MS_PER_DAY);
  // Check-in `date` is `@db.Date` (civil day) — pin the boundary to the local
  // Europe/Paris calendar date 14 days ago, then UTC-midnight via parseLocalDate.
  const checkinSinceLocal = shiftLocalDate(localDateOf(now, PARIS), -CHECKINS_WINDOW_DAYS);
  const checkinSinceDb = parseLocalDate(checkinSinceLocal);

  const [tradesLast30d, checkinsLast14d, training, lastMindset, profile] = await Promise.all([
    db.trade.count({ where: { userId, enteredAt: { gte: tradesSince } } }),
    db.dailyCheckin.count({ where: { userId, date: { gte: checkinSinceDb } } }),
    countRecentTrainingActivity(userId, trainingSince),
    db.mindsetCheck.findFirst({
      where: { userId },
      orderBy: { weekStart: 'desc' },
      select: { weekStart: true },
    }),
    db.memberProfile.findUnique({
      where: { userId },
      // D3 — pull the two §21.5-safe adaptive dimensions alongside the summary.
      // weakSignals / axesStructured are NOT selected: they are admin-only and
      // must never reach the member-facing calendar prompt.
      select: { summary: true, coachingTone: true, learningStage: true },
    }),
  ]);

  // Defensive parse of the two adaptive dimensions (Prisma Json?, null on
  // legacy/partial rows). safeParse never throws on null/garbage → we degrade
  // to "no modulation". Only the closed enum literal (`stage` / `register`)
  // crosses into the snapshot — the rationale/evidence stay behind (not needed,
  // and evidence is member free-text already surfaced only via profileSummary).
  const learningStageParsed = learningStageSchema.safeParse(profile?.learningStage);
  const learningStage = learningStageParsed.success ? learningStageParsed.data.stage : null;
  const coachingToneParsed = coachingToneSchema.safeParse(profile?.coachingTone);
  const coachingRegister = coachingToneParsed.success ? coachingToneParsed.data.register : null;

  return buildCalendarSnapshot({
    pseudonymLabel: pseudonymizeMember(userId),
    weekStart,
    instrumentVersion: questionnaire.instrumentVersion,
    profileSummary: profile?.summary ?? null,
    responses: questionnaire.responses,
    activity: {
      tradesLast30d,
      checkinsLast14d,
      trainingSessionsLast14d: training.count,
      lastMindsetCheckDate: lastMindset ? lastMindset.weekStart.toISOString().slice(0, 10) : null,
    },
    learningStage,
    coachingRegister,
  });
}

/** Re-export the current instrument so callers need a single import. */
export { CALENDAR_INSTRUMENT_V1 };
