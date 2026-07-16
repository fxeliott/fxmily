import 'server-only';

import { db } from '@/lib/db';
// Tour 14 — off-day context over the report window, to pre-compute the count of
// off days the AI reads as a choice of process (never a missing check-in, §31.2).
import { getOffDaySet, isOffDay } from '@/lib/checkin/off-days';
import { shiftLocalDate } from '@/lib/checkin/timezone';
import type { SerializedCheckin } from '@/lib/checkin/service';
// S5 §32-C/D — coaching psychologique. `getCoachingReportContext` agrège des
// signaux de PROCESS (carte mentale, constance, micro-objectifs, momentum) —
// aucun training, aucun P&L, aucun edge réel : hors firewall §21.5, comme
// scoring/meeting/verification.
import { getCoachingReportContext } from '@/lib/coaching/service';
// SPEC §28/§30 — count-only meeting attendance primitive ({ scheduledCount,
// completedCount }; no meeting body, no P&L). Feeds the explicit
// `meetingAttendance` snapshot counter. Meeting assiduité touches no real edge
// (§30.7) and is NOT a §21.5-isolated symbol, so this import is unrestricted
// (scoring/service.ts already imports it the same way).
import { countMeetingAttendance } from '@/lib/meeting/service';
// SPEC §30.7 T3-1 — floor the report window at the member's join day so a member
// who joined mid-week is never charged for meetings scheduled before they
// existed (byte-identical for everyone past their first week).
import { floorMeetingWindowAtJoin } from '@/lib/meeting/window';
// C4 (tour 10) — the two sub-schemas that validate the member's onboarding
// coaching REGISTER + learning STAGE before they cross into the prompt. We
// `safeParse` the raw Prisma JSON (`unknown`) and derive ONLY the enum
// (`.register` / `.stage`); the verbatim rationale/evidence are dropped (data
// minimisation). `weakSignals` is NEVER read here (admin-only, §21.5) — importing
// only these two mirrors the calendar + monthly-debrief loaders exactly.
import { coachingToneSchema, learningStageSchema } from '@/lib/schemas/onboarding-interview';
// J5.3 — the dedicated per-answer ceiling for the member weekly-review answers,
// shared with the builder + schema so all three layers agree on one bound.
import {
  MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS,
  REFLECTION_PROMPT_MAX_ENTRIES,
} from '@/lib/schemas/weekly-report';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
// 🚨 §21.5 — the ONLY symbol the weekly-report loader may import from the
// training module: the count-only primitive. Anything else is a breach.
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
// Quick win (coach corrections echo, weekly) — the axis FR label prefixes each
// coach correction so the report can theme them. Pure data module (no DB/edge),
// §2-safe (process axes). Mirror the monthly loader.
import { getAxisLabel } from '@/lib/tracking/axes';
// DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters (count-only,
// posture §2). `listConstancyScoresInRange` is a PERIOD-SCOPED read (the score OF
// the reported week, never `getLatestConstancyScore` = current ISO week).
// Verification is a real-edge read (NOT training) — outside the §21.5 firewall,
// like scoring/meeting above.
import { listConstancyScoresInRange } from '@/lib/verification/constancy';
import { countAlertsInRange } from '@/lib/verification/alerts';
import { countOpenDiscrepancies } from '@/lib/verification/service';
// V1.8 REFLECT — the member's OWN weekly review (Sunday recap, 5 free-text
// answers). Real-edge REFLECT read (member reflection on their REAL week — NOT
// training), outside the §21.5 firewall like scoring/meeting/verification above.
// Member free-text → the loader caps/truncates only; the builder re-hardens
// (safeFreeText) and the prompt wraps it untrusted.
import { getWeeklyReview } from '@/lib/weekly-review/service';

import type { MemberToneRef } from './prompt';
import type {
  BehavioralScoreSnapshot,
  BuilderInput,
  MemberScreenNote,
  MemberWeeklyReviewAnswers,
} from './types';
import {
  computePreviousFullWeekWindow,
  computeReportingWeek,
  type WeekWindow,
} from './week-window';

