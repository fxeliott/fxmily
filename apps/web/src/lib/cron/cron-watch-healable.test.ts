import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Coupling guard between the health monitor (health.ts EXPECTATIONS) and the
// external watcher's self-heal map (.github/workflows/cron-watch.yml HEALABLE).
// A cron that is monitored AND safe to re-fire (detection-only, idempotent, no
// member-facing send) MUST be in the self-heal map, or a real/false 503 the
// watcher cannot clear becomes a false hourly outage email until an operator
// acts. This pins the leaderboard recompute in that map + asserts no self-heal
// entry points at a route that does not exist (a re-fired 404).
//
// The workflow is a repo-root file, five levels up from apps/web/src/lib/cron
// (cron → lib → src → web → apps → root), same shape as ./crontab-sync.test.ts.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const CRON_WATCH_FILE = join(REPO_ROOT, '.github', 'workflows', 'cron-watch.yml');
const CRON_ROUTES_DIR = join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'api', 'cron');

/**
 * Parse the `declare -A HEALABLE=( ["action"]="route" ... )` associative array
 * from cron-watch.yml into an { action: route } map. Comment lines carry no
 * `["…"]="…"` pair and are ignored; the block ends at the first line that is only
 * a closing paren, so a `)` sitting inside a comment (e.g. "(userId, date)") does
 * not truncate it early.
 */
function parseHealableMap(yml: string): Record<string, string> {
  const open = yml.indexOf('declare -A HEALABLE=(');
  if (open === -1) throw new Error('HEALABLE map not found in cron-watch.yml');
  const afterOpen = yml.slice(open);
  const closeRel = afterOpen.search(/\n\s*\)/);
  const block = closeRel === -1 ? afterOpen : afterOpen.slice(0, closeRel);
  const map: Record<string, string> = {};
  for (const match of block.matchAll(/\["([^"]+)"\]="([^"]+)"/g)) {
    const [, action, route] = match;
    if (action && route) map[action] = route;
  }
  return map;
}

describe('cron-watch.yml — self-heal (HEALABLE) map', () => {
  const healable = parseHealableMap(readFileSync(CRON_WATCH_FILE, 'utf8'));

  it('parses a non-empty map anchored on the stable admin-brief entry (guards a broken parse)', () => {
    expect(Object.keys(healable).length).toBeGreaterThan(0);
    expect(healable['cron.admin_daily_brief.scan']).toBe('admin-daily-brief');
  });

  it('makes the nightly leaderboard recompute self-healable → no un-healable false 503', () => {
    // Regression: the brand-new leaderboard cron is monitored in health.ts but was
    // ABSENT from this map, so a delayed first run or an un-synced host crontab
    // produced a 503 the watcher could not clear → a false hourly outage email.
    // It is pure computation + an idempotent (userId, date) snapshot upsert with
    // NO member-facing send (see service.recomputeLeaderboard), so re-firing it is
    // safe and clears the red by writing a fresh heartbeat.
    expect(healable['cron.recompute_leaderboard.scan']).toBe('recompute-leaderboard');
  });

  it('every self-healable route resolves to a real /api/cron route (never re-fires a 404)', () => {
    const missing = Object.entries(healable).filter(
      ([, route]) => !existsSync(join(CRON_ROUTES_DIR, route, 'route.ts')),
    );
    expect(
      missing,
      missing.length === 0
        ? ''
        : `HEALABLE routes with no api/cron/<route>/route.ts: ${missing
            .map(([action, route]) => `${action} → ${route}`)
            .join(', ')}`,
    ).toEqual([]);
  });
});
