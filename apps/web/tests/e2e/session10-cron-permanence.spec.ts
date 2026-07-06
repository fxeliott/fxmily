/**
 * SESSION 10 — Interconnexion / Validation finale.
 *
 * CRON PERMANENCE & SECURITY net (DoD §30 #3 — « app stable / permanente,
 * 0 faille »). The whole project's durability rests on its cron endpoints
 * (reminders, scans, reports, RGPD purges). This proves AT RUNTIME that every
 * protected cron:
 *   - rejects an unauthenticated POST (401 unauthorized, or 503 if the secret
 *     is not configured in this env) — work is NEVER done before the gate;
 *   - rejects a WRONG secret (same 401/503);
 *   - rejects GET (405 method-not-allowed) — crons are POST-only.
 *
 * The public liveness endpoint `/api/cron/health` is asserted separately: it is
 * intentionally secret-less (200 healthy / 503 degraded for an external probe).
 *
 * NOTE: we deliberately do NOT fire a valid-secret POST here — several of these
 * crons are DESTRUCTIVE (RGPD purges) and a real run belongs in a scoped test
 * with seeded data (see `session10-anti-mensonge-chain.spec.ts` for the real
 * `verification-scan` run). This spec is pure security-gate coverage and is
 * fast (no page cold-compile).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './fixtures';

/**
 * Every secret-gated cron under app/api/cron. `health` IS gated too (POST-only,
 * X-Cron-Secret, GET→405) — it serves a CronHealthReport to an authenticated
 * external monitor, NOT public liveness. The PUBLIC liveness probe is the
 * separate `/api/health` (asserted below).
 */
// S10 re-verif — DERIVED FROM THE FILESYSTEM, never hardcoded. Every directory
// under `src/app/api/cron` that ships a `route.ts` is a secret-gated endpoint and
// is therefore covered here automatically. A previous static list had silently
// dropped `weekly-report-overdue-alert` (a real gated route), letting its gate go
// untested; deriving the list makes that whole class of gap impossible — any cron
// added in the future is gate-tested the moment its route lands. Playwright runs
// from the `apps/web` package root (`pnpm --filter`), so `process.cwd()` resolves
// the app source tree in both local and CI runs. The `≥17` guard test below fails
// loudly if the derivation ever resolves an empty list (wrong cwd).
const CRON_DIR = join(process.cwd(), 'src', 'app', 'api', 'cron');
const PROTECTED_CRONS = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(CRON_DIR, entry.name, 'route.ts')))
  .map((entry) => entry.name)
  .sort();

test.describe('S10 — permanence : tous les crons protégés sont gated (runtime)', () => {
  // Guard: a broken filesystem derivation (wrong cwd -> empty list) must FAIL
  // loudly here, never silently pass with zero crons asserted.
  test('la liste des crons protégés est bien dérivée du filesystem (au moins 17, anti-liste-vide)', () => {
    expect(
      PROTECTED_CRONS.length,
      `derived only ${PROTECTED_CRONS.length} crons from ${CRON_DIR} -- derivation broken?`,
    ).toBeGreaterThanOrEqual(17);
  });

  for (const cron of PROTECTED_CRONS) {
    test(`cron/${cron} — POST sans secret rejeté (401/503), GET rejeté (405)`, async ({
      request,
    }) => {
      const noSecret = await request.post(`/api/cron/${cron}`, { failOnStatusCode: false });
      expect(
        [401, 503],
        `cron/${cron} did work or 200'd WITHOUT a secret (got ${noSecret.status()})`,
      ).toContain(noSecret.status());

      const wrongSecret = await request.post(`/api/cron/${cron}`, {
        headers: { 'x-cron-secret': 'definitely-not-the-real-secret-0000' },
        failOnStatusCode: false,
      });
      expect(
        [401, 503],
        `cron/${cron} accepted a WRONG secret (got ${wrongSecret.status()})`,
      ).toContain(wrongSecret.status());

      const getReq = await request.get(`/api/cron/${cron}`, { failOnStatusCode: false });
      expect(getReq.status(), `cron/${cron} GET should be 405`).toBe(405);
    });
  }

  test('/api/health — endpoint PUBLIC de liveness (200 sain / 503 dégradé, jamais 401)', async ({
    request,
  }) => {
    // The public liveness probe (SPEC §12.4) — readiness = env + DB SELECT 1.
    // GET is allowed and must NOT require auth (external uptime monitors).
    const res = await request.get('/api/health', { failOnStatusCode: false });
    expect([200, 503], `/api/health returned ${res.status()}`).toContain(res.status());
  });
});
