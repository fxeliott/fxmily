/**
 * J6 scope 5 — RUNTIME proof that a REAL member's replay visit RECORDS a
 * `ReplayView` (the recording path the admin "Vu par X/N" badge counts).
 *
 * `admin-seance-views.spec.ts` proves the badge RENDERS from a PRE-SEEDED row —
 * it never exercises the member's actual visit. This spec closes that gap from
 * the MEMBER's seat, driving `SeancePage` → `after()` → `recordReplayView`:
 *
 *   A. a member opening a published replay creates exactly ONE ReplayView
 *      (`viewCount` 1); a re-open increments `viewCount` but stays ONE distinct
 *      row (upsert dedup on `(sessionId, userId)`), so "distinct viewers" can
 *      never be inflated by a member refreshing the page.
 *   B. an ADMIN opening the same replay records NOTHING — the `role === 'member'`
 *      guard keeps admins previewing the page out of the coverage numerator.
 *   C. a CANCELLED séance records NOTHING even for a member (`status` guard).
 *
 * Recording runs in `after()` (post-response), so the DB assertions poll with a
 * bounded timeout. A FIXED far-past `(date, slot)` key is used so this can never
 * collide with the today-keyed séance specs when CI shards share one Postgres.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test, type Page } from './fixtures';

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

// Far-past, test-owned key — impossible to collide with the today-keyed
// `admin-seance-views` (analyse) / `seances-admin-runtime` (debrief) cells.
const TEST_DATE = '2019-06-15';
const PUBLISHED_SLOT = 'analyse' as const;
const CANCELLED_SLOT = 'debrief' as const;

let admin: SeededUser | null = null;
let member: SeededUser | null = null;
let publishedId: string | null = null;
let cancelledId: string | null = null;

async function cleanupTestCells(): Promise<void> {
  await db.replaySession.deleteMany({ where: { date: parseLocalDate(TEST_DATE) } });
}

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once.`,
    };
  }
  return { ok: true };
}

function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const ALLOW = [
    /React DevTools/i,
    /favicon/i,
    /Download the React/i,
    // WebKit (iPhone project) refuses to register the PWA service worker over
    // plain-http localhost ("sw.js due to access control checks"). It registers
    // fine in prod (HTTPS) — a test-harness artefact, never a member-facing error.
    /sw\.js/i,
    /access control checks/i,
    // Turbopack DEV serves `next/dynamic` islands (e.g. the nav command-palette,
    // unrelated to J6) as on-demand chunks; a fast double-navigation can race a
    // cold chunk compile → "Failed to load chunk …". Prod ships pre-built,
    // content-hashed chunks, so this cannot happen to a member — dev-only flake.
    /Failed to load chunk/i,
  ];
  const isAllowed = (text: string): boolean => ALLOW.some((re) => re.test(text));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isAllowed(text)) return;
    errors.push(text);
  });
  // The allow-list must guard BOTH surfaces: uncaught page errors and console
  // errors alike carry the same dev/WebKit artefacts.
  page.on('pageerror', (err) => {
    const text = `pageerror: ${err.message}`;
    if (isAllowed(text)) return;
    errors.push(text);
  });
  return () => errors;
}

test.describe('Séance replay — member view recording (runtime)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    await cleanupTestCells();
    admin = await seedAdminUser({ firstName: 'ViewRecAdmin' });
    member = await seedMemberUser({ firstName: 'ViewRecMember' });

    const published = await db.replaySession.create({
      data: {
        date: parseLocalDate(TEST_DATE),
        slot: PUBLISHED_SLOT,
        status: 'done',
        title: 'Analyse — preuve enregistrement',
        time: '12h00',
      },
      select: { id: true },
    });
    publishedId = published.id;

    const cancelled = await db.replaySession.create({
      data: {
        date: parseLocalDate(TEST_DATE),
        slot: CANCELLED_SLOT,
        status: 'cancelled',
        title: 'Débrief — séance annulée',
        time: '20h00',
        cancelReason: 'Test — annulée.',
      },
      select: { id: true },
    });
    cancelledId = cancelled.id;
  });

  test.afterAll(async () => {
    await cleanupTestCells();
    await cleanupTestUsers();
    admin = member = publishedId = cancelledId = null;
  });

  test('A — a member opening a published replay records exactly one view; re-open dedups', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!member || !publishedId) throw new Error('seed missing — beforeAll did not run');
    const errors = trackConsoleErrors(page);
    const sessionId = publishedId;
    const memberId = member.id;

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    // Real member visit → the replay renders.
    await page.goto(`/seances/${TEST_DATE}/${PUBLISHED_SLOT}`);
    await expect(page.getByRole('region', { name: 'Replay de la séance' })).toBeVisible({
      timeout: 30_000,
    });

    // `after()` fires post-response → poll the row into existence.
    await expect
      .poll(() => db.replayView.count({ where: { sessionId, userId: memberId } }), {
        timeout: 20_000,
      })
      .toBe(1);
    const firstRow = await db.replayView.findUnique({
      where: { sessionId_userId: { sessionId, userId: memberId } },
      select: { viewCount: true },
    });
    expect(firstRow?.viewCount).toBe(1);

    // Re-open → viewCount increments, but it stays ONE distinct row (dedup):
    // a member refreshing can never inflate the distinct-viewer numerator.
    await page.goto(`/seances/${TEST_DATE}/${PUBLISHED_SLOT}`);
    await expect(page.getByRole('region', { name: 'Replay de la séance' })).toBeVisible();
    await expect
      .poll(
        async () => {
          const row = await db.replayView.findUnique({
            where: { sessionId_userId: { sessionId, userId: memberId } },
            select: { viewCount: true },
          });
          return row?.viewCount ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBe(2);
    expect(await db.replayView.count({ where: { sessionId } })).toBe(1);

    expect(errors(), `console errors: ${errors().join(' | ')}`).toEqual([]);
  });

  test('B — an ADMIN opening the same replay records nothing (role guard)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!admin || !publishedId) throw new Error('seed missing — beforeAll did not run');
    const sessionId = publishedId;
    const adminId = admin.id;

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);

    await page.goto(`/seances/${TEST_DATE}/${PUBLISHED_SLOT}`);
    await expect(page.getByRole('region', { name: 'Replay de la séance' })).toBeVisible({
      timeout: 30_000,
    });

    // Give `after()` ample time to have fired (test A proved it lands in ~1-2s),
    // then assert the admin's visit left NO row.
    await page.waitForTimeout(4000);
    expect(await db.replayView.count({ where: { sessionId, userId: adminId } })).toBe(0);
  });

  test('C — a member opening a CANCELLED séance records nothing (status guard)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    if (!member || !cancelledId) throw new Error('seed missing — beforeAll did not run');
    const sessionId = cancelledId;
    const memberId = member.id;

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto(`/seances/${TEST_DATE}/${CANCELLED_SLOT}`);
    // The heading renders `&apos;` (straight U+0027), so match with a regex whose
    // `.` spans the apostrophe glyph — robust to straight-vs-curly.
    await expect(page.getByRole('heading', { name: /Cette séance n.a pas eu lieu\./ })).toBeVisible(
      { timeout: 30_000 },
    );

    await page.waitForTimeout(4000);
    expect(await db.replayView.count({ where: { sessionId, userId: memberId } })).toBe(0);
  });
});
