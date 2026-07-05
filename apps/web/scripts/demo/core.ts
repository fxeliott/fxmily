/**
 * Core spine of the demo dataset: real-journal trades, daily check-ins, the
 * derived behavioral-score history, and habit logs — the four sources that
 * "unlock" and populate the dashboard, /progression, /patterns and /objectifs.
 *
 * Everything trends gently upward across the WINDOW_DAYS window so the demo
 * tells a coherent story: a member who started undisciplined and grew into a
 * calm, process-driven trader (improving win-rate, tighter risk, kept plans,
 * rising scores).
 */
import {
  type SeedCtx,
  WINDOW_DAYS,
  PAIRS,
  SESSIONS,
  POSITIVE_TRADE_TAGS,
  NEGATIVE_TRADE_TAGS,
  POSITIVE_CHECKIN_TAGS,
  NEGATIVE_CHECKIN_TAGS,
  at,
  dbDate,
  progress,
  makePrng,
  gauss,
  pick,
  chance,
  clamp,
  clampInt,
  round,
} from './_shared.js';

// =============================================================================
// Trades (real journal)
// =============================================================================

export async function seedTrades(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  // Dedicated PRNG stream so adding/removing other seeders never shifts trades.
  const rand = makePrng(101);

  let created = 0;
  let closed = 0;
  let open = 0;
  let wins = 0;

  for (let daysAgo = WINDOW_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const p = progress(daysAgo); // 0 (old) → 1 (today)
    // ~0.75 trading days; the member trades a bit more often as he engages.
    if (!chance(rand, 0.6 + p * 0.2)) continue;

    // Discipline ramps: win-rate, plan adherence, process completeness all rise.
    const winRate = 0.48 + p * 0.22;
    // Guarantee a couple of fresh OPEN trades in the recent days so the journal
    // + TradeStatCards "open" surface is non-empty.
    const isOpen = daysAgo <= 6 && open < 3 && chance(rand, 0.5);
    const willWin = chance(rand, winRate);
    const isEstimated = chance(rand, 0.22 - p * 0.12); // fewer "no-SL" trades over time

    const r = willWin ? gauss(rand, 1.8, 0.6) : gauss(rand, -1.0, 0.3);
    const realizedR = round(clamp(r, -5, 5), 2);

    const pair = pick(rand, PAIRS);
    const session = pick(rand, SESSIONS);
    const direction = chance(rand, 0.5) ? 'long' : 'short';

    const entryPrice = round(1.0 + rand() * 0.6, 5);
    const lotSize = round(0.1 + rand() * 0.5, 2);
    const stopLossPrice = isEstimated
      ? null
      : round(entryPrice * (direction === 'long' ? 0.99 : 1.01), 5);
    const plannedRR = round(1.6 + rand() * 1.4 + p * 0.4, 2);
    const exitDelta = realizedR * Math.abs(entryPrice * 0.01);
    const exitPrice = round(
      direction === 'long' ? entryPrice + exitDelta : entryPrice - exitDelta,
      5,
    );

    // Risk tightens (variance shrinks) as the member matures.
    const riskPct = round(clamp(gauss(rand, 1.1 - p * 0.3, 0.35), 0.2, 2.5), 2);

    // Process flags improve with progress.
    const planRespected = willWin ? chance(rand, 0.8 + p * 0.1) : chance(rand, 0.45 + p * 0.25);
    const slPerRule = chance(rand, 0.55 + p * 0.35);
    const movedToBe = chance(rand, 0.4 + p * 0.3);
    const partialAtTarget = chance(rand, 0.3 + p * 0.35);
    const processComplete = chance(rand, 0.5 + p * 0.4);
    const hedgeRespected = chance(rand, 0.6) ? chance(rand, 0.3 + p * 0.5) : null;

    // Setup quality grade rises over the window.
    const qualityRoll = rand() + p * 0.4;
    const tradeQuality = qualityRoll > 1.05 ? 'A' : qualityRoll > 0.55 ? 'B' : 'C';

    const pickPos = () => pick(rand, POSITIVE_TRADE_TAGS);
    const pickNeg = () => pick(rand, NEGATIVE_TRADE_TAGS);
    const emotionBefore = [
      willWin
        ? chance(rand, 0.7)
          ? pickPos()
          : pickNeg()
        : chance(rand, 0.6)
          ? pickNeg()
          : pickPos(),
    ];

    const enteredAt = at(ctx.now, daysAgo, 8 + Math.floor(rand() * 7), Math.floor(rand() * 60));

    if (isOpen) {
      open++;
      created++;
      await db.trade.create({
        data: {
          userId,
          pair,
          direction,
          session,
          enteredAt,
          entryPrice,
          lotSize,
          stopLossPrice,
          plannedRR,
          riskPct,
          tradeQuality,
          emotionBefore,
          emotionDuring: [],
          emotionAfter: [],
          tags: [],
          planRespected,
          hedgeRespected,
          slPerRule,
          processComplete,
          notes: null,
        },
      });
      continue;
    }

    const closedAt = new Date(enteredAt.getTime() + (20 + Math.floor(rand() * 70)) * 60_000);
    const outcome = Math.abs(realizedR) < 0.1 ? 'break_even' : willWin ? 'win' : 'loss';
    if (outcome === 'win') wins++;
    closed++;
    created++;

    await db.trade.create({
      data: {
        userId,
        pair,
        direction,
        session,
        enteredAt,
        entryPrice,
        lotSize,
        stopLossPrice,
        plannedRR,
        riskPct,
        tradeQuality,
        emotionBefore,
        emotionDuring: [willWin ? 'focused' : 'fear-loss'],
        emotionAfter: [willWin ? pickPos() : pickNeg()],
        tags: willWin && chance(rand, 0.5) ? ['A+ setup'] : [],
        planRespected,
        hedgeRespected,
        slPerRule,
        movedToBe,
        partialAtTarget,
        processComplete,
        notes: chance(rand, 0.25)
          ? willWin
            ? 'Plan suivi, sortie au TP.'
            : 'Sorti au stop, pas de revenge.'
          : null,
        exitedAt: closedAt,
        closedAt,
        exitPrice,
        outcome,
        realizedR,
        realizedRSource: isEstimated ? 'estimated' : 'computed',
      },
    });
  }

  ctx.log(`  trades: ${created} (${closed} closed / ${open} open), ${wins} wins`);
  return { trades: created, closed, open, wins };
}

