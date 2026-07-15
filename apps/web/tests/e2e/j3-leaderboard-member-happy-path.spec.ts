/**
 * J3 "Classement pour tous" — MEMBER happy-path E2E.
 *
 * Proves at runtime, against a REAL dev server + REAL Postgres, that the
 * `/classement` leaderboard behaves correctly from the MEMBER point of view:
 *   1. a ranked member sees their own rank ("mon rang" MyRankCard);
 *   2. a member in qualification appears in the "En qualification" section;
 *   3. an opted-out member is HIDDEN from OTHER viewers, but ALWAYS sees their
 *      own row (isViewer) — the symmetric opt-out guard (service.ts:505 ranked +
 *      service.ts:514 qualifying, identical `(!leaderboardOptOut || isViewer)`);
 *   4. the opt-out toggle on `/account/visibilite` persists to the DB AND flips
 *      the member's presence on OTHER viewers' `/classement` render.
 *
 * SCAR GG-CI: this spec imports ONLY `@/lib/db` + `@/test/*` helpers +
 * `@/lib/checkin/timezone` (pure). It NEVER imports a `server-only` module
 * (`src/lib/leaderboard/service.ts` has `import 'server-only'` at line 1) —
 * that would crash the Playwright Node runtime. All feature behavior is asserted
 * via the RENDERED UI of `/classement`, never via the service.
 *
 * Self-cleaning: `cleanupTestUsers` wipes seeded users AND their leaderboard
 * snapshots (ON DELETE CASCADE, made explicit in db-helpers for log-visibility).
 */
import { expect, test } from '@playwright/test';

import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

// The `@db.Date` board anchor — UTC-midnight of the local Paris day, NEVER
// `toISOString().slice(0,10)` (which would drift one day west of UTC).
const boardDate = parseLocalDate(localDateOf(new Date(), 'Europe/Paris'));

/** A valid ranked-member `components` JSON (mirrors builder.ts `computeLeaderboardScore` "ok"). */
function rankedComponents(score: number, activeDays: number) {
  return {
    score: {
      score,
      status: 'ok' as const,
      parts: {
        assiduity: { rate: score / 100, pointsAwarded: (score / 100) * 35, pointsMax: 35 },
        discipline: { rate: score / 100, pointsAwarded: (score / 100) * 30, pointsMax: 30 },
        regularity: { rate: score / 100, pointsAwarded: (score / 100) * 20, pointsMax: 20 },
        work: { rate: score / 100, pointsAwarded: (score / 100) * 15, pointsMax: 15 },
      },
      sample: { days: activeDays, sufficient: true },
    },
  };
}

/** A valid qualifying-member `components` JSON (mirrors builder.ts "insufficient_data"). */
function qualifyingComponents(activeDays: number) {
  return {
    score: {
      score: null,
      status: 'insufficient_data' as const,
      reason: 'window_short' as const,
      parts: { assiduity: null, discipline: null, regularity: null, work: null },
      sample: { days: activeDays, sufficient: false },
    },
  };
}

function sampleSizeJson(activeDays: number, activePillars: number) {
  return { activeDays, windowDays: 30, activePillars, minActiveDays: 7 };
}

async function seedSnapshot(
  userId: string,
  opts: { rank: number | null; score: number | null; activeDays: number },
) {
  const ranked = opts.rank !== null;
  await db.leaderboardSnapshot.upsert({
    where: { userId_date: { userId, date: boardDate } },
    update: {},
    create: {
      userId,
      date: boardDate,
      score: opts.score,
      rank: opts.rank,
      status: ranked ? 'ok' : 'insufficient_data',
      windowDays: 30,
      components: ranked
        ? (rankedComponents(opts.score ?? 0, opts.activeDays) as object)
        : (qualifyingComponents(opts.activeDays) as object),
      sampleSize: ranked
        ? (sampleSizeJson(opts.activeDays, 4) as object)
        : (sampleSizeJson(opts.activeDays, 0) as object),
    },
  });
}

async function setOptOut(userId: string, optOut: boolean) {
  await db.user.update({ where: { id: userId }, data: { leaderboardOptOut: optOut } });
}

// Shared cohort seeded once for the whole board.
let memberRanked: SeededUser; // primary logged-in viewer, rank 1
let optOutRanked: SeededUser; // rank 2, leaderboardOptOut = true (hidden from others, sees self)
let qualifying: SeededUser; // rank null → "En qualification"

