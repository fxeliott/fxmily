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

// Intentionally NO `import 'server-only'` here. Test helpers run in the
// Playwright Node runtime (vanilla ESM, no Next.js bundler) so the
// `'server-only'` shim wouldn't resolve. The file lives under `src/test/`
// which Next's tsconfig excludes from the build, so client bundles can
// never accidentally import it anyway.
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
  await db.behavioralScore.deleteMany({ where: { userId: { in: ids } } });
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

// =============================================================================
// J6 — Deterministic seed helpers for behavioral analytics (smoke + E2E)
// =============================================================================

/**
 * mulberry32 — tiny seedable PRNG. Produces a stable [0, 1) stream from a
 * 32-bit seed. We use it (instead of Math.random) so test runs are
 * reproducible: same seed = same trades = same scores.
 */
function makePrng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample N(mean, sd). */
function gauss(rand: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

const SEED_PAIRS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'NAS100', 'US30', 'USDJPY'];
const SEED_SESSIONS = ['asia', 'london', 'newyork', 'overlap'] as const;

const NEGATIVE_TRADE_TAGS = ['fomo', 'fear-loss', 'fear-wrong', 'frustrated'];
const POSITIVE_TRADE_TAGS = ['calm', 'focused', 'confident', 'disciplined'];

const NEGATIVE_CHECKIN_TAGS = ['fearful', 'fomo', 'frustrated', 'overwhelmed'];
const POSITIVE_CHECKIN_TAGS = ['calm', 'focused', 'rested', 'energetic', 'disciplined'];

export interface SeedTradeHistoryOptions {
  /** Number of trades to seed. Default 100. */
  count?: number;
  /** PRNG seed for reproducibility. Default 42. */
  seed?: number;
  /** Probability of a winning trade. Default 0.55. */
  winRate?: number;
  /** Mean realized R for winning trades (positive). Default 1.8. */
  avgWinR?: number;
  /** Mean realized R for losing trades (kept negative). Default -1.0. */
  avgLossR?: number;
  /** Probability of `realizedRSource='estimated'` (no stop-loss). Default 0.2. */
  estimatedRate?: number;
  /** Probability the trade stays open (not closed). Default 0.05. */
  openRate?: number;
  /** "realistic" → FOMO/fear bias on losses, calm bias on wins. */
  emotionCorrelation?: 'realistic' | 'none';
  /**
   * Anchor for the trade window. Trades will be spread evenly between
   * `endDate − count days` and `endDate`. Default = today.
   */
  endDate?: Date;
}

export interface SeedTradeHistoryResult {
  count: number;
  closed: number;
  open: number;
  computed: number;
  estimated: number;
}

/**
 * Seed N deterministic trades for a member. Used by smoke tests and the
 * dashboard demo flow to populate plausible analytics.
 *
 * The distribution is realistic but **synthetic** — no backtesting claim.
 * If you change defaults, document the rationale (a future J6 dev should
 * be able to read the test fixtures and trust them).
 */
