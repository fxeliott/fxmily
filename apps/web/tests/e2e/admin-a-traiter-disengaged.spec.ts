import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { seedAdminUser, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';
import { db } from '@/lib/db';

/**
 * J6 scope 2 (verification pass) — the "Membres en décrochage" triage section on
 * `/admin/a-traiter`, exercised end-to-end against REAL Postgres through the real
 * rendered UI. This is the RUNTIME PROOF for pass/fail #2: a disengaged member
 * actually surfaces in the admin triage queue with a deep link to their fiche.
 *
 * It also closes the adversarial gap the verifier flagged: the cursor of
 * `listDisengagedMembers` is `lastSeenAt asc NULLS FIRST` + `id asc`, and NO test
 * exercised that nullable cursor at the NULL boundary against a real database
 * (the unit suite mocks `@/lib/db`). Describe 2 drives the real 26-member
 * pagination across the null bucket through the real `?dm=<cursor>` URL and
 * asserts no member is skipped or repeated at the boundary.
 *
 * CANON (must not regress):
 *  - Never import `lib/admin/attention-service.ts` here — it starts with
 *    `import 'server-only'` (Playwright has no server-only alias → crash). The
 *    service is exercised INDIRECTLY through the rendered page; this spec touches
 *    Prisma only via `@/lib/db` and the `@/test/*` helpers.
 *  - No `networkidle` against the dev server (Turbopack HMR socket never settles);
 *    every assertion gates on an auto-waiting `expect(locator)`.
 *  - Targeted per-id cleanup only — NEVER `cleanupTestUsers()` (it would nuke the
 *    150 seeded cohort fixtures the verify DB ships with).
 */

const DAY_MS = 86_400_000;

/** Rows in the disengaged section carry this exact aria-label suffix (page.tsx). */
const DISENGAGED_LABEL_SUFFIX = '(membre en décrochage)';

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

/**
 * Member ids of the disengaged rows, in DOM (render) order. Keyed on the
 * aria-label suffix that is UNIQUE to the disengaged section, so other triage
 * sections that may also deep-link members can never pollute the result.
 */
async function disengagedMemberIdsInOrder(page: Page): Promise<string[]> {
  return page.$$eval(`main a[aria-label$="${DISENGAGED_LABEL_SUFFIX}"]`, (anchors) =>
    anchors
      .map((a) => a.getAttribute('href') ?? '')
      .map((href) => href.split('/admin/members/')[1] ?? '')
      .map((seg) => seg.split(/[/?#]/)[0] ?? '')
      .filter((id) => id.length > 0),
  );
}

test.describe('J6 scope 2 — /admin/a-traiter : membres en décrochage (preuve runtime)', () => {
  let admin: SeededUser | null = null;
  let neverSeen: SeededUser | null = null;
  let longAbsent: SeededUser | null = null;

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    const now = Date.now();
    admin = await seedAdminUser({ firstName: 'DisAdmin' });

    // Never-seen new joiner: lastSeenAt stays NULL, joined before the 7-day floor
    // → disengaged via the NULL branch, and sorts FIRST (NULLS FIRST).
    neverSeen = await seedMemberUser({ firstName: 'NeverSeenNull' });
    await db.user.update({
      where: { id: neverSeen.id },
      data: { joinedAt: new Date(now - 30 * DAY_MS) },
    });

    // Long-absent member: lastSeenAt well before the floor → disengaged via the
    // lastSeenAt<floor branch, sorts AFTER the null bucket.
    longAbsent = await seedMemberUser({ firstName: 'LongAbsentOld' });
    await db.user.update({
      where: { id: longAbsent.id },
      data: { lastSeenAt: new Date(now - 20 * DAY_MS) },
    });
  });

  test.afterAll(async () => {
    const ids = [admin?.id, neverSeen?.id, longAbsent?.id].filter(
      (id): id is string => typeof id === 'string',
    );
    if (ids.length > 0) {
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
    admin = null;
    neverSeen = null;
    longAbsent = null;
  });

  test('un membre en décrochage remonte dans la section, avec lien vers sa fiche, NULLS FIRST en tête', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!admin || !neverSeen || !longAbsent) {
      throw new Error('seed missing — beforeAll did not run');
    }

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto('/admin/a-traiter');

    // pass/fail #2: both disengaged members surface with a deep link to their fiche.
    await expect(page.locator(`main a[href$="/admin/members/${neverSeen.id}"]`)).toBeVisible();
    await expect(page.locator(`main a[href$="/admin/members/${longAbsent.id}"]`)).toBeVisible();

    // The rows belong to the disengaged section (unique aria-label suffix), not to
    // another triage section that happens to link a member.
    await expect(page.locator(`main a[aria-label$="${DISENGAGED_LABEL_SUFFIX}"]`)).toHaveCount(2);

    // NULLS FIRST: the never-seen member (null lastSeenAt) renders BEFORE the
    // long-absent one (non-null lastSeenAt) in DOM order.
    const order = await disengagedMemberIdsInOrder(page);
    const idxNeverSeen = order.indexOf(neverSeen.id);
    const idxLongAbsent = order.indexOf(longAbsent.id);
    expect(idxNeverSeen, 'never-seen member present in disengaged section').toBeGreaterThanOrEqual(
      0,
    );
    expect(
      idxLongAbsent,
      'long-absent member present in disengaged section',
    ).toBeGreaterThanOrEqual(0);
    expect(
      idxNeverSeen,
      'NULLS FIRST — never-seen (null lastSeenAt) must sort before long-absent',
    ).toBeLessThan(idxLongAbsent);
  });
});

test.describe('J6 scope 2 — curseur nullable au bord NULL (26 membres, pagination réelle)', () => {
  const DISENGAGED_COUNT = 26; // one full page (25) + 1 → forces a page boundary IN the null bucket
  let admin: SeededUser | null = null;
  const memberIds: string[] = [];

  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    admin = await seedAdminUser({ firstName: 'DisAdminPage' });

    for (let i = 0; i < DISENGAGED_COUNT; i += 1) {
      const member = await seedMemberUser({ firstName: `DisPage${i}` });
      memberIds.push(member.id);
    }

    // All 26 keep lastSeenAt = NULL and are back-dated before the 7-day floor:
    // every row lands in the NULL bucket, so the page-1→page-2 cursor boundary
    // falls squarely inside NULLS FIRST — exactly where a nullable cursor can
    // silently skip or repeat a row.
    await db.user.updateMany({
      where: { id: { in: memberIds } },
      data: { joinedAt: new Date(Date.now() - 30 * DAY_MS) },
    });
  });

  test.afterAll(async () => {
    const ids = [admin?.id, ...memberIds].filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) {
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  test('la pagination du curseur nullable ne saute ni ne répète aucun membre au bord NULL', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!admin) throw new Error('seed missing — beforeAll did not run');
    const seeded = new Set(memberIds);

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    // --- Page 1: full page of 25 disengaged rows. ---
    await page.goto('/admin/a-traiter');
    await expect(
      page.locator(`main a[aria-label$="${DISENGAGED_LABEL_SUFFIX}"]`).first(),
    ).toBeVisible();

    const page1All = await disengagedMemberIdsInOrder(page);
    const page1 = page1All.filter((id) => seeded.has(id));
    expect(page1.length, 'page 1 shows a full page of 25 seeded disengaged rows').toBe(25);

    // The disengaged "Voir plus" link carries the real cursor (?dm=<id>). Only the
    // disengaged section emits `dm=`, so this uniquely targets its next-page link.
    const moreHref = await page.locator('main a[href*="dm="]').first().getAttribute('href');
    expect(moreHref, 'disengaged section must offer a Voir plus cursor link').toBeTruthy();

    // --- Page 2: follow the real cursor URL across the null boundary. ---
    await page.goto(moreHref as string);
    await expect(
      page.locator(`main a[aria-label$="${DISENGAGED_LABEL_SUFFIX}"]`).first(),
    ).toBeVisible();

    const page2All = await disengagedMemberIdsInOrder(page);
    const page2 = page2All.filter((id) => seeded.has(id));
    expect(page2.length, 'page 2 shows the remaining seeded disengaged row').toBe(1);

    // No repeat at the boundary: page 1 and page 2 are disjoint.
    const overlap = page2.filter((id) => page1.includes(id));
    expect(overlap, 'nullable cursor must not REPEAT a member across the null boundary').toEqual(
      [],
    );

    // No skip at the boundary: the union covers all 26 seeded members exactly.
    const union = new Set([...page1, ...page2]);
    expect(
      union.size,
      'nullable cursor must not SKIP a member — union of page 1 + page 2 covers all 26',
    ).toBe(DISENGAGED_COUNT);
  });
});