// =============================================================================
// Daily check-ins (morning + evening)
// =============================================================================

const MORNING_INTENTIONS = [
  'Discipline avant tout.',
  'Un seul trade A, sinon rien.',
  'Respecter le stop, toujours.',
  'Process > P&L aujourd’hui.',
  'Patience : attendre le vrai setup.',
];

export async function seedCheckins(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  const rand = makePrng(202);

  let mornings = 0;
  let evenings = 0;
  let both = 0;

  // Random-walk affect, mean-reverting but trending toward calmer over time.
  let mood = 5.5;
  let sleep = 6.5;
  let stress = 5.5;

  for (let daysAgo = WINDOW_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const p = progress(daysAgo);
    // Guarantee an unbroken recent streak (last 24 days always filled) so the
    // streak halo + milestones light up; earlier days fill more sparsely.
    const fillRate = daysAgo <= 24 ? 1 : 0.7 + p * 0.2;
    if (!chance(rand, fillRate)) continue;

    const bothSlots = chance(rand, 0.6 + p * 0.25);
    const date = dbDate(ctx.now, daysAgo);

    // Targets drift toward calm/rested/low-stress as the member matures.
    mood = clamp(mood + gauss(rand, 0, 0.5) - 0.15 * (mood - (5.5 + p * 2)), 1, 10);
    sleep = clamp(sleep + gauss(rand, 0, 0.4) - 0.15 * (sleep - (6.5 + p * 1.2)), 3, 10);
    stress = clamp(stress + gauss(rand, 0, 0.5) - 0.15 * (stress - (5.5 - p * 2.2)), 1, 10);

    mornings++;
    await db.dailyCheckin.upsert({
      where: { userId_date_slot: { userId, date, slot: 'morning' } },
      create: {
        userId,
        date,
        slot: 'morning',
        sleepHours: round(sleep, 1),
        sleepQuality: clampInt(sleep, 1, 10),
        morningRoutineCompleted: chance(rand, 0.55 + p * 0.35),
        marketAnalysisDone: chance(rand, 0.6 + p * 0.3),
        meditationMin: chance(rand, 0.4 + p * 0.2) ? clampInt(rand() * 20, 0, 20) : null,
        sportType: chance(rand, 0.3) ? 'course' : null,
        sportDurationMin: chance(rand, 0.3) ? clampInt(rand() * 60, 0, 60) : null,
        intention: chance(rand, 0.7) ? pick(rand, MORNING_INTENTIONS) : null,
        moodScore: clampInt(mood, 1, 10),
        emotionTags: chance(rand, 0.4 + p * 0.2) ? [pick(rand, POSITIVE_CHECKIN_TAGS)] : [],
        journalNote: null,
      },
      update: {},
    });

    if (bothSlots) {
      evenings++;
      both++;
      const stressed = stress > 6;
      await db.dailyCheckin.upsert({
        where: { userId_date_slot: { userId, date, slot: 'evening' } },
        create: {
          userId,
          date,
          slot: 'evening',
          planRespectedToday: chance(rand, 0.55 + p * 0.35),
          intentionKept: chance(rand, 0.5 + p * 0.4),
          hedgeRespectedToday: chance(rand, 0.6) ? chance(rand, 0.4 + p * 0.4) : null,
          formationFollowed: chance(rand, 0.6 + p * 0.3),
          caffeineMl: chance(rand, 0.7) ? clampInt(rand() * 500, 0, 500) : null,
          waterLiters: chance(rand, 0.7) ? round(1 + rand() * 1.8, 1) : null,
          stressScore: clampInt(stress, 1, 10),
          gratitudeItems: chance(rand, 0.45) ? ['Process before P&L'] : [],
          moodScore: clampInt(mood, 1, 10),
          emotionTags: stressed
            ? [pick(rand, NEGATIVE_CHECKIN_TAGS)]
            : chance(rand, 0.4)
              ? [pick(rand, POSITIVE_CHECKIN_TAGS)]
              : [],
          journalNote: chance(rand, 0.3) ? 'Suivi mon plan, pas dévié.' : null,
        },
        update: {},
      });
    }
  }

  ctx.log(`  check-ins: ${mornings} morning + ${evenings} evening (${both} dual-slot)`);
  return { mornings, evenings, both };
}