/**
 * Phase B — DB loader for the J8 weekly report.
 *
 * Reads the 7-day slice (member's local-week) from Postgres, serializes it to
 * the shape the pure-functions builder expects, and returns a {@link BuilderInput}.
 *
 * Pure orchestration : the loader does NOT compute analytics. The builder
 * (Phase A, `lib/weekly-report/builder.ts`) is the only function that turns
 * the slice into a {@link WeeklySnapshot}.
 *
 * Idempotency : the `weekStart`/`weekEnd` returned here are deterministic for a
 * fixed `(now, timezone)`, so two cron runs on the same Sunday will produce
 * the exact same slice — `(userId, weekStart)` is unique on the
 * `weekly_reports` table, so the orchestrator can `upsert` safely.
 */

// =============================================================================
// Public types
// =============================================================================

export interface LoadedWeeklySlice {
  builderInput: BuilderInput;
  window: WeekWindow;
  /// Member metadata — joined in the same `findUnique` round-trip as
  /// timezone, so downstream layers (email, audit) don't re-query the DB.
  /// J8 perf TIER 2 (T2.1) economy : 30 members × 1 round-trip saved.
  userMeta: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  /// C4 (tour 10) — the member's onboarding coaching REGISTER + learning STAGE
  /// (validated enums only), carried ALONGSIDE the pseudonymised snapshot so the
  /// LIVE Claude client can inject a tone consigne into the prompt (mirror of the
  /// monthly-debrief + calendar loaders). Both `null` when the member has no
  /// profile yet (or the row's JSON is malformed) → the prompt stays neutral,
  /// zero regression. Read-only reference, NEVER an input of the behavioural
  /// score (firewall §21.5).
  memberTone: MemberToneRef;
}

export interface LoadOptions {
  /// `now` reference (cron pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → current local-week. `true` → previous full local-week
  /// (Mon→Sun BEFORE `now`'s week). The cron sticks to the default.
  previousFullWeek?: boolean;
}

// =============================================================================
// Loader
// =============================================================================

