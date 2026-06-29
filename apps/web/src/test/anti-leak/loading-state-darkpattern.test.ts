import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * SPEC §31.2 — anti-dark-pattern (Black-Hat) guardrail for loading/empty states.
 *
 * RC#7 SI-2 — the invariant "no behavioral score, no streak count, no urgency /
 * FOMO lexicon in a skeleton / loading / empty state" was, until now, enforced
 * ONLY by manual review + a documenting `// §31.2` comment in each
 * `app/**∕loading.tsx`. The two existing §31.2 tests cover the amber-vs-red
 * TONE of a *populated* active action (north-star-hero / today-guidance), never
 * the token-ABSENCE sub-invariant on the un-populated states. A future skeleton
 * that pre-rendered the streak flame or a score number would ship a Black-Hat
 * pattern with a fully green suite — exactly the failure mode the §21.5 firewall
 * tests were built to prevent. This structural suite closes that gap (carbon of
 * the training/calendar/tracking-isolation source-grep style).
 *
 * It reads every route-level `loading.tsx` (Next.js streaming skeletons — the
 * surfaces a member sees BEFORE data loads, where an urgency nudge would be the
 * most manipulative) and asserts the rendered source carries none of the
 * gamification / urgency tokens §31.2 forbids. Documenting comments NAME those
 * tokens on purpose, so comments are stripped before the grep.
 */

// Resolve `src/app` relative to THIS file (cwd-independent): ../../ = src/.
const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Every route-level streaming skeleton under app/. */
function loadingFiles(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('loading.tsx'))
    .map((rel) => `${APP_DIR}/${rel}`.replace(/\\/g, '/'));
}

/** Strip block + line comments so the documenting `// §31.2 …` notes (which
 *  deliberately name the forbidden tokens) don't trip the grep. The `:` guard
 *  avoids truncating a `://` inside a string. */
function readCode(absPath: string): string {
  return readFileSync(absPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Tokens a §31.2-compliant skeleton/empty/loading state must NEVER render.
 * Each is verified absent from EVERY current loading.tsx (post comment-strip),
 * so a match means a real regression, not a false positive.
 */
const FORBIDDEN: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'streak flame emoji', re: /🔥/u },
  { label: 'streak reference', re: /\bstreak\b/i },
  { label: '« en feu » streak label', re: /\ben feu\b/i },
  { label: 'behavioral score reference', re: /\bscore\b/i },
  { label: 'urgency: expire/expiration', re: /\bexpir/i },
  { label: 'urgency: dépêche-toi', re: /d[ée]p[êe]che/i },
  { label: 'urgency: dernière chance', re: /derni[eè]re chance/i },
  { label: 'urgency: plus que N', re: /plus que \d/i },
  { label: 'urgency: il ne reste que', re: /il ne reste\b/i },
  { label: 'urgency: compte à rebours / countdown', re: /compte à rebours|countdown/i },
];

describe('§31.2 anti-dark-pattern — loading/empty states carry no gamification/urgency tokens (RC#7 SI-2)', () => {
  const files = loadingFiles();

  it('discovers the route-level loading skeletons (guards against an empty glob false-green)', () => {
    // If this ever hits 0 the suite would vacuously pass — pin a sane floor.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('/app/')), f] as const))(
    '%s contains no §31.2-forbidden token',
    (_label, absPath) => {
      const code = readCode(absPath);
      const hits = FORBIDDEN.filter((t) => t.re.test(code)).map((t) => t.label);
      expect(hits, `§31.2 violation in ${absPath}: ${hits.join(', ')}`).toEqual([]);
    },
  );
});
