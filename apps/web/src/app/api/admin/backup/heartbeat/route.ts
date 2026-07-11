import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminToken } from '@/lib/auth/admin-token';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';

/**
 * Nightly Postgres backup heartbeat endpoint (last mile of the backup chain).
 *
 * `/usr/local/bin/fxmily-backup` runs at 02:30 Paris on the Hetzner host (crond reads local time)
 * (pg_dump → gzip → GPG → R2 offsite upload → 7-day rotation). Until now its
 * only success signal was an external Healthchecks ping — invisible on
 * /admin/system. A backup pipeline that dies silently is the one failure mode
 * backups cannot tolerate: you only discover it the day you need the restore.
 * The script now POSTs a counts-only heartbeat here AFTER the offsite upload
 * and rotation; the row this route writes is what the `cron.backup.heartbeat`
 * EXPECTATION monitors, so a dead backup surfaces red on /admin/system AND
 * /api/cron/health within 48h.
 *
 * Auth : `X-Admin-Token` (SHA-256 + timingSafeEqual via `requireAdminToken`),
 * same contract as the autoheal + worker-watchdog heartbeats — the backup
 * script reuses the existing admin token, no new secret to rotate.
 *
 * Payload is COUNTS ONLY by design (§21.5 PII-free): dump size + duration +
 * offsite flag + bounded version string — never a filename, never a bucket
 * name, never a token. `offsiteUploaded: false` (local dump OK but R2 upload
 * skipped) maps to `errors: 1` so the board escalates green → amber via
 * `buildHeartbeatReport`'s `metadata.errors` read: the data is safe on disk
 * but NOT disaster-proof, which deserves attention without paging red.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const heartbeatSchema = z
  .object({
    /** Compressed encrypted dump size in bytes (sanity floor is host-side). */
    dumpBytes: z.number().int().min(0).max(1_000_000_000_000),
    /** Wall-clock duration of the whole backup run, in seconds. */
    durationSecs: z.number().int().min(0).max(86_400),
    /** Whether the R2 offsite upload succeeded. False escalates the board
     *  green → amber: local-only backups are not disaster-proof. */
    offsiteUploaded: z.boolean(),
    /** Backup script version, for fleet drift visibility. */
    scriptVersion: z.string().max(20).optional(),
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
      action: 'cron.backup.heartbeat',
      metadata: {
        dumpBytes: payload.dumpBytes,
        durationSecs: payload.durationSecs,
        offsiteUploaded: payload.offsiteUploaded,
        // A local dump that never reached R2 is a degraded backup — surface it
        // under the generic `errors` key so buildHeartbeatReport escalates the
        // fresh-but-local-only run green → amber, same as the autoheal board.
        errors: payload.offsiteUploaded ? 0 : 1,
        ...(payload.scriptVersion ? { scriptVersion: payload.scriptVersion } : {}),
      },
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    reportError(
      'cron.backup.heartbeat',
      err instanceof Error ? err : new Error('backup_heartbeat_unknown'),
    );
    return NextResponse.json({ error: 'heartbeat_failed' }, { status: 500 });
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
