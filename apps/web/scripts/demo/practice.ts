/**
 * Practice & meetings of the demo dataset — the §21.5-ISOLATED training world
 * (backtest sessions + backtests + weekly training debriefs) plus the member's
 * meeting presence.
 *
 * Statistical isolation (SPEC §21.5): nothing here ever touches the real edge.
 * Backtests live only on `/training`; their P&L (`resultR`/`outcome`) feeds the
 * training stats bar (win-rate, R moyen) while `enteredAt`/`systemRespected`
 * feed the cyan "Discipline cumulée" equity curve (`TrainingEquityCard` — needs
 * ≥3 backtests to draw). Meetings feed `/reunions` (presence + honest rate over
 * the rolling 30d window: numerator = `attendanceMode != null` AND
 * `contentReviewed = true` AND `adminPresent != false`).
 *
 * The story trends upward like the rest of the demo: the member practises more
 * regularly, keeps his system more often, fills the discipline checklist more,
 * and attends meetings more reliably as the window approaches today.
 *
 * Re-runnable: `TrainingSession`/`TrainingTrade` have no natural unique key, so
 * we `deleteMany` them (trades first — FK order) before re-creating. Debriefs
 * upsert on `(userId, weekStart)`, meetings upsert on `(date, slot)` (GLOBAL —
 * never deleted, re-used across re-runs), attendances upsert on
 * `(meetingId, userId)`.
 */
import {
  type SeedCtx,
  WINDOW_DAYS,
  at,
  dbDate,
  mondayOf,
  progress,
  makePrng,
  gauss,
  pick,
  chance,
  clamp,
  round,
} from './_shared.js';

// Training pairs / timeframes are practice CONTEXT (free strings the member
// typed), kept local to this module (the real-journal PAIRS pool is shared but
// the backtest world uses its own labels to feel distinct).
const TRAINING_PAIRS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'NAS100', 'US30'] as const;
const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4'] as const;

const SESSION_LABELS = [
  'Backtest EURUSD · range asiatique',
  'Replay GBPUSD · cassures de Londres',
  'Backtest XAUUSD · pullbacks NY',
  'Replay NAS100 · ouverture US',
  'Backtest US30 · continuation H1',
] as const;

const SESSION_NOTES = [
  'Séance focalisée sur l’attente du vrai setup, pas la fréquence.',
  'Travail des entrées sur retour à la moyenne, stop fixe.',
  'Répétition du geste : définir le risque avant, sortir au plan.',
  null,
] as const;

const LESSONS = [
  'Attendre la confirmation au lieu d’anticiper m’aurait évité une entrée prématurée.',
  'Mon stop était au bon endroit ; j’ai tenu le plan sans le déplacer.',
  'J’ai forcé un trade hors zone. Anything can happen, le geste doit rester propre.',
  'Sortie au TP comme prévu : la patience sur ce setup a payé le process.',
  'Risque défini avant l’entrée, aucune déviation impulsive : bon réflexe à ancrer.',
  'J’ai coupé trop tôt par peur ; le plan disait de laisser courir.',
  'Setup B traité comme un A, rester sélectif sur la qualité.',
  'Bon repérage de la structure, mais j’ai sur-tradé la séance. Réduire le volume.',
] as const;

const STRENGTHS_ONE = [
  'J’ai attendu mon setup au lieu de forcer des entrées.',
  'J’ai défini mon risque avant chaque backtest de la semaine.',
  'J’ai tenu mes stops sans jamais les déplacer.',
] as const;
const STRENGTHS_TWO = [
  'J’ai noté une leçon claire sur chaque backtest, pas juste le résultat.',
  'J’ai gardé un volume raisonnable, sans sur-trader la séance.',
  'J’ai relu les corrections de l’admin et ajusté mon geste.',
] as const;
const MICRO_ADJUSTMENTS = [
  'La semaine prochaine : un seul backtest A par séance, sinon je passe.',
  'Marquer le R:R planifié AVANT de regarder le résultat du replay.',
  'M’arrêter après deux entrées hors-plan pour ne pas enchaîner.',
] as const;
const TRANSVERSAL_LESSONS = [
  'Le résultat d’un backtest ne dit rien de ma valeur ; le geste propre, oui.',
  'La régularité de la pratique compte plus que le P&L de la semaine.',
  'Définir le risque en amont retire l’émotion de la décision.',
] as const;

