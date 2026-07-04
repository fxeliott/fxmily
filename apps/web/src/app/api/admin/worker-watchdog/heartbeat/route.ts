import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminToken } from '@/lib/auth/admin-token';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';

/**
 * Tour 12 — worker watchdog heartbeat endpoint (self-healing layer).
 *
 * `ops/worker/watchdog.ps1` runs every 30 min on the host machine, verifies
 * the 6 Fxmily-worker-* scheduled tasks (present, enabled, not stuck on a
 * repeated failure code), repairs what it can (re-register via
 * install-worker.ps1 -LogonType Interactive), then POSTs its verdict here.
 * The row this route writes is what `WORKER_EXPECTATIONS` monitors — a
 * silent watchdog surfaces on /admin/system exactly like a silent cron.
 *
 * Auth : `X-Admin-Token` (SHA-256 + timingSafeEqual via `requireAdminToken`),
 * same contract as the batch pull/persist endpoints — the watchdog reuses
 * the worker's existing token, no new secret to rotate.
 *
 * Payload is COUNTS ONLY by design (§21.5 PII-free): task names checked and
 * error labels are bounded enums/strings, never a token value, never a local
 * username or path. `errors > 0` escalates the board entry green → amber
 * automatically via `buildHeartbeatReport`'s metadata.errors read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const heartbeatSchema = z
  .object({
    /** Tasks the watchdog inspected this tick (expected 6). */
    tasksChecked: z.number().int().min(0).max(50),
    /** Tasks found healthy (registered, enabled, sane last result). */
    tasksOk: z.number().int().min(0).max(50),
    /** Tasks re-registered/re-enabled by this tick. */
    repaired: z.number().int().min(0).max(50),
    /** Problems the watchdog could NOT fix (drives green → amber). */
    errors: z.number().int().min(0).max(50),
    /** Bounded machine-readable labels ("task_missing:calendar", ...). */
    errorLabels: z.array(z.string().max(120)).max(20).optional(),
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
      action: 'worker.watchdog.heartbeat',
      metadata: {
        tasksChecked: payload.tasksChecked,
        tasksOk: payload.tasksOk,
        repaired: payload.repaired,
        errors: payload.errors,
        ...(payload.errorLabels?.length ? { errorLabels: payload.errorLabels } : {}),
        ...(payload.watchdogVersion ? { watchdogVersion: payload.watchdogVersion } : {}),
      },
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    reportError(
      'worker.watchdog.heartbeat',
      err instanceof Error ? err : new Error('watchdog_heartbeat_unknown'),
    );
    return NextResponse.json({ error: 'heartbeat_failed' }, { status: 500 });
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
