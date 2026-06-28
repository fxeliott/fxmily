/**
 * "Daily extras" of the demo dataset — the three recurring, low-friction member
 * rituals that surround the journal:
 *
 *   1. PreTradeCheck   — V2.3 pre-trade circuit breaker (Mark Douglas anti-FOMO
 *                        + Gollwitzer if-then). One ~30s tap before an entry.
 *   2. TrackingEntry / TrackingSchedule — V2 S2 universal tracking engine. The
 *                        weekly "Fidélité à ton cadre" instrument (the only
 *                        shipped instrument, axis `risk_discipline`) captured
 *                        week over week, plus its recurring schedule.
 *   3. WeeklyScheduleQuestionnaire / AdaptiveCalendar — §26 calendrier adaptatif.
 *                        The closed weekly availability questionnaire and the
 *                        Claude-generated weekly plan it feeds.
 *
 * The whole module tells the same improvement arc as the rest of the demo
 * (posture §2/§31.2 — a calm mirror, never a verdict): early in the window the
 * member acts more on FOMO / revenge and skips a couple of frame rules; recently
 * the pre-trade reasons skew to `edge`/`calme` and the frame fidelity climbs.
 *
 * Self-contained: imports ONLY `./_shared.js` (no `@/lib/*`, no `server-only`)
 * so it runs under plain `tsx` with just DATABASE_URL set. Every recurring write
 * is an UPSERT on a `@@unique` key so a re-run is byte-identical; `PreTradeCheck`
 * has no unique key, so we `deleteMany` the demo user's rows first (the
 * orchestrator already wipes the user, but idempotence is kept as discipline).
 *
 * SHAPES (verified against the read-side source of truth):
 *   - TrackingEntry.responses — the closed `process-fidelity@v1` instrument
 *     (`src/lib/tracking/instruments/process-fidelity-v1.ts`): 7 booleans +
 *     2 likert (1..5) + 1 optional single_choice. Confidence (1..5) lives in the
 *     `confidenceLevel` COLUMN, never in `responses`.
 *   - WeeklyScheduleQuestionnaire.responses — the 9 closed answers of
 *     `weeklyScheduleResponsesSchema` (`src/lib/schemas/weekly-schedule-
 *     questionnaire.ts`).
 *   - AdaptiveCalendar.schedule — `adaptiveCalendarOutputSchema`
 *     (`src/lib/schemas/adaptive-calendar.ts`): { weekStart, overview,
 *     days[7]{ date, dayLabel, blocks[]{ slot, category, durationMin, label,
 *     priority } }, weeklyFocus, warnings[] }.
 */
import {
  type SeedCtx,
  at,
  dbDate,
  mondayOf,
  makePrng,
  pick,
  chance,
  clamp,
  clampInt,
} from './_shared.js';

// =============================================================================
// Shared constants (kept §2-clean — every label is process/psychology, never a
// market call, mirror the frozen instruments these rows answer).
// =============================================================================

/** Canonical batch-local Claude Max sentinel (mirror reports.ts / the service). */
const CLAUDE_MODEL = 'claude-code-local';

/** The only shipped tracking instrument (registry: process-fidelity@v1). */
const PROCESS_FIDELITY_KEY = 'process-fidelity';
const PROCESS_FIDELITY_VERSION = 'v1';
/** The single axis the instrument feeds (lib/tracking/instruments/process-fidelity-v1.ts). */
const PROCESS_FIDELITY_AXIS = 'risk_discipline';

// =============================================================================
// Date helpers local to this module
// =============================================================================

