import 'server-only';

import {
  extractTextFromResponse,
  extractUsage,
  safeParseJson,
} from '@/lib/ai/claude-response';
import { env } from '@/lib/env';
import type { CalendarSnapshot } from '@/lib/calendar/snapshot';
import {
  adaptiveCalendarOutputSchema,
  type AdaptiveCalendarOutput,
  type CalendarBlock,
  type CalendarBlockCategoryValue,
  type CalendarBlockPriority,
  type CalendarDay,
} from '@/lib/schemas/adaptive-calendar';
import {
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKEND_DAYS,
  CALENDAR_SLOTS,
  type CalendarSlotValue,
} from '@/lib/calendar/instrument-v1';
import type { DaySlotsAvailability } from '@/lib/schemas/weekly-schedule-questionnaire';

import {
  buildCalendarUserPrompt,
  CALENDAR_OUTPUT_JSON_SCHEMA,
  CALENDAR_SYSTEM_PROMPT,
} from './prompt';
import { computeCostEur, type ClaudeUsage, type CostBreakdown } from './pricing';

/**
 * §26 Calendrier adaptatif — Claude client wrapper (J-C2). Carbone
 * `lib/weekly-report/claude-client.ts`.
 *
 * Two implementations behind a single interface :
 *   - **`MockCalendarClient`** — deterministic, zero-cost, no SDK import.
 *     Builds a Zod-valid {@link AdaptiveCalendarOutput} from the snapshot's
 *     declared availability so the smoke test exercises the full chain. Used
 *     when `ANTHROPIC_API_KEY` is not set (V1 default — the REAL path is the
 *     batch-local `claude --print` orchestrator, not this in-process client).
 *   - **`LiveCalendarClient`** — backed by `@anthropic-ai/sdk`, lazy-loaded so
 *     the bundle stays small and the import never fires unless `ANTHROPIC_API_KEY`
 *     is set. Dormant in V1 (kept ready for a future paid-API scaling path).
 *
 * **Defense-in-depth** :
 *   - System prompt locks Claude into the §2 "organise le temps, pas les
 *     trades" posture. No market analysis.
 *   - Output validated TWICE : the SDK structured-output config asks for
 *     `CALENDAR_OUTPUT_JSON_SCHEMA`, then `adaptiveCalendarOutputSchema.parse`
 *     re-validates (anti enum-fuzzing + double net + `safeFreeText` transform).
 *   - `profileSummary` already passed `safeFreeText` upstream + is wrapped in
 *     `<member_reflection_untrusted>` by `buildCalendarUserPrompt`.
 */

// =============================================================================
// Public interface
// =============================================================================

export interface CalendarGeneration {
  output: AdaptiveCalendarOutput;
  usage: ClaudeUsage;
  model: string;
  cost: CostBreakdown;
  /** True if the generation came from the mock path (no API call). */
  mocked: boolean;
}

export interface CalendarClaudeClient {
  generate(snapshot: CalendarSnapshot): Promise<CalendarGeneration>;
}

// =============================================================================
// Factory
// =============================================================================

let _cachedClient: CalendarClaudeClient | null = null;
let _cachedKeyPresent: boolean | null = null;

/**
 * Returns the active client (mock or live) based on env. Cached per-process —
 * the env doesn't change at runtime. Tests can call `resetCalendarClient()` to
 * clear the cache.
 */
export function getCalendarClient(): CalendarClaudeClient {
  const keyPresent = Boolean(env.ANTHROPIC_API_KEY);
  if (_cachedClient !== null && _cachedKeyPresent === keyPresent) {
    return _cachedClient;
  }
  const client = keyPresent ? new LiveCalendarClient() : new MockCalendarClient();
  _cachedClient = client;
  _cachedKeyPresent = keyPresent;
  return client;
}

export function resetCalendarClient(): void {
  _cachedClient = null;
  _cachedKeyPresent = null;
}

// =============================================================================
// Mock implementation — V1 default + smoke fixture
// =============================================================================

