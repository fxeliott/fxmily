import 'server-only';

import { db } from '@/lib/db';
// Tour 14 — off-day context over the month window, to pre-compute the count of
// off days the AI reads as a choice of process (never a missing check-in, §31.2).
import { getOffDaySet, isOffDay } from '@/lib/checkin/off-days';
import type { SerializedCheckin } from '@/lib/checkin/service';
import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
// S5 §32-C/D — coaching psychologique. `getCoachingReportContext` agrège des
// signaux de PROCESS (carte mentale, constance, micro-objectifs, momentum) —
// aucun training, aucun P&L, aucun edge réel : hors firewall §21.5, comme
// scoring/meeting/verification.
import { getCoachingReportContext } from '@/lib/coaching/service';
// SPEC §28/§30 — count-only meeting attendance primitive ({ scheduledCount,
// completedCount }; no meeting body, no P&L). Feeds the explicit
// `meetingAttendance` REAL counter. Meeting assiduité touches no real edge
// (§30.7) and is NOT a §21.5-isolated symbol, so this import is unrestricted
// (scoring/service.ts + weekly-report/loader.ts already import it the same way).
import { countMeetingAttendance } from '@/lib/meeting/service';
// SPEC §30.7 T3-1 — floor the month window at the member's join day so a
// mid-month joiner is not charged for pre-join meetings (byte-identical past
// the first month).
import { floorMeetingWindowAtJoin } from '@/lib/meeting/window';
// TASK B (SPEC §25.2) — the member's OWN onboarding profile (their words), a
// READ-ONLY REFERENCE for the prompt TEXT only (never scoring/edge — posture
// §2). `getProfileForUser(userId)` reads THIS member's `MemberProfile` row, so
// there is 0 cross-member leak. NOT a §21.5-isolated symbol (onboarding answers
// are real self-declaration, not training-backtest P&L) — unrestricted import.
import { getProfileForUser } from '@/lib/onboarding-interview/service';
// J5.7 — SSOT des objectifs de process (anneaux + axe de coaching + objectif de
// methode). Read-only (scoring + profil + miroir de methode) ; process/psycho
// §2-safe, hors firewall §21.5 comme scoring/coaching. Le membre voit ces memes
// valeurs sur /objectifs.
import { getProcessObjectives } from '@/lib/objectives/service';
import { listMyFavorites } from '@/lib/cards/service';
// D1 (SPEC §25.2) — the sub-schemas that validate the member's onboarding
// coaching REGISTER + learning STAGE before they cross the member boundary. We
// `safeParse` the raw Prisma JSON (`unknown`) and derive ONLY the enum
// (`.register` / `.stage`); the verbatim rationale/evidence are dropped (data
// minimisation). weakSignals is NEVER read here (admin-only, §21.5) — importing
// its schema would be a code smell, so we deliberately import only these two.
import { coachingToneSchema, learningStageSchema } from '@/lib/schemas/onboarding-interview';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
// 🚨 §21.5 — the ONLY symbol the monthly-debrief loader may import from the
// training module: the count-only primitive. Anything else is a breach.
// (Pinned by the anti-leak suite Block A once this file is added to
// SANCTIONED_TOUCHPOINTS — mirror weekly-report/loader.ts:8.)
import { countRecentTrainingActivity } from '@/lib/training/training-trade-service';
// pseudonymizeMember is the V1.5.2 pure SHA-256 helper (no schema/training
// dependency). SPEC §25.2 decision: the LOADER pre-computes the pseudonym at
// the Claude boundary so the pure aggregator stays import-free and trivially
// §21.5-clean. Importing it from `@/lib/weekly-report/builder` is the
// sanctioned reuse (no extraction = no scope-creep into 3 stable files).
import { pseudonymizeMember } from '@/lib/weekly-report/builder';
// DOD3-01 / DoD#2 S6 — Session-3 counters (count-only, posture §2). Two scopings:
//   • `constancy` (listConstancyScoresInRange) + `alertCount` (countAlertsInRange)
//     are PERIOD-SCOPED to the reported month (never `getLatestConstancyScore`,
//     which is the current ISO week → wrong score for a retrospective report).
//   • `openDiscrepancyCount` (countOpenDiscrepancies) is a CURRENT-STATE count
//     (écarts still `open` NOW, « encore ouverts / à regarder ») — point-in-time
//     by design, NOT period-scoped.
// `currentPeriodStart` anchors the constancy lower bound at the ISO Monday of the
// week containing the 1st (so a first-partial-week score is not dropped).
// All real-edge reads, NOT training (§21.5 firewall is training-isolation only —
// verification is a sanctioned real-edge read like scoring/meeting).
import { listConstancyScoresInRange, currentPeriodStart } from '@/lib/verification/constancy';
import { countAlertsInRange } from '@/lib/verification/alerts';
import { countOpenDiscrepancies } from '@/lib/verification/service';