/** `YYYY-MM-DD` for a UTC-midnight `@db.Date` (the `mondayOf` / `dbDate` output). */
function ymdOfUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO-8601 year-week key (e.g. "2026-W26") for a UTC-midnight Monday. */
function isoWeekKey(monday: Date): string {
  // `monday` is a UTC-midnight Monday — count weeks from the year's first
  // Thursday (ISO-8601 anchor), identical to `lib/tracking/cadence.ts`.
  const d = new Date(monday.getTime());
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// =============================================================================
// 1. Pre-trade circuit-breaker checks
// =============================================================================

type PreTradeReason = 'edge' | 'fomo' | 'revenge' | 'boredom';
type PreTradeEmotion = 'calme' | 'excite' | 'frustre' | 'anxieux';

interface PreTradeSpec {
  daysAgo: number;
  utcHour: number;
  reasonToTrade: PreTradeReason;
  emotionLabel: PreTradeEmotion;
  planAlignment: boolean;
  stopLossPredefined: boolean;
  /** When true, this check is auto-linked to a real seeded trade on the same day. */
  link: boolean;
}

/**
 * ~17 checks across the window. EARLY → more `fomo`/`revenge`, `frustre`/`anxieux`,
 * plan/stop sometimes skipped. RECENT → almost all `edge`/`calme`, plan + stop
 * predefined. Spread so /pre-trade reads as a real, evolving habit.
 */
const PRE_TRADE_SPECS: readonly PreTradeSpec[] = [
  // --- Early window: the impulsive phase ---
  {
    daysAgo: 86,
    utcHour: 8,
    reasonToTrade: 'fomo',
    emotionLabel: 'excite',
    planAlignment: false,
    stopLossPredefined: false,
    link: false,
  },
  {
    daysAgo: 82,
    utcHour: 13,
    reasonToTrade: 'revenge',
    emotionLabel: 'frustre',
    planAlignment: false,
    stopLossPredefined: false,
    link: true,
  },
  {
    daysAgo: 79,
    utcHour: 9,
    reasonToTrade: 'fomo',
    emotionLabel: 'anxieux',
    planAlignment: true,
    stopLossPredefined: false,
    link: false,
  },
  {
    daysAgo: 74,
    utcHour: 14,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 68,
    utcHour: 8,
    reasonToTrade: 'boredom',
    emotionLabel: 'anxieux',
    planAlignment: false,
    stopLossPredefined: true,
    link: false,
  },
  // --- Mid window: steadier, the odd slip ---
  {
    daysAgo: 60,
    utcHour: 10,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 54,
    utcHour: 13,
    reasonToTrade: 'fomo',
    emotionLabel: 'excite',
    planAlignment: true,
    stopLossPredefined: true,
    link: false,
  },
  {
    daysAgo: 47,
    utcHour: 9,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 41,
    utcHour: 15,
    reasonToTrade: 'revenge',
    emotionLabel: 'frustre',
    planAlignment: false,
    stopLossPredefined: true,
    link: false,
  },
  {
    daysAgo: 34,
    utcHour: 8,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  // --- Recent window: the disciplined phase ---
  {
    daysAgo: 27,
    utcHour: 14,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 21,
    utcHour: 9,
    reasonToTrade: 'edge',
    emotionLabel: 'excite',
    planAlignment: true,
    stopLossPredefined: true,
    link: false,
  },
  {
    daysAgo: 16,
    utcHour: 13,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 11,
    utcHour: 10,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 6,
    utcHour: 8,
    reasonToTrade: 'boredom',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: false,
  },
  {
    daysAgo: 3,
    utcHour: 14,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
  {
    daysAgo: 1,
    utcHour: 9,
    reasonToTrade: 'edge',
    emotionLabel: 'calme',
    planAlignment: true,
    stopLossPredefined: true,
    link: true,
  },
] as const;

async function seedPreTradeChecks(ctx: SeedCtx, rand: () => number): Promise<number> {
  const { db, userId, now } = ctx;

  // No `@@unique` on PreTradeCheck → clear the user's rows for re-runnability.
  await db.preTradeCheck.deleteMany({ where: { userId } });

  // Index the demo trades by civil day so a "link" check can point at a real
  // trade entered the same day (linkedTradeId is a plain string, no FK). Null-
  // safe: if no trade exists on that day, the check stays unlinked.
  const trades = await db.trade.findMany({
    where: { userId },
    select: { id: true, enteredAt: true },
    orderBy: { enteredAt: 'asc' },
  });
  const tradeByDay = new Map<string, string>();
  for (const t of trades) {
    const dayKey = t.enteredAt.toISOString().slice(0, 10);
    if (!tradeByDay.has(dayKey)) tradeByDay.set(dayKey, t.id);
  }

  let created = 0;
  for (const spec of PRE_TRADE_SPECS) {
    const createdAt = at(now, spec.daysAgo, spec.utcHour, clampInt(rand() * 55, 0, 59));
    const dayKey = ymdOfUtc(dbDate(now, spec.daysAgo));
    const linkedTradeId = spec.link ? (tradeByDay.get(dayKey) ?? null) : null;

    await db.preTradeCheck.create({
      data: {
        userId,
        reasonToTrade: spec.reasonToTrade,
        emotionLabel: spec.emotionLabel,
        planAlignment: spec.planAlignment,
        stopLossPredefined: spec.stopLossPredefined,
        linkedTradeId,
        createdAt,
      },
    });
    created++;
  }
  return created;
}

// =============================================================================
// 2. Universal tracking engine — process-fidelity weekly captures + schedule
// =============================================================================

type FeltEmotion = 'calm' | 'confident' | 'impatient' | 'fearful' | 'frustrated' | 'euphoric';

/** A boolean answer that gets MORE likely to be "true" as the window progresses. */
function disciplinedBool(rand: () => number, t: number, floor: number): boolean {
  // floor at the oldest week, →~0.97 at the most recent. Bounded for safety.
  return chance(rand, clamp(floor + t * (0.95 - floor), 0, 0.97));
}

/** A 1..5 likert that trends up over the window (frequency of good behaviour). */
function disciplinedLikert(rand: () => number, t: number): 1 | 2 | 3 | 4 | 5 {
  const base = 2 + t * 2.4; // ~2 early → ~4.4 recent
  return clampInt(base + (rand() - 0.5) * 1.2, 1, 5) as 1 | 2 | 3 | 4 | 5;
}

/**
 * Seed N most-recent COMPLETE weeks of the `process-fidelity` instrument plus its
 * recurring schedule. occurrenceKey = the ISO year-week (`computeOccurrenceKey`
 * weekly format), unique per (userId, instrumentKey). The captures improve over
 * time (fidelity climbs); confidence rises in lock-step (column, not responses).
 */
async function seedProcessFidelity(ctx: SeedCtx, rand: () => number): Promise<number> {
  const { db, userId, now } = ctx;

  const WEEKS = 11; // ~3 months of weekly captures, skipping the in-progress week.
  let created = 0;

  for (let i = 0; i < WEEKS; i++) {
    const weeksAgo = i + 1; // 1 = last complete week … WEEKS = oldest.
    const monday = mondayOf(now, weeksAgo); // UTC-midnight Monday (@db.Date math).
    const occurrenceKey = isoWeekKey(monday);
    // 0 at the oldest week → 1 at the most recent.
    const t = clamp((WEEKS - i) / WEEKS, 0, 1);

    const responses: Record<string, boolean | number | string> = {
      cut_20h: disciplinedBool(rand, t, 0.55),
      one_risk_trade_per_day: disciplinedBool(rand, t, 0.5),
      one_stop_per_day: disciplinedBool(rand, t, 0.5),
      stop_set_before_entry: disciplinedBool(rand, t, 0.6),
      risk_size_respected: disciplinedBool(rand, t, 0.55),
      // `breakeven_secured` is optional — sometimes omitted early (no answer).
      prep_done_before_session: disciplinedBool(rand, t, 0.5),
      patience_anti_fomo: disciplinedLikert(rand, t),
      no_revenge_after_loss: disciplinedLikert(rand, t),
    };
    // Optional booleans/choices: present most of the time, omitted occasionally so
    // the "optional, may be absent" path is represented (never `undefined` in JSON).
    if (chance(rand, 0.75)) {
      responses.breakeven_secured = disciplinedBool(rand, t, 0.6);
    }
    if (chance(rand, 0.85)) {
      const feltEarly: readonly FeltEmotion[] = ['impatient', 'fearful', 'frustrated'];
      const feltRecent: readonly FeltEmotion[] = ['calm', 'confident', 'euphoric'];
      responses.felt_emotion = pick(rand, t > 0.5 ? feltRecent : feltEarly);
    }

    // Confidence (1..5) — rises with the arc, persisted to the COLUMN.
    const confidenceLevel = clampInt(2 + t * 2.6 + (rand() - 0.5), 1, 5);

    // D2 reliability metadata. Weekly instrument default context is `cold`
    // (retrospective). A handful captured at the scheduled prompt → `scheduled`.
    const captureContext: 'cold' | 'scheduled' = chance(rand, 0.3) ? 'scheduled' : 'cold';
    const responseLatencyMs = clampInt(45_000 + rand() * 120_000, 0, 86_400_000);
    // Submitted on the Monday the week closes, ~19h local; prompted ~2min earlier.
    const submittedAt = at(now, weeksAgo * 7 - 7, 18, clampInt(rand() * 50, 0, 59));
    const promptedAt = new Date(submittedAt.getTime() - (90_000 + Math.floor(rand() * 60_000)));

    await db.trackingEntry.upsert({
      where: {
        userId_instrumentKey_occurrenceKey: {
          userId,
          instrumentKey: PROCESS_FIDELITY_KEY,
          occurrenceKey,
        },
      },
      create: {
        userId,
        instrumentKey: PROCESS_FIDELITY_KEY,
        instrumentVersion: PROCESS_FIDELITY_VERSION,
        axis: PROCESS_FIDELITY_AXIS,
        occurrenceKey,
        responses: responses as object,
        confidenceLevel,
        captureContext,
        responseLatencyMs,
        promptedAt,
        submittedAt,
      },
      update: {
        instrumentVersion: PROCESS_FIDELITY_VERSION,
        axis: PROCESS_FIDELITY_AXIS,
        responses: responses as object,
        confidenceLevel,
        captureContext,
        responseLatencyMs,
        promptedAt,
        submittedAt,
      },
    });
    created++;
  }

  // Recurring schedule (one row per user+instrument). The last completion was the
  // most recent week's Monday; the next is due in the near future (a calm nudge,
  // SPEC §2 — no streak/urgency). `nextDueAt` lands ~2 days out so /track surfaces
  // the instrument as "à venir", not overdue.
  const lastCompletedAt = at(now, 7 - 7, 18, 30); // last week's Monday ~18:30 UTC
  const nextDueAt = at(now, -2, 8, 0); // ~2 days in the future, 08:00 UTC.
  await db.trackingSchedule.upsert({
    where: { userId_instrumentKey: { userId, instrumentKey: PROCESS_FIDELITY_KEY } },
    create: {
      userId,
      instrumentKey: PROCESS_FIDELITY_KEY,
      nextDueAt,
      lastCompletedAt,
    },
    update: {
      nextDueAt,
      lastCompletedAt,
    },
  });

  return created;
}

// =============================================================================
// 3. Adaptive calendar — weekly questionnaire + the Claude-generated plan
// =============================================================================

type CalendarSlot = 'morning' | 'afternoon' | 'evening';
type CalendarBlockCategory =
  | 'live_trading'
  | 'backtest'
  | 'mark_douglas_review'
  | 'checkin'
  | 'rest'
  | 'meeting'
  | 'free';
type CalendarBlockPriority = 'high' | 'medium' | 'low';

interface CalendarBlock {
  slot: CalendarSlot;
  category: CalendarBlockCategory;
  durationMin: number;
  label: string;
  priority: CalendarBlockPriority;
}

interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayLabel: string;
  blocks: CalendarBlock[];
}

interface CalendarSchedule {
  weekStart: string;
  overview: string;
  days: CalendarDay[];
  weeklyFocus: string;
  warnings: string[];
}

/** FR weekday labels, Monday-first (the schedule days run Mon → Sun). */
const FR_DAY_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

/** Closed answer vocab (mirror lib/calendar/instrument-v1.ts). */
type Profile = 'trader_en_formation' | 'etudiant' | 'salarie' | 'independant' | 'autre';
type SleepChronotype = 'early' | 'standard' | 'late';
type MeetingCommitment = 'none' | 'occasional' | 'regular';
type PracticeFocus = 'live' | 'backtest' | 'mark_douglas' | 'balanced';
type WeekConstraint = 'none' | 'travel' | 'exams' | 'reduced';

interface DaySlots {
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
}

/**
 * Build a coherent, §2-clean weekly plan whose `days[].date` are the 7 civil days
 * (Mon→Sun) starting at `monday`. A weekday gets a prep + live-trading block in
 * the member's energy-peak slot, an evening check-in, plus a backtest / Mark
 * Douglas / meeting touch; weekends are lighter (rest + a little training). The
 * shape matches `adaptiveCalendarOutputSchema.strict()` exactly (durations
 * 15..120, ≤8 blocks/day, overview 100..300, weeklyFocus 50..200, ≤3 warnings).
 */
function buildSchedule(
  monday: Date,
  energyPeak: CalendarSlot,
  focus: PracticeFocus,
  meetingCommitment: MeetingCommitment,
  constraint: WeekConstraint,
): CalendarSchedule {
  const weekStart = ymdOfUtc(monday);
  const days: CalendarDay[] = [];

  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(monday.getTime() + d * 86_400_000);
    const date = ymdOfUtc(dayDate);
    const dayLabel = FR_DAY_LABELS[d] ?? 'Jour';
    const isWeekday = d <= 4;
    const blocks: CalendarBlock[] = [];

    if (isWeekday && constraint !== 'travel') {
      // Preparation before the session — the FACT of prep, never its content.
      blocks.push({
        slot: 'morning',
        category: 'live_trading',
        durationMin: 30,
        label: 'Préparation de session',
        priority: 'high',
      });
      // The live session in the energy-peak slot.
      blocks.push({
        slot: energyPeak,
        category: 'live_trading',
        durationMin: 90,
        label: 'Session de trading',
        priority: 'high',
      });
      // A training / psychology touch, weighted by the member's focus.
      if (focus === 'backtest' || focus === 'balanced') {
        blocks.push({
          slot: 'afternoon',
          category: 'backtest',
          durationMin: 45,
          label: 'Backtest et entraînement',
          priority: 'medium',
        });
      }
      if (focus === 'mark_douglas' || focus === 'balanced') {
        blocks.push({
          slot: 'afternoon',
          category: 'mark_douglas_review',
          durationMin: 30,
          label: 'Lecture Mark Douglas',
          priority: 'low',
        });
      }
      // §30 réunion presence a couple of days a week when committed.
      if (meetingCommitment !== 'none' && (d === 1 || d === 3)) {
        blocks.push({
          slot: 'evening',
          category: 'meeting',
          durationMin: 60,
          label: 'Réunion Fxmily',
          priority: 'medium',
        });
      }
      // The evening check-in ritual.
      blocks.push({
        slot: 'evening',
        category: 'checkin',
        durationMin: 15,
        label: 'Bilan du soir',
        priority: 'medium',
      });
    } else {
      // Weekend (or a travel weekday) — recover + a light touch.
      blocks.push({
        slot: 'morning',
        category: 'rest',
        durationMin: 60,
        label: 'Repos et récupération',
        priority: 'medium',
      });
      if (d === 6) {
        // Sunday — gentle weekly review + a little backtest.
        blocks.push({
          slot: 'afternoon',
          category: 'backtest',
          durationMin: 45,
          label: 'Revue de la semaine',
          priority: 'low',
        });
      } else {
        blocks.push({
          slot: 'afternoon',
          category: 'free',
          durationMin: 60,
          label: 'Temps libre',
          priority: 'low',
        });
      }
    }

    days.push({ date, dayLabel, blocks });
  }

  const overview =
    'Cette semaine organise ton temps autour de sessions courtes et préparées, ' +
    "d'un entraînement régulier hors marché et d'un retour calme chaque soir. " +
    "L'objectif est de tenir ton cadre, pas de viser un résultat : chaque créneau " +
    'est un repère pour pratiquer avec constance et préserver ton énergie mentale.';

  const weeklyFocus =
    'Garde ta coupure du soir, prépare chaque session à l’avance et reste fidèle ' +
    'à tes règles dures, sans te juger sur le résultat de la semaine.';

  const warnings: string[] = [];
  if (constraint === 'travel') {
    warnings.push('Semaine de déplacement : allège les sessions et privilégie le repos.');
  }
  if (constraint === 'exams') {
    warnings.push('Période d’examens : protège ton sommeil avant tout le reste.');
  }

  return { weekStart, overview, days, weeklyFocus, warnings };
}

/** Dominant block category across the 7 days (mirror `deriveDominantBlockCategory`). */
function dominantCategory(schedule: CalendarSchedule): CalendarBlockCategory | null {
  const order: readonly CalendarBlockCategory[] = [
    'live_trading',
    'backtest',
    'mark_douglas_review',
    'checkin',
    'rest',
    'meeting',
    'free',
  ];
  const counts = new Map<CalendarBlockCategory, number>();
  for (const day of schedule.days) {
    for (const block of day.blocks) {
      counts.set(block.category, (counts.get(block.category) ?? 0) + 1);
    }
  }
  let best: CalendarBlockCategory | null = null;
  let bestCount = 0;
  for (const category of order) {
    const n = counts.get(category) ?? 0;
    if (n > bestCount) {
      best = category;
      bestCount = n;
    }
  }
  return best;
}

interface WeekProfile {
  energyPeak: CalendarSlot;
  focus: PracticeFocus;
  meetingCommitment: MeetingCommitment;
  constraint: WeekConstraint;
  sessionGoal: number;
  sleep: SleepChronotype;
  profile: Profile;
}

/** Build the availability grid: peak slot always on, the rest mostly on. */
function buildAvailability(
  rand: () => number,
  energyPeak: CalendarSlot,
): { weekday: Record<string, DaySlots>; weekend: Record<string, DaySlots> } {
  const slotsFor = (lighter: boolean): DaySlots => ({
    morning: energyPeak === 'morning' ? true : chance(rand, lighter ? 0.3 : 0.7),
    afternoon: energyPeak === 'afternoon' ? true : chance(rand, lighter ? 0.4 : 0.75),
    evening: energyPeak === 'evening' ? true : chance(rand, lighter ? 0.5 : 0.8),
  });
  return {
    weekday: {
      monday: slotsFor(false),
      tuesday: slotsFor(false),
      wednesday: slotsFor(false),
      thursday: slotsFor(false),
      friday: slotsFor(false),
    },
    weekend: {
      saturday: slotsFor(true),
      sunday: slotsFor(true),
    },
  };
}

async function seedAdaptiveCalendars(
  ctx: SeedCtx,
  rand: () => number,
): Promise<{
  questionnaires: number;
  calendars: number;
}> {
  const { db, userId, now } = ctx;

  // Seed the current in-progress week (weeksAgo 0) PLUS 3 past weeks. Every
  // questionnaire gets a MATCHING calendar so the overdue safety-net scan
  // (lib/calendar/overdue.ts) never flags the demo member as "en attente".
  const WEEKS = 4;
  const CALENDAR_INSTRUMENT_VERSION = 1;

  // The arc: early weeks tilt to backtest/formation, recent weeks toward live +
  // a balanced focus, with one lighter (constraint) week mid-window.
  const weekProfiles: readonly WeekProfile[] = [
    // weeksAgo 0 (current)
    {
      energyPeak: 'morning',
      focus: 'balanced',
      meetingCommitment: 'regular',
      constraint: 'none',
      sessionGoal: 4,
      sleep: 'standard',
      profile: 'trader_en_formation',
    },
    // weeksAgo 1
    {
      energyPeak: 'morning',
      focus: 'live',
      meetingCommitment: 'regular',
      constraint: 'none',
      sessionGoal: 5,
      sleep: 'early',
      profile: 'trader_en_formation',
    },
    // weeksAgo 2
    {
      energyPeak: 'afternoon',
      focus: 'balanced',
      meetingCommitment: 'occasional',
      constraint: 'reduced',
      sessionGoal: 3,
      sleep: 'standard',
      profile: 'trader_en_formation',
    },
    // weeksAgo 3
    {
      energyPeak: 'afternoon',
      focus: 'backtest',
      meetingCommitment: 'occasional',
      constraint: 'none',
      sessionGoal: 3,
      sleep: 'late',
      profile: 'trader_en_formation',
    },
  ];

  let questionnaires = 0;
  let calendars = 0;

  for (let weeksAgo = 0; weeksAgo < WEEKS; weeksAgo++) {
    const monday = mondayOf(now, weeksAgo); // @db.Date Monday (UTC-midnight).
    const p = weekProfiles[weeksAgo];
    if (!p) continue;

    const availability = buildAvailability(rand, p.energyPeak);

    // --- Questionnaire (the 9 closed answers) ---------------------------------
    const responses = {
      profile: p.profile,
      sessionGoal: p.sessionGoal,
      weekdayAvailability: availability.weekday,
      weekendAvailability: availability.weekend,
      sleep: p.sleep,
      energyPeak: p.energyPeak,
      meetingCommitment: p.meetingCommitment,
      practiceFocus: p.focus,
      constraint: p.constraint,
    };

    await db.weeklyScheduleQuestionnaire.upsert({
      where: { userId_weekStart: { userId, weekStart: monday } },
      create: {
        userId,
        weekStart: monday,
        instrumentVersion: CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: p.energyPeak,
        responses: responses as object,
        // Filled the Sunday evening before the week (or Monday morning for the
        // current week) — well before the 18h overdue grace.
        createdAt: at(now, weeksAgo * 7 + 1, 18, 30),
        updatedAt: at(now, weeksAgo * 7 + 1, 18, 30),
      },
      update: {
        instrumentVersion: CALENDAR_INSTRUMENT_VERSION,
        energyPeakSlot: p.energyPeak,
        responses: responses as object,
      },
    });
    questionnaires++;

    // --- Calendar (the Claude-generated plan) ---------------------------------
    const schedule = buildSchedule(
      monday,
      p.energyPeak,
      p.focus,
      p.meetingCommitment,
      p.constraint,
    );
    const primaryCategory = dominantCategory(schedule);

    // Plausible batch-local Claude Max usage (mirror reports.ts cost shape).
    const inputTokens = clampInt(7000 + rand() * 3000, 0, 2_000_000);
    const outputTokens = clampInt(1200 + rand() * 800, 0, 50_000);
    const costEur = 0.01 + rand() * 0.02; // ~sub-cent; Prisma wraps Decimal.
    // Generated shortly after the questionnaire (the admin ran the batch).
    const generatedAt = at(now, weeksAgo * 7, 6, clampInt(rand() * 50, 0, 59));
    // Disclosure banner already seen on past weeks (not the current in-progress one).
    const aiDisclosureShownAt = weeksAgo > 0 ? at(now, weeksAgo * 7 - 1, 7, 15) : null;

    await db.adaptiveCalendar.upsert({
      where: { userId_weekStart: { userId, weekStart: monday } },
      create: {
        userId,
        weekStart: monday,
        schedule: schedule as object,
        primaryCategory,
        claudeModel: CLAUDE_MODEL,
        inputTokens,
        outputTokens,
        costEur,
        aiDisclosureShownAt,
        calendarInstrumentVersion: CALENDAR_INSTRUMENT_VERSION,
        generatedAt,
      },
      update: {
        schedule: schedule as object,
        primaryCategory,
        claudeModel: CLAUDE_MODEL,
        inputTokens,
        outputTokens,
        costEur,
        calendarInstrumentVersion: CALENDAR_INSTRUMENT_VERSION,
        generatedAt,
      },
    });
    calendars++;
  }

  return { questionnaires, calendars };
}

// =============================================================================
// Orchestrator
// =============================================================================

export async function seedDailyExtras(ctx: SeedCtx): Promise<Record<string, number>> {
  const { log } = ctx;
  // Dedicated PRNG stream (per the sibling-seeder convention) — stable, isolated.
  const rand = makePrng(1101);

  const preTradeChecks = await seedPreTradeChecks(ctx, rand);
  const trackingEntries = await seedProcessFidelity(ctx, rand);
  const { questionnaires, calendars } = await seedAdaptiveCalendars(ctx, rand);

  const summary = {
    preTradeChecks,
    trackingEntries,
    trackingSchedules: 1,
    weeklyScheduleQuestionnaires: questionnaires,
    adaptiveCalendars: calendars,
  };

  log(
    `  daily-extras: ${preTradeChecks} pre-trade checks, ${trackingEntries} tracking captures ` +
      `(process-fidelity) + 1 schedule, ${questionnaires} weekly questionnaires, ` +
      `${calendars} adaptive calendars`,
  );
  return summary;
}
