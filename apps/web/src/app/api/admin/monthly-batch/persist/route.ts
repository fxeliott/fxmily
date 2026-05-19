import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { logAudit } from '@/lib/auth/audit';
import { requireMonthlyAdminToken } from '@/lib/auth/admin-token';
import { flushSentry, reportError } from '@/lib/observability';
import {
  persistGeneratedReports,
  type MonthlyBatchPersistRequest,
} from '@/lib/monthly-debrief/batch';

/**
 * V1.4 §25 — POST `/api/admin/monthly-batch/persist`.
 *
 * Accepts a `MonthlyBatchPersistRequest` JSON body produced by Eliot's
 * local script after `claude --print` generation. Carbon of
 * `/api/admin/weekly-batch/persist` (V1.7.2) : strict top-level Zod, 16 MiB
 * body cap (Content-Length cheap check + byte-length re-verify), then
 * `persistGeneratedReports` (which already gates crisis routing +
 * active-user check + double-net Zod + per-entry audit).
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_MONTHLY_ADMIN_TOKEN" \
 *        -H "Content-Type: application/json" \
 *        --data-binary "@results.json" \
 *        "https://app.fxmilyapp.com/api/admin/monthly-batch/persist"
 *
 * Returns `{ persisted, skipped, errors, total }` JSON. 413 if body too
 * large, 400 invalid JSON / Zod fail, 401/429/503 via
 * `requireMonthlyAdminToken`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
// Mirror weekly V1.10 hardening : cuid = 25, nanoid ≤ 32 ; 40 covers both
// with margin. Any longer is malicious / schema drift.
const userIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'userId must be cuid-safe (alnum + _-)');

const monthlyBatchResultEntrySchema = z.union([
  z.object({
    userId: userIdSchema,
    output: z.unknown(), // strict-validated downstream in persistGeneratedReports
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

const monthlyBatchPersistRequestSchema = z
  .object({
    monthStart: z.string().regex(localDatePattern, 'monthStart must be YYYY-MM-DD'),
    monthEnd: z.string().regex(localDatePattern, 'monthEnd must be YYYY-MM-DD'),
    // Mirror weekly cap : V1 30 members × 1 monthly = 30 ; V2 1000 × 1 =
    // 1000. Above that is malicious/corrupted ; bounds JSON.parse heap.
    results: z.array(monthlyBatchResultEntrySchema).max(1000),
  })
  .strict();

export async function POST(req: NextRequest) {
  const guard = requireMonthlyAdminToken(req);
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
    reportError('admin.monthly_batch.persist', err, {
      route: '/api/admin/monthly-batch/persist',
      stage: 'read_body',
    });
    return NextResponse.json({ error: 'body_read_failed' }, { status: 400 });
  }

  // Compare BYTE length, not UTF-16 char length (4-byte codepoints inflate
  // wire size 2-4× ; the Content-Length check above is the cheap first line).
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  if (raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'empty_body', detail: 'POST a MonthlyBatchPersistRequest JSON body.' },
      { status: 400 },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_json',
        detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
      { status: 400 },
    );
  }

  const parsed = monthlyBatchPersistRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'envelope_validation_failed',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          // Truncate to 100 chars — Zod 4 sometimes echoes the received
          // value into `.message` ; don't reflect attacker strings back.
          message: i.message.slice(0, 100),
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await persistGeneratedReports(parsed.data as MonthlyBatchPersistRequest);
    const total = parsed.data.results.length;
    return NextResponse.json({ ...result, total });
  } catch (err) {
    // Emit a route-level audit row so a mid-flight throw leaves an
    // operational trace (complements the per-entry rows from
    // persistGeneratedReports). Mirror weekly persist route.
    await logAudit({
      action: 'monthly_debrief.batch.persist_failed',
      metadata: {
        ranAt: new Date().toISOString(),
        monthStart: parsed.data.monthStart,
        monthEnd: parsed.data.monthEnd,
        total: parsed.data.results.length,
        stage: 'route_handler',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    reportError('admin.monthly_batch.persist', err, {
      route: '/api/admin/monthly-batch/persist',
      stage: 'persist',
    });
    await flushSentry();
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
