import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireProfileAdminToken } from '@/lib/auth/admin-token';
import { logAudit } from '@/lib/auth/audit';
import {
  persistGeneratedSnapshots,
  type MemberProfileMonthlyBatchPersistRequest,
} from '@/lib/member-profile-monthly/batch';
import { flushSentry, reportError, reportWarning } from '@/lib/observability';

/**
 * J-E (expansion IA §21.5) — POST `/api/admin/member-profile-batch/persist`.
 *
 * Accepts a `MemberProfileMonthlyBatchPersistRequest` JSON body produced by
 * Eliott's local script after `claude --print` generation. Carbon of
 * `/api/admin/monthly-batch/persist`: strict top-level Zod, 16 MiB body cap
 * (Content-Length cheap check + byte-length re-verify), then
 * `persistGeneratedSnapshots` (which already gates crisis routing + active-user
 * check + double-net Zod + server-re-derived evidence grounding + per-entry
 * audit).
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_PROFILE_ADMIN_TOKEN" \
 *        -H "Content-Type: application/json" \
 *        --data-binary "@results.json" \
 *        "https://app.fxmilyapp.com/api/admin/member-profile-batch/persist"
 *
 * Returns `{ persisted, skipped, errors, total }` JSON. 413 if body too large,
 * 400 invalid JSON / Zod fail, 401/429/503 via `requireProfileAdminToken`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
// cuid = 25, nanoid ≤ 32 ; 40 covers both with margin. Longer = malicious /
// schema drift (mirror monthly-batch persist).
const userIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'userId must be cuid-safe (alnum + _-)');

const profileBatchResultEntrySchema = z.union([
  z.object({
    userId: userIdSchema,
    output: z.unknown(), // strict-validated downstream in persistGeneratedSnapshots
    usage: z
      .object({
        inputTokens: z.number().int().min(0).max(2_000_000),
        outputTokens: z.number().int().min(0).max(2_000_000),
        cacheReadTokens: z.number().int().min(0).max(2_000_000).optional(),
      })
      .optional(),
    model: z.string().max(64).optional(),
  }),
  z.object({
    userId: userIdSchema,
    error: z.string().max(2000),
  }),
]);

const profileBatchPersistRequestSchema = z
  .object({
    monthStart: z.string().regex(localDatePattern, 'monthStart must be YYYY-MM-DD'),
    monthEnd: z.string().regex(localDatePattern, 'monthEnd must be YYYY-MM-DD'),
    // V1 30 members × 1 monthly = 30 ; V2 1000 × 1 = 1000. Above that is
    // malicious/corrupted ; bounds JSON.parse heap (mirror monthly-batch).
    results: z.array(profileBatchResultEntrySchema).max(1000),
  })
  .strict();

export async function POST(req: NextRequest) {
  const guard = requireProfileAdminToken(req);
  if (guard) return guard;

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch (err) {
    reportError('admin.member_profile_batch.persist', err, {
      route: '/api/admin/member-profile-batch/persist',
      stage: 'read_body',
    });
    return NextResponse.json({ error: 'body_read_failed' }, { status: 400 });
  }

  // Compare BYTE length, not UTF-16 char length (4-byte codepoints inflate wire
  // size 2-4× ; the Content-Length check above is the cheap first line).
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  if (raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'empty_body', detail: 'POST a MemberProfileMonthlyBatchPersistRequest JSON body.' },
      { status: 400 },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    reportWarning('admin.member_profile_batch.persist', 'invalid_json', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = profileBatchPersistRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'envelope_validation_failed',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          // Truncate to 100 chars — Zod 4 sometimes echoes the received value
          // into `.message` ; don't reflect attacker strings back.
          message: i.message.slice(0, 100),
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await persistGeneratedSnapshots(
      parsed.data as MemberProfileMonthlyBatchPersistRequest,
    );
    const total = parsed.data.results.length;
    return NextResponse.json({ ...result, total });
  } catch (err) {
    // Route-level audit so a mid-flight throw leaves an operational trace
    // (complements the per-entry rows from persistGeneratedSnapshots).
    await logAudit({
      action: 'member_profile_monthly.batch.persist_failed',
      metadata: {
        ranAt: new Date().toISOString(),
        monthStart: parsed.data.monthStart,
        monthEnd: parsed.data.monthEnd,
        total: parsed.data.results.length,
        stage: 'route_handler',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    reportError('admin.member_profile_batch.persist', err, {
      route: '/api/admin/member-profile-batch/persist',
      stage: 'persist',
    });
    await flushSentry();
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
