/**
 * Runtime PROOF (J7 stress-test tracker id=10 — "Fix requêtes classement
 * indexées/paginées à 1000") that the `@@index([date, rank])` index
 * (`leaderboard_snapshots_date_rank_idx`) is the load-bearing index for the two
 * `/classement` read queries in `src/lib/leaderboard/service.ts`:
 *
 *   1. `latestBoardDate`   → findFirst  ORDER BY date DESC LIMIT 1
 *   2. `getLeaderboardBoard` → findMany WHERE date = X AND user.status='active'
 *                              ORDER BY rank ASC NULLS LAST
 *
 * Both are captured BYTE-FAITHFULLY via Prisma query events (the service carries
 * `import 'server-only'`, un-loadable by tsx — so the two calls are REPLICATED
 * here), then `EXPLAIN (ANALYZE, BUFFERS)` runs on that exact SQL via the `pg`
 * driver.
 *
 * ─── The honest two-regime story ────────────────────────────────────────────
 * The seed (`scripts/seed-stress-cohort.ts`) writes 1000 snapshots for ONE
 * anchor date. At that scale `WHERE date = <anchor>` selects 100% of the table,
 * so Postgres CORRECTLY prefers a Seq Scan + Sort — the `(date, rank)` index is
 * NOT decisive yet (and forcing it would be slower). The index only becomes
 * load-bearing once snapshots ACCUMULATE over many days (the nightly cron writes
 * one row per member per day). So this harness proves BOTH:
 *
 *   Regime A — current 1000-row single-date scale: report the real plan
 *              (Seq Scan + Sort is the honest, correct choice at 100% selectivity).
 *   Regime B — multi-day accumulation: inside a BEGIN…ROLLBACK transaction,
 *              back-date-inflate the table to ~91k rows (90 days × 1000) so
 *              `date = <anchor>` becomes ~1.1% selective, ANALYZE, then prove the
 *              board findMany flips to an Index Scan on
 *              `leaderboard_snapshots_date_rank_idx` (no Seq Scan on the table),
 *              then DROP that index (still in the tx) → Seq Scan counterfactual,
 *              then ROLLBACK (restores every inflated row AND the index).
 *
 * ⚠️ Run ONLY against the disposable verify DB (port 55432), NEVER the real dev
 * DB on 5432. Seed it first with `scripts/seed-stress-cohort.ts`:
 *   DATABASE_URL="postgresql://postgres:verify@localhost:55432/fxmily_j7?schema=public" \
 *   AUTH_SECRET="<32+ chars>" AUTH_URL="http://localhost:3000" \
 *   pnpm --filter @fxmily/web exec tsx scripts/j7-explain-leaderboard.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[j7-explain] DATABASE_URL is required.');
  process.exit(1);
}
// Hard guard: this harness INSERTs ~90k rows + DROPs an index (inside a rollback
// tx) + runs ANALYZE. Never let it touch `fxmily-postgres-dev` on 5432 — require
// the throwaway port (mirror `scripts/j6-explain-cohort.ts`).
if (!DATABASE_URL.includes(':55432/')) {
  console.error(
    '[j7-explain] refusing to run: DATABASE_URL must target the disposable verify DB on port 55432.',
  );
  process.exit(1);
}

// ---- the index this jalon is proving --------------------------------------
const LEADERBOARD_INDEX = 'leaderboard_snapshots_date_rank_idx'; // ON (date, rank)
// Days to back-date-inflate in regime B: 90 days × 1000 members ≈ 90k extra rows
// so the anchor date drops from 100% → ~1.1% selectivity (91k total).
const INFLATE_DAYS = 90;

interface CapturedQuery {
  label: string;
  /** Base table whose scan the index is meant to serve. */
  table: string;
  /** The index this query is expected to use at accumulation scale. */
  index: string;
  sql: string;
  params: unknown[];
}