export async function loadWeeklySliceForUser(
  userId: string,
  options: LoadOptions = {},
): Promise<LoadedWeeklySlice | null> {
  const now = options.now ?? new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      status: true,
      // SPEC §30.7 T3-1 — join day, to floor the meeting-attendance window.
      joinedAt: true,
      // J8 perf TIER 2 (T2.1) — pull email metadata in same round-trip so
      // downstream `maybeSendEmail` doesn't re-query for member label.
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!user || user.status !== 'active') return null;

  // J8 audit fix — `computeReportingWeek(now)` anchors on `now - 24h` so the
  // Sunday 21:00 UTC cron correctly reports "the week that just ended"
  // regardless of member timezone (Paris stays on the current week, Tokyo
  // rolls back to last week instead of jumping forward 6 days).
  const window = options.previousFullWeek
    ? computePreviousFullWeekWindow(now, user.timezone)
    : computeReportingWeek(now, user.timezone);

  const [
    trades,
    checkins,
    deliveries,
    annotations,
    coachCorrections,
    memberScreenNotes,
    latestScore,
    scoreHistory,
    trainingActivity,
    meeting,
    constancyScores,
    openDiscrepancyCount,
    alertCount,
    coaching,
    memberProfileRow,
    offCtx,
    memberWeeklyReview,
  ] = await Promise.all([
    loadTrades(userId, window),
    loadCheckins(userId, window),
    loadDeliveries(userId, window),
    loadAnnotationStats(userId, window),
    // Quick win — the coach's TAGGED corrections on this member's REAL trades this
    // week, pre-formatted `« Axe » : commentaire` for the report corpus (parity with
    // the monthly debrief). REAL side only (training corrections are §21.5-isolated).
    loadCoachCorrections(userId, window),
    // Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    // trades RÉELS de la semaine — l'explication que le membre écrit à côté de son
    // screen. REAL side only : les notes d'entraînement (`TrainingTrade.
    // tradingViewNote`) sont §21.5-isolées et jamais lues ici.
    loadMemberScreenNotes(userId, window),
    getLatestBehavioralScore(userId),
    // S15 #6/#7 — 90d daily score history for the snapshot's momentum signal
    // (sustained multi-week declines). User-scoped, count-only (0–100, no P&L).
    getBehavioralScoreHistory(userId, { sinceDays: 90 }),
    // 🚨 §21.5 — sanctioned training→real-edge touchpoint #3 (weekly
    // report). Count-only; the report window is exactly the helper
    // window (loader trade query uses the same gte/lte bounds). Only
    // `.count` is consumed — never a backtest P&L.
    countRecentTrainingActivity(userId, window.weekStartUtc, window.weekEndUtc),
    // SPEC §28/§30 — meeting assiduité over the report window, FLOORED at the
    // member's join day (§30.7 T3-1) so a mid-week joiner is not charged for
    // pre-join meetings. Half-open `[from, to)`; count-only
    // ({ scheduledCount, completedCount }); `lastDeclaredAt` ignored here.
    countMeetingAttendance(
      userId,
      floorMeetingWindowAtJoin(window.weekStartUtc, user.joinedAt),
      window.weekEndUtc,
    ),
    // DOD3-01 / DoD#2 S6 — Session-3 ConstancyScore, READ-ONLY & period-scoped. The
    // ConstancyScore is folded per ISO-week, so a single report week yields ≤1
    // row. `periodStart` is UTC-midnight-of-civil-Monday (parseLocalDate), so the
    // range bounds use the same civil-day convention (`parseDbDate(...Local)`),
    // NOT the TZ-shifted `...Utc` instant. The report pipeline NEVER recomputes
    // (the cron `verification-scan` owns the writers) — it only reads.
    // weekStartLocal == the ISO Monday == the ConstancyScore `periodStart` for
    // this week, so [gte weekStart, lte weekEnd] captures exactly ≤1 row (tight,
    // no boundary leak — unlike a civil month, a report week IS one ISO week).
    listConstancyScoresInRange(
      userId,
      parseDbDate(window.weekStartLocal),
      parseDbDate(window.weekEndLocal),
    ),
    // CURRENT-STATE count (NOT period-scoped): écarts still `open` right now
    // (« encore ouverts / à regarder »). Point-in-time by design — distinct from
    // the period-scoped constancy/alert reads.
    countOpenDiscrepancies(userId),
    // Alerts carry a real `createdAt` instant → the local-instant window bounds
    // are correct here (not the civil-day midnights).
    countAlertsInRange(userId, window.weekStartUtc, window.weekEndUtc),
    // S5 §32-C/D — synthèse de coaching psychologique (process/mental only),
    // boucles de micro-objectifs period-scopées à la semaine rapportée. `null`
    // quand le membre n'a aucun insight à synthétiser (carte mentale vide).
    getCoachingReportContext(userId, { start: window.weekStartUtc, end: window.weekEndUtc }),
    // C4 (tour 10) — THIS member's onboarding profile, for the two §21.5-safe
    // adaptive dimensions ONLY (coachingTone / learningStage). `weakSignals`
    // and `axesStructured` are NOT selected: admin-only, they must never reach
    // the prompt. `null` until the onboarding batch has run (honest absence).
    // Mirror of calendar/service.ts:389 + monthly-debrief getProfileForUser.
    db.memberProfile.findUnique({
      where: { userId },
      select: { coachingTone: true, learningStage: true },
    }),
    // Tour 14 — off-day context over the SAME civil window as the check-in slice
    // (weekStartLocal → weekEndLocal). A single indexed query + the member's
    // `weekendsOff` flag (React-cached). Feeds `offDaysInWindow` so the report
    // reads a jour off as a choice of process, never a missing check-in (§31.2).
    getOffDaySet(userId, window.weekStartLocal, window.weekEndLocal),
    // V1.8 REFLECT — the member's own weekly review for THIS report week
    // (keyed `(userId, weekStart)` on the civil local Monday — same `@db.Date`
    // convention as the ConstancyScore read above, so `weekStartLocal`, never
    // the TZ-shifted `weekStartUtc`). Loader caps/truncates each answer; the
    // builder re-hardens + the prompt wraps untrusted. `null` = no review.
    loadMemberWeeklyReview(userId, window.weekStartLocal),
  ]);

  // DOD3-01 / DoD#2 S6 — a single report week has ≤1 ConstancyScore; take it (or
  // null when no signal — no fake neutral score, §33.6). Count-only, posture §2.
  const latestConstancy = constancyScores.at(-1) ?? null;
  const verification = {
    constancy: latestConstancy
      ? {
          value: latestConstancy.value,
          honesty: latestConstancy.breakdown.honesty,
          regularity: latestConstancy.breakdown.regularity,
          discipline: latestConstancy.breakdown.discipline,
        }
      : null,
    openDiscrepancyCount,
    alertCount,
  };

  // C4 (tour 10) — defensive parse of the two adaptive dimensions (Prisma Json?,
  // null on legacy/partial rows). `safeParse` never throws on null/garbage → we
  // degrade to "no modulation". Only the closed enum literal (`register` /
  // `stage`) crosses into the prompt reference — the rationale/evidence stay
  // behind (not needed for tone, and evidence is member free-text). Carbon of
  // calendar/service.ts:403-406.
  const coachingToneParsed = coachingToneSchema.safeParse(memberProfileRow?.coachingTone);
  const learningStageParsed = learningStageSchema.safeParse(memberProfileRow?.learningStage);
  const memberTone: MemberToneRef = {
    coachingRegister: coachingToneParsed.success ? coachingToneParsed.data.register : null,
    learningStage: learningStageParsed.success ? learningStageParsed.data.stage : null,
  };

  // Tour 14 — count the off days inside the report window [weekStartLocal,
  // weekEndLocal] (both inclusive, civil-local). Weekends off-by-default are
  // folded in via `offCtx.weekendsOff`, exactly like the scoring window count.
  let offDaysInWindow = 0;
  for (let d = window.weekStartLocal; d <= window.weekEndLocal; d = shiftLocalDate(d, 1)) {
    if (isOffDay(d, offCtx)) offDaysInWindow += 1;
  }

  // J5.1 — reflexions ABCD (CBT Ellis) du membre sur la fenetre hebdo. Requete
  // indexee (@@index([userId, date(sort: Desc)])) bornee aux N plus recentes ;
  // on ne selectionne QUE les 4 champs A/B/C/D + la date (aucune PII). Free-text
  // MEMBRE -> le builder borne + `safeFreeText`, rendu untrusted au prompt. `[]`
  // quand aucune -> le prompt omet la section (retrocompat, twin du mensuel).
  const reflectionRows = await db.reflectionEntry.findMany({
    where: {
      userId,
      date: {
        gte: parseDbDate(window.weekStartLocal),
        lte: parseDbDate(window.weekEndLocal),
      },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: REFLECTION_PROMPT_MAX_ENTRIES,
    select: {
      date: true,
      triggerEvent: true,
      beliefAuto: true,
      consequence: true,
      disputation: true,
    },
  });
  const reflections = reflectionRows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    triggerEvent: row.triggerEvent,
    beliefAuto: row.beliefAuto,
    consequence: row.consequence,
    disputation: row.disputation,
  }));

  const builderInput: BuilderInput = {
    userId: user.id,
    timezone: user.timezone,
    weekStart: window.weekStartUtc,
    weekEnd: window.weekEndUtc,
    trades,
    checkins,
    deliveries,
    annotationsReceived: annotations.received,
    annotationsViewed: annotations.viewed,
    // Quick win — the coach's TAGGED corrections on REAL trades this week,
    // pre-formatted `« Axe » : commentaire` (REAL side only, §21.5-clean).
    coachCorrections,
    // Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    // trades RÉELS de la semaine (REAL side only, §21.5-clean). L'IA relie ces
    // lectures de screens aux corrections du coach pour personnaliser le suivi.
    memberScreenNotes,
    // 🚨 §21.5 — effort COUNT only (volume de pratique). Recency is handled
    // by the no_training_activity_in_window trigger, not the report.
    trainingActivityCount: trainingActivity.count,
    // SPEC §28/§30 — meeting assiduité counts (count-only). The builder turns
    // them into the explicit `meetingAttendance` counter ; 0/0 → `null` rate.
    meetingScheduledCount: meeting.scheduledCount,
    meetingCompletedCount: meeting.completedCount,
    // Tour 14 — off days in the window (count-only). The builder folds it into
    // the `offDaysCount` counter; the prompt reads it as a choice of process.
    offDaysInWindow,
    latestScore: latestScore === null ? null : toScoreSnapshot(latestScore),
    // S15 #6/#7 — score history feeds the snapshot momentum signal (count-only).
    scoreHistory,
    // DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters (count-only).
    verification,
    // S5 §32-C/D — coaching psychologique structuré (le builder le rend en bloc
    // Markdown dans le snapshot ; `null` → slice omis). §2-safe (copie curée).
    coaching,
    // V1.8 REFLECT — the member's own words about their week (weekly review).
    // Member free-text → re-hardened by the builder (safeFreeText), wrapped
    // untrusted at the prompt boundary. `null` when no review was submitted.
    memberWeeklyReview,
    // J5.1 — reflexions ABCD recentes (toujours present cote input ; [] quand
    // aucune). Le builder borne + rend untrusted au prompt.
    reflections,
  };

  return {
    builderInput,
    window,
    userMeta: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    // C4 (tour 10) — the validated tone reference, carried alongside the slice
    // so the service can hand it to the LIVE Claude client for prompt injection.
    memberTone,
  };
}

