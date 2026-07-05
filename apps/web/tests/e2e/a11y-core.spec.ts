/**
 * Tour 13 — automated accessibility scan (axe-core) over the core surfaces.
 *
 * REPORT MODE, deliberately: this is the repo's FIRST automated a11y gate.
 * Prior WCAG AA work (tour 7/8 contrast passes) was proven by manual CDP
 * audits, so a first axe run may surface pre-existing debt that manual
 * audits never covered. Failing CI on unknown debt would block unrelated
 * work, so this suite MEASURES and publishes the violations as test
 * annotations + a JSON artifact, exactly like the `pnpm audit ... || true`
 * report step in ci.yml. Once the baseline is triaged, flip REPORT_ONLY to
 * false (or assert per-impact) to make it a hard gate.
 *
 * Scope v1: 5 surfaces × default (dark) theme — /login (public), /dashboard,
 * /journal, /checkin as a member, /admin/members as the admin. Light theme
 * and the remaining routes belong to the gate-hardening pass.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const REPORT_ONLY = true;
const REPORT_DIR = path.join('test-results', 'a11y');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const MEMBER_EMAIL = 'a11y.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'A11yMemberPwd-2026!';
const ADMIN_EMAIL = 'a11y.admin.e2e.test@fxmily.local';
const ADMIN_PASSWORD = 'A11yAdminPwd-2026!';

let member: SeededUser | null = null;
let admin: SeededUser | null = null;

interface ViolationSummary {
  id: string;
  impact: string;
  help: string;
  nodes: number;
  sampleTarget: string;
}

async function scanCurrentPage(
  page: import('@playwright/test').Page,
  label: string,
): Promise<ViolationSummary[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    nodes: v.nodes.length,
    sampleTarget: String(v.nodes[0]?.target?.[0] ?? ''),
  }));
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    path.join(REPORT_DIR, `${label}.json`),
    JSON.stringify({ label, url: page.url(), violations: results.violations }, null, 2),
  );
  return violations;
}

function reportViolations(
  testInfo: import('@playwright/test').TestInfo,
  label: string,
  violations: ViolationSummary[],
): void {
  for (const v of violations) {
    testInfo.annotations.push({
      type: 'a11y-violation',
      description: `[${label}] ${v.impact}: ${v.id} (${v.nodes} node(s)) — ${v.help} — e.g. ${v.sampleTarget}`,
    });
  }
  // Visible in the CI log via the list/github reporters.
  console.log(
    `[a11y] ${label}: ${violations.length} violation(s)` +
      (violations.length
        ? ` — ${violations.map((v) => `${v.impact}:${v.id}×${v.nodes}`).join(', ')}`
        : ''),
  );
  if (!REPORT_ONLY) {
    expect(violations, `${label} must have zero WCAG A/AA violations`).toEqual([]);
  }
}

test.describe('a11y core surfaces (axe-core, report mode)', () => {
  test.beforeAll(async () => {
    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'A11y',
      lastName: 'Member',
    });
    admin = await seedAdminUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstName: 'A11y',
      lastName: 'Admin',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    admin = null;
  });

  test('scans /login (public)', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
    reportViolations(testInfo, 'login', await scanCurrentPage(page, 'login'));
  });

  for (const route of ['/dashboard', '/journal', '/checkin'] as const) {
    const label = route.slice(1);
    test(`scans ${route} (member)`, async ({ page, request }, testInfo) => {
      if (!member) throw new Error('seed missing — beforeAll did not run');
      // Put a real origin in the page URL before loginAs (about:blank guard).
      await page.goto('/login');
      await loginAs(page, request, member.email, MEMBER_PASSWORD);
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')));
      reportViolations(testInfo, label, await scanCurrentPage(page, label));
    });
  }

  test('scans /admin/members (admin)', async ({ page, request }, testInfo) => {
    if (!admin) throw new Error('seed missing — beforeAll did not run');
    await page.goto('/login');
    await loginAs(page, request, admin.email, ADMIN_PASSWORD);
    await page.goto('/admin/members');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/admin\/members/);
    reportViolations(testInfo, 'admin-members', await scanCurrentPage(page, 'admin-members'));
  });
});
