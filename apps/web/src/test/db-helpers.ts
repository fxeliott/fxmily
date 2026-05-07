/**
 * E2E test database helpers (J5 follow-up — cross-jalon utility unblocked
 * after J5 merge).
 *
 * Bridges Playwright tests with the live Postgres dev DB so end-to-end
 * happy-paths can:
 *   1. Seed deterministic test users (member or admin) with a known password.
 *   2. Run the assertions against real data state.
 *   3. Clean up everything they touched (idempotent — safe to re-run).
 *
 * Conventions:
 *   - Test users have email `*.e2e.test@fxmily.local` (unique TLD `.local`).
 *     The cleanup helpers target that pattern only — never wipe real data.
 *   - Argon2id password hash is computed via the same `lib/auth/password`
 *     wrapper that the production Credentials provider uses, so the seeded
 *     hash will verify against the runtime sign-in path.
 *   - DB connections reuse the singleton `lib/db.ts`. No connection-pool
 *     juggling: one test process = one connection.
 *
 * Usage from Playwright:
 *
 *     import { seedMemberUser, cleanupTestUsers } from '@/test/db-helpers';
 *
 *     test.beforeEach(async () => {
 *       await cleanupTestUsers();
 *     });
 *
 *     test('member submits morning check-in', async ({ page }) => {
 *       const { email, password } = await seedMemberUser({ firstName: 'Alice' });
 *       // ...
 *     });
 */

import 'server-only';

import { nanoid } from 'nanoid';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

export const TEST_EMAIL_DOMAIN = 'e2e.test@fxmily.local';
const TEST_EMAIL_RE = /\.e2e\.test@fxmily\.local$/i;

export interface SeedUserOptions {
  /** Defaults to a random unique email under the test domain. */
  email?: string;
  /** Defaults to a random 16-char password (returned in the result). */
  password?: string;
  /** Defaults to "Alice". */
  firstName?: string;
  /** Defaults to "Test". */
  lastName?: string;
  /** Defaults to "Europe/Paris". */
  timezone?: string;
  /** Defaults to "active". */
  status?: 'active' | 'suspended' | 'deleted';
}

export interface SeededUser {
  id: string;
  email: string;
  password: string; // plaintext, for the test to log in with
  role: 'member' | 'admin';
  firstName: string;
  lastName: string;
  timezone: string;
}

/** Internal — seeds a user with the given role. */
async function seedUser(role: 'member' | 'admin', options: SeedUserOptions): Promise<SeededUser> {
  const email = options.email ?? `${nanoid(8).toLowerCase()}.${role}.e2e.test@fxmily.local`;
  const password = options.password ?? nanoid(16);
  const firstName = options.firstName ?? 'Alice';
  const lastName = options.lastName ?? 'Test';
  const timezone = options.timezone ?? 'Europe/Paris';
  const status = options.status ?? 'active';

  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: {
      email,
      firstName,
      lastName,
      passwordHash,
      role,
      status,
      timezone,
      consentRgpdAt: new Date(),
    },
    select: { id: true },
  });

  return {
    id: user.id,
    email,
    password,
    role,
    firstName,
    lastName,
    timezone,
  };
}

/** Seed an active member user. */
export function seedMemberUser(options: SeedUserOptions = {}): Promise<SeededUser> {
  return seedUser('member', options);
}

/** Seed an active admin user. */
export function seedAdminUser(options: SeedUserOptions = {}): Promise<SeededUser> {
  return seedUser('admin', options);
}

/**
 * Wipe all data touching test users (matches `*.e2e.test@fxmily.local`).
 *
 * Order matters because of FK constraints:
 *   1. notifications, audit logs, daily_checkins, trades, trade_annotations
 *      → cascade on User delete, but we delete-by-userId for explicitness.
 *   2. Sessions / accounts / invitations are also user-cascading.
 *   3. Finally, the users themselves.
 *
 * Idempotent: deleting from an empty set is a no-op.
 */
export async function cleanupTestUsers(): Promise<{ deleted: number }> {
  const users = await db.user.findMany({
    where: { email: { contains: '.e2e.test@fxmily.local' } },
    select: { id: true },
  });
  if (users.length === 0) return { deleted: 0 };
  const ids = users.map((u) => u.id);

  // Cascade-relations (some are already ON DELETE CASCADE in the schema, but
  // we explicit them so cleanup logs are obvious if a future migration drops
  // a cascade by accident).
  await db.notificationQueue.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.dailyCheckin.deleteMany({ where: { userId: { in: ids } } });
  // Trade annotations cascade through trades (admin-authored) and through
  // members (annotation.tradeId → trade.userId). Wipe annotations authored
  // by these admins first, then trades they own.
  await db.tradeAnnotation.deleteMany({
    where: { OR: [{ adminId: { in: ids } }, { trade: { userId: { in: ids } } }] },
  });
  await db.trade.deleteMany({ where: { userId: { in: ids } } });
  await db.invitation.deleteMany({ where: { invitedById: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.account.deleteMany({ where: { userId: { in: ids } } });

  const result = await db.user.deleteMany({ where: { id: { in: ids } } });
  return { deleted: result.count };
}

/** Type-guard for tests that want to verify they got a real test user. */
export function isTestUserEmail(email: string): boolean {
  return TEST_EMAIL_RE.test(email);
}

/**
 * Convenience for snapshot-style assertions: returns the latest checkin row
 * for a (user, date, slot) tuple, or null. Strips Decimal/Date fields to
 * primitive values for easy `expect.toMatchObject(...)`.
 */
export async function getLatestCheckin(
  userId: string,
  date: string,
  slot: 'morning' | 'evening',
): Promise<Record<string, unknown> | null> {
  const row = await db.dailyCheckin.findUnique({
    where: { userId_date_slot: { userId, date: new Date(`${date}T00:00:00.000Z`), slot } },
  });
  if (!row) return null;
  return {
    ...row,
    date: row.date.toISOString().slice(0, 10),
    sleepHours: row.sleepHours?.toString() ?? null,
    waterLiters: row.waterLiters?.toString() ?? null,
  };
}