import { REFLECTION_PROMPT_MAX_ENTRIES, WEEKLY_CONTEXT_MAX } from '@/lib/schemas/monthly-debrief';
// J-AI corrections echo — the axis FR label prefixes each coach correction so the
// debrief can theme them. Pure data module (no DB/edge), §2-safe (process axes).
import { getAxisLabel } from '@/lib/tracking/axes';
// TASK C — filter the profile axes/labels on the REAL sanitization the builder
// applies (`safeFreeText`), not a bare `.trim()`: a 100% zero-width/bidi
// (U+200B/U+200E/U+200F) axis survives `.trim()` but `safeFreeText` strips it to
// "", so a `.trim()`-only filter would let a doomed empty string through.
import { safeFreeText } from '@/lib/text/safe';

import { computeMonthWindow, computeReportingMonth, type MonthWindow } from './month-window';
import type {
  BehavioralScoreSnapshot,
  MemberProfileReference,
  MemberScreenNote,
  MonthlyBuilderInput,
} from './types';

/**
 * J-M2 — DB loader for the V1.4 monthly AI debrief (SPEC §25).
 *
 * Reads the civil-month slice (member's local-month) from Postgres,
 * serializes it to the shape the pure aggregator expects, and returns a
 * {@link MonthlyBuilderInput}. Carbon of `weekly-report/loader.ts` adapted
 * to the monthly cadence + the §25 dual-section snapshot.
 *
 * Pure orchestration : the loader does NOT compute analytics. The pure
 * aggregator (`lib/monthly-debrief/builder.ts`, J-M1) is the only function
 * that turns the slice into a `MonthlySnapshot`.
 *
 * 🚨 §21.5 / §25.7 (BLOCKING). The training side is loaded EXCLUSIVELY via
 * `countRecentTrainingActivity` ({ count, lastEnteredAt } — pinned count/
 * recency-only by anti-leak Block B). The loader derives
 * `daysSinceLastBacktest` from the primitive's `lastEnteredAt` with the
 * member tz + month end ; no backtest P&L is ever selected. The REAL side
 * legitimately reads real-trade rows + the ≤4 sanctioned `WeeklyReport`
 * summaries of the month (INPUT, never an FK — SPEC §25.3). The §25
 * firewall is training-isolation only (anti-leak Block G, tailored ≠
 * Block F).
 *
 * Idempotency : `monthStart`/`monthEnd` are deterministic for a fixed
 * `(now, timezone)`, so two batch runs in the same month produce the exact
 * same slice — `(userId, monthStart)` is unique on `monthly_debriefs`, so
 * the persist path can `upsert` safely.
 */

// =============================================================================
// Public types
// =============================================================================

export interface LoadedMonthlySlice {
  builderInput: MonthlyBuilderInput;
  window: MonthWindow;
  /// Member metadata — joined in the same `findUnique` round-trip as
  /// timezone so the J-M3 member email + audit don't re-query the DB.
  /// SPEC §25.2: the monthly debrief notifies the MEMBER (no admin email).
  userMeta: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface LoadOptions {
  /// `now` reference (batch pass-through). Defaults to `new Date()`.
  now?: Date;
  /// `false` (default) → the just-ended civil month (`computeReportingMonth`,
  /// anchored by a 1 ms step-back before the current month start — the
  /// canonical "1st of the month, report the month that ended" cadence,
  /// robust to a delayed run; never `now − 24h`, cf. defect-B fix below).
  /// `true` → the in-progress civil month (`computeMonthWindow`, rare
  /// preview). Mirror weekly `previousFullWeek`.
  currentMonth?: boolean;
}

// =============================================================================
// Loader
// =============================================================================

export async function loadMonthlySliceForUser(
  userId: string,
  options: LoadOptions = {},
): Promise<LoadedMonthlySlice | null> {
  const now = options.now ?? new Date();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      status: true,
      // Account-age guard (SPEC §25.4 — "membre inscrit en cours de mois →
      // couverture depuis la date d'inscription, IA informée de l'âge").
      joinedAt: true,
      // Pulled in the same round-trip so the J-M3 member email doesn't
      // re-query (SPEC §25.2 — member-facing notification).
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!user || user.status !== 'active') return null;

  // SPEC §25.4 — the batch reports the just-ended civil month.
  // `computeReportingMonth` returns the last FULLY-completed civil month in the
  // member's TZ, robust to a multi-day-delayed manual run (Session 5 defect-B
  // fix: was `now − 24h`-anchored, which mis-targeted the current month for any
  // run past the 1st — it now shares the exact source the overdue net uses, so
  // batch and net always agree). `currentMonth` (rare preview) → the in-progress month.
  const window = options.currentMonth
    ? computeMonthWindow(now, user.timezone)
    : computeReportingMonth(now, user.timezone);

  // §29 « voir son évolution » — the civil month BEFORE the reported one, for the
  // ConstancyScore month-over-month progression (mirror of the behavioural
  // `scoreProgression` baseline). Same step-back as `computeReportingMonth`: 1ms
  // before the reported month's start → the previous civil month.
  const prevMonth = computeMonthWindow(new Date(window.monthStartUtc.getTime() - 1), user.timezone);

