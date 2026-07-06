import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkServiceWorker } from '../../scripts/check-sw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(HERE, '../../public/sw.js'); // src/test → apps/web → public/sw.js

/**
 * Tour 15 — keeps the real `public/sw.js` honest in CI. The SW is hand-written
 * plain JS and never hits tsc/vitest otherwise; this test runs the same static
 * invariant check as `scripts/check-sw.mjs` against the committed file, and
 * proves the check actually catches regressions (not a rubber stamp).
 */
describe('service worker invariants', () => {
  const source = readFileSync(SW_PATH, 'utf8');

  it('the committed public/sw.js holds all 5 invariants', () => {
    expect(checkServiceWorker(source)).toEqual([]);
  });

  it('flags a fetch handler that intercepts non-navigation requests', () => {
    // Remove the `mode !== 'navigate'` guard → the check must complain.
    const broken = source.replace(/request\.mode\s*!==\s*['"]navigate['"]/, 'false');
    const failures = checkServiceWorker(broken);
    expect(failures.some((f) => /navigation/i.test(f))).toBe(true);
  });

  it('flags a missing offline pre-cache at install', () => {
    const broken = source.replace(/cache\.add\(/g, 'noop(');
    const failures = checkServiceWorker(broken);
    expect(failures.some((f) => /pre-cache/i.test(f))).toBe(true);
  });

  it('flags a removed push handler', () => {
    const broken = source.replace(/addEventListener\(\s*['"]push['"]/, "addEventListener('nope'");
    const failures = checkServiceWorker(broken);
    expect(failures.some((f) => /push handler/i.test(f))).toBe(true);
  });

  it('flags a stale (legacy) cache version', () => {
    const broken = source.replace(
      /const\s+VERSION\s*=\s*['"][^'"]+['"]/,
      "const VERSION = 'fxmily-sw-v1-j9'",
    );
    const failures = checkServiceWorker(broken);
    expect(failures.some((f) => /legacy/i.test(f))).toBe(true);
  });
});