export async function seedTradeHistory(
  userId: string,
  options: SeedTradeHistoryOptions = {},
): Promise<SeedTradeHistoryResult> {
  const {
    count = 100,
    seed = 42,
    winRate = 0.55,
    avgWinR = 1.8,
    avgLossR = -1.0,
    estimatedRate = 0.2,
    openRate = 0.05,
    emotionCorrelation = 'realistic',
    endDate = new Date(),
  } = options;

  const rand = makePrng(seed);
  const startMs = endDate.getTime() - count * 24 * 60 * 60 * 1000;
  const stepMs = (endDate.getTime() - startMs) / Math.max(count, 1);

  let closed = 0;
  let open = 0;
  let computedCount = 0;
  let estimatedCount = 0;

  for (let i = 0; i < count; i++) {
    const enteredAt = new Date(startMs + stepMs * i + Math.floor(rand() * stepMs));
    const isOpen = rand() < openRate;
    const willWin = rand() < winRate;
    const isEstimated = rand() < estimatedRate;

    const r = willWin ? gauss(rand, avgWinR, 0.6) : gauss(rand, avgLossR, 0.3);
    const clampedR = Math.max(-5, Math.min(5, r));

    const pair = SEED_PAIRS[i % SEED_PAIRS.length]!;
    const session = SEED_SESSIONS[i % SEED_SESSIONS.length]!;
    const direction = i % 2 === 0 ? 'long' : 'short';

    const entryPrice = 1.0 + rand() * 0.5;
    const lot = 0.1 + rand() * 0.4;
    const stopLossPrice = isEstimated ? null : entryPrice * (direction === 'long' ? 0.99 : 1.01);
    const plannedRR = 1.5 + rand() * 1.5;
    const exitPriceDelta = clampedR * Math.abs(entryPrice * 0.01);
    const exitPrice =
      direction === 'long' ? entryPrice + exitPriceDelta : entryPrice - exitPriceDelta;

    const planRespected = willWin ? rand() > 0.15 : rand() > 0.4;
    const hedgeRespected = rand() < 0.6 ? rand() > 0.2 : null;

    let emotionBefore: string[] = [];
    let emotionAfter: string[] = [];
    if (emotionCorrelation === 'realistic') {
      const pickNeg = () => NEGATIVE_TRADE_TAGS[Math.floor(rand() * NEGATIVE_TRADE_TAGS.length)]!;
      const pickPos = () => POSITIVE_TRADE_TAGS[Math.floor(rand() * POSITIVE_TRADE_TAGS.length)]!;
      // Wins skew positive, losses skew negative (60% bias).
      emotionBefore = [
        willWin ? (rand() < 0.6 ? pickPos() : pickNeg()) : rand() < 0.6 ? pickNeg() : pickPos(),
      ];
      emotionAfter = [willWin ? pickPos() : pickNeg()];
    } else {
      emotionBefore = [POSITIVE_TRADE_TAGS[i % POSITIVE_TRADE_TAGS.length]!];
      emotionAfter = [willWin ? 'calm' : 'frustrated'];
    }

    const closedAt = isOpen ? null : new Date(enteredAt.getTime() + 30 * 60 * 1000);
    const exitedAt = closedAt;

    const outcome = isOpen
      ? null
      : willWin
        ? 'win'
        : Math.abs(clampedR) < 0.1
          ? 'break_even'
          : 'loss';

    if (isOpen) {
      open++;
    } else {
      closed++;
      if (isEstimated) estimatedCount++;
      else computedCount++;
    }

    await db.trade.create({
      data: {
        userId,
        pair,
        direction,
        session,
        enteredAt,
        entryPrice,
        lotSize: lot,
        stopLossPrice,
        plannedRR,
        emotionBefore,
        planRespected,
        hedgeRespected,
        notes: null,
        screenshotEntryKey: null,
        ...(closedAt
          ? {
              exitedAt,
              exitPrice,
              outcome,
              realizedR: clampedR,
              realizedRSource: isEstimated ? 'estimated' : 'computed',
              emotionAfter,
              closedAt,
            }
          : {}),
      },
    });
  }

  return { count, closed, open, computed: computedCount, estimated: estimatedCount };
}

export interface SeedCheckinHistoryOptions {
  /** Number of days to seed. Default 30. */
  days?: number;
  /** PRNG seed. Default 42. */
  seed?: number;
  /** Probability that a given day has at least one check-in. Default 0.85. */
  fillRate?: number;
  /** Probability that a filled day has both morning + evening. Default 0.7. */
  bothSlotsRate?: number;
  /** Anchor day (local date YYYY-MM-DD). Default = today. */
  endDate?: string;
  /** Member's timezone (used to convert local YYYY-MM-DD → @db.Date). Default Europe/Paris. */
  timezone?: string;
}

export interface SeedCheckinHistoryResult {
  days: number;
  morning: number;
  evening: number;
  bothSlots: number;
}