// =============================================================================
// Behavioral-score history (one snapshot per day — the derived 4 dims)
// =============================================================================

export async function seedBehavioralScores(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  const rand = makePrng(303);

  let n = 0;
  for (let daysAgo = WINDOW_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const p = progress(daysAgo);
    const discipline = clampInt(50 + p * 32 + gauss(rand, 0, 2.5), 0, 100);
    const emotionalStability = clampInt(57 + p * 24 + gauss(rand, 0, 2.5), 0, 100);
    const consistency = clampInt(60 + p * 23 + gauss(rand, 0, 2), 0, 100);
    const engagement = clampInt(64 + p * 22 + gauss(rand, 0, 2), 0, 100);
    const date = dbDate(ctx.now, daysAgo);

    await db.behavioralScore.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        disciplineScore: discipline,
        emotionalStabilityScore: emotionalStability,
        consistencyScore: consistency,
        engagementScore: engagement,
        components: {},
        sampleSize: {},
        windowDays: 30,
      },
      update: {
        disciplineScore: discipline,
        emotionalStabilityScore: emotionalStability,
        consistencyScore: consistency,
        engagementScore: engagement,
      },
    });
    n++;
  }

  ctx.log(`  behavioral scores: ${n} daily snapshots (discipline ~50 → ~82)`);
  return { behavioralScores: n };
}

// =============================================================================
// Habit logs (TRACK module — sleep / nutrition / caffeine / sport / meditation)
// =============================================================================