  // The reported month's ConstancyScore LOWER bound = the ISO Monday of the week
  // containing the 1st (a month often opens mid-week; that week's `periodStart`
  // sits in the PREVIOUS civil month, so anchoring on the civil 1st would drop a
  // first-partial-week score — review TIER2-1). This SAME boundary closes the
  // previous-month range's UPPER bound (−1ms below) so the two reads are DISJOINT:
  // the cross-boundary ISO week belongs to the reported month ONLY. Without this, a
  // member whose sole constancy signal is that shared week would read the identical
  // row as BOTH `constancy` and `constancyPrevious` → a fabricated "Δ+0" progression
  // (review TIER1, both reviewers converged ; mirror of `buildScoreProgression`'s
  // `previous === current` guard, builder.ts).
  const reportedConstancyLowerBound = parseLocalDate(currentPeriodStart(window.monthStartUtc));

  // S6 pass-3 fix (DoD §32-2) — the reported month's ConstancyScore UPPER bound
  // MUST mirror the disjointness the previous-month range already enforces (its
  // upper = `reportedConstancyLowerBound − 1ms`, below). Using `monthEndLocal`
  // here was ASYMMETRIC: when a civil month ends mid-week (last day Mon–Sat,
  // ~6 months out of 7) the ISO week that contains the NEXT month's 1st has its
  // `periodStart` ≤ `monthEndLocal`, so it fell INSIDE the reported range — and
  // since the builder takes `constancyScores.at(-1)` that mostly-next-month week
  // became this month's surfaced « constance du mois ». Worse, the SAME folded
  // row was re-read by the next month's report as its earliest in-range score →
  // one week attributed to two month labels (and a fabricated §29 baseline).
  // Capping at the next month's ISO-Monday − 1ms attributes every folded ISO week
  // to EXACTLY one civil month (the one whose lower bound ≤ its periodStart),
  // disjoint and complete, symmetric with `constancyPrevious`.
  const nextMonth = computeMonthWindow(new Date(window.monthEndUtc.getTime() + 1), user.timezone);
  const reportedConstancyUpperBound = new Date(
    parseLocalDate(currentPeriodStart(nextMonth.monthStartUtc)).getTime() - 1,
  );

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
    weeklySummaries,
    meeting,
    constancyScores,
    openDiscrepancyCount,
    alertCount,
    constancyScoresPrev,
    memberProfileRow,
    coaching,
    offCtx,
  ] = await Promise.all([
    loadTrades(userId, window),
    loadCheckins(userId, window),
    loadDeliveries(userId, window),
    loadAnnotationStats(userId, window),
    // J-AI corrections echo — the coach's TAGGED corrections on this member's REAL
    // trades, pre-formatted `« Axe » : commentaire` for the debrief corpus. REAL
    // side only (training corrections are §21.5-isolated — the monthly loader may
    // read only `countRecentTrainingActivity`, never a `TrainingAnnotation`).
    loadCoachCorrections(userId, window),
    // Notes membre attachées à ses liens TradingView (entrée / sortie) sur ses
    // trades RÉELS du mois — l'explication que le membre écrit à côté de son screen.
    // REAL side only : les notes d'entraînement (`TrainingTrade.tradingViewNote`)
    // sont §21.5-isolées et jamais lues ici.
    loadMemberScreenNotes(userId, window),
    getLatestBehavioralScore(userId),
    // DoD#3 / §29 "progression MESURABLE" — la série ASCENDANTE des scores
    // comportementaux sur ~75 jours (≈2 mois + marge) pour ancrer le récit de
    // progression mois-sur-mois dans des chiffres N-1 vs N réels. `latestScore`
    // (le plus récent) reste la photo "scores" du snapshot ; cette série fournit
    // EN PLUS une BASELINE (score d'entrée de mois) + un DELTA. Le builder pur
    // dérive `scoreProgression` (il ne touche pas l'horloge ; le loader passe la
    // série + `monthStartLocal`).
    getBehavioralScoreHistory(userId, { sinceDays: 75 }),
    // 🚨 §21.5 — sanctioned training→debrief touchpoint (the count-only
    // primitive). `.count` is consumed for the volume of practice ;
    // `lastEnteredAt` (all-time most-recent) is used ONLY to derive a
    // recency integer below — never a backtest P&L.
    countRecentTrainingActivity(userId, window.monthStartUtc, window.monthEndUtc),
    loadWeeklySummaries(userId, window),
    // SPEC §28/§30 — meeting assiduité over the civil-month window, FLOORED at
    // the member's join day (§30.7 T3-1) so a mid-month joiner is not charged
    // for pre-join meetings. Half-open `[from, to)`; count-only
    // ({ scheduledCount, completedCount }); `lastDeclaredAt` ignored here.
    countMeetingAttendance(
      userId,
      floorMeetingWindowAtJoin(window.monthStartUtc, user.joinedAt),
      window.monthEndUtc,
    ),
    // DOD3-01 / DoD#2 S6 — Session-3 ConstancyScore, READ-ONLY & period-scoped.
    // Folded per ISO-week, so the civil month yields ~4-5 rows; the builder takes
    // the latest in range. The report pipeline NEVER recomputes (the cron
    // `verification-scan` owns the writers) — it only reads.
    // `periodStart` is UTC-midnight-of-the-civil-Monday (parseLocalDate), so the
    // bounds use the same UTC-midnight-of-local-day convention (parseLocalDate),
    // NOT the local-instant `...Utc` (TZ-shifted). LOWER bound = the ISO Monday of
    // the week containing the 1st (`currentPeriodStart`) — a month often opens
    // mid-week, and that week's `periodStart` is in the PREVIOUS month; anchoring
    // on the civil 1st would drop a first-partial-week score (code-review TIER2-1).
    listConstancyScoresInRange(userId, reportedConstancyLowerBound, reportedConstancyUpperBound),
    // CURRENT-STATE count (NOT period-scoped): écarts still `open` right now
    // (« encore ouverts / à regarder »). Point-in-time by design — distinct from
    // the period-scoped constancy/alert reads.
    countOpenDiscrepancies(userId),
    // Alerts carry a real `createdAt` instant → the local-instant window bounds
    // are correct here (not the civil-day midnights).
    countAlertsInRange(userId, window.monthStartUtc, window.monthEndUtc),
    // §29 evolution — the PREVIOUS civil month's ConstancyScore → the
    // month-over-month progression baseline. UPPER bound = `reportedConstancyLowerBound − 1ms`
    // (NOT `prevMonth.monthEndLocal`) so this range is DISJOINT from the reported
    // month's: the cross-boundary ISO week is read as the reported month's ONLY,
    // never double-counted as both current & previous → no fabricated Δ+0 (review
    // TIER1). `.at(-1)` (latest full prev-month week) taken below.
    listConstancyScoresInRange(
      userId,
      parseLocalDate(currentPeriodStart(prevMonth.monthStartUtc)),
      new Date(reportedConstancyLowerBound.getTime() - 1),
    ),
    // TASK B (SPEC §25.2) — THIS member's onboarding profile (their words),
    // READ-ONLY reference for the prompt TEXT only (never scoring/edge). `null`
    // until the Phase A.2 onboarding batch has run (honest absence, no fabrication).
    // "Graceful degradation" applies to a NULL/absent row only (the prompt omits
    // the section). A read FAILURE (throw) is NOT swallowed here: it rejects this
    // member's whole slice, caught one level up by the batch `allSettled` +
    // TASK G-monthly (member surfaced via Sentry/audit, never a silent drop) —
    // consistent with the 13 other parallel reads in this `Promise.all`.
    getProfileForUser(userId),
    // S5 §32-C/D — synthèse de coaching psychologique (process/mental only),
    // boucles de micro-objectifs period-scopées au mois rapporté. `null` quand
    // le membre n'a aucun insight à synthétiser (carte mentale vide).
    getCoachingReportContext(userId, { start: window.monthStartUtc, end: window.monthEndUtc }),
    // Tour 14 — off-day context over the SAME civil-month window as the check-in
    // slice (monthStartLocal → monthEndLocal). A single indexed query + the
    // member's `weekendsOff` flag (React-cached). Feeds `offDaysInWindow` so the
    // debrief reads a jour off as a choice of process, never a missing check-in.
    getOffDaySet(userId, window.monthStartLocal, window.monthEndLocal),
  ]);

  // J5.4 — continuite N-1 : notre debrief du mois PRECEDENT (sortie IA deja
  // validee), le plus recent strictement anterieur au mois rapporte. Requete
  // indexee (@@index([userId, monthStart(sort: Desc)])). REEL only : on ne
  // selectionne QUE `summaryReal` + `recommendations` (jamais `summaryTraining`
  // — §21.5 firewall). `null` quand aucun debrief anterieur -> le builder omet la
  // slice -> le prompt omet le bloc (retrocompat, aucune continuite fabriquee).
  const previousDebriefRow = await db.monthlyDebrief.findFirst({
    where: { userId, monthStart: { lt: parseLocalDate(window.monthStartLocal) } },
    orderBy: { monthStart: 'desc' },
    select: { monthStart: true, summaryReal: true, recommendations: true },
  });
  const previousDebrief = previousDebriefRow
    ? {
        monthStart: previousDebriefRow.monthStart,
        summaryReal: previousDebriefRow.summaryReal,
        recommendations: (Array.isArray(previousDebriefRow.recommendations)
          ? previousDebriefRow.recommendations
          : []
        ).filter((rec): rec is string => typeof rec === 'string'),
      }
    : undefined;

  // J5.1 — reflexions ABCD (CBT Ellis) du membre sur la fenetre du mois civil.
  // Requete indexee (@@index([userId, date(sort: Desc)])) bornee aux N plus
  // recentes ; on ne selectionne QUE les 4 champs A/B/C/D + la date (aucune PII).
  // Free-text MEMBRE -> le builder borne + `safeFreeText`, rendu untrusted au
  // prompt. `[]` quand aucune -> le prompt omet la section (retrocompat).
  const reflectionRows = await db.reflectionEntry.findMany({
    where: {
      userId,
      date: {
        gte: parseLocalDate(window.monthStartLocal),
        lte: parseLocalDate(window.monthEndLocal),
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

  // Tour 14 — count the off days inside the civil-month window [monthStartLocal,
  // monthEndLocal] (both inclusive, civil-local). Weekends off-by-default are
  // folded in via `offCtx.weekendsOff`, exactly like the scoring/weekly count.
  let offDaysInWindow = 0;
  for (let d = window.monthStartLocal; d <= window.monthEndLocal; d = shiftLocalDate(d, 1)) {
    if (isOffDay(d, offCtx)) offDaysInWindow += 1;
  }

  // SPEC §25.3 — training slice = count/recency ONLY. `daysSinceLastBacktest`
  // is derived here (the loader owns the clock; the pure aggregator stays
  // clock-free). `localDateOf` ⇒ Europe/Paris-anchored, NEVER
  // `toISOString().slice` on a naive instant (invariant §25.7 / PR#96).
  let daysSinceLastBacktest: number | null = null;
  let hasEverPractised = false;
  if (trainingActivity.lastEnteredAt !== null) {
    hasEverPractised = true;
    const lastLocal = localDateOf(new Date(trainingActivity.lastEnteredAt), user.timezone);
    const diffDays = Math.floor(
      (parseLocalDate(window.monthEndLocal).getTime() - parseLocalDate(lastLocal).getTime()) /
        86_400_000,
    );
    // A backtest logged AFTER the reporting month's end (member practised in
    // the in-progress month) clamps to 0 = "très récemment", never negative
    // (schema requires `.min(0)`).
    daysSinceLastBacktest = diffDays < 0 ? 0 : diffDays;
  }

  // SPEC §25.4 — whole days the account existed within the window. Account
  // joined after the month end ⇒ 0 (did not exist in the window); joined
  // before the month start ⇒ full month length; otherwise from the join day.
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

  // DOD3-01 / DoD#2 S6 — the ConstancyScore is folded PER ISO-WEEK; for a civil
  // month (~4-5 weeks) we surface the MOST RECENT in-range score = the member's
  // constancy state at the end of the reported month. `null` when no signal at
  // all in the window (no fake neutral score, §33.6). Count-only, posture §2.
  // `constancyPrevious` (§29 evolution) = same, for the PREVIOUS civil month →
  // the month-over-month progression baseline (the prompt renders the delta).
  // Round each axis to 1 decimal (review TIER2): `value` is already 1-decimal,
  // but `honesty` is integer and `regularity`/`discipline` are raw fractions
  // (filled/total × 100 — e.g. 5/7×100 = 71.428…) straight from the fold. Without
  // this the prompt would surface "régularité 71.42857142857143/100" and a noisy
  // "Δ+14.285714…". 1 decimal matches `value`'s precision and keeps the schema
  // bounds [0,100] valid.
  const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);
  const toConstancyView = (
    s: {
      value: number;
      breakdown: { honesty: number | null; regularity: number | null; discipline: number | null };
    } | null,
  ) =>
    s
      ? {
          value: Math.round(s.value * 10) / 10,
          honesty: round1(s.breakdown.honesty),
          regularity: round1(s.breakdown.regularity),
          discipline: round1(s.breakdown.discipline),
        }
      : null;
  const verification = {
    constancy: toConstancyView(constancyScores.at(-1) ?? null),
    constancyPrevious: toConstancyView(constancyScoresPrev.at(-1) ?? null),
    openDiscrepancyCount,
    alertCount,
  };

  // TASK B (SPEC §25.2) — shape THIS member's onboarding profile into the
  // truncated REFERENCE the prompt TEXT consumes (never scoring/edge — posture
  // §2). The loader owns the truncation (summary ~600 chars, ≤5 axes, ≤5 highlight
  // LABELS) and DROPS the verbatim `evidence[]` entirely — only the short,
  // member-authored labels travel (data minimisation; the snapshot schema
  // re-hardens with safeFreeText/bidi-refine defense-in-depth). `highlights` /
  // `axesPrioritaires` are Prisma JSON (`unknown`) so we coerce defensively; a
  // malformed/empty profile collapses to `null` (the prompt then omits the
  // section — no fabricated axes, §33.6).
  const memberProfile = toMemberProfileReference(memberProfileRow);

  // J5.7 — objectifs de process du membre via le SSOT `getProcessObjectives`
  // (read-only). On ne relaie que les 3 signaux demandes (anneaux, axe, methodGoal)
  // — le builder borne + `safeFreeText`, `null`/vide -> le prompt omet la section.
  const objectivesView = await getProcessObjectives(userId, user.timezone);
  const objectives = {
    rings: objectivesView.objectives.map((o) => ({
      label: o.label,
      current: o.current,
      target: o.target,
      reached: o.reached,
    })),
    coachingAxis: objectivesView.coachingAxis,
    methodGoal: objectivesView.methodGoal
      ? {
          label: objectivesView.methodGoal.label,
          hint: objectivesView.methodGoal.hint,
          current: objectivesView.methodGoal.current,
          target: objectivesView.methodGoal.target,
        }
      : null,
  };

  // J5.8 — fiches Mark Douglas favorites du membre via le SSOT `listMyFavorites`
  // (read-only, published-only, recency-desc). Le builder borne (N + safeFreeText),
  // [] -> le prompt omet la section.
  const favorites = (await listMyFavorites(userId)).map((f) => ({
    title: f.cardTitle,
    category: f.cardCategory,
  }));

  const builderInput: MonthlyBuilderInput = {
    // SPEC §25.2 — pseudonym pre-computed by the loader at the Claude
    // boundary (8-char hex, salted via env.MEMBER_LABEL_SALT in prod).
    pseudonymLabel: pseudonymizeMember(user.id),
    timezone: user.timezone,
    monthStart: window.monthStartUtc,
    monthEnd: window.monthEndUtc,
    accountAgeDaysInWindow,
    trades,
    checkins,
    deliveries,
    annotationsReceived: annotations.received,
    annotationsViewed: annotations.viewed,
    // J-AI corrections echo — the coach's TAGGED corrections on REAL trades,
    // pre-formatted `« Axe » : commentaire` (REAL side only, §21.5-clean).
    coachCorrections,
    // Notes membre TradingView (entrée / sortie) sur ses trades RÉELS du mois,
    // pré-shapées `{ pair, direction, kind, note }` (REAL side only, §21.5-clean).
    // L'IA les relie aux corrections du coach pour personnaliser le suivi.
    memberScreenNotes,
    latestScore: latestScore === null ? null : toScoreSnapshot(latestScore),
    // DoD#3 / §29 — série brute + ancre d'entrée de mois ; le builder pur en
    // calcule la baseline N-1 et le delta (clock-free, fixture-replayable).
    scoreHistory,
    monthStartLocal: window.monthStartLocal,
    weeklySummaries,
    // SPEC §28/§30 — meeting assiduité counts (count-only). The aggregator
    // turns them into the explicit `meetingAttendance` REAL counter ; 0/0 →
    // `null` rate.
    meetingScheduledCount: meeting.scheduledCount,
    meetingCompletedCount: meeting.completedCount,
    // Tour 14 — off days in the month (count-only). The aggregator folds it into
    // the `offDaysCount` counter; the prompt reads it as a choice of process.
    offDaysInWindow,
    // 🚨 §21.5 — effort COUNT + recency only. The pure aggregator relays
    // this verbatim; the snapshot schema `.strict()` structurally rejects a
    // smuggled backtest P&L key.
    training: {
      backtestCount: trainingActivity.count,
      daysSinceLastBacktest,
      hasEverPractised,
    },
    // DOD3-01 / DoD#2 S6 — Session-3 constancy & honesty counters (count-only).
    verification,
    // TASK B (SPEC §25.2) — onboarding profile REFERENCE (TEXT only, never edge).
    memberProfile,
    // S5 §32-C/D — coaching psychologique structuré (le builder le rend en bloc
    // Markdown dans le snapshot ; `null` → slice omis). §2-safe (copie curée).
    coaching,
    // J5.4 — continuite N-1 (spread conditionnel, exactOptionalPropertyTypes).
    ...(previousDebrief ? { previousDebrief } : {}),
    // J5.1 — reflexions ABCD recentes (toujours present ; [] quand aucune).
    reflections,
    // J5.7 — objectifs de process (anneaux + axe + methodGoal, SSOT objectifs).
    objectives,
    // J5.8 — fiches Mark Douglas favorites (titre + categorie, SSOT favoris).
    favorites,
  };

  return {
    builderInput,
    window,
    userMeta: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
}

// =============================================================================
// Per-table queries (private) — carbon weekly loader serializers
// =============================================================================

async function loadTrades(
  userId: string,
  window: MonthWindow,
): Promise<MonthlyBuilderInput['trades']> {
  // "Trades du mois" = trades whose `enteredAt` falls inside the local-month
  // window. Trades opened earlier and still open at month-end are
  // intentionally excluded (they belong to a previous month's debrief and
  // would otherwise double-count). Mirror weekly loader.
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
    },
    orderBy: { enteredAt: 'asc' },
  });

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
    // Tour 13 — carried on the shape so it stays SerializedTrade-compatible. The
    // actual injection into the monthly IA prompt is a separate wiring task.
    tradingViewEntryNote: trade.tradingViewEntryNote,
    exitedAt: trade.exitedAt ? trade.exitedAt.toISOString() : null,
    exitPrice: trade.exitPrice == null ? null : trade.exitPrice.toString(),
    outcome: trade.outcome,
    exitReason: trade.exitReason,
    realizedR: trade.realizedR == null ? null : trade.realizedR.toString(),
    realizedRSource: trade.realizedRSource,
    // D3-01 — post-outcome behavioural bias tags (LESSOR/Steenbarger). The
    // shared `SerializedTrade` view drops this; serialize it inline so the
    // monthly aggregator can surface declared biases to Claude.
    tags: [...trade.tags],
    emotionDuring: [...trade.emotionDuring],
    emotionAfter: [...trade.emotionAfter],
    screenshotExitKey: trade.screenshotExitKey,
    tradingViewExitUrl: trade.tradingViewExitUrl,
    // Tour 13 — shape-only (SerializedTrade parity); prompt injection is a
    // separate wiring task.
    tradingViewExitNote: trade.tradingViewExitNote,
    closedAt: trade.closedAt ? trade.closedAt.toISOString() : null,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    isClosed: trade.closedAt !== null,
  }));
}

