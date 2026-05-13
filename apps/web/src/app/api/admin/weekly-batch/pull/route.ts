import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminToken } from '@/lib/auth/admin-token';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { loadAllSnapshotsForActiveMembers } from '@/lib/weekly-report/batch';

/**
 * V1.7.2 — POST `/api/admin/weekly-batch/pull`.
 *
 * Returns a `BatchPullEnvelope` JSON describing every active member's
 * pseudonymized weekly snapshot. Designed to be `curl`'d from Eliot's local
 * machine by `ops/scripts/weekly-batch-local.sh` :
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_ADMIN_TOKEN" \
 *        "https://app.fxmilyapp.com/api/admin/weekly-batch/pull?currentWeek=true"
 *
 * Replaces the previous SSH + `docker compose exec` + `pnpm tsx scripts/weekly-batch-pull.ts`
 * orchestration which was non-functional in prod (the runtime container does
 * not ship with `pnpm` or `tsx` — Next.js standalone build excludes devDeps).
 * See `apps/web/CLAUDE.md` section "V1.7 batch script BROKEN" for the audit.
 *
 * Why POST (not GET) :
 *   - Mirrors the existing 9 cron routes (defense-in-depth — POST URL never
 *     leaks via referer chain even though this is a script-only endpoint).
 *   - Caddy reverse-proxy log rotation (POST bodies are not echoed in
 *     `caddy access.log` even when verbose, GETs are).
 *
 * Auth + rate-limit are delegated to `requireAdminToken` (see lib/auth/admin-token.ts).
 *
 * Idempotency : the underlying `loadAllSnapshotsForActiveMembers` is a pure
 * read — multiple calls in the same week return the same envelope (modulo a
 * single audit row `weekly_report.batch.pulled` per call, which is desired
 * behavior to spot abuse / re-runs).
 *
 * Query params :
 *   ?currentWeek=true  pulls the in-progress week instead of the previous
 *                      full week (default = previous full week, the canonical
 *                      Sunday cadence).
 */

// Reads env + DB → must run on Node.js, never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  // V1.7.2 audit fix : the batch is the canonical "external export" path
  // (snapshots leave the host and reach Eliot's laptop, then Anthropic).
  // `lib/env.ts` JSDoc says MEMBER_LABEL_SALT is "REQUIS en prod si export
  // externe envisagé" — refuse here in production NODE_ENV if the salt is
  // not configured, otherwise unsalted pseudonyms would leak. Dev/test
  // environments are exempt (V1 single-user dev with seed cuids).
  if (env.NODE_ENV === 'production' && !env.MEMBER_LABEL_SALT) {
    return NextResponse.json(
      {
        error: 'member_label_salt_missing',
        detail:
          'MEMBER_LABEL_SALT must be configured in production before exposing pseudonymized snapshots externally.',
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const currentWeek = url.searchParams.get('currentWeek') === 'true';

  try {
    const envelope = await loadAllSnapshotsForActiveMembers({
      previousFullWeek: !currentWeek,
    });
    return NextResponse.json(envelope);
  } catch (err) {
    reportError('admin.weekly_batch.pull', err, {
      route: '/api/admin/weekly-batch/pull',
      currentWeek,
    });
    await flushSentry();
    return NextResponse.json({ error: 'pull_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: defense in depth (mirrors cron pattern).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
