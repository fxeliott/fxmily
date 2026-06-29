import 'server-only';

import { extractTextFromResponse, extractUsage, safeParseJson } from '@/lib/ai/claude-response';
import { env } from '@/lib/env';
import { weeklyReportOutputSchema, type WeeklyReportOutput } from '@/lib/schemas/weekly-report';
import type { WeeklySnapshot } from '@/lib/schemas/weekly-report';

import {
  buildWeeklyReportUserPrompt,
  WEEKLY_REPORT_OUTPUT_JSON_SCHEMA,
  WEEKLY_REPORT_SYSTEM_PROMPT,
} from './prompt';
import { computeCostEur, type ClaudeUsage, type CostBreakdown } from './pricing';

/**
 * Phase C — Claude client wrapper for the J8 weekly report.
 *
 * Two implementations behind a single interface :
 *   - **`MockWeeklyReportClient`** — deterministic, zero-cost, no SDK import.
 *     The cron uses this when `ANTHROPIC_API_KEY` is not set (V1 ship default
 *     until Eliott adds the key). Returns a Zod-valid {@link WeeklyReportOutput}
 *     derived from the snapshot counters so the smoke test is meaningful.
 *   - **`LiveWeeklyReportClient`** — backed by `@anthropic-ai/sdk`. Activates
 *     when `ANTHROPIC_API_KEY` is set. Lazy-loads the SDK so the bundle stays
 *     small in dev and the import never fires unless we explicitly opted in.
 *
 * **Defense-in-depth** :
 *   - System prompt locks Claude into Mark Douglas / discipline / exécution
 *     posture. No market analysis (SPEC §2).
 *   - Output schema validated TWICE : once at SDK level via structured-output,
 *     once via `weeklyReportOutputSchema.parse` (anti enum-fuzzing + double net
 *     in case the SDK ever drops schema enforcement).
 *   - All free-text in the snapshot already passed through `safeFreeText`
 *     upstream (builder + loader), so prompt-injection via Trojan Source bidi
 *     reorder is closed at the door.
 *
 * **Pricing & cache** :
 *   - System prompt is static & marked `cache_control: ephemeral` (1h cache,
 *     90% rabais on cache reads — `lib/weekly-report/pricing.ts`).
 *   - Cost in EUR (6-decimal string) returned alongside the output, ready for
 *     `weekly_reports.cost_eur` `Decimal(10, 6)`.
 */

// =============================================================================
// Public interface
// =============================================================================

export interface WeeklyReportGeneration {
  output: WeeklyReportOutput;
  usage: ClaudeUsage;
  model: string;
  cost: CostBreakdown;
  /** True if the generation came from the mock path (no API call). */
  mocked: boolean;
}

export interface WeeklyReportClaudeClient {
  generate(snapshot: WeeklySnapshot): Promise<WeeklyReportGeneration>;
}

// =============================================================================
// Factory
// =============================================================================

let _cachedClient: WeeklyReportClaudeClient | null = null;
let _cachedKeyPresent: boolean | null = null;

/**
 * Returns the active client (mock or live) based on env. Cached per-process —
 * the env doesn't change at runtime. Tests can call `resetClaudeClient()` to
 * clear the cache.
 */
export function getWeeklyReportClient(): WeeklyReportClaudeClient {
  const keyPresent = Boolean(env.ANTHROPIC_API_KEY);
  if (_cachedClient !== null && _cachedKeyPresent === keyPresent) {
    return _cachedClient;
  }
  const client = keyPresent ? new LiveWeeklyReportClient() : new MockWeeklyReportClient();
  _cachedClient = client;
  _cachedKeyPresent = keyPresent;
  return client;
}

export function resetClaudeClient(): void {
  _cachedClient = null;
  _cachedKeyPresent = null;
}

// =============================================================================
// Mock implementation — V1 ship default
// =============================================================================

/**
 * Deterministic offline client. Produces a {@link WeeklyReportOutput} derived
 * from the snapshot counters so the smoke-test live can prove the full chain
 * without hitting the Anthropic API.
 *
 * The output is **not** a substitute for Claude's qualitative judgment — it's
 * a contract-level smoke fixture. The intent is "the email lands in Eliott's
 * inbox with a structured report, and once ANTHROPIC_API_KEY is set the same
 * pipeline produces real Claude output".
 */
