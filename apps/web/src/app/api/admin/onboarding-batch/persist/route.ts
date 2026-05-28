import { NextResponse } from 'next/server';

import { requireAdminToken } from '@/lib/auth/admin-token';
import {
  persistGeneratedProfiles,
  type BatchPersistRequest,
  type BatchResultEntry,
} from '@/lib/onboarding-interview/batch';
import { reportError, reportWarning } from '@/lib/observability';
import { batchPersistRequestSchema } from '@/lib/schemas/onboarding-interview';

/**
 * V2.4 Phase A.2 — Onboarding interview batch persist endpoint (Session β,
 * M3 directive 2026-05-28).
 *
 * Pattern carbone V1.7.2 `app/api/admin/weekly-batch/persist/route.ts`.
 *
 * Authentication : `X-Admin-Token` header (same as `/pull` route).
 *
 * Rate limit : `adminBatchLimiter` (shared with pull — burst 10, refill 1/5min).
 *
 * Body : `BatchPersistRequest` JSON validated via `batchPersistRequestSchema`
 * (Zod strict) — discriminated union per result (output|error). Hard cap
 * `MAX_BODY_BYTES = 16 MiB` (per Content-Length + Buffer.byteLength UTF-8
 * double check, V1.7.2 H4 fix).
 *
 * Validation : 4 layers fail-fast before passing to `persistGeneratedProfiles` :
 *   1. Admin token (rate-limit + auth)
 *   2. Body size cap (Content-Length + actual UTF-8 byte length)
 *   3. JSON parse (defensive try/catch)
 *   4. Zod `batchPersistRequestSchema.safeParse` (10 issues max truncated 100 chars
 *      — anti reflect attacker-controlled bodies in error response)
 *
 * After validation, `persistGeneratedProfiles` runs the 6 fail-fast gates
 * (active user / interview owner / Zod re-parse / crisis / safety / upsert)
 * and returns `{persisted, skipped, errors}` for the client.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Maximum body bytes — V1.7.2 H4 fix anti-DoS amplification. 16 MiB covers
 * worst-case 1000 entries × ~3 KB each with generous margin. At V1 30
 * members ~100 KB typical.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  // Layer 1 — Admin token gate (SHA-256 + timingSafeEqual + rate-limit).
  const guard = await requireAdminToken(req);
  if (guard) return guard;

  // Layer 2 — Body size cap (Content-Length pre-check + Buffer.byteLength
  // post-read defense-in-depth, V1.7.2 H4 fix).
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          error: 'payload_too_large',
          message: `Body declares ${declared} bytes, max ${MAX_BODY_BYTES}.`,
        },
        { status: 413 },
      );
    }
  }

  // Layer 3 — Read body + post-read size check + JSON parse.
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch (err) {
    reportWarning('onboarding-interview.batch.persist', 'body_read_failed', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json(
      { error: 'body_read_failed', message: 'Could not read request body.' },
      { status: 400 },
    );
  }

  // Post-read byte length defense (Content-Length can be omitted / spoofed).
  const actualBytes = Buffer.byteLength(bodyText, 'utf8');
  if (actualBytes > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        error: 'payload_too_large',
        message: `Body is ${actualBytes} bytes, max ${MAX_BODY_BYTES}.`,
      },
      { status: 413 },
    );
  }

  if (bodyText.length === 0) {
    return NextResponse.json(
      { error: 'empty_body', message: 'Request body is empty.' },
      { status: 400 },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: err instanceof Error ? err.message.slice(0, 200) : 'Could not parse JSON.',
      },
      { status: 400 },
    );
  }

  // Layer 4 — Zod strict validation (10 issues max truncated 100 chars
  // anti-reflect-attacker-payload, V1.7.2 audit fix).
  const parsed = batchPersistRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join('.').slice(0, 100),
      code: issue.code,
      message: issue.message.slice(0, 100),
    }));
    return NextResponse.json(
      {
        error: 'validation_failed',
        issuesCount: parsed.error.issues.length,
        issues,
      },
      { status: 400 },
    );
  }

  // Layer 5 — Persist via the service (6 internal fail-fast gates).
  // Convert Zod-validated input to BatchResultEntry shape (TypeScript union
  // narrowed via `'error' in entry` in the loop). The shapes are byte-
  // identical (no `kind` discriminator on wire, see schema rationale).
  const request: BatchPersistRequest = {
    results: parsed.data.results as readonly BatchResultEntry[],
  };

  try {
    const result = await persistGeneratedProfiles(request);
    return NextResponse.json(
      {
        ok: true,
        ...result,
        total: parsed.data.results.length,
      },
      { status: 200 },
    );
  } catch (err) {
    // `persistGeneratedProfiles` is designed to NOT throw on single bad
    // entries — it counts and moves on. A throw here means a deeper failure
    // (DB connection lost, etc.) — Sentry + 500.
    reportError(
      'onboarding-interview.batch.persist',
      err instanceof Error ? err : new Error('batch_persist_unknown'),
    );
    return NextResponse.json(
      {
        error: 'batch_persist_failed',
        message: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
      },
      { status: 500 },
    );
  }
}

/** GET → 405. Only POST allowed. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
