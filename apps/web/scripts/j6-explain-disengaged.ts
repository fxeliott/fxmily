/**
 * Runtime EXPLAIN proof for the J6 "disengaged members" triage list + counter
 * (scope 2 — `listDisengagedMembers` / `disengagedMembersWhere` /
 * `getTriageQueueCounts` in `src/lib/admin/attention-service.ts`).
 *
 * Unlike the four cohort queries in `j6-explain-cohort.ts`, this one scans the
 * `users` table, which in the verify cohort holds only ~150 rows — small enough
 * that the planner may legitimately prefer a Seq Scan over the new index
 * `users_status_deleted_at_last_seen_at_idx (status, deleted_at, last_seen_at)`.
 * This harness is written to tell the HONEST story rather than assert a win:
 *
 *   1. It captures the EXACT SQL Prisma emits for `listDisengagedMembers`
 *      (that service file has `import 'server-only'` so it cannot be imported by
 *      tsx — the findMany is REPLICATED here byte-faithfully: same
 *      `disengagedMembersWhere` predicate, same `lastSeenAt asc NULLS FIRST, id`
 *      order, same `take = limit + 1 = 26`, same select).
 *   2. It EXPLAINs that SQL against the cohort AS-SEEDED (every member has
 *      `last_seen_at IS NULL` + a recent `joined_at`, so ZERO rows are
 *      disengaged) — both with the default planner and with `enable_seqscan=off`
 *      to reveal whether the plain btree can even satisfy the `NULLS FIRST`
 *      ordering (a default btree stores NULLs LAST, so it usually cannot drop
 *      the Sort node for this query).
 *   3. Inside a `BEGIN … ROLLBACK` it makes a realistic ~60 % of the cohort
 *      disengaged (backdated `last_seen_at` + never-seen old joiners), re-ANALYZEs,
 *      and EXPLAINs again WITH the index, WITH the index forced, and WITHOUT the
 *      index (dropped in the same tx) — then ROLLs BACK so the disposable DB is
 *      left byte-for-byte untouched.
 *
 * ⚠️ Run ONLY against the disposable verify DB (port 55432), NEVER the real dev
 * DB on 5432. Seed + migrate it first (`scripts/seed-j6-cohort.ts` +
 * `prisma migrate deploy`):
 *   DATABASE_URL="postgresql://postgres:verify@localhost:55432/fxmily_j6?schema=public" \
 *   AUTH_SECRET="<32+ chars>" AUTH_URL="http://localhost:3000" \
 *   pnpm --filter @fxmily/web exec tsx scripts/j6-explain-disengaged.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[j6-explain-disengaged] DATABASE_URL is required.');
  process.exit(1);
}
// Hard guard: this harness DROPs an index + UPDATEs rows (all inside a rollback
// tx) + runs ANALYZE. Never let it touch `fxmily-postgres-dev` on 5432.
if (!DATABASE_URL.includes(':55432/')) {
  console.error(
    '[j6-explain-disengaged] refusing to run: DATABASE_URL must target the disposable verify DB on port 55432.',
  );
  process.exit(1);
}

// ---- exact query constants (mirror attention-service.ts) --------------------
const TRIAGE_PAGE_SIZE = 25; // attention-service.ts — take = limit + 1 = 26
const DAY_MS = 86_400_000;
const DISENGAGED_AFTER_MS = 7 * DAY_MS; // attention-service.ts:43
const DISENGAGED_INDEX = 'users_status_deleted_at_last_seen_at_idx';

/** Byte-faithful replica of `disengagedMembersWhere(floor)`. */
function disengagedMembersWhere(floor: Date) {
  return {
    status: 'active' as const,
    deletedAt: null,
    OR: [{ lastSeenAt: { lt: floor } }, { lastSeenAt: null, joinedAt: { lt: floor } }],
  };
}

interface CapturedQuery {
  label: string;
  sql: string;
  params: unknown[];
}

