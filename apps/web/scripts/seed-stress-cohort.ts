/**
 * Seed a disposable Postgres with a 1000-member leaderboard cohort for the J7
 * stress-test "S3 — leaderboard read at scale" EXPLAIN proof.
 *
 * The read path we want to stress is `getLeaderboardBoard(viewerId)` in
 * `src/lib/leaderboard/service.ts`:
 *
 *     db.leaderboardSnapshot.findMany({
 *       where: { date, user: { status: 'active' } },
 *       orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }],
 *       select: { userId, score, rank, status, components, sampleSize,
 *         user: { firstName, lastName, avatarKey, image, leaderboardOptOut } },
 *     })
 *
 * covered by `@@index([date, rank])`. To EXPLAIN it at realistic scale we need
 * ~1000 `LeaderboardSnapshot` rows for ONE anchor date whose `user` join
 * resolves to `status='active'` members. The scoring/leaderboard services carry
 * `import 'server-only'` (un-loadable by tsx), so this script writes the
 * snapshot rows DIRECTLY via `db.leaderboardSnapshot.createMany` with hand-built
 * `components` / `sampleSize` JSON that mirror the canonical
 * `LeaderboardComponentsJson` / `LeaderboardSampleSizeJson` shapes
 * (`src/lib/leaderboard/types.ts`).
 *
 * ⚠️ Run ONLY against the disposable verify DB (port 55432), NEVER the real dev
 * DB on 5432 (this inserts 1000 throwaway users):
 *   DATABASE_URL="postgresql://postgres:verify@localhost:55432/fxmily_j7?schema=public" \
 *   AUTH_SECRET="<32+ chars>" AUTH_URL="http://localhost:3000" \
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-stress-cohort.ts
 *
 * Deterministic (seed=42). Idempotent: cleans every `.e2e.test@fxmily.local`
 * user first (User cascade + explicit `leaderboardSnapshot.deleteMany` remove
 * their snapshots), then re-seeds a fresh cohort.
 */

import { hashPassword } from '../src/lib/auth/password.js';
import { db } from '../src/lib/db.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { cleanupTestUsers } from '../src/test/db-helpers.js';

// ---- hard guard: NEVER touch the real dev DB on 5432 ------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-stress] DATABASE_URL is required.');
  process.exit(1);
}
// This seeds 1000 throwaway members. Refuse anything but the disposable verify
// DB on port 55432 (mirror `scripts/j6-explain-cohort.ts`).
if (!DATABASE_URL.includes(':55432/')) {
  console.error(
    '[seed-stress] refusing to run: DATABASE_URL must target the disposable verify DB on port 55432.',
  );
  process.exit(1);
}

// ---- sizing knobs -----------------------------------------------------------
const NUM_MEMBERS = 1000;
const RANKED_FRACTION = 0.95; // ~95% qualify (rank set), ~5% insufficient_data (rank null)
const CREATE_CHUNK = 500; // batch size for createMany
const LEADERBOARD_WINDOW_DAYS = 30;
const LEADERBOARD_MIN_ACTIVE_DAYS = 7;
const EMAIL_PREFIX = 'stress-cohort-';

// Pillar weights (mirror src/lib/leaderboard/builder.ts).
const WEIGHT_ASSIDUITY = 35;
const WEIGHT_DISCIPLINE = 30;
const WEIGHT_REGULARITY = 20;
const WEIGHT_WORK = 15;

const FIRST_NAMES = [
  'Alice',
  'Bruno',
  'Camille',
  'David',
  'Elodie',
  'Fabien',
  'Gaëlle',
  'Hugo',
  'Inès',
  'Julien',
  'Karim',
  'Laura',
  'Mathis',
  'Nadia',
  'Olivier',
  'Priya',
];
const LAST_NAMES = [
  'Martin',
  'Bernard',
  'Dubois',
  'Thomas',
  'Robert',
  'Petit',
  'Durand',
  'Leroy',
  'Moreau',
  'Simon',
];

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

const asJson = <T>(value: T): Prisma.InputJsonValue => value as unknown as Prisma.InputJsonValue;

/** Build one leaderboard `SubScore` (mirror `valueSubScore` output shape). */
function pillarSub(score0to100: number, weight: number) {
  const rate = score0to100 / 100;
  return {
    rate,
    pointsAwarded: Math.round(rate * weight * 100) / 100,
    pointsMax: weight,
    numerator: Math.round(score0to100),
    denominator: 100,
  };
}

/** Local Paris day (YYYY-MM-DD) → UTC-midnight Date for the `@db.Date` anchor. */
function parisAnchorDate(): { iso: string; date: Date } {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  return { iso, date: new Date(`${iso}T00:00:00.000Z`) };
}

