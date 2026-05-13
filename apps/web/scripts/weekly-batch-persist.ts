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

import { persistGeneratedReports, type BatchPersistRequest } from '@/lib/weekly-report/batch';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  if (raw.trim().length === 0) {
    throw new Error('Empty stdin — pass the BatchPersistRequest JSON via pipe.');
  }

  const request: BatchPersistRequest = JSON.parse(raw);
  if (typeof request.weekStart !== 'string' || !Array.isArray(request.results)) {
    throw new Error('Malformed input — expected { weekStart, weekEnd, results: [] }');
  }

  const result = await persistGeneratedReports(request);
  const total = request.results.length;

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
