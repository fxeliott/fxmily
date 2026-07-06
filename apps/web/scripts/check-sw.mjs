/**
 * Static invariant check for the Service Worker (`public/sw.js`), Tour 15.
 *
 * The SW is hand-written plain JS (Turbopack doesn't compile SWs), so it never
 * goes through tsc/vitest by default. This script parses the source and asserts
 * the load-bearing contract so a careless edit can't silently break the offline
 * fallback or, worse, the push path. Pure text analysis — no DB, no dev server,
 * no browser — so it runs anywhere in <50ms and is safe for CI.
 *
 * Invariants (fail = exit 1):
 *   1. Versioned cache bucket present, and DIFFERENT from the legacy J9 name.
 *   2. Fetch handler only acts on top-level navigations (`mode === 'navigate'`).
 *   3. `/offline` is pre-cached at install.
 *   4. Stale cache buckets are cleaned up at activate.
 *   5. The push + notificationclick handlers are still present (never regressed).
 *
 * Run: `node scripts/check-sw.mjs` (from apps/web) → exit 0 when all pass.
 * Also imported by `check-sw.test.ts` so the CI vitest run enforces it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(__dirname, '..', 'public', 'sw.js');
const LEGACY_VERSION = 'fxmily-sw-v1-j9';

/**
 * Run every invariant against the given SW source. Returns a list of failure
 * messages (empty = all good). Exported so a unit test can assert on it.
 */
export function checkServiceWorker(source) {
  const failures = [];

  // 1. Versioned cache bucket, bumped past the legacy J9 name.
  const versionMatch = source.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!versionMatch) {
    failures.push('VERSION constant not found.');
  } else if (versionMatch[1] === LEGACY_VERSION) {
    failures.push(
      `VERSION is still the legacy ${LEGACY_VERSION} — bump it when the install/activate flow changes.`,
    );
  }
  if (!/const\s+CACHE_NAME\s*=\s*[`'"].*\$\{?VERSION\}?/.test(source)) {
    failures.push('CACHE_NAME must be derived from VERSION (versioned bucket).');
  }

  // 2. Fetch handler is navigation-scoped and network-first with an offline catch.
  const hasFetch = /addEventListener\(\s*['"]fetch['"]/.test(source);
  if (!hasFetch) {
    failures.push('No fetch handler — offline navigation fallback is missing.');
  } else {
    if (!/request\.mode\s*!==\s*['"]navigate['"]/.test(source)) {
      failures.push(
        'Fetch handler must early-return for non-navigation requests (request.mode !== "navigate").',
      );
    }
    if (!/caches\.match\(\s*OFFLINE_URL\s*\)/.test(source)) {
      failures.push(
        'Fetch handler must fall back to caches.match(OFFLINE_URL) on network failure.',
      );
    }
  }

  // 3. Pre-cache /offline at install.
  const installBlock = extractHandler(source, 'install');
  if (!installBlock) {
    failures.push('No install handler.');
  } else if (!/cache\.add\(/.test(installBlock) || !/OFFLINE_URL/.test(installBlock)) {
    failures.push('Install handler must pre-cache OFFLINE_URL (cache.add).');
  }
  if (!/const\s+OFFLINE_URL\s*=\s*['"]\/offline['"]/.test(source)) {
    failures.push("OFFLINE_URL must be '/offline'.");
  }

  // 4. Cleanup of stale buckets at activate.
  const activateBlock = extractHandler(source, 'activate');
  if (!activateBlock) {
    failures.push('No activate handler.');
  } else if (!/caches\.keys\(\)/.test(activateBlock) || !/caches\.delete\(/.test(activateBlock)) {
    failures.push(
      'Activate handler must enumerate caches.keys() and caches.delete() stale buckets.',
    );
  }

  // 5. Push path intact — the whole reason the fetch handler stays narrow.
  if (!/addEventListener\(\s*['"]push['"]/.test(source)) {
    failures.push('Push handler missing — the offline work must not remove it.');
  }
  if (!/addEventListener\(\s*['"]notificationclick['"]/.test(source)) {
    failures.push('notificationclick handler missing — the offline work must not remove it.');
  }

  return failures;
}

/**
 * Extract the body of a `self.addEventListener('<name>', ...)` block by brace
 * balancing from the handler start. Good enough for a hand-written SW; returns
 * null if the handler isn't found.
 */
function extractHandler(source, name) {
  const start = source.indexOf(`addEventListener('${name}'`);
  if (start === -1) return null;
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
      started = true;
    } else if (ch === '}') {
      depth--;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

// CLI entry point (skipped when imported by the test).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-sw.mjs')) {
  const source = readFileSync(SW_PATH, 'utf8');
  const failures = checkServiceWorker(source);
  if (failures.length > 0) {
    console.error('[check-sw] FAIL — Service Worker invariants broken:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('[check-sw] OK — all 5 Service Worker invariants hold.');
}
