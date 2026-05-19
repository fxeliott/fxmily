import { NextResponse, type NextRequest } from 'next/server';

import { requireMonthlyAdminToken } from '@/lib/auth/admin-token';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { loadAllSnapshotsForActiveMembers } from '@/lib/monthly-debrief/batch';

/**
 * V1.4 §25 — POST `/api/admin/monthly-batch/pull`.
 *
 * Returns a `MonthlyBatchPullEnvelope` JSON describing every active member's
 * pseudonymized civil-month snapshot. `curl`'d from Eliot's local machine by
 * `ops/scripts/monthly-batch-local.sh` :
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_MONTHLY_ADMIN_TOKEN" \
 *        "https://app.fxmilyapp.com/api/admin/monthly-batch/pull"
 *
 * Carbon of `/api/admin/weekly-batch/pull` (V1.7.2) — same auth surface,
 * same Node.js runtime + force-dynamic, same MEMBER_LABEL_SALT prod guard
 * (snapshots leave the host → reach Eliot's laptop → Anthropic). Separate
 * token (`MONTHLY_ADMIN_BATCH_TOKEN`) for independent rotation (SPEC §25.2).
 *
 * Query params :
 *   ?currentMonth=true  pulls the in-progress civil month instead of the
 *                       just-ended one (default = the just-ended month, the
 *                       canonical "1st of the month" cadence).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = requireMonthlyAdminToken(req);
  if (guard) return guard;

  // The batch is the canonical "external export" path (snapshots leave the
  // host and reach Eliot's laptop, then Anthropic). MEMBER_LABEL_SALT must
  // be configured in production before exposing pseudonymized snapshots
  // externally (mirror weekly pull route).
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
  const currentMonth = url.searchParams.get('currentMonth') === 'true';

  try {
    const envelope = await loadAllSnapshotsForActiveMembers({ currentMonth });
    return NextResponse.json(envelope);
  } catch (err) {
    reportError('admin.monthly_batch.pull', err, {
      route: '/api/admin/monthly-batch/pull',
      currentMonth,
    });
    await flushSentry();
    return NextResponse.json({ error: 'pull_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: defense in depth (mirrors cron + weekly-batch pattern).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
