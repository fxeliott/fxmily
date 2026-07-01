import { NextResponse, type NextRequest } from 'next/server';

import { requireProfileAdminToken } from '@/lib/auth/admin-token';
import { env } from '@/lib/env';
import { loadAllReprofileSnapshots } from '@/lib/member-profile-monthly/batch';
import { flushSentry, reportError } from '@/lib/observability';

/**
 * J-E (expansion IA §21.5) — POST `/api/admin/member-profile-batch/pull`.
 *
 * Returns a `MemberProfileMonthlyBatchPullEnvelope` JSON describing every active
 * member's pseudonymized civil-month re-profiling snapshot. `curl`'d from
 * Eliott's local machine by `ops/scripts/member-profile-monthly-local.sh`:
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_PROFILE_ADMIN_TOKEN" \
 *        "https://app.fxmilyapp.com/api/admin/member-profile-batch/pull"
 *
 * Carbon of `/api/admin/monthly-batch/pull` — same auth surface, same Node.js
 * runtime + force-dynamic, same MEMBER_LABEL_SALT prod guard (snapshots leave
 * the host → reach Eliott's laptop → Anthropic). Separate token
 * (`PROFILE_ADMIN_BATCH_TOKEN`) for independent rotation.
 *
 * Query params:
 *   ?currentMonth=true  pulls the in-progress civil month instead of the
 *                       just-ended one (default = the just-ended month, the
 *                       canonical "1st of the month" cadence).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = requireProfileAdminToken(req);
  if (guard) return guard;

  // The batch is an "external export" path (snapshots leave the host, reach
  // Eliott's laptop, then Anthropic). MEMBER_LABEL_SALT must be configured in
  // production before exposing pseudonymized snapshots externally (mirror the
  // monthly/weekly pull routes).
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
    const envelope = await loadAllReprofileSnapshots({ currentMonth });
    return NextResponse.json(envelope);
  } catch (err) {
    reportError('admin.member_profile_batch.pull', err, {
      route: '/api/admin/member-profile-batch/pull',
      currentMonth,
    });
    await flushSentry();
    return NextResponse.json({ error: 'pull_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: defense in depth (mirrors cron + other batch pull routes).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
