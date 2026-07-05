import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminToken } from '@/lib/auth/admin-token';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';

/**
 * Tour 14 — host autoheal watchdog heartbeat endpoint (self-healing layer).
 *
 * `/usr/local/bin/fxmily-autoheal` runs every minute on the Hetzner host,
 * restarting any `fxmily-web` / `fxmily-postgres` container whose Docker
 * HEALTHCHECK went unhealthy (with a cooldown + escalation ping). It was
 * previously MUTE — a watchdog that restarts containers all day with nobody
 * watching is exactly the blind spot the worker layer had before its own
 * watchdog. It now POSTs an hourly counts-only heartbeat here; the row this
 * route writes is what the `cron.autoheal.heartbeat` EXPECTATION monitors, so a
 * dead watchdog surfaces red on /admin/system AND /api/cron/health.
 *
 * Auth : `X-Admin-Token` (SHA-256 + timingSafeEqual via `requireAdminToken`),
 * same contract as the worker-watchdog + batch endpoints — the autoheal script
 * reuses the existing admin token, no new secret to rotate.
 *
 * Payload is COUNTS ONLY by design (§21.5 PII-free): container count + restarts
 * + escalations SINCE the previous heartbeat, plus a bounded version string —
 * never a container name beyond the fixed watched set, never a path, never a
 * token. `escalations > 0` escalates the board entry green → amber automatically
 * via `buildHeartbeatReport`'s `metadata.errors` read (mapped below).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const heartbeatSchema = z
  .object({
    /** Containers the watchdog inspected this hour (expected 2). */
    containersChecked: z.number().int().min(0).max(50),
    /** Container restarts issued since the previous heartbeat. */
    restarts: z.number().int().min(0).max(10_000),
    /** Escalations (still unhealthy after cooldown, or a failed restart) since
     *  the previous heartbeat. Drives the board green → amber. */
    escalations: z.number().int().min(0).max(10_000),
    /** Watchdog script version, for fleet drift visibility. */
    watchdogVersion: z.string().max(20).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdminToken(req);
  if (guard) return guard;

  let payload: z.infer<typeof heartbeatSchema>;
  try {
    payload = heartbeatSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    await logAudit({
      action: 'cron.autoheal.heartbeat',
      metadata: {
        containersChecked: payload.containersChecked,
        restarts: payload.restarts,
        escalations: payload.escalations,
        // `escalations` is the "self-heal tried, still broken" count — surface it
        // under the generic `errors` key so buildHeartbeatReport escalates a
        // fresh-but-escalating watchdog green → amber, same as the worker board.
        errors: payload.escalations,
        ...(payload.watchdogVersion ? { watchdogVersion: payload.watchdogVersion } : {}),
      },
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    reportError(
      'cron.autoheal.heartbeat',
      err instanceof Error ? err : new Error('autoheal_heartbeat_unknown'),
    );
    return NextResponse.json({ error: 'heartbeat_failed' }, { status: 500 });
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