/**
 * Deterministic offline client. Produces a {@link AdaptiveCalendarOutput}
 * derived from the snapshot's declared availability + practice focus so a
 * smoke test can prove the full chain (build → validate → persist) without
 * the Anthropic API NOR the local `claude --print` binary.
 *
 * NOT a substitute for Claude's qualitative judgment — a contract-level smoke
 * fixture. The intent : "the calendar persists + renders ; once the batch runs
 * the same pipeline produces a real Claude-generated plan".
 */
export class MockCalendarClient implements CalendarClaudeClient {
  async generate(snapshot: CalendarSnapshot): Promise<CalendarGeneration> {
    const output = renderMockOutput(snapshot);
    // Validate via Zod — guarantees the mock stays aligned with the live schema.
    const validated = adaptiveCalendarOutputSchema.parse(output);

    // Token counts mimic a typical Opus calendar run so dev cost dashboards
    // look plausible. Cost is real EUR computed with the canonical table
    // (sentinel = 0.000000 for the local Max path).
    const usage: ClaudeUsage = {
      inputTokens: 2400,
      outputTokens: 900,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
    const cost = computeCostEur(env.ANTHROPIC_MODEL, usage);

    return {
      output: validated,
      usage,
      model: `mock:${env.ANTHROPIC_MODEL}`,
      cost,
      mocked: true,
    };
  }
}

const PRIMARY_CATEGORY_BY_FOCUS: Record<string, CalendarBlockCategoryValue> = {
  live: 'live_trading',
  backtest: 'backtest',
  mark_douglas: 'mark_douglas_review',
  balanced: 'live_trading',
};

const CATEGORY_LABELS: Record<CalendarBlockCategoryValue, string> = {
  live_trading: 'Session de trading',
  backtest: 'Entraînement / backtest',
  mark_douglas_review: 'Révision Mark Douglas',
  checkin: 'Check-in du jour',
  rest: 'Repos',
  meeting: 'Réunion Fxmily',
  free: 'Temps libre',
};

const DAY_LABELS_FR: Record<string, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

/** All 7 day keys in calendar order (Mon→Sun). */
const WEEK_DAY_KEYS = [...CALENDAR_WEEKDAYS, ...CALENDAR_WEEKEND_DAYS] as const;

function renderMockOutput(snapshot: CalendarSnapshot): AdaptiveCalendarOutput {
  const r = snapshot.responses;
  const primary = PRIMARY_CATEGORY_BY_FOCUS[r.practiceFocus] ?? 'live_trading';

  const days: CalendarDay[] = WEEK_DAY_KEYS.map((dayKey, index) => {
    const availability: DaySlotsAvailability =
      dayKey === 'saturday' || dayKey === 'sunday'
        ? r.weekendAvailability[dayKey]
        : r.weekdayAvailability[dayKey];

    const blocks: CalendarBlock[] = [];
    for (const slot of CALENDAR_SLOTS) {
      if (!availability[slot]) continue;
      // Balanced focus rotates the practice category across the day's slots.
      const category = r.practiceFocus === 'balanced' ? balancedCategoryForSlot(slot) : primary;
      const priority: CalendarBlockPriority = slot === r.energyPeak ? 'high' : 'medium';
      const durationMin = category === 'mark_douglas_review' ? 30 : 60;
      blocks.push({
        slot,
        category,
        durationMin,
        label: CATEGORY_LABELS[category],
        priority,
      });
    }
    // A light morning check-in nudge if the morning is free (process > outcome).
    if (availability.morning) {
      blocks.unshift({
        slot: 'morning',
        category: 'checkin',
        durationMin: 15,
        label: CATEGORY_LABELS.checkin,
        priority: 'low',
      });
    }

    return {
      date: addDaysIso(snapshot.weekStart, index),
      dayLabel: DAY_LABELS_FR[dayKey] ?? dayKey,
      // Cap defensively at the schema max (natural max here = 4).
      blocks: blocks.slice(0, 8),
    };
  });

  const overview =
    `Voici ta semaine organisée autour de tes ${snapshot.availableSlotsCount} créneaux disponibles ` +
    `et de ton objectif de ${r.sessionGoal} session(s). Le plan suit ta disponibilité réelle ` +
    `et ton pic d'énergie, sans pression : avance à ton rythme.`;

  const weeklyFocus =
    "Cette semaine, garde en tête que tu n'as pas besoin de prédire le marché pour bien exécuter : " +
    'concentre-toi sur ton process et accepte chaque résultat comme une donnée, pas un verdict.';

  const warnings: string[] = [];
  if (r.constraint !== 'none') {
    warnings.push(
      "J'ai allégé la charge de pratique cette semaine pour rester réaliste avec ta contrainte déclarée.",
    );
  }

  return {
    weekStart: snapshot.weekStart,
    overview: clampLen(overview, 100, 300),
    days,
    weeklyFocus: clampLen(weeklyFocus, 50, 200),
    warnings,
  };
}

function balancedCategoryForSlot(slot: CalendarSlotValue): CalendarBlockCategoryValue {
  switch (slot) {
    case 'morning':
      return 'live_trading';
    case 'afternoon':
      return 'backtest';
    case 'evening':
      return 'mark_douglas_review';
  }
}

/** Add `n` days to a `YYYY-MM-DD` string via UTC math (no TZ drift). */
function addDaysIso(weekStart: string, n: number): string {
  const [y, m, d] = weekStart.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Defensive clamp so the deterministic mock always satisfies the Zod bounds. */
function clampLen(s: string, min: number, max: number): string {
  let out = s.trim();
  if (out.length > max) out = out.slice(0, max).trimEnd();
  while (out.length < min) out += ' .';
  return out.slice(0, max);
}

// =============================================================================
// Live implementation — `@anthropic-ai/sdk` (dormant V1)
// =============================================================================

/**
 * Live client. Lazy-loads `@anthropic-ai/sdk` so the V1 default mock path
 * doesn't pull the SDK into the bundle / dev startup.
 *
 * **NOT the V1 production path** — V1 generates calendars via the batch-local
 * `claude --print` orchestrator ($0 Max subscription). This client is the
 * paid-API fallback, kept ready for a future scaling decision (ADR-005 Alt 6).
 * If the SDK import fails, falls back to the mock path with a `console.warn`.
 */
export class LiveCalendarClient implements CalendarClaudeClient {
  async generate(snapshot: CalendarSnapshot): Promise<CalendarGeneration> {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new MockCalendarClient().generate(snapshot);
    }

    let Anthropic: typeof import('@anthropic-ai/sdk').default;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch (err) {
      console.warn(
        '[calendar.claude-client] @anthropic-ai/sdk not installed — falling back to mock',
        err instanceof Error ? err.message : err,
      );
      return new MockCalendarClient().generate(snapshot);
    }

    const client = new Anthropic({ apiKey });
    const model = env.ANTHROPIC_MODEL;
    const userPrompt = buildCalendarUserPrompt(snapshot);

    // Cache the system prompt + schema via `cache_control: ephemeral` with an
    // explicit `ttl: '1h'` (default is 5min, which would invalidate every run
    // and bill full input rate). Output validated via Zod on the way back.
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: CALENDAR_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
        {
          type: 'text',
          text:
            'Schéma JSON à respecter (no extra keys) :\n' +
            JSON.stringify(CALENDAR_OUTPUT_JSON_SCHEMA),
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ] as never, // SDK type shape varies per version — we cast since we already
      // validate the output via Zod post-parse.
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = extractTextFromResponse(response);
    const parsedJson = safeParseJson(text);
    const validated = adaptiveCalendarOutputSchema.parse(parsedJson);

    const usage = extractUsage(response);
    const cost = computeCostEur(model, usage);

    return {
      output: validated,
      usage,
      model,
      cost,
      mocked: false,
    };
  }
}

// Response parsing helpers (extractTextFromResponse / safeParseJson /
// extractUsage) live in `@/lib/ai/claude-response` — shared single source of
// truth across the weekly / calendar / onboarding Claude clients (Session 1
// DoD#3 §28 : service central réutilisable).