// =============================================================================
// Training: sessions + backtests + weekly debriefs (§21.5 isolated)
// =============================================================================

async function seedTraining(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  // Dedicated PRNG stream so other seeders never shift the training data.
  const rand = makePrng(1001);

  // Re-runnable: drop the user's training rows in FK order (trades reference
  // sessions via `sessionId` SetNull, but we wipe both — trades FIRST).
  await db.trainingTrade.deleteMany({ where: { userId } });
  await db.trainingSession.deleteMany({ where: { memberId: userId } });

  // ----- Sessions (3–5 practice sittings spread across the window) -----------
  // Anchored at decreasing daysAgo so they read newest-last in creation order;
  // the page sorts them newest-first anyway.
  const sessionDays = [72, 54, 33, 17, 5];
  const sessionIds: string[] = [];

  for (let i = 0; i < sessionDays.length; i++) {
    const daysAgo = sessionDays[i] ?? 0;
    const symbol = pick(rand, TRAINING_PAIRS);
    const startedAt = at(ctx.now, daysAgo, 9 + Math.floor(rand() * 6), Math.floor(rand() * 60));
    // Most sessions are closed; the most recent one stays open (no endedAt).
    const isOpen = i === sessionDays.length - 1 && chance(rand, 0.6);
    const endedAt = isOpen
      ? null
      : new Date(startedAt.getTime() + (40 + Math.floor(rand() * 90)) * 60_000);

    const session = await db.trainingSession.create({
      data: {
        memberId: userId,
        label: SESSION_LABELS[i] ?? `Séance de backtest ${i + 1}`,
        symbol,
        timeframe: pick(rand, TIMEFRAMES),
        notes: pick(rand, SESSION_NOTES),
        startedAt,
        endedAt,
      },
      select: { id: true },
    });
    sessionIds.push(session.id);
  }

  // ----- Backtests (15–25, attached to sessions, improving over time) --------
  // We walk a set of entry days from oldest to newest so the equity curve (which
  // the page renders newest-first, then the chart reverses) trends upward and so
  // the discipline checklist + system-kept rate clearly improve. Each backtest is
  // attached to the session whose day is the closest one at-or-before it.
  const tradeDays = [
    71, 70, 68, 53, 52, 50, 49, 34, 33, 32, 30, 18, 17, 16, 14, 12, 6, 5, 4, 3, 2, 1,
  ];

  let tradeCount = 0;
  let withROutcome = 0;
  let systemKept = 0;
  let checklistClean = 0;

  for (const daysAgo of tradeDays) {
    const p = progress(daysAgo); // 0 (old) → 1 (today)

    // Discipline ramps with progress: system kept, checklist filled, win-rate.
    const winRate = 0.48 + p * 0.24;
    const willWin = chance(rand, winRate);
    // Result in R (most backtests are decided; a few left without a result).
    const hasResult = chance(rand, 0.8 + p * 0.15);
    const r = willWin ? gauss(rand, 1.7, 0.6) : gauss(rand, -1.0, 0.3);
    const resultR = hasResult ? round(clamp(r, -5, 5), 2) : null;
    const outcome: 'win' | 'loss' | 'break_even' | null = !hasResult
      ? null
      : Math.abs(resultR ?? 0) < 0.1
        ? 'break_even'
        : willWin
          ? 'win'
          : 'loss';

    // System respect rises over the window (tri-state; mostly answered).
    const systemRespected: boolean | null = chance(rand, 0.85)
      ? chance(rand, 0.45 + p * 0.45)
      : null;

    // §33-2 discipline checklist — answered more, and "respected" more, over time.
    const answerChecklist = chance(rand, 0.5 + p * 0.45);
    const itemKept = (): boolean | null => (answerChecklist ? chance(rand, 0.5 + p * 0.4) : null);
    const planFollowed = itemKept();
    const riskDefinedBefore = itemKept();
    const emotionalStateNoted = itemKept();
    const noImpulsiveDeviation = itemKept();

    // Attach to the most recent session at-or-before this backtest's day.
    let sessionIdx = -1;
    for (let i = 0; i < sessionDays.length; i++) {
      if ((sessionDays[i] ?? 0) >= daysAgo) sessionIdx = i;
    }
    const sessionId = sessionIdx >= 0 ? (sessionIds[sessionIdx] ?? null) : null;

    const enteredAt = at(ctx.now, daysAgo, 8 + Math.floor(rand() * 8), Math.floor(rand() * 60));
    const plannedRR = round(1.5 + rand() * 1.5 + p * 0.4, 2);

    await db.trainingTrade.create({
      data: {
        userId,
        ...(sessionId ? { sessionId } : {}),
        pair: pick(rand, TRAINING_PAIRS),
        plannedRR,
        outcome,
        ...(resultR == null ? {} : { resultR }),
        systemRespected,
        planFollowed,
        riskDefinedBefore,
        emotionalStateNoted,
        noImpulsiveDeviation,
        lessonLearned: pick(rand, LESSONS),
        enteredAt,
      },
    });

    tradeCount++;
    if (outcome === 'win' || outcome === 'loss') withROutcome++;
    if (systemRespected === true) systemKept++;
    if (
      planFollowed === true &&
      riskDefinedBefore === true &&
      emotionalStateNoted === true &&
      noImpulsiveDeviation === true
    ) {
      checklistClean++;
    }
  }

  // ----- Weekly training debriefs (3–4 recent weeks, upsert idempotent) ------
  let debriefs = 0;
  for (let weeksAgo = 1; weeksAgo <= 4; weeksAgo++) {
    const weekStart = mondayOf(ctx.now, weeksAgo);
    // Submitted a few days into the following week.
    const submittedAt = at(ctx.now, weeksAgo * 7 - 5, 18, Math.floor(rand() * 60));
    await db.trainingDebrief.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: {
        userId,
        weekStart,
        processStrengthOne: pick(rand, STRENGTHS_ONE),
        processStrengthTwo: pick(rand, STRENGTHS_TWO),
        microAdjustment: pick(rand, MICRO_ADJUSTMENTS),
        transversalLesson: pick(rand, TRANSVERSAL_LESSONS),
        submittedAt,
      },
      update: {
        processStrengthOne: pick(rand, STRENGTHS_ONE),
        processStrengthTwo: pick(rand, STRENGTHS_TWO),
        microAdjustment: pick(rand, MICRO_ADJUSTMENTS),
        transversalLesson: pick(rand, TRANSVERSAL_LESSONS),
        submittedAt,
      },
    });
    debriefs++;
  }

  ctx.log(
    `  training: ${sessionIds.length} sessions, ${tradeCount} backtests ` +
      `(${withROutcome} decided, ${systemKept} système tenu, ${checklistClean} checklist clean), ` +
      `${debriefs} weekly debriefs`,
  );
  return {
    trainingSessions: sessionIds.length,
    trainingTrades: tradeCount,
    trainingDebriefs: debriefs,
  };
}

