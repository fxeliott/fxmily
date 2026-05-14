import { describe, expect, it } from 'vitest';

import { detectInjection } from '@/lib/ai/injection-detector';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { containsBidiOrZeroWidth } from '@/lib/text/safe';

import { REVIEW_TEXT_MAX_CHARS, buildReviewCorpus, weeklyReviewSchema } from './weekly-review';

/**
 * V1.8 PR3 — edge tests cumulatifs (defense-in-depth audit).
 *
 * Three forensic angles a future regression could expose:
 *
 *   1. `buildReviewCorpus` must produce a corpus that **never** trips
 *      `detectCrisis` on common trader vocabulary (the same exclusions
 *      `lib/safety/crisis-detection.ts` carries for the V1.7.1 batch
 *      wire must hold on member free-text too).
 *
 *   2. `buildReviewCorpus` must produce a corpus that **never** trips
 *      `detectInjection` on legitimate Markdown-style member writing
 *      (headers, lists, role-name mentions in prose).
 *
 *   3. Member 4-byte UTF-8 (emoji) at max-char × 5 fields must stay
 *      well under Next.js Server Action body cap (1 MiB) — proves the
 *      char-count Zod max is a safe proxy for bytes.
 *
 * These tests exercise the *integration* between three already-tested
 * modules ; they don't re-test the modules themselves.
 */

function lastMondayUTC(): string {
  const d = new Date();
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function validBase() {
  return {
    weekStart: lastMondayUTC(),
    biggestWin: 'Closed at TP per plan despite a tempting trail above 50 EMA.',
    biggestMistake: 'Took a discretionary entry on a B-grade setup at NFP open.',
    bestPractice: 'Held my hedge rule when down -0.5R on the hour.',
    lessonLearned: 'Stick to A-grade only on news days; B is a tomorrow trade.',
    nextWeekFocus: 'Run the full pre-trade checklist before EVERY entry.',
  };
}

// ---------------------------------------------------------------------------
// Crisis-routing — trader slang false-positive guard on the BUILT corpus
// ---------------------------------------------------------------------------

describe('crisis FP on built WeeklyReview corpus', () => {
  it.each([
    {
      label: 'capital loss phrasing',
      override: {
        biggestMistake:
          "J'ai failli tout perdre sur ce trade — un revenge entry après NFP, sans stop.",
      },
    },
    {
      label: 'trading slang "tuer la position"',
      override: {
        biggestWin: "J'ai bien tué ma position au TP sans la trailler bêtement pour la 3e fois.",
      },
    },
    {
      label: 'market depression terminology',
      override: {
        nextWeekFocus: 'Ignorer la dépression du marché et exécuter le plan A sur les setups gold.',
      },
    },
  ])('does not trigger crisis HIGH on legit trader vocabulary — $label', ({ override }) => {
    const parsed = weeklyReviewSchema.safeParse({ ...validBase(), ...override });
    expect(
      parsed.success,
      `Zod input must parse cleanly for case ${JSON.stringify(override)}`,
    ).toBe(true);
    if (!parsed.success) return;

    const corpus = buildReviewCorpus(parsed.data);
    const crisis = detectCrisis(corpus);
    // Trading slang exclusions in `lib/safety/crisis-detection.ts` must
    // keep these out of the HIGH band — the V1.7.1 wire enforces this
    // on Claude output ; the V1.8 wire must hold the same line on
    // member input.
    expect(crisis.level).not.toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Injection-detector — Markdown / prose false-positive guard
// ---------------------------------------------------------------------------

describe('injection FP on built WeeklyReview corpus', () => {
  it('legit Markdown-style writing must not trigger injection_suspected', () => {
    const parsed = weeklyReviewSchema.safeParse({
      ...validBase(),
      biggestWin: 'Plan respecté lundi et mardi (process > outcome).',
      biggestMistake: 'Skip checklist sur NFP — vrai apprentissage en assistant un mentor.',
      lessonLearned: 'Le system trading doit toujours céder au système discipline.',
      nextWeekFocus: 'Re-lire les fiches Mark Douglas chapitre "patience" avant chaque session.',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const corpus = buildReviewCorpus(parsed.data);
    const injection = detectInjection(corpus);
    expect(injection.suspected, JSON.stringify(injection.matchedLabels)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Byte budget — emoji-heavy max-cap stays under Next.js Server Action 1 MiB
// ---------------------------------------------------------------------------

describe('built corpus byte budget (UTF-8 4-byte emoji safety)', () => {
  it('stays well under the 1 MiB Server Action body cap at max textarea size', () => {
    // Each emoji is 4 bytes UTF-8 (e.g. 💪 = U+1F4AA = 4 bytes).
    // Char-count Zod max is 4000 per field × 5 fields = 20000 chars max.
    // 4-byte × 20000 = 80 000 bytes ≈ 78 KiB — well under 1 MiB.
    // Safety floor : also assert each field hits its char cap individually.
    const emoji = '💪'; // 4 bytes UTF-8, 1 grapheme cluster
    const filled = emoji.repeat(REVIEW_TEXT_MAX_CHARS / 2); // 2000 emoji = 4000 chars (UTF-16 code units)
    expect(filled.length).toBe(REVIEW_TEXT_MAX_CHARS);

    const corpus = buildReviewCorpus({
      weekStart: '2026-05-04',
      biggestWin: filled,
      biggestMistake: filled,
      bestPractice: filled,
      lessonLearned: filled,
      nextWeekFocus: filled,
    });

    const bytes = Buffer.byteLength(corpus, 'utf8');
    expect(bytes).toBeLessThan(128 * 1024); // 128 KiB ceiling — 8× margin
    expect(containsBidiOrZeroWidth(corpus)).toBe(false);
  });
});
