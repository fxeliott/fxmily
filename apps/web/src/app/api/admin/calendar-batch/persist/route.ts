import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { logAudit } from '@/lib/auth/audit';
import { requireCalendarAdminToken } from '@/lib/auth/admin-token';
import { flushSentry, reportError } from '@/lib/observability';
import { persistGeneratedCalendars, type CalendarBatchPersistRequest } from '@/lib/calendar/batch';

/**
 * §26 — POST `/api/admin/calendar-batch/persist` (J-C2).
 *
 * Accepts a `CalendarBatchPersistRequest` JSON body produced by Eliott's local
 * script after `claude --print` generation. Re-validates with a strict Zod
 * schema, then calls `persistGeneratedCalendars` (the canonical helper that
 * gates active-user + questionnaire-exists + double-net Zod + crisis routing +
 * §2 AMF posture before the upsert).
 *
 *   curl --fail-with-body --silent -X POST \
 *        -H "X-Admin-Token: $FXMILY_CALENDAR_TOKEN" \
 *        -H "Content-Type: application/json" \
 *        --data-binary "@results.json" \
 *        "https://app.fxmilyapp.com/api/admin/calendar-batch/persist"
 *
 * Returns `{ persisted, skipped, errors, total }` JSON.
 *
 * Body cap : 16 MiB (carbon weekly/monthly). At 30 calendars × ~4 KiB ≈ 120 KiB
 * legitimate ; 1000 × ~4 KiB ≈ 4 MiB ; 16 MiB is ~4000× the realistic max.
 *
 * 413 if body too large, 400 if invalid JSON / Zod fail, 401/429/503 via
 * `requireCalendarAdminToken`. Audit rows emitted by `persistGeneratedCalendars`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap body to prevent OOM (carbon weekly/monthly MAX_BODY_BYTES).
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
// cuid = 25 chars, nanoid = up to 32 ; 40 covers both with margin (mirror
// weekly M3 security-auditor tightening). Any longer is malicious / drift.
const userIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'userId must be cuid-safe (alnum + _-)');

const calendarBatchResultEntrySchema = z.union([
  z.object({
    userId: userIdSchema,
    output: z.unknown(), // strict-validated downstream in persistGeneratedCalendars
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

const calendarBatchPersistRequestSchema = z
  .object({
    weekStart: z.string().regex(localDatePattern, 'weekStart must be YYYY-MM-DD'),
    // V1 30 members × 1 weekly = 30 entries ; V2 1000 × 1 = 1000. Above that is
    // malicious/corrupted. Bounds JSON.parse heap amplification (carbon weekly H4).
    results: z.array(calendarBatchResultEntrySchema).max(1000),
  })
  .strict();

export async function POST(req: NextRequest) {
  const guard = requireCalendarAdminToken(req);
  if (guard) return guard;

  // Body length cap — cheap Content-Length header check first.
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
    reportError('admin.calendar_batch.persist', err, {
      route: '/api/admin/calendar-batch/persist',
      stage: 'read_body',
    });
    return NextResponse.json({ error: 'body_read_failed' }, { status: 400 });
  }

  // Compare BYTE length, not UTF-16 char length (4-byte codepoints inflate the
  // wire size 2-4× vs JS char count). Defense-in-depth after the header check.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', limit: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  if (raw.trim().length === 0) {
    return NextResponse.json(
      { error: 'empty_body', detail: 'POST a CalendarBatchPersistRequest JSON body.' },
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

  const parsed = calendarBatchPersistRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'envelope_validation_failed',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          // Truncate to 100 chars — Zod 4 can echo the received value into
          // `.message`, which would reflect attacker-controlled strings back.
          message: i.message.slice(0, 100),
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await persistGeneratedCalendars(parsed.data as CalendarBatchPersistRequest);
    const total = parsed.data.results.length;
    return NextResponse.json({ ...result, total });
  } catch (err) {
    // Emit `calendar.batch.persist_failed` so a mid-flight throw leaves an
    // operational trace (complements the per-entry audit inside the helper).
    await logAudit({
      action: 'calendar.batch.persist_failed',
      metadata: {
        ranAt: new Date().toISOString(),
        weekStart: parsed.data.weekStart,
        total: parsed.data.results.length,
        stage: 'route_handler',
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    reportError('admin.calendar_batch.persist', err, {
      route: '/api/admin/calendar-batch/persist',
      stage: 'persist',
    });
    await flushSentry();
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
