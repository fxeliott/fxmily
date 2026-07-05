/**
 * Seed the "Démo" member account — a fully populated, multi-day demo so every
 * member surface (dashboard, /progression, /patterns, /objectifs, coaching,
 * verification, training, calendar, reports…) renders with real, evolving data.
 *
 * Idempotent: wipes and re-creates ONLY `demo@fxmily.local` (real members are
 * never touched). Self-contained: needs only DATABASE_URL (Pattern A — local
 * PrismaClient + argon2, no AUTH_SECRET / server-only coupling).
 *
 * Usage (from D:\Fxmily):
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-demo.ts
 *
 * Mark Douglas cards must already be seeded (scripts/seed-mark-douglas-cards.ts);
 * the coaching module references published cards by slug/category.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/auth/password.js';
import { DEMO, WINDOW_DAYS, SEED, makePrng, type SeedCtx, type DB } from './demo/_shared.js';
import {
  seedTrades,
  seedCheckins,
  seedBehavioralScores,
  seedHabitLogs,
  seedOffDays,
} from './demo/core.js';
import { seedOnboarding } from './demo/onboarding.js';
import { seedCoaching } from './demo/coaching.js';
import { seedVerification } from './demo/verification.js';
import { seedReflection } from './demo/reflection.js';
import { seedReports } from './demo/reports.js';
import { seedPractice } from './demo/practice.js';
import { seedDailyExtras } from './demo/daily-extras.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-demo] DATABASE_URL is required. See script header.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const db: DB = new PrismaClient({ adapter });

/** Wipe the demo account (User cascade removes all user-scoped rows). */
async function wipeDemo(): Promise<void> {
  const existing = await db.user.findUnique({ where: { email: DEMO.email }, select: { id: true } });
  if (!existing) return;
  // MeetingAttendance cascades on User delete; the global Meeting rows are
  // re-used (upserted) by the practice module, so we leave them in place.
  await db.user.delete({ where: { id: existing.id } });
  console.log('[seed-demo] wiped previous demo account');
}

async function createDemoUser(): Promise<string> {
  const passwordHash = await hashPassword(DEMO.password);
  const now = new Date();
  const joinedAt = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const user = await db.user.create({
    data: {
      email: DEMO.email,
      firstName: DEMO.firstName,
      lastName: DEMO.lastName,
      passwordHash,
      role: 'member',
      status: 'active',
      timezone: DEMO.timezone,
      // Tour 14 — the demo member keeps weekends off (the product default), so
      // the dashboard/heatmap/reports show the "pont" behaviour out of the box.
      weekendsOff: true,
      emailVerified: joinedAt,
      consentRgpdAt: joinedAt,
      joinedAt,
      lastSeenAt: now,
    },
    select: { id: true },
  });
  return user.id;
}

async function main() {
  console.log('[seed-demo] starting…');
  await wipeDemo();

  const userId = await createDemoUser();
  console.log(`[seed-demo] created member ${DEMO.email} (id=${userId})`);

  const ctx: SeedCtx = {
    db,
    userId,
    now: new Date(),
    rand: makePrng(SEED),
    log: (msg: string) => console.log(msg),
  };

  // Order matters: core first (trades/check-ins/scores are read by later
  // derived surfaces), then onboarding (axes), then everything else.
  const steps: Array<[string, (c: SeedCtx) => Promise<Record<string, number>>]> = [
    ['core: trades', seedTrades],
    ['core: check-ins', seedCheckins],
    ['core: off days', seedOffDays],
    ['core: behavioral scores', seedBehavioralScores],
    ['core: habit logs', seedHabitLogs],
    ['onboarding profile', seedOnboarding],
    ['coaching (Mark Douglas)', seedCoaching],
    ['verification (MT5/honesty)', seedVerification],
    ['reflection & mindset', seedReflection],
    ['AI reports', seedReports],
    ['practice & meetings', seedPractice],
    ['daily extras', seedDailyExtras],
  ];

  const summary: Record<string, number> = {};
  for (const [label, fn] of steps) {
    console.log(`[seed-demo] ${label}…`);
    const res = await fn(ctx);
    for (const [k, v] of Object.entries(res)) summary[k] = (summary[k] ?? 0) + v;
  }

  console.log('\n[seed-demo] ✅ done. Summary:');
  console.table(summary);
  console.log('\n[seed-demo] Login with:');
  console.log(`  email:    ${DEMO.email}`);
  console.log(`  password: ${DEMO.password}`);
  console.log('  url:      http://localhost:3000/login');
}

main()
  .catch((err) => {
    console.error('[seed-demo] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
