/**
 * Seed a demo user with J6 dashboard data populated.
 *
 * Usage:
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-j6-demo.ts
 *
 * Creates (or refreshes) a demo admin at `j6demo.admin.e2e.test@fxmily.local`
 * with password `J6DemoPwd-2026!`, seeds 100 trades + 30 days check-ins via
 * the deterministic helpers. The behavioral score snapshot is intentionally
 * NOT computed inline (the scoring service has `import 'server-only'` which
 * tsx can't load); instead, run the cron endpoint after the dev server is up:
 *
 *   curl -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/recompute-scores
 *
 * Idempotent: re-running cleans + re-seeds the demo account only — never
 * touches real members.
 */

import { db } from '../src/lib/db.ts';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedCheckinHistory,
  seedTradeHistory,
} from '../src/test/db-helpers.ts';

const DEMO_EMAIL = 'j6demo.admin.e2e.test@fxmily.local';
const DEMO_PASSWORD = 'J6DemoPwd-2026!';

async function main() {
  console.log('[seed-j6] cleaning up test users…');
  const cleaned = await cleanupTestUsers();
  console.log(`[seed-j6] removed ${cleaned.deleted} test users`);

  console.log('[seed-j6] creating demo admin…');
  const user = await seedAdminUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    firstName: 'Eliot',
    lastName: 'Demo',
  });
  console.log(`[seed-j6] admin id=${user.id}`);

  console.log('[seed-j6] seeding 100 trades (deterministic seed=42)…');
  const trades = await seedTradeHistory(user.id, { count: 100, seed: 42 });
  console.log(
    `[seed-j6]   ${trades.count} trades — ${trades.closed} closed (${trades.computed} computed, ${trades.estimated} estimated), ${trades.open} open`,
  );

  console.log('[seed-j6] seeding 30 days of check-ins…');
  const checkins = await seedCheckinHistory(user.id, { days: 30, seed: 42 });
  console.log(
    `[seed-j6]   ${checkins.morning} morning + ${checkins.evening} evening (${checkins.bothSlots} dual-slot)`,
  );

  console.log('\n[seed-j6] done. Login with:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log('  url:      http://localhost:3000/login');
  console.log('\n[seed-j6] To populate the BehavioralScore snapshot, run:');
  console.log(
    '  curl -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/recompute-scores',
  );
}

main()
  .catch((err) => {
    console.error('[seed-j6] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
