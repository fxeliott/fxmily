/**
 * V1.7 weekly batch — persist locally-generated reports (Hetzner-side).
 *
 * Invoked by `ops/scripts/weekly-batch-local.sh` over SSH :
 *   cat results.json | docker compose exec -T web pnpm tsx scripts/weekly-batch-persist.ts
 *
 * Reads a `BatchPersistRequest` JSON from stdin, validates each entry against
 * the strict `weeklyReportOutputSchema`, and upserts into `weekly_reports`.
 *
 * Idempotent on `(userId, weekStart)` — re-running the same batch updates the
 * existing rows rather than stacking duplicates.
 *
 * Returns counts on stdout as JSON :
 *   { "persisted": N, "skipped": M, "errors": K, "total": T }
 *
 * Exit code :
 *   0 if persisted > 0 OR (persisted === 0 AND total === 0)
 *   2 if every entry was skipped/errored (fail-loud for the local script)
 */

import { z } from 'zod';

import { persistGeneratedReports, type BatchPersistRequest } from '@/lib/weekly-report/batch';

// V1.7 fix (security-auditor Round 16 BLOCKER 3) : cap stdin to prevent OOM.
// 30 reports × ~3 KiB ≈ 90 KiB ; 1000 reports × ~3 KiB ≈ 3 MiB. 16 MiB is
// ~5000× the realistic max — anything larger is malicious or corrupted.
const MAX_STDIN_BYTES = 16 * 1024 * 1024;

/**
 * V1.7 fix (code-reviewer Round 16 BLOQUANT 1 + security-auditor BLOCKER 2) :
 * top-level Zod validation of the BatchPersistRequest envelope. Before this,
 * a malformed envelope crashed `persistGeneratedReports` partway through
 * (parseLocalDate throw) with no audit row written. Now we reject early
 * with a structured exit-2 error message.
 *
 * Schema mirrors the runtime contract in `lib/weekly-report/batch.ts` :
 *   - weekStart / weekEnd : YYYY-MM-DD strings
 *   - results : array of either { userId, output, usage?, model? } OR
 *                                { userId, error }
 *
 * Note : `output` content validation is delegated to the strict zod schema
 * inside `persistGeneratedReports` (`weeklyReportOutputSchema.safeParse`)
 * because that's the canonical schema (kept in sync with the DB columns).
 */
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const userIdSchema = z
  .string()
  .min(1)
  .max(128)
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
    results: z.array(batchResultEntrySchema).max(10_000),
  })
  .strict();

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'stdin is a TTY — pipe the BatchPersistRequest JSON instead (e.g. cat results.json | ...).',
    );
  }
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error(`stdin payload exceeds ${MAX_STDIN_BYTES} bytes — aborting. Suspected DoS.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  if (raw.trim().length === 0) {
    throw new Error('Empty stdin — pass the BatchPersistRequest JSON via pipe.');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON on stdin: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  const parsed = batchPersistRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    process.stderr.write(
      '[weekly-batch-persist] Envelope validation failed (BatchPersistRequest):\n',
    );
    for (const issue of parsed.error.issues.slice(0, 10)) {
      process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
    }
    process.exit(2);
  }

  // The envelope-level Zod schema treats `output` as `unknown` because the
  // canonical WeeklyReportOutput shape is enforced inside
  // `persistGeneratedReports` via `weeklyReportOutputSchema.safeParse`.
  // The cast is sound : every entry has the union shape, only `output`'s
  // inner content is delegated.
  const result = await persistGeneratedReports(parsed.data as BatchPersistRequest);
  const total = parsed.data.results.length;

  process.stdout.write(JSON.stringify({ ...result, total }, null, 2));
  process.stdout.write('\n');

  if (total > 0 && result.persisted === 0) {
    process.stderr.write('[weekly-batch-persist] WARNING: 0 reports persisted — investigate.\n');
    process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(
    `[weekly-batch-persist] FAILED: ${err instanceof Error ? err.message : err}\n`,
  );
  process.exit(1);
});
