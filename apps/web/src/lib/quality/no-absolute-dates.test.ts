import { describe, expect, it } from 'vitest';

// Guardrail unit + LIVE-repo coverage for the date TIME-BOMB check
// (`scripts/check-no-absolute-dates-in-tests.mjs`). The pure `scanSource`
// helper is asserted against synthetic inputs (so the future/past/sentinel/
// comment/allowlist branches are provably correct), and the LIVE test tree is
// asserted clean — so this very test flips red the moment someone commits a
// NEW future-dated literal without the `// allow-absolute-date` marker.
//
// The script is an ESM `.mjs` at the repo root, five levels up from this file
// (apps/web/src/lib/quality → repo root). Same cross-package-import shape as
// `../cron/crontab-sync.test.ts`.
import {
  SENTINEL_YEAR,
  checkNoAbsoluteDatesInTests,
  scanSource,
} from '../../../../../scripts/check-no-absolute-dates-in-tests.mjs';

// Fixed "today" so the assertions never depend on the real clock (the very bug
// class this check exists to prevent — we don't reproduce it in its own test).
const NOW = Date.UTC(2026, 6, 6); // 2026-07-06

describe('scanSource — future-dated literal detection', () => {
  it('flags a strictly-future date in executable code', () => {
    const hits = scanSource(`const d = new Date('2026-09-01');`, NOW); // allow-absolute-date test-fixture
    expect(hits.map((h) => h.date)).toEqual(['2026-09-01']); // allow-absolute-date test-fixture
  });

  it('does NOT flag a past date (already behind the clock — cannot rot)', () => {
    expect(scanSource(`const d = new Date('2026-05-01');`, NOW)).toEqual([]);
  });

  it('does NOT flag today (boundary is strictly greater-than)', () => {
    expect(scanSource(`const d = '2026-07-06';`, NOW)).toEqual([]);
  });

  it('does NOT flag a far-future SENTINEL year (intentional "never" marker)', () => {
    expect(scanSource(`const NEVER = '2099-01-15';`, NOW)).toEqual([]);
    // Boundary: the sentinel year itself is exempt.
    expect(scanSource(`const d = '${SENTINEL_YEAR}-01-01';`, NOW)).toEqual([]);
    // But the year just below it is NOT a sentinel and still flags.
    expect(scanSource(`const d = '${SENTINEL_YEAR - 1}-01-01';`, NOW)).toHaveLength(1);
  });

  it('ignores a future date sitting in a comment (documentation, not executed)', () => {
    expect(scanSource(`// scheduled for 2026-09-01`, NOW)).toEqual([]); // allow-absolute-date test-fixture
    expect(scanSource(` * shipped 2026-09-01`, NOW)).toEqual([]); // allow-absolute-date test-fixture
  });

  it('ignores a future date in a trailing line-comment on a code line', () => {
    expect(scanSource(`foo(); // revisit after 2026-09-01`, NOW)).toEqual([]); // allow-absolute-date test-fixture
  });

  it('honours the allow-absolute-date marker on the line', () => {
    expect(scanSource(`const d = '2026-09-01'; // allow-absolute-date fixture`, NOW)).toEqual([]);
  });

  it('honours the allow-absolute-date marker on the line above', () => {
    const src = `// allow-absolute-date fixture\nconst d = '2026-09-01';`;
    expect(scanSource(src, NOW)).toEqual([]);
  });

  it('rejects an impossible calendar date (not a real date → no false positive)', () => {
    expect(scanSource(`const s = 'ref-2026-99-99';`, NOW)).toEqual([]);
  });
});

describe('checkNoAbsoluteDatesInTests — LIVE repo (regression net)', () => {
  it('the committed test suite carries no un-annotated future-dated literals', () => {
    const violations = checkNoAbsoluteDatesInTests();
    expect(
      violations.length,
      violations.length === 0
        ? ''
        : [
            'Future-dated absolute literals found in tests (will rot as the clock advances):',
            ...violations.map((v) => `  ${v.file}:${v.line} → ${v.date}`),
            'Fix: make it relative, or annotate with `// allow-absolute-date <reason>`.',
          ].join('\n'),
    ).toBe(0);
  });
});