async function main() {
  const rand = makePrng(42);
  const { iso: anchorIso, date: anchorDate } = parisAnchorDate();

  console.log('[seed-stress] cleaning up prior test users…');
  const cleaned = await cleanupTestUsers();
  console.log(`[seed-stress]   removed ${cleaned.deleted} test users`);

  // Hash the throwaway password ONCE (these members never sign in; a shared
  // valid argon2id hash keeps the seed fast — no 1000× hashing).
  console.log('[seed-stress] hashing shared throwaway password…');
  const passwordHash = await hashPassword('stress-cohort-verify-only');

  const consentRgpdAt = new Date();
  const userRows = Array.from({ length: NUM_MEMBERS }, (_, i) => ({
    email: `${EMAIL_PREFIX}${String(i).padStart(4, '0')}.member.e2e.test@fxmily.local`,
    firstName: FIRST_NAMES[i % FIRST_NAMES.length]!,
    lastName: LAST_NAMES[(i * 7) % LAST_NAMES.length]!,
    passwordHash,
    role: 'member' as const,
    status: 'active' as const,
    timezone: 'Europe/Paris',
    consentRgpdAt,
    weekendsOff: false,
  }));

  console.log(`[seed-stress] inserting ${NUM_MEMBERS} members…`);
  for (let i = 0; i < userRows.length; i += CREATE_CHUNK) {
    const chunk = userRows.slice(i, i + CREATE_CHUNK);
    await db.user.createMany({ data: chunk, skipDuplicates: true });
    console.log(`[seed-stress]   …${Math.min(i + CREATE_CHUNK, userRows.length)}/${NUM_MEMBERS}`);
  }

  // Fetch the ids back in a STABLE order (email asc) so scores are deterministic.
  const members = await db.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
    orderBy: { email: 'asc' },
  });
  console.log(`[seed-stress]   ${members.length} members fetched`);

  // Assign a deterministic composite score per member.
  const rankedCount = Math.round(NUM_MEMBERS * RANKED_FRACTION);
  const scored = members.map((m, idx) => {
    const ranked = idx < rankedCount;
    // Four pillar scores in [40, 100] for ranked members (realistic spread).
    const assiduity = 40 + rand() * 60;
    const discipline = 40 + rand() * 60;
    const regularity = 40 + rand() * 60;
    const work = 40 + rand() * 60;
    const composite =
      (assiduity * WEIGHT_ASSIDUITY +
        discipline * WEIGHT_DISCIPLINE +
        regularity * WEIGHT_REGULARITY +
        work * WEIGHT_WORK) /
      100;
    const activeDays = 7 + Math.floor(rand() * (LEADERBOARD_WINDOW_DAYS - 7 + 1));
    return { id: m.id, ranked, assiduity, discipline, regularity, work, composite, activeDays };
  });

  // Rank the qualifying members by composite score desc → rank 1..rankedCount.
  const ranked = scored.filter((s) => s.ranked).sort((a, b) => b.composite - a.composite);
  const rankByUser = new Map<string, number>();
  ranked.forEach((s, i) => rankByUser.set(s.id, i + 1));

  const snapshotRows = scored.map((s) => {
    if (!s.ranked) {
      // Insufficient-data member: score/rank null, pillars null, nulls-last order.
      const components = {
        score: {
          score: null,
          status: 'insufficient_data',
          reason: 'window_short',
          parts: { assiduity: null, discipline: null, regularity: null, work: null },
          sample: { days: s.activeDays, sufficient: false },
        },
      };
      const sampleSize = {
        activeDays: s.activeDays,
        windowDays: LEADERBOARD_WINDOW_DAYS,
        activePillars: 0,
        minActiveDays: LEADERBOARD_MIN_ACTIVE_DAYS,
      };
      return {
        userId: s.id,
        date: anchorDate,
        score: null,
        rank: null,
        components: asJson(components),
        sampleSize: asJson(sampleSize),
        windowDays: LEADERBOARD_WINDOW_DAYS,
        status: 'insufficient_data',
        computedAt: consentRgpdAt,
      };
    }

    const scoreInt = Math.round(s.composite);
    const components = {
      score: {
        score: scoreInt,
        status: 'ok',
        parts: {
          assiduity: pillarSub(s.assiduity, WEIGHT_ASSIDUITY),
          discipline: pillarSub(s.discipline, WEIGHT_DISCIPLINE),
          regularity: pillarSub(s.regularity, WEIGHT_REGULARITY),
          work: pillarSub(s.work, WEIGHT_WORK),
        },
        sample: { days: s.activeDays, sufficient: true },
      },
    };
    const sampleSize = {
      activeDays: s.activeDays,
      windowDays: LEADERBOARD_WINDOW_DAYS,
      activePillars: 4,
      minActiveDays: LEADERBOARD_MIN_ACTIVE_DAYS,
    };
    return {
      userId: s.id,
      date: anchorDate,
      score: scoreInt,
      rank: rankByUser.get(s.id)!,
      components: asJson(components),
      sampleSize: asJson(sampleSize),
      windowDays: LEADERBOARD_WINDOW_DAYS,
      status: 'ok',
      computedAt: consentRgpdAt,
    };
  });

  console.log(
    `[seed-stress] inserting ${snapshotRows.length} leaderboard snapshots (${anchorIso})…`,
  );
  for (let i = 0; i < snapshotRows.length; i += CREATE_CHUNK) {
    const chunk = snapshotRows.slice(i, i + CREATE_CHUNK);
    await db.leaderboardSnapshot.createMany({ data: chunk, skipDuplicates: true });
    console.log(
      `[seed-stress]   …${Math.min(i + CREATE_CHUNK, snapshotRows.length)}/${snapshotRows.length}`,
    );
  }

  // Report the row/selectivity picture that matters for the planner.
  const rankedScores = ranked.map((s) => Math.round(s.composite));
  const insufficient = snapshotRows.length - ranked.length;
  console.log('\n[seed-stress] summary:');
  console.log(`  anchor date ............. ${anchorIso} (Europe/Paris local day)`);
  console.log(`  members ................. ${members.length}`);
  console.log(`  snapshots ............... ${snapshotRows.length}`);
  console.log(`  ranked (status='ok') .... ${ranked.length}  ranks 1..${ranked.length}`);
  console.log(`  insufficient_data ....... ${insufficient} (rank NULL)`);
  console.log(
    `  score spread ............ min ${Math.min(...rankedScores)} / max ${Math.max(...rankedScores)}`,
  );
}

main()
  .catch((err) => {
    console.error('[seed-stress] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