async function main() {
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  // Query-event logging so we can grab the EXACT SQL Prisma generates.
  const prisma = new PrismaClient({
    adapter,
    log: [{ level: 'query', emit: 'event' }],
  });
  const events: Array<{ query: string; params: string }> = [];
  prisma.$on('query', (e: { query: string; params: string }) => {
    events.push({ query: e.query, params: e.params });
  });

  /**
   * Run a replicated leaderboard query, then pick the MAIN table query out of
   * the emitted events (Prisma may load the `user` relation in a second query;
   * only the main one carries `leaderboard_snapshots` FROM + ORDER BY).
   */
  async function capture(
    label: string,
    table: string,
    index: string,
    run: () => Promise<unknown>,
  ): Promise<CapturedQuery> {
    events.length = 0;
    await run();
    await new Promise((r) => setTimeout(r, 150)); // let query events flush
    const lowerTable = `"${table}"`.toLowerCase();
    const main = events.find(
      (e) =>
        e.query.toLowerCase().includes(lowerTable) && e.query.toLowerCase().includes('order by'),
    );
    if (!main) {
      console.error(`[j7-explain] could not capture the main query for ${label}. Emitted:`);
      events.forEach((e, i) => console.error(`  [${i}] ${e.query}`));
      throw new Error(`no main query captured for ${label}`);
    }
    return { label, table, index, sql: main.query, params: JSON.parse(main.params) as unknown[] };
  }

  console.log('[j7-explain] capturing the 2 exact /classement queries via Prisma query events…');

  // 1) latestBoardDate → findFirst ORDER BY date DESC LIMIT 1
  const latestQ = await capture('latestBoardDate', 'leaderboard_snapshots', LEADERBOARD_INDEX, () =>
    prisma.leaderboardSnapshot.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  );

  // Fetch the actual latest board date to feed the board findMany (mirrors the
  // service, where getLeaderboardBoard calls latestBoardDate() first).
  const latest = await prisma.leaderboardSnapshot.findFirst({
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  const boardDate = latest?.date;
  if (!boardDate) {
    console.error('[j7-explain] no leaderboard snapshots found — seed the cohort first.');
    await prisma.$disconnect();
    process.exit(1);
  }

  // 2) getLeaderboardBoard → findMany WHERE date + user.status='active', ORDER BY rank
  const boardQ = await capture(
    'getLeaderboardBoard',
    'leaderboard_snapshots',
    LEADERBOARD_INDEX,
    () =>
      prisma.leaderboardSnapshot.findMany({
        where: { date: boardDate, user: { status: 'active' } },
        orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }],
        select: {
          userId: true,
          score: true,
          rank: true,
          status: true,
          components: true,
          sampleSize: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              avatarKey: true,
              image: true,
              leaderboardOptOut: true,
            },
          },
        },
      }),
  );

  const queries: CapturedQuery[] = [latestQ, boardQ];

  await prisma.$disconnect();

  // ---- run the EXPLAINs on a single pg connection (tx control for inflate) ---
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  async function explain(q: CapturedQuery): Promise<string> {
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.params);
    return res.rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  const execTime = (plan: string): number | null => {
    const m = plan.match(/Execution Time: ([\d.]+) ms/);
    return m ? Number.parseFloat(m[1]!) : null;
  };
  // Target the leaderboard_snapshots scan specifically — the `users` relation
  // (status='active' filter / relation load) can legitimately Seq Scan without
  // meaning the board query itself is un-indexed.
  const hasSeqScanOnTable = (plan: string): boolean =>
    /Seq Scan on\s+(?:public\.)?"?leaderboard_snapshots"?/i.test(plan);
  const usesTargetIndex = (plan: string): boolean => plan.includes(LEADERBOARD_INDEX);

  const sep = '='.repeat(78);

  console.log(`\n${sep}\nEXACT /classement QUERIES (captured from Prisma)\n${sep}`);
  for (const q of queries) {
    console.log(`\n### ${q.label}`);
    console.log(`SQL: ${q.sql}`);
    console.log(`PARAMS: ${JSON.stringify(q.params)}`);
  }

  // ─── Regime A — current 1000-row single-date scale ────────────────────────
  console.log(`\n${sep}\nREGIME A — current scale (single anchor date)\n${sep}`);
  await client.query('ANALYZE "leaderboard_snapshots"');
  await client.query('ANALYZE "users"');
  const rowCountA = (await client.query('SELECT count(*)::int AS c FROM "leaderboard_snapshots"'))
    .rows[0].c as number;
  const anchorRows = (
    await client.query('SELECT count(*)::int AS c FROM "leaderboard_snapshots" WHERE date = $1', [
      boardQ.params[0],
    ])
  ).rows[0].c as number;
  const selectivityA = ((anchorRows / rowCountA) * 100).toFixed(1);
  console.log(
    `rows: ${rowCountA} total | anchor-date rows: ${anchorRows} (${selectivityA}% selectivity)`,
  );
  console.log(
    `→ At ${selectivityA}% selectivity, Seq Scan + Sort is the CORRECT plan (the (date,rank)\n` +
      `  index is not decisive until snapshots accumulate over many days).`,
  );
  const regimeAPlans: Record<string, string> = {};
  for (const q of queries) {
    const plan = await explain(q);
    regimeAPlans[q.label] = plan;
    console.log(
      `\n### ${q.label}\n  uses ${LEADERBOARD_INDEX}? ${usesTargetIndex(plan) ? 'YES' : 'no'}` +
        `  | Seq Scan on table? ${hasSeqScanOnTable(plan) ? 'YES' : 'no'}` +
        `  | exec ${execTime(plan) ?? '?'} ms\n${plan}`,
    );
  }

  // ─── Regime B — multi-day accumulation (BEGIN → inflate → EXPLAIN → ROLLBACK) ─
  console.log(
    `\n${sep}\nREGIME B — multi-day accumulation (~${INFLATE_DAYS}× inflate, non-destructive)\n${sep}`,
  );
  const withPlans: Record<string, string> = {};
  const withoutPlans: Record<string, string> = {};
  let rowCountB = 0;
  let anchorRowsB = 0;

  await client.query('BEGIN');
  try {
    // Back-date-inflate: for every existing snapshot, insert INFLATE_DAYS copies
    // shifted back 1..N days. `date - g.d` stays strictly before the anchor, so
    // the `(user_id, date)` unique index never collides and `date = <anchor>`
    // still returns exactly the original rows — now a tiny fraction of the table.
    const ins = await client.query(
      `INSERT INTO "leaderboard_snapshots"
         ("id", "user_id", "date", "score", "rank", "components", "sample_size",
          "window_days", "status", "computed_at", "created_at", "updated_at")
       SELECT gen_random_uuid()::text, s."user_id", s."date" - g.d, s."score", s."rank",
              s."components", s."sample_size", s."window_days", s."status",
              s."computed_at", s."created_at", now()
       FROM "leaderboard_snapshots" s
       CROSS JOIN generate_series(1, $1) AS g(d)
       WHERE s."date" = (SELECT max("date") FROM "leaderboard_snapshots")`,
      [INFLATE_DAYS],
    );
    console.log(`inflate: inserted ${ins.rowCount} back-dated rows`);
    await client.query('ANALYZE "leaderboard_snapshots"');

    rowCountB = (await client.query('SELECT count(*)::int AS c FROM "leaderboard_snapshots"'))
      .rows[0].c as number;
    anchorRowsB = (
      await client.query('SELECT count(*)::int AS c FROM "leaderboard_snapshots" WHERE date = $1', [
        boardQ.params[0],
      ])
    ).rows[0].c as number;
    const selectivityB = ((anchorRowsB / rowCountB) * 100).toFixed(2);
    console.log(
      `rows: ${rowCountB} total | anchor-date rows: ${anchorRowsB} (${selectivityB}% selectivity)`,
    );

    console.log(`\n--- WITH ${LEADERBOARD_INDEX} present ---`);
    for (const q of queries) {
      const plan = await explain(q);
      withPlans[q.label] = plan;
      console.log(
        `\n### ${q.label}\n  uses ${LEADERBOARD_INDEX}? ${usesTargetIndex(plan) ? 'YES' : 'no'}` +
          `  | Seq Scan on table? ${hasSeqScanOnTable(plan) ? 'YES' : 'no'}` +
          `  | exec ${execTime(plan) ?? '?'} ms\n${plan}`,
      );
    }

    console.log(`\n--- WITHOUT ${LEADERBOARD_INDEX} (DROP INDEX inside tx) ---`);
    await client.query(`DROP INDEX "${LEADERBOARD_INDEX}"`);
    for (const q of queries) {
      const plan = await explain(q);
      withoutPlans[q.label] = plan;
      console.log(
        `\n### ${q.label}\n  Seq Scan on table? ${hasSeqScanOnTable(plan) ? 'YES' : 'no'}` +
          `  | exec ${execTime(plan) ?? '?'} ms\n${plan}`,
      );
    }
  } finally {
    await client.query('ROLLBACK'); // restores every inflated row + the index
  }

  // Confirm the ROLLBACK restored the index + row count.
  const restored = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname = $1`, [
    LEADERBOARD_INDEX,
  ]);
  const rowCountAfter = (
    await client.query('SELECT count(*)::int AS c FROM "leaderboard_snapshots"')
  ).rows[0].c as number;

  // ─── VERDICT ──────────────────────────────────────────────────────────────
  console.log(`\n${sep}\nVERDICT\n${sep}`);
  const boardWith = withPlans['getLeaderboardBoard']!;
  const boardWithout = withoutPlans['getLeaderboardBoard']!;
  const boardPass =
    usesTargetIndex(boardWith) && !hasSeqScanOnTable(boardWith) && hasSeqScanOnTable(boardWithout);

  const latestWith = withPlans['latestBoardDate']!;
  const latestWithout = withoutPlans['latestBoardDate']!;
  const latestPass = usesTargetIndex(latestWith) && hasSeqScanOnTable(latestWithout);

  console.log(
    `\n### getLeaderboardBoard (the /classement board — id=10 primary target)` +
      `\n  Regime A (${rowCountA} rows)  : uses index? ${usesTargetIndex(regimeAPlans['getLeaderboardBoard']!) ? 'YES' : 'no (Seq+Sort — correct at 100% selectivity)'}` +
      `\n  Regime B WITH index (${rowCountB} rows): uses ${LEADERBOARD_INDEX}? ${usesTargetIndex(boardWith) ? 'YES' : 'NO'} | Seq Scan on table? ${hasSeqScanOnTable(boardWith) ? 'YES' : 'no'} | exec ${execTime(boardWith) ?? '?'} ms` +
      `\n  Regime B WITHOUT index      : Seq Scan on table? ${hasSeqScanOnTable(boardWithout) ? 'YES' : 'no'} | exec ${execTime(boardWithout) ?? '?'} ms` +
      `\n  → ${boardPass ? 'PASS — index is load-bearing at accumulation scale (Index Scan → Seq Scan when dropped)' : 'REVIEW — see plans above'}`,
  );
  console.log(
    `\n### latestBoardDate (ORDER BY date DESC LIMIT 1)` +
      `\n  Regime B WITH index         : uses ${LEADERBOARD_INDEX}? ${usesTargetIndex(latestWith) ? 'YES' : 'NO'} | exec ${execTime(latestWith) ?? '?'} ms` +
      `\n  Regime B WITHOUT index      : Seq Scan on table? ${hasSeqScanOnTable(latestWithout) ? 'YES' : 'no'} | exec ${execTime(latestWithout) ?? '?'} ms` +
      `\n  → ${latestPass ? 'PASS — index serves the max-date lookup (Index Scan → Seq Scan when dropped)' : 'REVIEW — see plans above'}`,
  );

  console.log(
    `\n[j7-explain] index restored after ROLLBACK: ${restored.rows.map((r) => r.indexname).join(', ') || 'NONE'} (${restored.rowCount}/1)`,
  );
  console.log(`[j7-explain] row count after ROLLBACK: ${rowCountAfter} (expected ${rowCountA})`);
  console.log(
    `\n[j7-explain] OVERALL: ${boardPass && latestPass && restored.rowCount === 1 && rowCountAfter === rowCountA ? 'PASS ✅' : 'PARTIAL — review flagged lines'}`,
  );

  await client.end();
}

main().catch((err) => {
  console.error('[j7-explain] failed:', err);
  process.exit(1);
});