// =============================================================================
// Per-table queries (private)
// =============================================================================

async function loadTrades(userId: string, window: WeekWindow): Promise<BuilderInput['trades']> {
  // "Trades de la semaine" = trades whose `enteredAt` falls inside the local-
  // week window. Trades opened earlier and still open at week-end are
  // intentionally excluded — they belong to a previous week's report and the
  // counters would otherwise double-count them.
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
    },
    orderBy: { enteredAt: 'asc' },
  });

  // Inline serialize — we don't import `toSerialized` from `lib/trades/service`
  // because that helper is private. Replicating the shape here keeps the
  // service layer free of cross-module side-channels.
  return rows.map((trade) => ({
    id: trade.id,
    userId: trade.userId,
    pair: trade.pair,
    direction: trade.direction,
    session: trade.session,
    enteredAt: trade.enteredAt.toISOString(),
    entryPrice: trade.entryPrice.toString(),
    lotSize: trade.lotSize.toString(),
    stopLossPrice: trade.stopLossPrice == null ? null : trade.stopLossPrice.toString(),
    plannedRR: trade.plannedRR.toString(),
    // V1.5 — Steenbarger setup quality + Tharp risk %.
    tradeQuality: trade.tradeQuality,
    riskPct: trade.riskPct == null ? null : trade.riskPct.toString(),
    emotionBefore: [...trade.emotionBefore],
    planRespected: trade.planRespected,
    hedgeRespected: trade.hedgeRespected,
    processComplete: trade.processComplete,
    slPerRule: trade.slPerRule,
    movedToBe: trade.movedToBe,
    partialAtTarget: trade.partialAtTarget,
    notes: trade.notes,
    screenshotEntryKey: trade.screenshotEntryKey,
    tradingViewEntryUrl: trade.tradingViewEntryUrl,
    // Tour 13 — carried on the shape so it stays SerializedTrade-compatible.
    // The note DOES reach the weekly IA prompt, but via `loadMemberScreenNotes`
    // below (hardened: safeFreeText + cap + wrapUntrustedMemberInput) — never
    // read raw from this serialization.
    tradingViewEntryNote: trade.tradingViewEntryNote,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    exitReason: trade.exitReason,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    // D3-01 — post-outcome behavioural bias tags (LESSOR/Steenbarger). The
    // shared `SerializedTrade` view drops this; serialize it inline so the
    // weekly aggregator can surface declared biases to Claude.
    tags: [...trade.tags],
    emotionDuring: [...trade.emotionDuring],
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    tradingViewExitUrl: trade.tradingViewExitUrl,
    // Tour 13 — shape parity (see tradingViewEntryNote above): the prompt reads
    // this note only through the hardened `loadMemberScreenNotes` path.
    tradingViewExitNote: trade.tradingViewExitNote,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
  }));
}

