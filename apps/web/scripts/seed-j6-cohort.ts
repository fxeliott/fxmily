/**
 * Seed a disposable Postgres with enough admin-triage cohort data for the J6
 * "cohort triage indexes" EXPLAIN proof (pass/fail #1 of the j6-admin-scale
 * milestone).
 *
 * This is NOT a demo/dev seed — it exists solely to feed
 * `scripts/j6-explain-cohort.ts` so the four J6 indexes
 *   - trades_closed_at_id_idx (closed_at, id)
 *   - trades_closed_at_entered_at_id_idx (closed_at, entered_at, id)
 *   - discrepancies_status_detected_at_id_idx (status, detected_at, id)
 *   - mark_douglas_deliveries_created_at_idx (created_at)
 * each get a table big enough that Postgres prefers an Index Scan over a Seq
 * Scan for the four attention-service cohort queries.
 *
 * ⚠️ Run ONLY against the disposable verify DB (port 55432), NEVER the real
 * dev DB on 5432:
 *   DATABASE_URL="postgresql://postgres:verify@localhost:55432/fxmily_j6?schema=public" \
 *   AUTH_SECRET="<32+ chars>" AUTH_URL="http://localhost:3000" \
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-j6-cohort.ts
 *
 * Deterministic (seed=42). Idempotent: cleans every `.e2e.test@fxmily.local`
 * user first (User cascade removes their discrepancies + mark-douglas
 * deliveries), and upserts the seed Mark Douglas card by slug.
 */

import { db } from '../src/lib/db.js';
import {
  cleanupTestUsers,
  seedCheckinHistory,
  seedMemberUser,
  seedTradeHistory,
} from '../src/test/db-helpers.js';

// ---- sizing knobs -----------------------------------------------------------
const NUM_MEMBERS = 150;
const TRADES_PER_MEMBER = 25; // ~3750 trades (~95% closed / no annotations, ~5% open)
const CHECKIN_DAYS = 7; // light realistic filler (not queried by cohort)
const DISCREPANCIES_PER_MEMBER = 20; // ~3000 discrepancies, mixed open/resolved
const DISCREPANCY_SPREAD_DAYS = 60;
const DELIVERIES_PER_MEMBER = 27; // ~4050 deliveries, createdAt spread over 120d
const DELIVERY_SPREAD_DAYS = 120;

const DAY_MS = 86_400_000;
const CARD_SLUG = 'j6-cohort-seed-card';

// ---- deterministic PRNG (mulberry32) ---------------------------------------
function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const DISCREPANCY_TYPES = ['missing_declared', 'false_declared', 'mismatch'] as const;