async function main() {
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter, log: [{ level: 'query', emit: 'event' }] });
  const events: Array<{ query: string; params: string }> = [];
  prisma.$on('query', (e: { query: string; params: string }) => {
    events.push({ query: e.query, params: e.params });
  });

  const floor = new Date(Date.now() - DISENGAGED_AFTER_MS);

  // Capture the EXACT SQL `listDisengagedMembers` emits (byte-faithful replica).
  events.length = 0;
  await prisma.user.findMany({
    where: disengagedMembersWhere(floor),
    orderBy: [{ lastSeenAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: TRIAGE_PAGE_SIZE + 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      lastSeenAt: true,
      joinedAt: true,
    },
  });
  await new Promise((r) => setTimeout(r, 120)); // let query events flush

  const main = events.find(
    (e) => e.query.toLowerCase().includes('"users"') && e.query.toLowerCase().includes('order by'),
  );
  if (!main) {
    console.error('[j6-explain-disengaged] could not capture the users query. Emitted:');
    events.forEach((e, i) => console.error(`  [${i}] ${e.query}`));
    throw new Error('no users query captured');
  }
  const captured: CapturedQuery = {
    label: 'listDisengagedMembers',
    sql: main.query,
    params: JSON.parse(main.params) as unknown[],
  };

  await prisma.$disconnect();

  // ---- run EXPLAINs on a single pg connection (tx control for UPDATE + DROP) -
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const explain = async (): Promise<string> => {
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${captured.sql}`, captured.params);
    return res.rows.map((r) => r['QUERY PLAN']).join('\n');
  };
  const execTime = (plan: string): number | null => {
    const m = plan.match(/Execution Time: ([\d.]+) ms/);
    return m ? Number.parseFloat(m[1]!) : null;
  };
  const hasSeqScan = (plan: string): boolean => /Seq Scan/.test(plan);
  const usesDisengagedIdx = (plan: string): boolean => plan.includes(DISENGAGED_INDEX);
  const hasSort = (plan: string): boolean => /\bSort\b/.test(plan);
  const rowsMatched = (plan: string): string => {
    // top node "... rows=N ..." on the (actual ...) segment gives returned rows
    const m = plan.match(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/);
    return m ? m[1]! : '?';
  };

  const sep = '='.repeat(78);

  // Confirm the index is present (migration applied) before we start.
  const idxPresent = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname = $1`, [
    DISENGAGED_INDEX,
  ]);
  console.log(`\n${sep}\nJ6 DISENGAGED-MEMBERS EXPLAIN PROOF (scope 2)\n${sep}`);
  console.log(`\nindex ${DISENGAGED_INDEX} present: ${idxPresent.rowCount === 1 ? 'YES' : 'NO'}`);
  const totals = await client.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status='active' AND deleted_at IS NULL) AS active,
            count(*) FILTER (WHERE last_seen_at IS NULL) AS null_last_seen
       FROM users`,
  );
  console.log(`users table: ${JSON.stringify(totals.rows[0])}`);
  console.log(`\ncaptured SQL:\n${captured.sql}`);
  console.log(`params: ${JSON.stringify(captured.params)}`);

  await client.query(`ANALYZE "users"`);

  // ---- Scenario 1: cohort AS-SEEDED (0 disengaged) --------------------------
  console.log(
    `\n${sep}\nSCENARIO 1 — cohort AS-SEEDED (every member last_seen_at IS NULL,\n  joined recently → 0 rows match the disengaged predicate)\n${sep}`,
  );
  const s1Default = await explain();
  console.log(`\n### default planner\n${s1Default}`);
  await client.query(`SET enable_seqscan = off`);
  const s1Forced = await explain();
  await client.query(`RESET enable_seqscan`);
  console.log(`\n### enable_seqscan = off (is the btree even usable for this order?)\n${s1Forced}`);

  // ---- Scenario 2: realistic disengaged cohort (inside a rollback tx) --------
  console.log(
    `\n${sep}\nSCENARIO 2 — realistic cohort inside BEGIN…ROLLBACK:\n  ~40% backdated last_seen_at (silent), ~20% never-seen old joiners → ~60% disengaged\n${sep}`,
  );
  await client.query('BEGIN');
  let s2Default = '';
  let s2Forced = '';
  let s2NoIndex = '';
  try {
    // ~40% of members: seen long ago (last_seen_at < floor).
    await client.query(
      `UPDATE users SET last_seen_at = now() - interval '30 days'
        WHERE id IN (SELECT id FROM users ORDER BY id LIMIT (SELECT round(count(*)*0.40) FROM users))`,
    );
    // ~20% of members: never seen, but joined long ago (null last_seen_at + old joined_at).
    await client.query(
      `UPDATE users SET joined_at = now() - interval '30 days'
        WHERE last_seen_at IS NULL
          AND id IN (SELECT id FROM users WHERE last_seen_at IS NULL ORDER BY id LIMIT (SELECT round(count(*)*0.20) FROM users))`,
    );
    await client.query(`ANALYZE "users"`);

    s2Default = await explain();
    console.log(`\n### WITH index — default planner\n${s2Default}`);

    await client.query(`SET enable_seqscan = off`);
    s2Forced = await explain();
    await client.query(`RESET enable_seqscan`);
    console.log(`\n### WITH index — enable_seqscan = off (forced)\n${s2Forced}`);

    await client.query(`DROP INDEX "${DISENGAGED_INDEX}"`);
    s2NoIndex = await explain();
    console.log(`\n### WITHOUT index (dropped in tx)\n${s2NoIndex}`);
  } finally {
    await client.query('ROLLBACK'); // reverts the UPDATEs + the DROP INDEX
  }

  // Confirm ROLLBACK restored the index + left the data untouched.
  const restored = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname = $1`, [
    DISENGAGED_INDEX,
  ]);
  const stillZero = await client.query(
    `SELECT count(*) AS disengaged FROM users
      WHERE status='active' AND deleted_at IS NULL
        AND (last_seen_at < now() - interval '7 days'
             OR (last_seen_at IS NULL AND joined_at < now() - interval '7 days'))`,
  );

  // ---- verdict --------------------------------------------------------------
  console.log(`\n${sep}\nVERDICT (honest)\n${sep}`);
  console.log(
    `\nScenario 1 (0 disengaged, 150-row table):` +
      `\n  default        : ${hasSeqScan(s1Default) ? 'Seq Scan' : 'Index Scan'}` +
      ` | uses ${DISENGAGED_INDEX}? ${usesDisengagedIdx(s1Default) ? 'YES' : 'no'}` +
      ` | Sort node? ${hasSort(s1Default) ? 'YES' : 'no'} | exec ${execTime(s1Default) ?? '?'} ms` +
      `\n  seqscan=off    : uses index? ${usesDisengagedIdx(s1Forced) ? 'YES' : 'no'}` +
      ` | Sort node? ${hasSort(s1Forced) ? 'YES' : 'no'} | exec ${execTime(s1Forced) ?? '?'} ms`,
  );
  console.log(
    `\nScenario 2 (~60% disengaged, 150-row table):` +
      `\n  WITH index     : ${hasSeqScan(s2Default) ? 'Seq Scan' : 'Index Scan'}` +
      ` | uses ${DISENGAGED_INDEX}? ${usesDisengagedIdx(s2Default) ? 'YES' : 'no'}` +
      ` | Sort node? ${hasSort(s2Default) ? 'YES' : 'no'} | rows=${rowsMatched(s2Default)} | exec ${execTime(s2Default) ?? '?'} ms` +
      `\n  index forced   : uses index? ${usesDisengagedIdx(s2Forced) ? 'YES' : 'no'}` +
      ` | Sort node? ${hasSort(s2Forced) ? 'YES' : 'no'} | exec ${execTime(s2Forced) ?? '?'} ms` +
      `\n  WITHOUT index  : ${hasSeqScan(s2NoIndex) ? 'Seq Scan' : 'Index Scan'}` +
      ` | Sort node? ${hasSort(s2NoIndex) ? 'YES' : 'no'} | exec ${execTime(s2NoIndex) ?? '?'} ms`,
  );
  console.log(
    `\n[j6-explain-disengaged] index restored after ROLLBACK: ${
      restored.rowCount === 1 ? 'YES' : 'NO'
    } | data untouched (disengaged rows still ${stillZero.rows[0].disengaged})`,
  );
  console.log(
    `\nInterpretation: at ~150 members a Seq Scan of ~1-2 heap pages is cheaper than\n` +
      `an index scan, so the planner may pick it regardless — the index is a\n` +
      `FORWARD-LOOKING choice that starts paying off as the members table grows into\n` +
      `the thousands. The 'seqscan=off' pass shows whether the plain btree can serve\n` +
      `the 'lastSeenAt asc NULLS FIRST' order without a Sort (a default btree stores\n` +
      `NULLs LAST, so a residual Sort on the ~26-row page is expected and cheap).`,
  );

  await client.end();
}

main().catch((err) => {
  console.error('[j6-explain-disengaged] failed:', err);
  process.exit(1);
});
