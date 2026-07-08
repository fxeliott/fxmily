import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeLeaderboardScore } from '@/lib/leaderboard/builder';

/**
 * SPEC §2 / §21.5 (BLOQUANT) — statistical-isolation suite for the member
 * Leaderboard. The ranking measures the ACT of working (assiduité / discipline
 * / régularité / travail de suivi), NEVER trading performance. This is the test
 * PROMISED by `prisma/schema.prisma` (LeaderboardSnapshot block) and the sibling
 * of `tracking-isolation.test.ts` / `training-isolation.test.ts`.
 *
 * Invariant under test (3 angles):
 *   1. SCHEMA — `LeaderboardSnapshot` carries NO FK to `Trade` /
 *      `BehavioralScore` / `PreTradeCheck`. Only the `userId` cascade exists.
 *   2. SOURCE — the `lib/leaderboard/**` modules name no P&L column
 *      (`realizedR` / `resultR` / `plannedRR` / `expectancyR` / `profitFactor` /
 *      `drawdown` / `outcome`), never read the `consistency` (P&L-proxy)
 *      dimension, and import no real-edge analysis module (analytics / trades /
 *      the P&L `consistency` scorer). Building on the pure scoring PRIMITIVES
 *      (`@/lib/scoring/helpers` + `@/lib/scoring/types`) is allowed — they carry
 *      zero P&L; reading the `engagement` / `discipline` DIMENSION SCORES is
 *      allowed — they are act-only.
 *   3. RUNTIME — a P&L number handed to the builder as an unknown key cannot
 *      change the rank: the builder consumes only its four typed act inputs.
 */

/** Resolve repo source relative to THIS test file (cwd-independent). */
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

/** apps/web-relative read (for the Prisma schema, a sibling of `src/`). */
function readRepo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
}

/** Strip comments before scanning — defensive comments mention the tokens. */
function readSrcCode(rel: string): string {
  return readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFilesIn(relDir: string, exts: readonly string[]): string[] {
  const abs = fileURLToPath(new URL(`../../${relDir}`, import.meta.url));
  return readdirSync(abs)
    .filter(
      (f) =>
        exts.some((ext) => f.endsWith(ext)) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    )
    .map((f) => `${relDir}/${f}`);
}

const LEADERBOARD_MODULES: string[] = sourceFilesIn('lib/leaderboard', ['.ts']);
const LEADERBOARD_COMPONENTS: string[] = sourceFilesIn('components/leaderboard', ['.ts', '.tsx']);

// =============================================================================
// Block A — Prisma schema FK firewall (the literal `Enforced by` claim)
// =============================================================================

describe('§21.5 — LeaderboardSnapshot carries NO FK to the real edge', () => {
  const schema = readRepo('prisma/schema.prisma');

  function modelBlock(name: string): string {
    const start = schema.indexOf(`model ${name} {`);
    expect(start, `model ${name} must exist in schema.prisma`).toBeGreaterThan(-1);
    const end = schema.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    return schema.slice(start, end);
  }

  it('LeaderboardSnapshot has the userId cascade as its ONLY relation', () => {
    // Strip Prisma doc/line comments (`///` + `//`) — a comment that documents
    // "parity with BehavioralScore.date" is NOT an FK breach; only a field whose
    // TYPE is a real-edge model would be. This mirrors `readSrcCode` for sources.
    const block = modelBlock('LeaderboardSnapshot').replace(/\/\/.*$/gm, '');
    expect(block).toContain('@relation');
    expect(block).toContain('onDelete: Cascade');
    const relations = block.match(/@relation\b/g) ?? [];
    expect(relations, 'LeaderboardSnapshot must declare exactly one @relation (user)').toHaveLength(
      1,
    );
    for (const forbidden of ['Trade', 'BehavioralScore', 'PreTradeCheck', 'ConstancyScore']) {
      expect(
        block,
        `LeaderboardSnapshot must not reference ${forbidden} as a field type (§21.5 breach)`,
      ).not.toContain(forbidden);
    }
  });
});

// =============================================================================
// Block B — static source firewall over lib/leaderboard/**
// =============================================================================

/** P&L reads + real-edge analysis surfaces — NEVER in `lib/leaderboard/**`. */
const BREACH_TOKENS = [
  'realizedR',
  'resultR',
  'plannedRR',
  'expectancyR',
  'profitFactor',
  'drawdown',
  '@/lib/scoring/consistency',
  '@/lib/analytics',
  '@/lib/trades',
  '@/lib/habit',
  'db.trade.',
  // The P&L-proxy behavioral dimension must never feed the rank.
  'consistency',
  'ConsistencyParts',
];

describe('§21.5 — static source firewall', () => {
  it('the glob actually discovers the leaderboard tree (no silent empty set)', () => {
    expect(LEADERBOARD_MODULES).toContain('lib/leaderboard/builder.ts');
    expect(LEADERBOARD_MODULES).toContain('lib/leaderboard/types.ts');
    expect(LEADERBOARD_MODULES.length).toBeGreaterThanOrEqual(2);
  });

  it.each(LEADERBOARD_MODULES)(
    'leaderboard module %s names no P&L / real-edge analysis token',
    (rel) => {
      const code = readSrcCode(rel);
      for (const token of BREACH_TOKENS) {
        expect(code, `${rel} must not contain "${token}" in code (§21.5 breach)`).not.toContain(
          token,
        );
      }
      // `outcome` only as a whole word: leaderboard code never reads a trade outcome.
      expect(/\boutcome\b/.test(code), `${rel} must not reference trade outcome`).toBe(false);
    },
  );

  // The presentation tree is part of the firewall too: a component that named a
  // P&L column (even to render it) would leak the real edge onto the board.
  it('the glob discovers the leaderboard component tree (no silent empty set)', () => {
    expect(LEADERBOARD_COMPONENTS).toContain('components/leaderboard/my-rank-card.tsx');
    expect(LEADERBOARD_COMPONENTS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(LEADERBOARD_COMPONENTS)(
    'leaderboard component %s names no P&L / real-edge analysis token',
    (rel) => {
      const code = readSrcCode(rel);
      for (const token of BREACH_TOKENS) {
        expect(code, `${rel} must not contain "${token}" in code (§21.5 breach)`).not.toContain(
          token,
        );
      }
      expect(/\boutcome\b/.test(code), `${rel} must not reference trade outcome`).toBe(false);
    },
  );
});

// =============================================================================
// Block C — runtime: a smuggled P&L number cannot move the rank
// =============================================================================

describe('§2/§21.5 — the builder consumes only its four act inputs', () => {
  const actInput = {
    engagementScore: 80,
    disciplineScore: 90,
    regularityScore: 70,
    trackingCoverage: 60,
    activeDays: 20,
  };

  it('an extra P&L-looking key on the input is inert (rank unchanged)', () => {
    const clean = computeLeaderboardScore(actInput);
    const smuggled = computeLeaderboardScore({
      ...actInput,
      // @ts-expect-error — a P&L key is NOT part of the typed input; must be ignored.
      realizedR: 5,
      outcome: 'win',
      profitFactor: 3,
    });
    expect(smuggled.score).toBe(clean.score);
    expect(smuggled).toEqual(clean);
  });
});