async function loadCheckins(userId: string, window: MonthWindow): Promise<SerializedCheckin[]> {
  // Check-ins anchor to a `@db.Date` column (calendar day, no time). The
  // local-month → DATE filter uses `parseLocalDate` on the window boundary
  // strings (UTC-midnight Date, canon — never a TZ-drifted slice). §25.7.
  const startDate = parseLocalDate(window.monthStartLocal);
  const endDate = parseLocalDate(window.monthEndLocal);

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
  window: MonthWindow,
): Promise<MonthlyBuilderInput['deliveries']> {
  const rows = await db.markDouglasDelivery.findMany({
    where: {
      userId,
      createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
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
  window: MonthWindow,
): Promise<{ received: number; viewed: number }> {
  // Admin annotations authored on THIS member's REAL trades during the
  // window. `seenByMemberAt IS NOT NULL` → counted as viewed. (Real-edge
  // coaching — the §25 firewall is training-isolation only, real annotations
  // are legitimate, mirror weekly loader.)
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
      trade: { userId },
    },
    select: { id: true, seenByMemberAt: true },
  });
  const viewed = rows.filter((r) => r.seenByMemberAt !== null).length;
  return { received: rows.length, viewed };
}

/// J-AI corrections echo — cap + per-item truncation for the coach-corrections
/// corpus. ≤20 corrections (newest-first) keeps the prompt bounded; each comment
/// is clamped so a long paste can't balloon the payload (the axis-label prefix is
/// short and always kept). Mirrors the WEEKLY_CONTEXT_MAX belt-and-suspenders cap.
const COACH_CORRECTIONS_MAX = 20;
const COACH_CORRECTION_COMMENT_MAX_CHARS = 350;