async function loadCheckins(userId: string, window: WeekWindow): Promise<SerializedCheckin[]> {
  // Check-ins anchor to a `@db.Date` column (calendar day, no time). Local-week
  // → DATE filter via the local-date strings of the window boundaries.
  const startDate = parseDbDate(window.weekStartLocal);
  const endDate = parseDbDate(window.weekEndLocal);

  const rows = await db.dailyCheckin.findMany({
    where: { userId, date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: 'asc' }, { slot: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString().slice(0, 10),
    slot: row.slot,
    sleepHours: row.sleepHours == null ? null : row.sleepHours.toString(),
    sleepQuality: row.sleepQuality,
    morningRoutineCompleted: row.morningRoutineCompleted,
    marketAnalysisDone: row.marketAnalysisDone,
    meditationMin: row.meditationMin,
    sportType: row.sportType,
    sportDurationMin: row.sportDurationMin,
    intention: row.intention,
    planRespectedToday: row.planRespectedToday,
    hedgeRespectedToday: row.hedgeRespectedToday,
    intentionKept: row.intentionKept,
    formationFollowed: row.formationFollowed,
    caffeineMl: row.caffeineMl,
    waterLiters: row.waterLiters == null ? null : row.waterLiters.toString(),
    stressScore: row.stressScore,
    gratitudeItems: [...row.gratitudeItems],
    moodScore: row.moodScore,
    emotionTags: [...row.emotionTags],
    journalNote: row.journalNote,
    lateJustification: row.lateJustification,
    backfilledAt: row.backfilledAt == null ? null : row.backfilledAt.toISOString(),
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function loadDeliveries(
  userId: string,
  window: WeekWindow,
): Promise<BuilderInput['deliveries']> {
  // Deliveries created during the week. We use `createdAt` (not `triggeredOn`)
  // because the trigger engine sets `createdAt` at dispatch time — that's when
  // the member effectively received the card.
  const rows = await db.markDouglasDelivery.findMany({
    where: {
      userId,
      createdAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
    },
    include: { card: { select: { slug: true, title: true, category: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    cardSlug: row.card.slug,
    cardTitle: row.card.title,
    cardCategory: row.card.category,
    triggeredBy: row.triggeredBy,
    triggeredOn: row.triggeredOn.toISOString().slice(0, 10),
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    helpful: row.helpful,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function loadAnnotationStats(
  userId: string,
  window: WeekWindow,
): Promise<{ received: number; viewed: number }> {
  // Annotations the admin authored on THIS member's trades during the window.
  // `seenByMemberAt` IS NOT NULL → counted as viewed.
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
      trade: { userId },
    },
    select: { id: true, seenByMemberAt: true },
  });
  const viewed = rows.filter((r) => r.seenByMemberAt !== null).length;
  return { received: rows.length, viewed };
}

/// Quick win — cap + per-item truncation for the coach-corrections corpus. ≤20
/// corrections (newest-first) keeps the prompt bounded; each comment is clamped so
/// a long paste can't balloon the payload (the axis-label prefix is short and
/// always kept). Mirror of the monthly loader's `loadCoachCorrections` caps.
const COACH_CORRECTIONS_MAX = 20;
const COACH_CORRECTION_COMMENT_MAX_CHARS = 350;

/**
 * Quick win — load the coach's TAGGED corrections on THIS member's REAL trades
 * over the report week, pre-formatted `« Axe » : commentaire` for the report corpus.
 * Only corrections the admin tagged with a `TrackingAxis` are loaded (`axis: { not:
 * null }`) — an untagged correction carries no machine theme. Newest-first, capped
 * ≤20, each comment truncated so the payload stays bounded; the builder relays
 * verbatim + re-hardens. Carbon of the monthly loader's `loadCoachCorrections`,
 * scoped to the WEEK window.
 *
 * 🚨 §21.5 — REAL side ONLY. This reads `db.tradeAnnotation` (real-edge coaching,
 * legitimate — real annotations are the product, mirror `loadAnnotationStats`).
 * Training corrections (`TrainingAnnotation`) are §21.5-isolated and DELIBERATELY
 * not read here: the weekly loader may touch training exclusively through
 * `countRecentTrainingActivity`. So a backtest correction never leaks into the
 * real-trading report.
 */
async function loadCoachCorrections(userId: string, window: WeekWindow): Promise<string[]> {
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
      axis: { not: null },
      trade: { userId },
    },
    select: { axis: true, comment: true },
    orderBy: { createdAt: 'desc' },
    take: COACH_CORRECTIONS_MAX,
  });
  return rows.map((r) => {
    // `axis: { not: null }` guarantees a value at runtime; the select type stays
    // `TrackingAxis | null`, so getAxisLabel receives the narrowed value.
    const label = getAxisLabel(r.axis!);
    const comment = r.comment.trim().slice(0, COACH_CORRECTION_COMMENT_MAX_CHARS);
    return `« ${label} » : ${comment}`;
  });
}

/// Cap + per-item truncation for the member-screen-notes corpus. ≤20 notes
/// (newest-first) keeps the prompt bounded; each note is clamped so a long paste
/// can't balloon the payload. Mirror of the coach-corrections caps.
const MEMBER_SCREEN_NOTES_MAX = 20;
const MEMBER_SCREEN_NOTE_MAX_CHARS = 350;

/**
 * Load the member's own explanatory notes attached to their TradingView links
 * (`Trade.tradingViewEntryNote` / `tradingViewExitNote`) on their REAL trades of
 * the report week, shaped `{ pair, direction, kind, note }` so the report can
 * situate each note (which trade, entry or exit). One entry per non-empty note
 * (an entry note and an exit note on the same trade yield TWO entries). The trade
 * is ordered newest-first (`enteredAt desc`); within a trade the entry note comes
 * before the exit note. Capped ≤20 total, each note truncated so the payload stays
 * bounded; the builder relays verbatim + re-hardens (`safeFreeText` + the schema's
 * bidi refine). This is member free-text → wrapped untrusted at the prompt boundary.
 *
 * 🚨 §21.5 — REAL side ONLY. This reads `db.trade` (real trades — the product,
 * mirror `loadTrades`). Training notes (`TrainingTrade.tradingViewNote`) are
 * §21.5-isolated and DELIBERATELY not read here: the weekly loader may touch
 * training exclusively through `countRecentTrainingActivity`. So a backtest note
 * never leaks into the real-trading report.
 */
async function loadMemberScreenNotes(
  userId: string,
  window: WeekWindow,
): Promise<MemberScreenNote[]> {
  // Targeted select — only the columns needed to situate + relay a note. We pull
  // trades of the window that carry AT LEAST ONE non-empty TradingView note
  // (entry or exit); the per-trade emptiness of each field is re-checked below.
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.weekStartUtc, lte: window.weekEndUtc },
      OR: [{ tradingViewEntryNote: { not: null } }, { tradingViewExitNote: { not: null } }],
    },
    select: {
      pair: true,
      direction: true,
      tradingViewEntryNote: true,
      tradingViewExitNote: true,
    },
    orderBy: { enteredAt: 'desc' },
  });

  const notes: MemberScreenNote[] = [];
  for (const row of rows) {
    if (notes.length >= MEMBER_SCREEN_NOTES_MAX) break;
    // Entry note first (chronological within the trade), then the exit note.
    const entry = row.tradingViewEntryNote?.trim() ?? '';
    if (entry.length > 0) {
      notes.push({
        pair: row.pair,
        direction: row.direction,
        kind: 'entree',
        note: entry.slice(0, MEMBER_SCREEN_NOTE_MAX_CHARS),
      });
    }
    if (notes.length >= MEMBER_SCREEN_NOTES_MAX) break;
    const exit = row.tradingViewExitNote?.trim() ?? '';
    if (exit.length > 0) {
      notes.push({
        pair: row.pair,
        direction: row.direction,
        kind: 'sortie',
        note: exit.slice(0, MEMBER_SCREEN_NOTE_MAX_CHARS),
      });
    }
  }
  return notes;
}