test.beforeAll(async () => {
  await cleanupTestUsers();

  memberRanked = await seedMemberUser({ firstName: 'Rachel' });
  optOutRanked = await seedMemberUser({ firstName: 'Octave' });
  qualifying = await seedMemberUser({ firstName: 'Quentin' });
  const filler1 = await seedMemberUser({ firstName: 'Fabien' });
  const filler2 = await seedMemberUser({ firstName: 'Gaston' });

  await seedSnapshot(memberRanked.id, { rank: 1, score: 88, activeDays: 24 });
  await seedSnapshot(optOutRanked.id, { rank: 2, score: 81, activeDays: 22 });
  await seedSnapshot(filler1.id, { rank: 3, score: 74, activeDays: 20 });
  await seedSnapshot(filler2.id, { rank: 4, score: 66, activeDays: 18 });
  await seedSnapshot(qualifying.id, { rank: null, score: null, activeDays: 3 });

  await setOptOut(optOutRanked.id, true);
});

test.afterAll(async () => {
  // cleanupTestUsers deletes the seeded users AND their leaderboard snapshots
  // (ON DELETE CASCADE, made explicit in db-helpers for log-visibility).
  await cleanupTestUsers();
});

test('MEMBER 1+2+3 — mon rang, qualification section, opt-out hidden from other viewers', async ({
  page,
  request,
}) => {
  await loginAs(page, request, memberRanked.email, memberRanked.password);
  await page.goto('/classement');

  // Page renders.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Le classement des membres' }),
  ).toBeVisible();

  // (3) "mon rang" widget — MyRankCard shows the viewer's rank chip "Ni sur M".
  await expect(page.getByText(/\bsur\s+4\b/).first()).toBeVisible();

  // (1) "En qualification" section is present with the qualifying member.
  await expect(page.getByRole('heading', { name: 'En qualification' })).toBeVisible();
  const qualifyingSection = page.locator('section[aria-label="En qualification"]');
  await expect(qualifyingSection.getByText('Quentin')).toBeVisible();

  // (2a) The opted-out ranked member (Octave) is HIDDEN from this OTHER viewer.
  await expect(page.getByText('Octave')).toHaveCount(0);

  // The visible ranked cohort still shows the other members.
  await expect(page.getByText('Fabien')).toBeVisible();
  await expect(page.getByText('Gaston')).toBeVisible();
});

test('MEMBER 2b — an opted-out member ALWAYS sees their own row (isViewer)', async ({
  page,
  request,
}) => {
  await loginAs(page, request, optOutRanked.email, optOutRanked.password);
  await page.goto('/classement');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Le classement des membres' }),
  ).toBeVisible();
  // Octave is opted out, but their OWN MyRankCard (rank 2 → "2e sur 4") is shown.
  await expect(page.getByText(/\bsur\s+4\b/).first()).toBeVisible();
});

test('MEMBER 4 — opt-out toggle on /account/visibilite persists AND flips /classement render', async ({
  page,
  request,
}) => {
  // Seed a fresh participating (opt-in) ranked member for this scenario.
  const toggler = await seedMemberUser({ firstName: 'Tania' });
  await seedSnapshot(toggler.id, { rank: 5, score: 60, activeDays: 16 });
  await setOptOut(toggler.id, false);

  // Sanity: another viewer (memberRanked) currently SEES Tania on the board.
  await loginAs(page, request, memberRanked.email, memberRanked.password);
  await page.goto('/classement');
  await expect(page.getByText('Tania')).toBeVisible();

  // Tania logs in (separate browser context) and turns OFF her participation via
  // the real UI toggle.
  const tContext = await page.context().browser()!.newContext();
  const tab = await tContext.newPage();
  await loginAs(tab, tab.request, toggler.email, toggler.password);
  await tab.goto('/account/visibilite');

  const switchBtn = tab.getByRole('switch', {
    name: 'Je participe au classement des membres',
  });
  await expect(switchBtn).toHaveAttribute('aria-checked', 'true');
  await switchBtn.click();
  // Optimistic flip + Server Action confirmation copy.
  await expect(switchBtn).toHaveAttribute('aria-checked', 'false');
  await expect(
    tab.getByText("Tu n'apparais plus sur le classement des autres membres.", { exact: false }),
  ).toBeVisible();

  // Persistence: the DB column is now true.
  await expect
    .poll(async () => {
      const row = await db.user.findUnique({
        where: { id: toggler.id },
        select: { leaderboardOptOut: true },
      });
      return row?.leaderboardOptOut;
    })
    .toBe(true);

  await tContext.close();

  // Render flip: the other viewer no longer sees Tania on /classement.
  await page.goto('/classement');
  await expect(page.getByText('Tania')).toHaveCount(0);
});
