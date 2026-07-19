/**
 * Runtime PROOF (pass/fail #1 of the J6 "cohort triage indexes" milestone) that
 * the four J6 indexes flip the admin attention-service cohort queries from a
 * Seq Scan + Sort to an Index Scan.
 *
 *   - trades_closed_at_id_idx              (closed_at, id)
 *   - trades_closed_at_entered_at_id_idx   (closed_at, entered_at, id)
 *   - discrepancies_status_detected_at_id_idx (status, detected_at, id)
 *   - mark_douglas_deliveries_created_at_idx  (created_at)
 *
 * It captures the EXACT SQL that Prisma emits for each of the four cohort list
 * functions in `src/lib/admin/attention-service.ts` (that file has
 * `import 'server-only'` so it cannot be imported by tsx — the four findMany
 * calls are REPLICATED here byte-faithfully), then runs
 * `EXPLAIN (ANALYZE, BUFFERS)` on that exact SQL twice via the `pg` driver:
 *   (a) WITH the four J6 indexes present;
 *   (b) after `BEGIN; DROP INDEX <the 4 J6 indexes>; ...; ROLLBACK` so the drop
 *       is reverted at the end and the disposable DB is left untouched.
 *
 * ⚠️ Run ONLY against the disposable verify DB (port 55432), NEVER the real
 * dev DB on 5432. Seed it first with `scripts/seed-j6-cohort.ts`:
 *   DATABASE_URL="postgresql://postgres:verify@localhost:55432/fxmily_j6?schema=public" \
 *   AUTH_SECRET="<32+ chars>" AUTH_URL="http://localhost:3000" \
 *   pnpm --filter @fxmily/web exec tsx scripts/j6-explain-cohort.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[j6-explain] DATABASE_URL is required.');
  process.exit(1);
}
// Hard guard: this harness DROPs indexes (inside a rollback tx) + runs ANALYZE.
// Never let it touch `fxmily-postgres-dev` on 5432 — require the throwaway port.
if (!DATABASE_URL.includes(':55432/')) {
  console.error(
    '[j6-explain] refusing to run: DATABASE_URL must target the disposable verify DB on port 55432.',
  );
  process.exit(1);
}

// ---- exact cohort-query constants (mirror attention-service.ts) -------------
const MEMBER_LABEL_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;
const TRIAGE_PAGE_SIZE = 25; // attention-service.ts:195 — take = limit + 1 = 26
const STALE_OPEN_TRADE_MS = 72 * 60 * 60 * 1000; // stale-open-threshold.ts (72h)
const DAY_MS = 86_400_000;
const BEHAVIORAL_SIGNAL_RECENT_DAYS = 7; // attention-service.ts:481

const J6_INDEXES = [
  'discrepancies_status_detected_at_id_idx',
  'mark_douglas_deliveries_created_at_idx',
  'trades_closed_at_id_idx',
  'trades_closed_at_entered_at_id_idx',
] as const;

interface CapturedQuery {
  label: string;
  /** Base table whose scan the J6 index is meant to serve. */
  table: string;
  /** The J6 index this cohort query is expected to use. */
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
   * Run a replicated cohort findMany, then pick the MAIN table query out of the
   * emitted events (Prisma loads the `user`/`member` label relation in a second
   * query; only the main one carries the target table's FROM + ORDER BY).
   */
  async function capture(
    label: string,
    table: string,
    index: string,
    run: () => Promise<unknown>,
  ): Promise<CapturedQuery> {
    events.length = 0;
    await run();
    await new Promise((r) => setTimeout(r, 120)); // let query events flush
    const lowerTable = `"${table}"`.toLowerCase();
    const main = events.find(
      (e) =>
        e.query.toLowerCase().includes(lowerTable) && e.query.toLowerCase().includes('order by'),
    );
    if (!main) {
      console.error(`[j6-explain] could not capture the main query for ${label}. Emitted:`);
      events.forEach((e, i) => console.error(`  [${i}] ${e.query}`));
      throw new Error(`no main query captured for ${label}`);
    }
    return { label, table, index, sql: main.query, params: JSON.parse(main.params) as unknown[] };
  }

  const now = Date.now();
  const staleFloor = new Date(now - STALE_OPEN_TRADE_MS);
  const recentFloor = new Date(now - BEHAVIORAL_SIGNAL_RECENT_DAYS * DAY_MS);

  console.log('[j6-explain] capturing the 4 exact cohort queries via Prisma query events…');

  const queries: CapturedQuery[] = [
    // 1) listUncommentedClosedTrades → trades_closed_at_id_idx (closed_at, id)
    await capture('listUncommentedClosedTrades', 'trades', 'trades_closed_at_id_idx', () =>
      prisma.trade.findMany({
        where: {
          closedAt: { not: null },
          annotations: { none: {} },
          user: { status: { not: 'deleted' } },
        },
        orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
        take: TRIAGE_PAGE_SIZE + 1,
        select: {
          id: true,
          pair: true,
          direction: true,
          closedAt: true,
          realizedR: true,
          user: MEMBER_LABEL_SELECT,
        },
      }),
    ),
    // 2) listStaleOpenTrades → trades_closed_at_entered_at_id_idx (closed_at, entered_at, id)
    await capture('listStaleOpenTrades', 'trades', 'trades_closed_at_entered_at_id_idx', () =>
      prisma.trade.findMany({
        where: {
          closedAt: null,
          enteredAt: { lt: staleFloor },
          user: { status: { not: 'deleted' } },
        },
        orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
        take: TRIAGE_PAGE_SIZE + 1,
        select: {
          id: true,
          pair: true,
          direction: true,
          enteredAt: true,
          user: MEMBER_LABEL_SELECT,
        },
      }),
    ),
    // 3) listOpenDiscrepancies → discrepancies_status_detected_at_id_idx (status, detected_at, id)
    await capture(
      'listOpenDiscrepancies',
      'discrepancies',
      'discrepancies_status_detected_at_id_idx',
      () =>
        prisma.discrepancy.findMany({
          where: { status: 'open', member: { status: { not: 'deleted' } } },
          orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
          take: TRIAGE_PAGE_SIZE + 1,
          select: {
            id: true,
            type: true,
            severity: true,
            detectedAt: true,
            member: MEMBER_LABEL_SELECT,
          },
        }),
    ),
    // 4) listRecentBehavioralSignals → mark_douglas_deliveries_created_at_idx (created_at) — NO take
    await capture(
      'listRecentBehavioralSignals',
      'mark_douglas_deliveries',
      'mark_douglas_deliveries_created_at_idx',
      () =>
        prisma.markDouglasDelivery.findMany({
          where: { createdAt: { gte: recentFloor }, user: { status: { not: 'deleted' } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { triggeredBy: true, createdAt: true, user: MEMBER_LABEL_SELECT },
        }),
    ),
  ];

  await prisma.$disconnect();

  // ---- run the EXPLAINs on a single pg connection (tx control for DROP) -----
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('[j6-explain] ANALYZE-ing tables so the planner has fresh stats…');
  for (const t of [
    'trades',
    'discrepancies',
    'mark_douglas_deliveries',
    'users',
    'trade_annotations',
  ]) {
    await client.query(`ANALYZE "${t}"`);
  }

  async function explain(q: CapturedQuery): Promise<string> {
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.params);
    return res.rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  const execTime = (plan: string): number | null => {
    const m = plan.match(/Execution Time: ([\d.]+) ms/);
    return m ? Number.parseFloat(m[1]!) : null;
  };
  const hasSeqScan = (plan: string): boolean => /Seq Scan/.test(plan);
  const usesIndex = (plan: string, idx: string): boolean => plan.includes(idx);

  const withPlans: Record<string, string> = {};
  const withoutPlans: Record<string, string> = {};

  const sep = '='.repeat(78);

  console.log(`\n${sep}\nEXACT COHORT QUERIES (captured from Prisma)\n${sep}`);
  for (const q of queries) {
    console.log(`\n### ${q.label}  →  ${q.index}`);
    console.log(`SQL: ${q.sql}`);
    console.log(`PARAMS: ${JSON.stringify(q.params)}`);
  }

  console.log(`\n${sep}\nPLANS WITH THE 4 J6 INDEXES\n${sep}`);
  for (const q of queries) {
    const plan = await explain(q);
    withPlans[q.label] = plan;
    console.log(`\n### ${q.label}  (expects ${q.index})\n${plan}`);
  }

  console.log(
    `\n${sep}\nPLANS WITHOUT THE 4 J6 INDEXES (BEGIN → DROP → EXPLAIN → ROLLBACK)\n${sep}`,
  );
  await client.query('BEGIN');
  try {
    for (const idx of J6_INDEXES) {
      await client.query(`DROP INDEX "${idx}"`);
    }
    for (const q of queries) {
      const plan = await explain(q);
      withoutPlans[q.label] = plan;
      console.log(`\n### ${q.label}  (index ${q.index} dropped)\n${plan}`);
    }
  } finally {
    await client.query('ROLLBACK'); // restores all 4 indexes — DB left untouched
  }

  // Confirm the ROLLBACK restored the indexes.
  const restored = await client.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[]) ORDER BY indexname`,
    [J6_INDEXES],
  );

  console.log(`\n${sep}\nVERDICT\n${sep}`);
  let allPass = true;
  for (const q of queries) {
    const w = withPlans[q.label]!;
    const wo = withoutPlans[q.label]!;
    const withIdx = usesIndex(w, q.index);
    const withoutSeq = hasSeqScan(wo);
    const wt = execTime(w);
    const wot = execTime(wo);
    const pass = withIdx && withoutSeq;
    allPass &&= pass;
    console.log(
      `\n### ${q.label}` +
        `\n  WITH index    : uses ${q.index}? ${withIdx ? 'YES' : 'NO'}  | Seq Scan? ${hasSeqScan(w) ? 'YES' : 'no'}  | exec ${wt ?? '?'} ms` +
        `\n  WITHOUT index : Seq Scan? ${withoutSeq ? 'YES' : 'no'}  | exec ${wot ?? '?'} ms` +
        `\n  DELTA         : ${wt != null && wot != null ? `${(wot - wt).toFixed(3)} ms (${(wot / wt).toFixed(1)}× faster with index)` : 'n/a'}` +
        `\n  → ${pass ? 'PASS (Seq Scan → Index Scan)' : 'REVIEW — see plan above'}`,
    );
  }

  console.log(
    `\n[j6-explain] indexes restored after ROLLBACK: ${restored.rows.map((r) => r.indexname).join(', ')} (${restored.rowCount}/4)`,
  );
  console.log(
    `\n[j6-explain] OVERALL: ${allPass ? 'PASS ✅' : 'PARTIAL — review flagged queries'}`,
  );

  await client.end();
}

main().catch((err) => {
  console.error('[j6-explain] failed:', err);
  process.exit(1);
});