export async function seedHabitLogs(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId } = ctx;
  const rand = makePrng(404);
  const HABIT_WINDOW = 60;

  let n = 0;
  for (let daysAgo = HABIT_WINDOW - 1; daysAgo >= 0; daysAgo--) {
    const p = progress(daysAgo, HABIT_WINDOW);
    const date = dbDate(ctx.now, daysAgo);

    // Sleep — logged almost every day.
    if (chance(rand, 0.9)) {
      const durationMin = clampInt(gauss(rand, 6.6 + p * 1.0, 0.8) * 60, 240, 600);
      await db.habitLog.upsert({
        where: { userId_date_kind: { userId, date, kind: 'sleep' } },
        create: {
          userId,
          date,
          kind: 'sleep',
          value: { durationMin, quality: clampInt(5 + p * 4 + gauss(rand, 0, 1), 1, 10) },
          notes: null,
        },
        update: {},
      });
      n++;
    }

    // Nutrition — most days.
    if (chance(rand, 0.7)) {
      const q = ['poor', 'fair', 'good', 'excellent'] as const;
      await db.habitLog.upsert({
        where: { userId_date_kind: { userId, date, kind: 'nutrition' } },
        create: {
          userId,
          date,
          kind: 'nutrition',
          value: {
            mealsCount: clampInt(2 + rand() * 2, 1, 5),
            quality: pick(rand, q.slice(p > 0.5 ? 1 : 0)),
          },
          notes: null,
        },
        update: {},
      });
      n++;
    }

    // Caffeine — frequent, decreasing over time.
    if (chance(rand, 0.75)) {
      const cups = clampInt(gauss(rand, 3 - p * 1.2, 1), 0, 6);
      const caffeineValue = chance(rand, 0.6) ? { cups, lastDrinkAtUtc: '14:30' } : { cups };
      await db.habitLog.upsert({
        where: { userId_date_kind: { userId, date, kind: 'caffeine' } },
        create: { userId, date, kind: 'caffeine', value: caffeineValue, notes: null },
        update: {},
      });
      n++;
    }

    // Sport — a few times per week.
    if (chance(rand, 0.45 + p * 0.15)) {
      const type = ['cardio', 'strength', 'mixed', 'flexibility', 'other'] as const;
      await db.habitLog.upsert({
        where: { userId_date_kind: { userId, date, kind: 'sport' } },
        create: {
          userId,
          date,
          kind: 'sport',
          value: {
            type: pick(rand, type),
            durationMin: clampInt(30 + rand() * 60, 15, 120),
            intensityRating: clampInt(4 + rand() * 5, 1, 10),
          },
          notes: null,
        },
        update: {},
      });
      n++;
    }

    // Meditation — growing habit.
    if (chance(rand, 0.35 + p * 0.3)) {
      await db.habitLog.upsert({
        where: { userId_date_kind: { userId, date, kind: 'meditation' } },
        create: {
          userId,
          date,
          kind: 'meditation',
          value: {
            durationMin: clampInt(8 + rand() * 17, 5, 30),
            quality: clampInt(5 + p * 4, 1, 10),
          },
          notes: null,
        },
        update: {},
      });
      n++;
    }
  }

  ctx.log(`  habit logs: ${n} entries over ${HABIT_WINDOW} days`);
  return { habitLogs: n };
}

// =============================================================================
// Off days (Tour 14 — "jour off")
// =============================================================================

/**
 * Seed a couple of EXPLICIT past off days with a reason, so the demo shows the
 * "pont" behaviour on the heatmap / history / reports (a chosen day that never
 * counts as a missed check-in and does not break the streak). We deliberately
 * pick WEEKDAYS (the weekend is already off via `weekendsOff`), so these read as
 * a distinct member choice, not the automatic weekend rule.
 */
export async function seedOffDays(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId, now } = ctx;

  // Two recent, in-window weekday off days with a plausible reason each.
  const specs: Array<{ daysAgo: number; reason: string }> = [
    { daysAgo: 12, reason: 'Journée off posée : repos choisi, pas de trading.' },
    { daysAgo: 26, reason: 'Formation en présentiel toute la journée.' },
  ];

  let count = 0;
  for (const spec of specs) {
    // Nudge onto the nearest weekday so the off day is a visible member choice
    // rather than merged into the weekend-off rule (0 = Sun … 6 = Sat).
    let date = dbDate(now, spec.daysAgo);
    let dow = date.getUTCDay();
    let extra = 0;
    while (dow === 0 || dow === 6) {
      extra += 1;
      date = dbDate(now, spec.daysAgo + extra);
      dow = date.getUTCDay();
    }
    await db.memberOffDay.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, reason: spec.reason },
      update: { reason: spec.reason },
    });
    count++;
  }

  ctx.log(`  off days: ${count} explicit weekday off days (with reason)`);
  return { offDays: count };
}
