import 'server-only';

import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
// The member's OWN onboarding profile (their words + prior 4-dim reading), a
// READ-ONLY REFERENCE for the re-profiling prompt TEXT + narrative baseline.
// `getProfileForUser` reads THIS member's row only (0 cross-member leak) and is
// NOT a §21.5-isolated symbol (onboarding self-declaration, never training P&L).
import { getProfileForUser } from '@/lib/onboarding-interview/service';
// Civil-month window helpers — pure DST-safe date arithmetic, §21.5-clean, reused
// verbatim from the monthly-debrief pipeline (no scope creep, mirror its loader).
import {
  computeMonthWindow,
  computeReportingMonth,
  monthWindowFromMonthStart,
  type MonthWindow,
} from '@/lib/monthly-debrief/month-window';
// Enum-only derivation of the baseline coaching register / learning stage from
// the Prisma JSON columns (`safeParse`, never throws; rationale/evidence dropped).
import { coachingToneSchema, learningStageSchema } from '@/lib/schemas/onboarding-interview';
// The V1.5.2 pure SHA-256 pseudonymiser — pre-computed at the Claude boundary so
// no raw userId reaches the model (sanctioned reuse, mirror monthly-debrief loader).
import { pseudonymizeMember } from '@/lib/weekly-report/builder';
// J-AI corrections echo — the axis FR label prefixes each coach correction (REFERENCE
// context only). Pure data module (no DB/edge/scoring), §21.5-clean (process axes).
import { getAxisLabel } from '@/lib/tracking/axes';

import { buildReprofileSnapshot, concatReflectionCorpus } from './snapshot';
import type {
  CoachingRegister,
  LearningStageValue,
  MonthlyReprofileSnapshot,
  RawReprofileCheckin,
  RawReprofileSlice,
  RawReprofileTrade,
} from './types';

/**
 * J-E — IO loader for the ADMIN-ONLY monthly deep re-profiling pipeline.
 *
 * Reads the reported civil-month slice (member-local) from Postgres, shapes the
 * raw rows into a {@link RawReprofileSlice}, and hands them to the PURE builder
 * (`snapshot.ts`) — the only function that turns the slice into a
 * {@link MonthlyReprofileSnapshot}. Pure orchestration: no analytics here.
 *
 * 🚨 §21.5 (BLOCKING). This loader touches NO training surface: the 4 deep
 * dimensions are re-profiled from the member's own introspective free text
 * (check-in intentions/journal/gratitude + trade notes) + the emotion/behaviour
 * enum tags — never a backtest P&L, never a scoring input. The onboarding
 * baseline + previous-month snapshot are REFERENCE context for the narrative.
 *
 * Idempotency: `monthStart`/`monthEnd` are deterministic for a fixed
 * `(now, timezone)`, so two runs in the same month produce the exact same slice
 * — `(userId, monthStart)` is unique on `member_profile_monthly_snapshots`, so
 * the persist path can `upsert` safely.
 */

export interface LoadedReprofileSlice {
  readonly snapshot: MonthlyReprofileSnapshot;
  readonly window: MonthWindow;
  /// Member metadata joined in the same round-trip (never sent to Claude).
  readonly userMeta: {
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
  };
}

export interface LoadReprofileOptions {
  /// `now` reference (batch pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → the just-ended civil month (`computeReportingMonth`,
  /// robust to a delayed manual run). `true` → the in-progress month (preview).
  currentMonth?: boolean;
}

/// The baseline onboarding summary is reference context — truncated so a long
/// portrait cannot dominate the prompt (the builder does not re-truncate it).
const ONBOARDING_SUMMARY_MAX_CHARS = 600;

// SHARED projections + pure mappers — the ONLY definitions of "which reflection
// columns we read and how we shape them". Used by BOTH the pull slice loader and
// the persist-time corpus re-derivation ({@link loadReflectionCorpusForMonth}),
// so the reflection corpus is byte-for-byte identical on both sides: a
// re-profiled `evidence[]` that was a verbatim substring at generation is still
// a verbatim substring at the persist gate (no drift → no false evidence_invalid
// reject). Change the projection or the mapping in ONE place only.
const REFLECTION_CHECKIN_SELECT = {
  date: true,
  intention: true,
  journalNote: true,
  gratitudeItems: true,
  emotionTags: true,
} as const;

const REFLECTION_TRADE_SELECT = {
  enteredAt: true,
  notes: true,
  emotionBefore: true,
  emotionDuring: true,
  emotionAfter: true,
  tags: true,
} as const;

