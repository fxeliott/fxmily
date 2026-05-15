import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { logAudit } from '@/lib/auth/audit';
import { requireAdminToken } from '@/lib/auth/admin-token';
import { flushSentry, reportError } from '@/lib/observability';
import { persistGeneratedReports, type BatchPersistRequest } from '@/lib/weekly-report/batch';

/**
 * V1.7.2 — POST `/api/admin/weekly-batch/persist`.
 *
 * Accepts a `BatchPersistRequest` JSON body produced by Eliot's local script
 * after `claude --print` generation. Validates with the same strict Zod
 * schema as the previous standalone `weekly-batch-persist.ts` script (now
 * deleted ; replaced by this route — see `apps/web/CLAUDE.md` section
 * "V1.7.2 Migration HTTP routes ACTIVE" for the full architecture rationale).
 * Calls `persistGeneratedReports` (the canonical helper that already gates
 * crisis routing + active-user check + double-net Zod + per-entry audit).
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_ADMIN_TOKEN" \
 *        -H "Content-Type: application/json" \
 *        --data-binary "@results.json" \
 *        "https://app.fxmilyapp.com/api/admin/weekly-batch/persist"
 *
 * Returns `{ persisted, skipped, errors, total }` JSON.
 *
 * Body cap : 16 MiB (matches the previous `MAX_STDIN_BYTES` constant). At
 * 30 reports × ~3 KiB ≈ 90 KiB legitimate ; 1000 × ~3 KiB ≈ 3 MiB ; 16 MiB
 * is ~5000× the realistic max — anything larger is malicious or corrupted.
 *
 * 413 if body too large, 400 if invalid JSON / Zod validation fails, 401/429/503
 * via `requireAdminToken`. Audit rows are emitted by `persistGeneratedReports`
 * itself (per-entry + summary).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// V1.7 (carry-over from `weekly-batch-persist.ts`) : cap stdin to prevent OOM.
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
// V1.10 sec hardening (M3 security-auditor) : cap reduced 128 → 40. cuid = 25
// chars, nanoid = up to 32 chars ; 40 covers both with margin. Any longer is
// malicious or schema drift. Tightens JSON.parse heap amplification when
// combined with results.max(1000) above.
const userIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'userId must be cuid-safe (alnum + _-)');

const batchResultEntrySchema = z.union([
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

const batchPersistRequestSchema = z
  .object({
    weekStart: z.string().regex(localDatePattern, 'weekStart must be YYYY-MM-DD'),
    weekEnd: z.string().regex(localDatePattern, 'weekEnd must be YYYY-MM-DD'),
    // V1.7.2 post-merge hardening (security-auditor R2 H4) : cap reduced
    // 10_000 → 1000. V1 30 members × 1 weekly = 30 entries ; V2 1000 members
    // × 1 weekly = 1000 entries. Above that is malicious/corrupted. Bounds
    // JSON.parse heap amplification (10-20× heap vs wire = ~50MB max at
    // 1000 × 5KB) ; CX22 4GB RAM total minus postgres+caddy = OOM safe.
    // The 16 MiB MAX_BODY_BYTES is still the cheap-header first line of
    // defense ; this cap is the semantic ceiling.
    results: z.array(batchResultEntrySchema).max(1000),
  })
  .strict();

export async function POST(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  // Body length cap. We rely on Content-Length first (cheap header check),
  // then re-verify after `req.text()` because Content-Length can be missing
  // or lie about the actual payload.
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
    reportError('admin.weekly_batch.persist', err, {
      route: '/api/admin/weekly-batch/persist',
      stage: 'read_body',
    });
    return NextResponse.json({ error: 'body_read_failed' }, { status: 400 });
  }

  // V1.7.2 audit fix : compare BYTE length, not UTF-16 char length. A 4-byte
  // UTF-8 codepoint (emoji, CJK) counts 1 char in JS but inflates the actual
  // wire size 2-4×. The Content-Length cheap check above prevents most
  // attacks ; this is the defense-in-depth verification.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  if (raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'empty_body', detail: 'POST a BatchPersistRequest JSON body.' },
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

  const parsed = batchPersistRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'envelope_validation_failed',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          // V1.7.2 audit fix : truncate to 100 chars. Zod 4 sometimes echoes
          // the received value into `.message` (regex/literal mismatches).
          // A malicious body could otherwise reflect attacker-controlled
          // strings back through the 400 response.
          message: i.message.slice(0, 100),
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await persistGeneratedReports(parsed.data as BatchPersistRequest);
    const total = parsed.data.results.length;
    return NextResponse.json({ ...result, total });
  } catch (err) {
    // V1.7.2 audit fix : emit `weekly_report.batch.persist_failed` so a
    // mid-flight throw leaves an operational trace (without it, Eliot
    // sees the 500 in curl but no audit row to investigate from). This
    // complements the per-entry `persist_failed` already emitted by
    // `persistGeneratedReports` when an individual upsert throws.
    await logAudit({
      action: 'weekly_report.batch.persist_failed',
      metadata: {
        ranAt: new Date().toISOString(),
        weekStart: parsed.data.weekStart,
        weekEnd: parsed.data.weekEnd,
        total: parsed.data.results.length,
        stage: 'route_handler',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    reportError('admin.weekly_batch.persist', err, {
      route: '/api/admin/weekly-batch/persist',
      stage: 'persist',
    });
    await flushSentry();
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