/** Push a YYYY-MM-DD by N days (UTC math, since @db.Date stores midnight UTC). */
function shiftDay(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map((s) => Number(s));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function todayLocal(timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  return fmt.format(new Date());
}

/**
 * Seed `days` worth of daily check-ins for a member. Mood/sleep/stress are
 * generated as a random walk (autocorrelated, not IID) so dashboard charts
 * look "human" rather than uniformly noisy.
 */
export async function seedCheckinHistory(
  userId: string,
  options: SeedCheckinHistoryOptions = {},
): Promise<SeedCheckinHistoryResult> {
  const {
    days = 30,
    seed = 42,
    fillRate = 0.85,
    bothSlotsRate = 0.7,
    timezone = 'Europe/Paris',
  } = options;
  const endDate = options.endDate ?? todayLocal(timezone);
  const rand = makePrng(seed);

  // Random-walk state (mean-revert toward 6 with sd 1).
  let mood = 6;
  let sleep = 7;
  let stress = 4;

  let morningCount = 0;
  let eveningCount = 0;
  let bothCount = 0;

  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDay(endDate, -i);
    if (rand() > fillRate) continue;
    const both = rand() < bothSlotsRate;

    // Random-walk update with mean reversion.
    mood = clampNum(mood + gauss(rand, 0, 0.6) - 0.1 * (mood - 6), 1, 10);
    sleep = clampNum(sleep + gauss(rand, 0, 0.4) - 0.1 * (sleep - 7), 0, 10);
    stress = clampNum(stress + gauss(rand, 0, 0.5) - 0.1 * (stress - 4), 1, 10);

    const dateUtc = new Date(`${date}T00:00:00.000Z`);

    // Morning slot (always seeded).
    morningCount++;
    const morningTags =
      rand() < 0.3
        ? [POSITIVE_CHECKIN_TAGS[Math.floor(rand() * POSITIVE_CHECKIN_TAGS.length)]!]
        : [];
    await db.dailyCheckin.upsert({
      where: { userId_date_slot: { userId, date: dateUtc, slot: 'morning' } },
      create: {
        userId,
        date: dateUtc,
        slot: 'morning',
        sleepHours: sleep,
        sleepQuality: Math.round(clampNum(sleep, 1, 10)),
        morningRoutineCompleted: rand() > 0.3,
        meditationMin: rand() < 0.4 ? Math.round(rand() * 20) : null,
        sportType: rand() < 0.3 ? 'course' : null,
        sportDurationMin: rand() < 0.3 ? Math.round(rand() * 60) : null,
        intention: rand() < 0.5 ? 'Discipline avant tout.' : null,
        moodScore: Math.round(mood),
        emotionTags: morningTags,
        journalNote: null,
      },
      update: {},
    });

    if (both) {
      eveningCount++;
      bothCount++;
      const isStressed = stress > 6;
      const eveningTags = isStressed
        ? [NEGATIVE_CHECKIN_TAGS[Math.floor(rand() * NEGATIVE_CHECKIN_TAGS.length)]!]
        : rand() < 0.4
          ? [POSITIVE_CHECKIN_TAGS[Math.floor(rand() * POSITIVE_CHECKIN_TAGS.length)]!]
          : [];
      await db.dailyCheckin.upsert({
        where: { userId_date_slot: { userId, date: dateUtc, slot: 'evening' } },
        create: {
          userId,
          date: dateUtc,
          slot: 'evening',
          planRespectedToday: rand() > 0.25,
          hedgeRespectedToday: rand() < 0.6 ? rand() > 0.2 : null,
          caffeineMl: rand() < 0.7 ? Math.round(rand() * 600) : null,
          waterLiters: rand() < 0.7 ? 1 + rand() * 2 : null,
          stressScore: Math.round(stress),
          gratitudeItems: rand() < 0.4 ? ['Process before P&L'] : [],
          moodScore: Math.round(mood),
          emotionTags: eveningTags,
          journalNote: rand() < 0.3 ? 'Suivi mon plan, pas dévié.' : null,
        },
        update: {},
      });
    }
  }

  return { days, morning: morningCount, evening: eveningCount, bothSlots: bothCount };
}

function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
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