async function main() {
  const now = Date.now();
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const rand = makePrng(42);

  console.log('[seed-j6-cohort] cleaning up test users…');
  const cleaned = await cleanupTestUsers();
  console.log(`[seed-j6-cohort]   removed ${cleaned.deleted} test users`);

  console.log('[seed-j6-cohort] upserting seed Mark Douglas card…');
  const card = await db.markDouglasCard.upsert({
    where: { slug: CARD_SLUG },
    update: {},
    create: {
      slug: CARD_SLUG,
      title: 'Seed card (J6 cohort EXPLAIN proof)',
      category: 'discipline',
      quote: 'Anything can happen.',
      quoteSourceChapter: 'Trading in the Zone, ch.11 (seed placeholder)',
      paraphrase: 'Placeholder paraphrase used only for the disposable EXPLAIN-proof database.',
      exercises: [{ id: 'ex-1', label: 'Seed exercise', description: 'Placeholder.' }],
      published: true,
    },
  });
  console.log(`[seed-j6-cohort]   card id=${card.id}`);

  const discrepancyRows: Array<{
    memberId: string;
    type: (typeof DISCREPANCY_TYPES)[number];
    declaredTradeId: string;
    severity: number;
    status: 'open' | 'resolved' | 'acknowledged';
    detectedAt: Date;
    createdAt: Date;
  }> = [];
  const deliveryRows: Array<{
    userId: string;
    cardId: string;
    triggeredBy: string;
    triggerSnapshot: Record<string, never>;
    triggeredOn: Date;
    createdAt: Date;
  }> = [];

  console.log(`[seed-j6-cohort] seeding ${NUM_MEMBERS} members…`);
  let totalTrades = 0;
  let totalOpen = 0;
  for (let i = 0; i < NUM_MEMBERS; i++) {
    const member = await seedMemberUser();
    const trades = await seedTradeHistory(member.id, {
      count: TRADES_PER_MEMBER,
      seed: 42 + i,
    });
    totalTrades += trades.count;
    totalOpen += trades.open;
    await seedCheckinHistory(member.id, { days: CHECKIN_DAYS, seed: 42 + i });

    // Fetch this member's real trade ids so each discrepancy can carry a DISTINCT
    // `declaredTradeId`. The 3 reconcile types (missing_declared / false_declared /
    // mismatch) are covered by the partial unique index
    // `discrepancies_reconcile_key_uniq` ON (member_id, type, COALESCE(declared_trade_id,''),
    // COALESCE(extracted_position_id,'')). A distinct real trade id per row keeps that
    // key satisfied (and honours the FK discrepancies.declared_trade_id -> trades.id).
    // Invariant: DISCREPANCIES_PER_MEMBER <= TRADES_PER_MEMBER so `d` never wraps into
    // a duplicate id.
    const memberTradeIds = (
      await db.trade.findMany({ where: { userId: member.id }, select: { id: true } })
    ).map((t) => t.id);

    // Discrepancies: mixed status, detectedAt spread over 60 days, null meeting/tracking.
    for (let d = 0; d < DISCREPANCIES_PER_MEMBER; d++) {
      const offsetDays = rand() * DISCREPANCY_SPREAD_DAYS;
      const when = new Date(now - offsetDays * DAY_MS);
      const r = rand();
      const status = r < 0.5 ? 'open' : r < 0.8 ? 'resolved' : 'acknowledged';
      discrepancyRows.push({
        memberId: member.id,
        type: DISCREPANCY_TYPES[d % DISCREPANCY_TYPES.length]!,
        declaredTradeId: memberTradeIds[d % memberTradeIds.length]!,
        severity: 1 + Math.floor(rand() * 5),
        status,
        detectedAt: when,
        createdAt: when,
      });
    }

    // Mark Douglas deliveries: DISTINCT UTC-midnight `triggeredOn` per (userId,
    // cardId) so @@unique([userId, cardId, triggeredOn]) always holds. Anchor each
    // delivery to `todayMidnight - off days` (off unique from the shuffle) rather than
    // flooring a jittered timestamp, whose midnight could collide across adjacent days.
    const offsets = shuffle(
      Array.from({ length: DELIVERY_SPREAD_DAYS }, (_, k) => k),
      rand,
    ).slice(0, DELIVERIES_PER_MEMBER);
    for (const off of offsets) {
      const triggeredOn = new Date(todayMidnight - off * DAY_MS);
      // A jittered instant within that UTC day, clamped to <= now (no future rows).
      const createdAt = new Date(
        Math.min(triggeredOn.getTime() + Math.floor(rand() * DAY_MS), now - 1000),
      );
      deliveryRows.push({
        userId: member.id,
        cardId: card.id,
        triggeredBy: 'seed',
        triggerSnapshot: {},
        triggeredOn,
        createdAt,
      });
    }

    if ((i + 1) % 25 === 0) {
      console.log(`[seed-j6-cohort]   …${i + 1}/${NUM_MEMBERS} members`);
    }
  }

  console.log(
    `[seed-j6-cohort]   ${totalTrades} trades (${totalOpen} open / ${totalTrades - totalOpen} closed)`,
  );

  console.log(`[seed-j6-cohort] inserting ${discrepancyRows.length} discrepancies…`);
  const disc = await db.discrepancy.createMany({ data: discrepancyRows });
  console.log(`[seed-j6-cohort]   ${disc.count} discrepancies inserted`);

  console.log(`[seed-j6-cohort] inserting ${deliveryRows.length} mark-douglas deliveries…`);
  const del = await db.markDouglasDelivery.createMany({ data: deliveryRows });
  console.log(`[seed-j6-cohort]   ${del.count} deliveries inserted`);

  // Report the row/selectivity picture that matters for the planner.
  const openDisc = discrepancyRows.filter((d) => d.status === 'open').length;
  const recentFloor = now - 7 * DAY_MS;
  const recentDeliveries = deliveryRows.filter((d) => d.createdAt.getTime() >= recentFloor).length;
  console.log('\n[seed-j6-cohort] summary:');
  console.log(`  trades total ............ ${totalTrades} (open ${totalOpen})`);
  console.log(`  discrepancies total ..... ${discrepancyRows.length} (open ${openDisc})`);
  console.log(
    `  deliveries total ........ ${deliveryRows.length} (last 7d ${recentDeliveries} = ${((recentDeliveries / deliveryRows.length) * 100).toFixed(1)}%)`,
  );
}

main()
  .catch((err) => {
    console.error('[seed-j6-cohort] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