// V1.8 REFLECT — per-answer truncation applied at the loader boundary so the
// payload crossing into the builder stays bounded even though the wizard
// accepts up to 4000 chars per answer (`REVIEW_TEXT_MAX_CHARS`). J5.3 — all
// three layers (loader cap, builder re-harden, schema `.max()`) now share
// MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS (2000) as one source of truth, so a whole
// real answer survives instead of being clipped at 300 mid-sentence. The builder
// re-hardens (trim + `safeFreeText`); this cap only keeps the slice lean — it is
// NOT the sanitization layer.
const MEMBER_WEEKLY_REVIEW_LOADER_MAX_CHARS = MEMBER_WEEKLY_REVIEW_VALUE_MAX_CHARS;

/**
 * V1.8 REFLECT — the member's OWN completed weekly review for the report week.
 *
 * DEFENSIVE by design: `getWeeklyReview` returns `null` when the member never
 * submitted a review for this `weekStart` → the report generates exactly as
 * before (the builder omits the slice, honest empty state). The service layer
 * guarantees the row shape (typed Text columns, `bestPractice` the only
 * nullable answer), so no Json-snapshot parsing is needed here — but every
 * answer is still trimmed + truncated so a legacy oversized row can never
 * balloon the prompt payload.
 *
 * `weekStartLocal` is the civil local Monday (`YYYY-MM-DD`) — the same
 * `@db.Date` convention `getWeeklyReview` pins via `parseLocalDate`, so the
 * lookup never drifts a day across timezones (J8 BLOCKER #1 lesson).
 *
 * MEMBER free-text — the builder re-hardens (`safeFreeText`) and the prompt
 * wraps it untrusted; this loader only shapes + bounds.
 */