/**
 * J-AI corrections echo — load the coach's TAGGED corrections on THIS member's
 * REAL trades over the civil month, pre-formatted `« Axe » : commentaire` for the
 * debrief corpus. Only corrections the admin tagged with a `TrackingAxis` are
 * loaded (`axis: { not: null }`) — an untagged correction carries no machine
 * theme. Newest-first, capped ≤20, each comment truncated so the payload stays
 * bounded; the builder relays verbatim + re-hardens.
 *
 * 🚨 §21.5 — REAL side ONLY. This reads `db.tradeAnnotation` (real-edge coaching,
 * legitimate — the §25 firewall is training-isolation, real annotations are the
 * product, mirror `loadAnnotationStats`). Training corrections (`TrainingAnnotation`)
 * are §21.5-isolated and are DELIBERATELY not read here: the monthly loader may
 * touch training exclusively through `countRecentTrainingActivity` (anti-leak
 * Block A). So a backtest correction never leaks into the real-trading debrief.
 */
async function loadCoachCorrections(userId: string, window: MonthWindow): Promise<string[]> {
  const rows = await db.tradeAnnotation.findMany({
    where: {
      createdAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
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

/// Cap + per-note truncation for the member-screen-notes corpus. ≤20 notes
/// (newest-first) keeps the prompt bounded; each note is clamped so a long paste
/// can't balloon the payload. Mirror of the coach-corrections caps + the weekly
/// loader's `loadMemberScreenNotes`, scoped to the MONTH window.
const MEMBER_SCREEN_NOTES_MAX = 20;
const MEMBER_SCREEN_NOTE_MAX_CHARS = 350;

/**
 * Load the member's own explanatory notes attached to their TradingView links
 * (`Trade.tradingViewEntryNote` / `tradingViewExitNote`) on their REAL trades of
 * the civil month, shaped `{ pair, direction, kind, note }` so the debrief can
 * situate each note (which trade, entry or exit). One entry per non-empty note
 * (an entry note and an exit note on the same trade yield TWO entries). The trade
 * is ordered newest-first (`enteredAt desc`); within a trade the entry note comes
 * before the exit note. Capped ≤20 total, each note truncated so the payload stays
 * bounded; the builder relays verbatim + re-hardens. Carbon of the weekly loader's
 * `loadMemberScreenNotes`, scoped to the MONTH window.
 *
 * 🚨 §21.5 — REAL side ONLY. This reads `db.trade` (real trades — the product,
 * mirror `loadTrades`). Training notes (`TrainingTrade.tradingViewNote`) are
 * §21.5-isolated and DELIBERATELY not read here: the monthly loader may touch
 * training exclusively through `countRecentTrainingActivity` (anti-leak Block A).
 * So a backtest note never leaks into the real-trading debrief.
 */
async function loadMemberScreenNotes(
  userId: string,
  window: MonthWindow,
): Promise<MemberScreenNote[]> {
  const rows = await db.trade.findMany({
    where: {
      userId,
      enteredAt: { gte: window.monthStartUtc, lte: window.monthEndUtc },
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

async function loadWeeklySummaries(userId: string, window: MonthWindow): Promise<string[]> {
  // SPEC §25.3 — the ≤4 `WeeklyReport` of the civil month are ingested as
  // INPUT context (the month-over-month progression narrative), NEVER an
  // FK (isolation §21.5 by construction). `weekStart` is a `@db.Date`
  // (member-local Monday) → DATE-filter on the window boundaries; only the
  // `summary` is selected (no PII, no cost columns). Newest-first; the pure
  // aggregator caps at WEEKLY_CONTEXT_MAX + re-hardens defense-in-depth.
  const rows = await db.weeklyReport.findMany({
    where: {
      userId,
      weekStart: {
        gte: parseLocalDate(window.monthStartLocal),
        lte: parseLocalDate(window.monthEndLocal),
      },
    },
    select: { summary: true },
    orderBy: { weekStart: 'desc' },
    take: WEEKLY_CONTEXT_MAX,
  });
  return rows.map((r) => r.summary);
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

// TASK B truncation caps (SPEC §25.2). Match the snapshot schema bounds so the
// truncated reference always validates: summary ≤600, ≤5 axes (≤200 each),
// ≤5 highlight labels (≤100 each). The pure aggregator stays clock/IO-free,
// so the loader owns the truncation (mirror `daysSinceLastBacktest`/constancy).
const PROFILE_SUMMARY_MAX_CHARS = 600;
const PROFILE_AXES_MAX = 5;
const PROFILE_AXIS_MAX_CHARS = 200;
const PROFILE_HIGHLIGHT_LABELS_MAX = 5;
const PROFILE_HIGHLIGHT_LABEL_MAX_CHARS = 100;

/**
 * TASK B (SPEC §25.2) — coerce the `SerializedMemberProfile` row into the
 * truncated {@link MemberProfileReference} the prompt TEXT consumes. The row's
 * `highlights` / `axesPrioritaires` are Prisma JSON (typed `unknown`), so each
 * is defensively narrowed; anything malformed is dropped, never invented. Only
 * the short member-authored `label` of each highlight is kept — the verbatim
 * `evidence[]` (raw onboarding answer substrings) is intentionally DROPPED here
 * (data minimisation: no raw answer text crosses into the monthly snapshot).
 * Returns `null` when the row is absent OR when nothing usable survives (the
 * prompt then omits the whole profile section — no fabricated axes, §33.6).
 *
 * D1 (SPEC §25.2) — additionally derives the member's COACHING REGISTER and
 * LEARNING STAGE from the Prisma JSON `coachingTone` / `learningStage` columns
 * (typed `unknown`). Each is `safeParse`d with its dedicated sub-schema and only
 * the enum (`.register` / `.stage`) is kept — the verbatim rationale/evidence
 * are dropped (data minimisation). Invalid/absent JSON → `null` (never throws).
 * These tune the debrief TONE only; they are NEVER an input of the behavioural
 * score (firewall §21.5). `weakSignals` is deliberately NOT read (admin-only).
 * A profile carrying ONLY a register/stage (no summary/axes/labels) still
 * surfaces (returns a reference) so the tone consigne can travel even when the
 * member's own words are absent.
 */
function toMemberProfileReference(
  row: {
    summary: string;
    highlights: unknown;
    axesPrioritaires: unknown;
    coachingTone: unknown;
    learningStage: unknown;
  } | null,
): MemberProfileReference | null {
  if (row === null) return null;

  // D1 — derive the tone enums defensively (safeParse, never throw). Only the
  // enum crosses the member boundary; rationale/evidence are dropped.
  const coachingToneParsed = coachingToneSchema.safeParse(row.coachingTone);
  const coachingRegister = coachingToneParsed.success ? coachingToneParsed.data.register : null;
  const learningStageParsed = learningStageSchema.safeParse(row.learningStage);
  const learningStage = learningStageParsed.success ? learningStageParsed.data.stage : null;

  const summary =
    typeof row.summary === 'string' ? row.summary.trim().slice(0, PROFILE_SUMMARY_MAX_CHARS) : '';

  const axesPrioritaires = Array.isArray(row.axesPrioritaires)
    ? row.axesPrioritaires
        // TASK C — filter on the REAL sanitization (`safeFreeText`), not a bare
        // `.trim()`: a 100% zero-width/bidi axis survives `.trim()` but
        // `safeFreeText` strips it to "" at the builder, which would then fail
        // the schema's `min(1)`. Aligning the filter on `safeFreeText` drops it
        // here instead of surfacing a doomed empty axis.
        .filter((a): a is string => typeof a === 'string' && safeFreeText(a).length > 0)
        .slice(0, PROFILE_AXES_MAX)
        .map((a) => a.trim().slice(0, PROFILE_AXIS_MAX_CHARS))
    : [];

  // `highlights` is `Array<{ key, label, evidence[] }>` (MemberProfileOutput).
  // Keep the `label` ONLY (drop the verbatim evidence — data minimisation).
  const highlightLabels = Array.isArray(row.highlights)
    ? row.highlights
        .map((h) =>
          h !== null &&
          typeof h === 'object' &&
          typeof (h as { label?: unknown }).label === 'string'
            ? (h as { label: string }).label.trim()
            : '',
        )
        // TASK C — same as axesPrioritaires: filter on `safeFreeText` (the real
        // builder sanitization), not a bare `.length > 0`, so a zero-width-only
        // label is dropped here instead of becoming an empty string at the builder.
        .filter((label) => safeFreeText(label).length > 0)
        .slice(0, PROFILE_HIGHLIGHT_LABELS_MAX)
        .map((label) => label.slice(0, PROFILE_HIGHLIGHT_LABEL_MAX_CHARS))
    : [];

  // Nothing usable → null (the prompt omits the section; no fabricated axes).
  // D1 — a valid register/stage alone is "usable": the tone consigne can travel
  // even when the member's own words are empty, so keep the reference in that case.
  if (
    summary.length === 0 &&
    axesPrioritaires.length === 0 &&
    highlightLabels.length === 0 &&
    coachingRegister === null &&
    learningStage === null
  ) {
    return null;
  }

  return { summary, axesPrioritaires, highlightLabels, coachingRegister, learningStage };
}