// =============================================================================
// Meetings + the member's attendance (NOT §21.5-isolated — feeds engagement)
// =============================================================================

async function seedMeetings(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  const rand = makePrng(1002);

  let meetings = 0;
  let attendances = 0;
  let completeAttendances = 0;

  // Meetings are GLOBAL (not user-scoped). Creating them is fine on a local/dev
  // DB but would surface demo meetings to EVERY real member in prod. Set
  // DEMO_SEED_GLOBAL_MEETINGS=false (prod) to never create them — the demo then
  // only declares attendance on meetings that ALREADY exist, polluting nothing.
  const createGlobalMeetings = process.env.DEMO_SEED_GLOBAL_MEETINGS !== 'false';

  // Schedule ~3 meetings per week across the window (Mon midday, Wed evening,
  // Fri midday is the base cadence; we skip weekends). Walk the whole 90d window
  // so the demo has history, but only the rolling-30d slice renders/feeds the
  // rate on `/reunions`. `at()` maps midday → ~12h Paris (11h UTC CET, 10h UTC
  // CEST band — we use 11 to stay in the plausible band) and evening → ~20h
  // Paris (19h UTC). The Meeting model derives nothing from us here: we provide
  // date (@db.Date) + slot + scheduledAt directly.
  for (let daysAgo = WINDOW_DAYS - 1; daysAgo >= 1; daysAgo--) {
    const date = dbDate(ctx.now, daysAgo);
    const dow = date.getUTCDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) continue; // skip weekends

    // Base cadence ~3×/week: Monday + Wednesday + Friday.
    let slot: 'midday' | 'evening' | null = null;
    if (dow === 1) slot = 'midday';
    else if (dow === 3) slot = 'evening';
    else if (dow === 5) slot = 'midday';
    if (slot === null) continue;

    // A few slots get cancelled (admin not available) — never penalises the
    // member (excluded from numerator AND denominator).
    const cancelled = chance(rand, 0.08);
    const scheduledAt =
      slot === 'midday' ? at(ctx.now, daysAgo, 11, 0) : at(ctx.now, daysAgo, 19, 0);

    // UPSERT on the GLOBAL @@unique([date, slot]) — meetings are not user-scoped
    // and are re-used across re-runs (never deleted). In prod-safe mode we never
    // create: we only look up an already-existing meeting on this (date, slot).
    const meeting = createGlobalMeetings
      ? await db.meeting.upsert({
          where: { date_slot: { date, slot } },
          create: {
            date,
            slot,
            scheduledAt,
            status: cancelled ? 'cancelled' : 'scheduled',
            ...(cancelled ? { cancelledReason: 'Pas de réunion ce jour (indispo).' } : {}),
          },
          update: {
            scheduledAt,
            status: cancelled ? 'cancelled' : 'scheduled',
            cancelledReason: cancelled ? 'Pas de réunion ce jour (indispo).' : null,
          },
          select: { id: true, status: true },
        })
      : await db.meeting.findUnique({
          where: { date_slot: { date, slot } },
          select: { id: true, status: true },
        });
    // Prod-safe path: no existing meeting on this slot → nothing to attach.
    if (!meeting) continue;
    meetings++;

    // The member declares presence at MOST past scheduled meetings, with a
    // rising completion rate as the window approaches today. Cancelled slots are
    // not declarable (the member never declares on them).
    if (meeting.status === 'cancelled') continue;

    const p = progress(daysAgo);
    const declares = chance(rand, 0.55 + p * 0.4);
    if (!declares) continue;

    // Mode varies (mostly live, some replay); content-reviewed rate rises over
    // time so the honest "complete" rate climbs. A few declarations stay
    // partial (mode set but content not yet reviewed) → "partielle" state.
    const attendanceMode: 'live' | 'replay' = chance(rand, 0.7 + p * 0.1) ? 'live' : 'replay';
    const contentReviewed = chance(rand, 0.55 + p * 0.4);
    const declaredAt = new Date(scheduledAt.getTime() + (30 + Math.floor(rand() * 240)) * 60_000);

    await db.meetingAttendance.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
      create: {
        meetingId: meeting.id,
        userId,
        attendanceMode,
        contentReviewed,
        declaredAt,
      },
      update: {
        attendanceMode,
        contentReviewed,
        declaredAt,
      },
    });
    attendances++;
    // A complete attendance = mode set AND content reviewed (admin never marks
    // absent in the demo, so adminPresent stays null = counts).
    if (contentReviewed) completeAttendances++;
  }

  ctx.log(
    `  meetings: ${meetings} slots (~3/week), ${attendances} attendances declared ` +
      `(${completeAttendances} complete)`,
  );
  return { meetings, meetingAttendances: attendances };
}

// =============================================================================
// Entry point
// =============================================================================

export async function seedPractice(ctx: SeedCtx): Promise<Record<string, number>> {
  const training = await seedTraining(ctx);
  const meetings = await seedMeetings(ctx);
  return { ...training, ...meetings };
}