/** Shape check-in rows into the raw slice (pure — corpus-identity critical). */
function mapCheckinRows(
  rows: readonly {
    date: Date;
    intention: string | null;
    journalNote: string | null;
    gratitudeItems: string[];
    emotionTags: string[];
  }[],
): RawReprofileCheckin[] {
  return rows.map((row) => ({
    localDate: row.date.toISOString().slice(0, 10),
    intention: row.intention,
    journalNote: row.journalNote,
    gratitudeItems: [...row.gratitudeItems],
    emotionTags: [...row.emotionTags],
  }));
}

/** Shape trade rows into the raw slice (pure — corpus-identity critical). */
function mapTradeRows(
  rows: readonly {
    enteredAt: Date;
    notes: string | null;
    emotionBefore: string[];
    emotionDuring: string[];
    emotionAfter: string[];
    tags: string[];
  }[],
  timezone: string,
): RawReprofileTrade[] {
  return rows.map((row) => ({
    // `enteredAt` is a real instant → resolve to the member-local calendar day.
    localDate: localDateOf(row.enteredAt, timezone),
    notes: row.notes,
    emotionBefore: [...row.emotionBefore],
    emotionDuring: [...row.emotionDuring],
    emotionAfter: [...row.emotionAfter],
    tags: [...row.tags],
  }));
}