async function loadMemberWeeklyReview(
  userId: string,
  weekStartLocal: string,
): Promise<MemberWeeklyReviewAnswers | null> {
  const review = await getWeeklyReview(userId, weekStartLocal);
  if (review === null) return null;
  const cap = (s: string): string => s.trim().slice(0, MEMBER_WEEKLY_REVIEW_LOADER_MAX_CHARS);
  return {
    biggestWin: cap(review.biggestWin),
    biggestMistake: cap(review.biggestMistake),
    // Honest optional: the wizard's only optional answer stays `null` (never a
    // fake empty string) so the builder/prompt can omit the bullet entirely.
    bestPractice: review.bestPractice === null ? null : cap(review.bestPractice),
    lessonLearned: cap(review.lessonLearned),
    nextWeekFocus: cap(review.nextWeekFocus),
  };
}

// =============================================================================
// Helpers
// =============================================================================

function toScoreSnapshot(latest: {
  disciplineScore: number | null;
  emotionalStabilityScore: number | null;
  consistencyScore: number | null;
  engagementScore: number | null;
}): BehavioralScoreSnapshot {
  return {
    discipline: latest.disciplineScore,
    emotionalStability: latest.emotionalStabilityScore,
    consistency: latest.consistencyScore,
    engagement: latest.engagementScore,
  };
}

function parseDbDate(local: string): Date {
  // Mirrors `parseLocalDate` from `lib/checkin/timezone` for callers that don't
  // need the additional roundtrip validation. Same shape (UTC midnight Date).
  const [y, m, d] = local.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
