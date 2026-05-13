/**
 * V1.7 weekly batch — pull snapshots from Postgres (Hetzner-side).
 *
 * Invoked by `ops/scripts/weekly-batch-local.sh` over SSH :
 *   docker compose exec -T web pnpm tsx scripts/weekly-batch-pull.ts
 *     [--current-week]   # default: previous full week
 *     [--out=path]       # default: stdout
 *
 * Prints a JSON envelope conforming to `BatchPullEnvelope`. Designed to be
 * piped to a local file then fed entry-by-entry into `claude --print`.
 *
 * Why this script exists separately from a Next.js route :
 *   - SSH + `docker compose exec` auth is stronger than HTTP cookie auth
 *     for the batch use case (we already have an SSH key, no new admin
 *     auth surface to maintain).
 *   - Streams JSON to stdout, no HTTP buffering / proxy headaches.
 *   - Reuses the exact same business logic (`loadAllSnapshotsForActiveMembers`)
 *     as the V1 cron mock path — single source of truth.
 *
 * Read posture Mark Douglas : the system prompt + JSON schema travel with
 * the envelope so the local script CANNOT swap them out without committing
 * a change to this repo. Defense against on-device tampering.
 */

import { loadAllSnapshotsForActiveMembers } from '@/lib/weekly-report/batch';

async function main() {
  const args = process.argv.slice(2);
  const currentWeek = args.includes('--current-week');
  const outArg = args.find((a) => a.startsWith('--out='));
  const outPath = outArg ? outArg.slice('--out='.length) : null;

  const envelope = await loadAllSnapshotsForActiveMembers({
    previousFullWeek: !currentWeek,
  });

  const json = JSON.stringify(envelope, null, 2);

  if (outPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outPath, json, 'utf8');
    process.stderr.write(
      `Wrote ${envelope.entries.length} snapshots to ${outPath} (week ${envelope.weekStart})\n`,
    );
  } else {
    process.stdout.write(json);
    process.stdout.write('\n');
  }
}

main().catch((err) => {
  process.stderr.write(`[weekly-batch-pull] FAILED: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