export async function loadReprofileSliceForUser(
  userId: string,
  options: LoadReprofileOptions = {},
): Promise<LoadedReprofileSlice | null> {
  const now = options.now ?? new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      status: true,
      joinedAt: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!user || user.status !== 'active') return null;

  const window = options.currentMonth
    ? computeMonthWindow(now, user.timezone)
    : computeReportingMonth(now, user.timezone);

  const [checkinRows, tradeRows, correctionRows, profileRow, previousSnapshotRow] =
    await Promise.all([
      // Check-ins anchor to a `@db.Date` column → DATE-filter on the window
      // boundary strings (UTC-midnight, canon), never a TZ-drifted instant.
      db.dailyCheckin.findMany({
        where: {
          userId,
          date: {
            gte: parseLocalDate(window.monthStartLocal),
            lte: parseLocalDate(window.monthEndLocal),
          },
        },
        orderBy: [{ date: 'asc' }, { slot: 'asc' }],
        select: REFLECTION_CHECKIN_SELECT,
      }),
      // Trades whose `enteredAt` instant falls inside the local-month window.
      db.trade.findMany({
        where: { userId, enteredAt: { gte: window.monthStartUtc, lte: window.monthEndUtc } },
        orderBy: { enteredAt: 'asc' },
        select: REFLECTION_TRADE_SELECT,
      }),
      // J-AI corrections echo — the coach's TAGGED corrections on this member's REAL
      // trades this month, REFERENCE context for the narrative (never citable — an
      // admin correction is not a member reflection, so it stays out of the corpus).
      // REAL side only: training corrections are §21.5-isolated and never read here.
      db.tradeAnnotation.findMany({
        where: {
          createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
          axis: { not: null },
          trade: { userId },
        },
        select: { axis: true, comment: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // The member's onboarding profile (their words + prior reading) — `null`
      // until the onboarding batch has run (honest absence, no fabrication).
      getProfileForUser(userId),
      // The immediately-previous monthly snapshot (month-over-month trajectory).
      // `monthStart` is a `@db.Date` → compare against the UTC-midnight of THIS
      // month's local 1st (parseLocalDate), strictly-before to exclude re-runs.
      db.memberProfileMonthlySnapshot.findFirst({
        where: { userId, monthStart: { lt: parseLocalDate(window.monthStartLocal) } },
        orderBy: { monthStart: 'desc' },
        select: {
          monthStart: true,
          evolutionNarrative: true,
          coachingTone: true,
          learningStage: true,
        },
      }),
    ]);

  // SPEC §25.4 — whole days the account existed within the window (mirror the
  // monthly-debrief loader): joined after month end ⇒ 0; before month start ⇒
  // full month; otherwise from the join day.
  const joinedLocal = localDateOf(user.joinedAt, user.timezone);
  const coverageStartLocal =
    joinedLocal > window.monthStartLocal ? joinedLocal : window.monthStartLocal;
  const accountAgeDaysInWindow =
    coverageStartLocal > window.monthEndLocal
      ? 0
      : Math.floor(
          (parseLocalDate(window.monthEndLocal).getTime() -
            parseLocalDate(coverageStartLocal).getTime()) /
            86_400_000,
        ) + 1;

  const checkins = mapCheckinRows(checkinRows);
  const trades = mapTradeRows(tradeRows, user.timezone);

  const baselineProfile: RawReprofileSlice['baselineProfile'] =
    profileRow === null
      ? null
      : {
          onboardingSummary:
            typeof profileRow.summary === 'string' && profileRow.summary.trim().length > 0
              ? profileRow.summary.trim().slice(0, ONBOARDING_SUMMARY_MAX_CHARS)
              : null,
          coachingRegister: deriveRegister(profileRow.coachingTone),
          learningStage: deriveStage(profileRow.learningStage),
        };

  const previousMonthSnapshot: RawReprofileSlice['previousMonthSnapshot'] =
    previousSnapshotRow === null
      ? null
      : {
          monthStartLocal: previousSnapshotRow.monthStart.toISOString().slice(0, 10),
          evolutionNarrative: previousSnapshotRow.evolutionNarrative,
          coachingRegister: deriveRegister(previousSnapshotRow.coachingTone),
          learningStage: deriveStage(previousSnapshotRow.learningStage),
        };

  // J-AI corrections echo — pre-format the coach's TAGGED corrections as
  // `« Axe » : commentaire` (REFERENCE context; the builder sanitises + caps).
  // `axis: { not: null }` guarantees a value at runtime; the select type stays
  // `TrackingAxis | null`, so assert the narrowed shape for the label lookup.
  const coachCorrections = correctionRows.map(
    (r) => `« ${getAxisLabel(r.axis!)} » : ${r.comment.trim()}`,
  );

  const snapshot = buildReprofileSnapshot({
    pseudonymLabel: pseudonymizeMember(user.id),
    timezone: user.timezone,
    monthStartLocal: window.monthStartLocal,
    monthEndLocal: window.monthEndLocal,
    accountAgeDaysInWindow,
    checkins,
    trades,
    baselineProfile,
    previousMonthSnapshot,
    coachCorrections,
  });

  return {
    snapshot,
    window,
    userMeta: { email: user.email, firstName: user.firstName, lastName: user.lastName },
  };
}

/**
 * Persist-time re-derivation of a member's month reflection corpus — the ONLY
 * citable evidence source, rebuilt server-side so it can NEVER be tampered with
 * on the wire (mirror onboarding `rederiveSnapshotForValidation`). Keyed by the
 * persisted `monthStart` (`YYYY-MM-01`), NOT by `now`, so it is deterministic
 * and matches the pull window for the member's timezone. Returns `null` if the
 * user is unknown/inactive.
 *
 * Only the reflection corpus is needed for the evidence gate, so the rebuilt
 * snapshot is corpus-only: the baseline / previous-month reference (which is
 * NEVER a citable source) is passed as `null`. It does not contribute to
 * {@link concatReflectionCorpus}, so the corpus is byte-identical to the pull's
 * (same window + same shared projection + same shared mappers).
 */
export async function loadReflectionCorpusForMonth(
  userId: string,
  monthStartLocal: string,
): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, timezone: true, status: true },
  });
  if (!user || user.status !== 'active') return null;

  // Deterministic window from the persisted monthStart (anti-tamper; mirror the
  // monthly-debrief persist recomputing monthEnd). The member's real timezone
  // yields identical local + UTC bounds to the pull for any east-of-UTC member
  // (V1 cohort = Europe/Paris). `monthWindowFromMonthStart` shares the
  // parseLocalDate round-trip caveat for west-of-UTC zones (out of V1 scope).
  const window = monthWindowFromMonthStart(monthStartLocal, user.timezone);

  const [checkinRows, tradeRows] = await Promise.all([
    db.dailyCheckin.findMany({
      where: {
        userId,
        date: {
          gte: parseLocalDate(window.monthStartLocal),
          lte: parseLocalDate(window.monthEndLocal),
        },
      },
      orderBy: [{ date: 'asc' }, { slot: 'asc' }],
      select: REFLECTION_CHECKIN_SELECT,
    }),
    db.trade.findMany({
      where: { userId, enteredAt: { gte: window.monthStartUtc, lte: window.monthEndUtc } },
      orderBy: { enteredAt: 'asc' },
      select: REFLECTION_TRADE_SELECT,
    }),
  ]);

  const snapshot = buildReprofileSnapshot({
    pseudonymLabel: pseudonymizeMember(user.id),
    timezone: user.timezone,
    monthStartLocal: window.monthStartLocal,
    monthEndLocal: window.monthEndLocal,
    accountAgeDaysInWindow: 0, // irrelevant for the corpus (reflections only)
    checkins: mapCheckinRows(checkinRows),
    trades: mapTradeRows(tradeRows, user.timezone),
    baselineProfile: null,
    previousMonthSnapshot: null,
  });

  return concatReflectionCorpus(snapshot);
}

/** Derive the coaching register enum from a Prisma JSON column (safeParse). */
function deriveRegister(json: unknown): CoachingRegister | null {
  const parsed = coachingToneSchema.safeParse(json);
  return parsed.success ? parsed.data.register : null;
}

/** Derive the learning stage enum from a Prisma JSON column (safeParse). */
function deriveStage(json: unknown): LearningStageValue | null {
  const parsed = learningStageSchema.safeParse(json);
  return parsed.success ? parsed.data.stage : null;
}