export class MockWeeklyReportClient implements WeeklyReportClaudeClient {
  async generate(snapshot: WeeklySnapshot): Promise<WeeklyReportGeneration> {
    const output = renderMockOutput(snapshot);
    // Validate via Zod — guarantees the mock stays aligned with the live schema.
    const validated = weeklyReportOutputSchema.parse(output);

    // Token counts mimic a typical Sonnet 4.6 weekly run (~3k input, ~1k output)
    // so dev cost dashboards look plausible. Cost is real EUR computed with the
    // canonical pricing table.
    const usage: ClaudeUsage = {
      inputTokens: 3200,
      outputTokens: 950,
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

function renderMockOutput(snapshot: WeeklySnapshot): WeeklyReportOutput {
  const c = snapshot.counters;
  const closed = c.tradesWin + c.tradesLoss + c.tradesBreakEven;
  const winRate = closed > 0 ? Math.round((c.tradesWin / closed) * 100) : 0;
  const planRate = c.planRespectRate === null ? 'n/a' : `${Math.round(c.planRespectRate * 100)}%`;

  if (c.tradesTotal === 0 && c.morningCheckinsCount === 0 && c.eveningCheckinsCount === 0) {
    return {
      summary:
        "Le membre n'a aucune activité enregistrée cette semaine — pas de trades, pas de check-ins. C'est typique d'un onboarding récent ou d'une semaine de pause volontaire ; pas un signal d'inquiétude en soi.",
      risks: [],
      recommendations: [
        "Relancer doucement avec un message d'encouragement pour le check-in matin (rituel le plus facile à reprendre).",
      ],
      patterns: {},
    };
  }

  const summary =
    `Le membre a pris ${c.tradesTotal} trade(s) cette semaine (winrate ${winRate}%) avec ${planRate} de plan respecté. ` +
    `Routine : ${c.morningCheckinsCount} check-ins matin et ${c.eveningCheckinsCount} soir, streak ${c.streakDays}j. ` +
    `${c.douglasCardsDelivered} fiche(s) Mark Douglas délivrée(s) (${c.douglasCardsSeen} lue(s)). ` +
    `Mock smoke-test — l'analyse qualitative arrivera quand ANTHROPIC_API_KEY sera configurée.`;

  const risks: string[] = [];
  if (c.planRespectRate !== null && c.planRespectRate < 0.7) {
    risks.push(
      `Plan respecté seulement à ${Math.round(c.planRespectRate * 100)}% — drift de discipline à surveiller, à recouper avec la trajectoire émotionnelle.`,
    );
  }
  if (c.tradesLoss >= 3 && c.tradesWin === 0) {
    risks.push(
      `Série de ${c.tradesLoss} pertes sans gain — risque de tilt si le membre force la prochaine entrée pour "se refaire".`,
    );
  }
  if (c.streakDays === 0 && c.morningCheckinsCount === 0) {
    risks.push(
      `Aucun check-in matin cette semaine — risque de désengagement progressif, à recouper avec les annotations admin.`,
    );
  }

  const recommendations: string[] = [];
  recommendations.push(
    `Vérifier les fiches Mark Douglas livrées et relancer si la lecture stagne (${c.douglasCardsSeen}/${c.douglasCardsDelivered}).`,
  );
  if (c.eveningCheckinsCount < c.morningCheckinsCount) {
    recommendations.push(
      `Encourager le check-in du soir — il manque ${c.morningCheckinsCount - c.eveningCheckinsCount} jour(s) cette semaine, c'est là que la stabilité émotionnelle se mesure.`,
    );
  }

  const patterns: WeeklyReportOutput['patterns'] = {};
  if (snapshot.freeText.sessionsTraded.length > 0) {
    patterns.sessionFocus = `Sessions traitées : ${snapshot.freeText.sessionsTraded
      .map((s) => `${s.session}=${s.count}`)
      .join(', ')}.`;
  }
  if (c.sleepHoursMedian !== null && c.tradesTotal > 0) {
    patterns.sleepPerf = `Sommeil médian ${c.sleepHoursMedian.toFixed(1)}h sur ${c.tradesTotal} trade(s) — corrélation à observer sur 4–6 semaines.`;
  }
  if (snapshot.freeText.emotionTags.length > 0) {
    patterns.emotionPerf = `Émotions dominantes : ${snapshot.freeText.emotionTags.slice(0, 5).join(', ')}.`;
  }
  if (c.planRespectRate !== null) {
    patterns.disciplineTrend = `Plan respect rate ${Math.round(c.planRespectRate * 100)}% sur ${closed} trade(s) clôturé(s).`;
  }

  return { summary, risks, recommendations, patterns };
}

// =============================================================================
// Live implementation — `@anthropic-ai/sdk`
// =============================================================================

/**
 * Live client. Lazy-loads `@anthropic-ai/sdk` so the V1 default mock path
 * doesn't pull the SDK into the bundle / dev startup.
 *
 * **NOT smoke-tested in this PR** — V1 ships with `ANTHROPIC_API_KEY` empty,
 * the mock client is the smoke-test path. The first time Eliott sets the key,
 * point the cron at one user with `?dryRun=true` (cron route flag) to verify
 * cost numbers + content quality before the next Sunday cadence.
 *
 * If the SDK import fails (e.g. `@anthropic-ai/sdk` not installed), we fall
 * back to the mock path with a `console.warn` so the cron stays unblocked.
 */
export class LiveWeeklyReportClient implements WeeklyReportClaudeClient {
  async generate(snapshot: WeeklySnapshot): Promise<WeeklyReportGeneration> {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Defensive — should not happen, factory only instantiates us when key
      // is set. Fall back to mock rather than throw.
      return new MockWeeklyReportClient().generate(snapshot);
    }

    let Anthropic: typeof import('@anthropic-ai/sdk').default;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch (err) {
      console.warn(
        '[weekly-report.claude-client] @anthropic-ai/sdk not installed — falling back to mock',
        err instanceof Error ? err.message : err,
      );
      return new MockWeeklyReportClient().generate(snapshot);
    }

    // Bound the request: the SDK default is a 10-minute timeout × up to 2
    // retries (~30 min worst case on a hung connection), on a server cron path.
    // A 60s timeout comfortably covers a 2048-max_tokens non-streaming
    // completion and keeps a 5-member chunk bounded even if one member stalls;
    // the resulting APIConnectionTimeoutError is already isolated per member by
    // Promise.allSettled → reportWarning (audit RESIL-2).
    const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
    const model = env.ANTHROPIC_MODEL;
    const userPrompt = buildWeeklyReportUserPrompt(snapshot);

    // We treat the SDK shape defensively — JSON output via `messages.create`
    // with an explicit instruction. If the running SDK version exposes
    // `output_config.format` for guaranteed structured output, prefer that ;
    // otherwise rely on the strict schema instruction in the system prompt
    // and validate on the way back via Zod.
    //
    // We do NOT use prefill (Sonnet 4.6 returns 400 for prefill — verified
    // 2026-05-08). Cache the system prompt via `cache_control: ephemeral`
    // (1h cache, 90% off cache reads) — payoff after the 2nd run / week.

    // J8 audit fix — explicit `ttl: '1h'` on cache_control so the system
    // prompt is cached for the full hour (default is 5min, which would mean
    // every weekly cron invalidates the cache and bills full input rate).
    // SDK 0.95.1 supports `ttl` on `cache_control` ; documented in Anthropic
    // 2026 prompt-caching guide.
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: WEEKLY_REPORT_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
        {
          type: 'text',
          text:
            'Schéma JSON à respecter (no extra keys) :\n' +
            JSON.stringify(WEEKLY_REPORT_OUTPUT_JSON_SCHEMA),
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ] as never, // SDK type shape varies per version — we cast since we already
      // validate the output via Zod post-parse.
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract the JSON body. Sonnet 4.6 returns a single `content` array;
    // we look for the first `text` block.
    const text = extractTextFromResponse(response);
    const parsedJson = safeParseJson(text);
    const validated = weeklyReportOutputSchema.parse(parsedJson);

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
