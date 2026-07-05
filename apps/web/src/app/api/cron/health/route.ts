import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { getCronHealthReport, getDiskHealth } from '@/lib/system/health';

/**
 * J10 Phase J — Read-only cron health check endpoint.
 *
 * Returns 200 with the full `CronHealthReport` JSON when ALL crons are
 * either `green` or `amber`. Returns 503 when at least one cron is `red`
 * or `never_ran` so an external monitor (GitHub Actions `cron-watch.yml`,
 * UptimeRobot, etc.) can branch on the HTTP status code without parsing
 * JSON.
 *
 * Auth : same `X-Cron-Secret` SHA-256 timingSafeEqual contract as the
 * other crons. Rate-limited per IP via the shared `cronLimiter`. POST-only
 * so the URL never leaks via referer.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'cron_disabled', detail: 'CRON_SECRET not configured.' },
      { status: 503 },
    );
  }

  const id = callerIdTrusted(req);
  const decision = cronLimiter.consume(id);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  const provided = req.headers.get('x-cron-secret');
  if (!provided || !constantTimeEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = await getCronHealthReport();
    // Tour 13 — the shared prod volume filling up is a total silent failure
    // (Postgres stops, backups fail). Fold the instant disk probe into the
    // watcher response so `cron-watch.yml` opens an issue on a `red` disk just
    // like a stale cron. `unknown` (probe unavailable) is neutral — it must NOT
    // flip the endpoint to 503 (no reading is not an incident).
    const disk = getDiskHealth();
    const cronHealthy = report.overall === 'green' || report.overall === 'amber';
    const healthy = cronHealthy && disk.status !== 'red';
    // Heartbeat audit row : the watcher itself emits a `cron.health.scan`
    // so a missing health-check (e.g. cron-watch.yml broken) is also
    // detectable. Counts only — no PII.
    await logAudit({
      action: 'cron.health.scan',
      metadata: {
        overall: report.overall,
        red: report.entries.filter((e) => e.status === 'red').length,
        amber: report.entries.filter((e) => e.status === 'amber').length,
        neverRan: report.entries.filter((e) => e.status === 'never_ran').length,
        pending: report.entries.filter((e) => e.status === 'pending').length,
        diskStatus: disk.status,
        diskFreeBytes: disk.freeBytes,
        ranAt: report.ranAt,
      },
    });
    return NextResponse.json({ ...report, disk }, { status: healthy ? 200 : 503 });
  } catch (err) {
    reportError('cron.health', err, { route: '/api/cron/health' });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'health_check_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
