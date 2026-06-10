/**
 * Vitest pour `lib/ai/claude-response` — les helpers de parsing partagés par
 * les 3 clients Claude (weekly-report / calendar / onboarding-interview).
 *
 * Ce module est devenu le point unique de parsing des réponses Anthropic
 * (Session 1 plan-10, DoD#3 §28 « service central réutilisable ») : il doit
 * être couvert en propre, pas seulement via les tests des pipelines.
 *
 * Couvre :
 *   - `extractTextFromResponse` — path `text`, path `tool_use` (structured
 *     output), shapes dégénérées (null, content absent, blocs invalides).
 *   - `safeParseJson` — JSON nu, fences ```json / ``` défensives, JSON invalide.
 *   - `extractUsage` — shape nominale, drift de shape (zéros, jamais de throw).
 *   - `numericOr` — coercion défensive (négatifs, non-finis, non-numériques).
 */

import { describe, expect, it } from 'vitest';

import { extractTextFromResponse, extractUsage, numericOr, safeParseJson } from './claude-response';

describe('extractTextFromResponse', () => {
  it('returns the text of the first `text` block', () => {
    const resp = {
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: {},
    };
    expect(extractTextFromResponse(resp)).toBe('{"ok":true}');
  });

  it('returns the stringified `input` of a `tool_use` block (structured output)', () => {
    const resp = {
      content: [{ type: 'tool_use', input: { ok: true, n: 2 } }],
    };
    expect(JSON.parse(extractTextFromResponse(resp))).toEqual({ ok: true, n: 2 });
  });

  it('skips non-object / typeless blocks and still finds the text block', () => {
    const resp = {
      content: [null, 42, { noType: true }, { type: 'text', text: 'found' }],
    };
    expect(extractTextFromResponse(resp)).toBe('found');
  });

  it('throws on null / non-object response', () => {
    expect(() => extractTextFromResponse(null)).toThrow(/empty or non-object/);
    expect(() => extractTextFromResponse('raw string')).toThrow(/empty or non-object/);
  });

  it('throws when `content` is missing or not an array', () => {
    expect(() => extractTextFromResponse({})).toThrow(/missing `content` array/);
    expect(() => extractTextFromResponse({ content: 'nope' })).toThrow(/missing `content` array/);
  });

  it('throws when no `text` nor `tool_use` block is usable', () => {
    const resp = {
      content: [{ type: 'thinking' }, { type: 'tool_use', input: null }],
    };
    expect(() => extractTextFromResponse(resp)).toThrow(/no `text` or `tool_use` block/);
  });
});

describe('safeParseJson', () => {
  it('parses bare JSON', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a defensive ```json fence', () => {
    expect(safeParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips an anonymous ``` fence with surrounding whitespace', () => {
    expect(safeParseJson('  ```\n{"a":[1,2]}\n```  ')).toEqual({ a: [1, 2] });
  });

  it('throws a descriptive error on invalid JSON', () => {
    expect(() => safeParseJson('not json at all')).toThrow(/body is not valid JSON/);
    expect(() => safeParseJson('')).toThrow(/body is not valid JSON/);
  });
});

describe('extractUsage', () => {
  it('extracts the 4 counters from a nominal Anthropic usage shape', () => {
    const resp = {
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 50,
      },
    };
    expect(extractUsage(resp)).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 800,
      cacheCreateTokens: 50,
    });
  });

  it('returns all-zeros when the response or `usage` is missing (never throws)', () => {
    const zeros = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
    expect(extractUsage(null)).toEqual(zeros);
    expect(extractUsage({})).toEqual(zeros);
    expect(extractUsage({ usage: null })).toEqual(zeros);
  });

  it('zeroes only the drifted fields when the shape partially drifts', () => {
    const resp = {
      usage: {
        input_tokens: '1200', // drift : string au lieu de number
        output_tokens: 340,
        cache_read_input_tokens: -5, // drift : négatif
        // cache_creation_input_tokens absent
      },
    };
    expect(extractUsage(resp)).toEqual({
      inputTokens: 0,
      outputTokens: 340,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
  });
});

describe('numericOr', () => {
  it('returns the floored value for non-negative finite numbers', () => {
    expect(numericOr(42, 0)).toBe(42);
    expect(numericOr(12.9, 0)).toBe(12);
    expect(numericOr(0, 7)).toBe(0);
  });

  it('falls back on negatives, non-finites and non-numbers', () => {
    expect(numericOr(-1, 9)).toBe(9);
    expect(numericOr(Number.NaN, 9)).toBe(9);
    expect(numericOr(Number.POSITIVE_INFINITY, 9)).toBe(9);
    expect(numericOr('42', 9)).toBe(9);
    expect(numericOr(undefined, 9)).toBe(9);
    expect(numericOr(null, 9)).toBe(9);
  });
});
