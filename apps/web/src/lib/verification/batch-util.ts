import 'server-only';

/**
 * Verification scans (reconcile / rituals / meeting no-shows / tracking skips /
 * alerts / gentle reminders / constancy recompute) each iterate EVERY active
 * member. Running them strictly sequentially makes the daily cron's wall-clock
 * O(members) — fine at a handful of members, a scaling wall at hundreds.
 *
 * `mapMembersChunked` runs the per-member work in bounded-concurrency chunks,
 * mirroring the proven `lib/weekly-report/batch.ts` snapshot batcher. The
 * concurrency cap (5) stays well under the db.ts pool max (10): each member's
 * work is a short chain of awaits, so an in-flight chunk holds ≤5 pool
 * connections. Every member's writes are row-disjoint (scoped to that member,
 * guarded by the per-member partial unique indexes), so the parallelism is
 * contention-free — it changes throughput, never the result.
 */
export const VERIFICATION_SCAN_CONCURRENCY = 5;

/**
 * Map `items` through `fn` in chunks of `concurrency`, returning the SETTLED
 * result of each item IN INPUT ORDER. Callers zip the results back to `items`
 * and keep their own success/error tallying — byte-identical to the sequential
 * `for…of` + try/catch they replace, only parallelised within a chunk. Never
 * rejects: a thrown `fn` surfaces as a `rejected` entry for that item, so a
 * single member's failure can never abort the whole scan.
 */
export async function mapMembersChunked<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = VERIFICATION_SCAN_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map((item) => fn(item)));
    out.push(...settled);
  }
  return out;
}
