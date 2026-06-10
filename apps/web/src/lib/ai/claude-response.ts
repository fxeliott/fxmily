import 'server-only';

/**
 * Session 1 (Fondations, plan-10) — shared Claude response-parsing helpers.
 *
 * Single source of truth for the defensive parsing layer that was duplicated
 * verbatim across the three Claude client wrappers (`lib/weekly-report`,
 * `lib/calendar`, `lib/onboarding-interview`) — the "moteur dupliqué" reserve
 * flagged on Session 1 DoD#3 (§28 "service central réutilisable").
 *
 * Placement note : this module lives in `lib/ai/` ON PURPOSE. The anti-leak
 * firewall (`test/anti-leak/calendar-isolation.test.ts`) only sanctions
 * `pseudonymizeMember` as a cross-import from `lib/weekly-report/**` — putting
 * shared helpers there would force forbidden imports. `lib/ai/` is the neutral
 * home for pipeline-agnostic Claude plumbing (alongside `injection-detector`
 * and `prompt-builder`).
 *
 * These helpers are PURE (no env, no DB, no pipeline-specific schema) :
 * domain-specific prompts, Zod output schemas, mocks and pricing tables stay
 * in their pipeline module (carbon mince by design).
 */

/** Token usage of a Claude completion (API or local batch ingest). */
export interface ClaudeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreateTokens: number;
}

/** Minimal structural view of an Anthropic SDK response (shape-drift safe). */
export interface AnthropicLikeResponse {
  content?: unknown;
  usage?: unknown;
}

/**
 * Extract the JSON body from a Claude response, handling both the `text`
 * block path (default 2026-05) and the `tool_use` block path (some structured-
 * output configs return parsed JSON in `block.input`).
 *
 * Returns the raw string for the caller to JSON-parse — keeping the parser
 * separated from the extraction makes the unit test surface easier.
 */
export function extractTextFromResponse(resp: unknown): string {
  if (resp === null || typeof resp !== 'object') {
    throw new Error('Anthropic response: empty or non-object body');
  }
  const r = resp as AnthropicLikeResponse;
  if (!Array.isArray(r.content)) {
    throw new Error('Anthropic response: missing `content` array');
  }
  for (const block of r.content) {
    if (block === null || typeof block !== 'object' || !('type' in block)) continue;
    const typedBlock = block as { type: unknown };
    if (
      typedBlock.type === 'text' &&
      'text' in block &&
      typeof (block as { text: unknown }).text === 'string'
    ) {
      return (block as { text: string }).text;
    }
    // Structured-output mode — SDK returns the JSON pre-parsed in `block.input`.
    if (typedBlock.type === 'tool_use' && 'input' in block) {
      const input = (block as { input: unknown }).input;
      if (input !== null && typeof input === 'object') {
        return JSON.stringify(input);
      }
    }
  }
  throw new Error('Anthropic response: no `text` or `tool_use` block in `content`');
}

/** Parse a JSON body, stripping defensive ```json fences if the model added them. */
export function safeParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenceRe = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const match = fenceRe.exec(trimmed);
  const candidate = match ? match[1] : trimmed;
  try {
    return JSON.parse(candidate ?? '');
  } catch (err) {
    throw new Error(
      `Anthropic response: body is not valid JSON: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
}

/** Extract token usage from a Claude response, zeroed when the shape drifts. */
export function extractUsage(resp: unknown): ClaudeUsage {
  if (resp === null || typeof resp !== 'object') {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  }
  const u = (resp as AnthropicLikeResponse).usage;
  if (u === null || typeof u !== 'object') {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  }
  const usage = u as Record<string, unknown>;
  return {
    inputTokens: numericOr(usage.input_tokens, 0),
    outputTokens: numericOr(usage.output_tokens, 0),
    cacheReadTokens: numericOr(usage.cache_read_input_tokens, 0),
    cacheCreateTokens: numericOr(usage.cache_creation_input_tokens, 0),
  };
}

/** Coerce an unknown value to a non-negative integer, else the fallback. */
export function numericOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}
