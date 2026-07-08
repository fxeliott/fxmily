import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireCalendarAdminToken } from '@/lib/auth/admin-token';
import { parseLocalDate } from '@/lib/checkin/timezone';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { loadAllSnapshotsForCalendarGeneration } from '@/lib/calendar/batch';
import { currentParisWeekStart } from '@/lib/calendar/week';

/**
 * §26 — POST `/api/admin/calendar-batch/pull` (J-C2).
 *
 * Returns a `CalendarBatchPullEnvelope` JSON describing every eligible member's
 * pseudonymized weekly snapshot (members who filled the questionnaire this week
 * and don't already have a generated calendar). Designed to be `curl`'d from
 * Eliott's local machine by `ops/scripts/calendar-batch-local.sh` :
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_CALENDAR_TOKEN" \
 *        "https://app.fxmilyapp.com/api/admin/calendar-batch/pull"
 *
 * Carbon of the weekly/monthly pull routes. Auth + rate-limit delegated to
 * `requireCalendarAdminToken` (separate token from weekly/monthly — rotation
 * independent). POST-only (mirrors the cron + batch pattern: defense-in-depth,
 * URL never leaks via referer, body not echoed in Caddy access.log).
 *
 * Idempotency : `loadAllSnapshotsForCalendarGeneration` is a pure read — repeat
 * calls in the same week return the same envelope (modulo a single
 * `calendar.batch.pulled` audit row per call, desired for abuse detection). The
 * candidate filter is MISSING-or-STALE (DoD#1) : a member stops appearing once
 * their calendar exists AND is up to date, and re-appears when the
 * questionnaire is re-submitted after generation (updatedAt > generatedAt) so
 * a correction regenerates the plan.
 *
 * Catch-up : an OPTIONAL JSON body `{ "weekStart": "YYYY-MM-DD" }` pulls an
 * explicit week (e.g. regenerate a missed week after a worker outage). It must
 * be a Monday within [-28 d, +7 d] of the current Paris week — anything else
 * is a 400, so a typo can never fan a Claude batch out over garbage. No body
 * (the normal scheduled tick) targets the current Paris week.
 */

const pullBodySchema = z
  .object({
    weekStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
      .optional(),
  })
  .strict();

// Reads env + DB → must run on Node.js, never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = requireCalendarAdminToken(req);
  if (guard) return guard;

  // The batch is an "external export" path (pseudonymized snapshots leave the
  // host → Eliott's laptop → Anthropic). `lib/env.ts` JSDoc says
  // MEMBER_LABEL_SALT is "REQUIS en prod si export externe envisagé" — refuse
  // in production NODE_ENV if the salt is unset, else unsalted pseudonyms leak.
  // Dev/test exempt (V1 single-user dev with seed cuids). Carbon weekly pull.
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

  // Optional catch-up body. An unreadable/empty body is the NORMAL scheduled
  // tick (curl POSTs with no body) — never an error. A PRESENT body must parse
  // strictly: rejecting loudly beats silently pulling the wrong week.
  let weekStart: string | undefined;
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    rawBody = undefined;
  }
  if (rawBody !== undefined && rawBody !== null) {
    const parsed = pullBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', detail: 'expected optional { weekStart: "YYYY-MM-DD" }' },
        { status: 400 },
      );
    }
    if (parsed.data.weekStart) {
      const target = parseLocalDate(parsed.data.weekStart);
      if (target.getUTCDay() !== 1) {
        return NextResponse.json(
          { error: 'invalid_week_start', detail: 'weekStart must be a Monday' },
          { status: 400 },
        );
      }
      const current = parseLocalDate(currentParisWeekStart());
      const diffDays = (target.getTime() - current.getTime()) / 86_400_000;
      if (diffDays < -28 || diffDays > 7) {
        return NextResponse.json(
          {
            error: 'invalid_week_start',
            detail: 'weekStart must be within -28d..+7d of the current week',
          },
          { status: 400 },
        );
      }
      weekStart = parsed.data.weekStart;
    }
  }

  try {
    const envelope = await loadAllSnapshotsForCalendarGeneration(
      weekStart === undefined ? {} : { weekStart },
    );
    return NextResponse.json(envelope);
  } catch (err) {
    reportError('admin.calendar_batch.pull', err, {
      route: '/api/admin/calendar-batch/pull',
    });
    await flushSentry();
    return NextResponse.json({ error: 'pull_failed' }, { status: 500 });
  }
}

export function GET() {
  // POST-only: defense in depth (mirrors cron + weekly/monthly batch pattern).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
