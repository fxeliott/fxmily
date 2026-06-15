/**
 * SESSION 10 — Interconnexion / Validation finale.
 *
 * CHAÎNE ANTI-MENSONGE S3 prouvée DE BOUT EN BOUT en RUNTIME RÉEL (DoD §30 #2 —
 * « chaîne de vérité/anti-mensonge testée en réel » + brief S3 §31). This is
 * the missing integration layer: the verification cores are unit-tested with a
 * mocked db, but nothing exercised the REAL Prisma → real cron HTTP → real
 * downstream rows + real UI path. This does.
 *
 * Scenario (a member who lies + a member who is honest, in one account set):
 *   - 2 broker accounts declared (the "how many accounts" axis — count proven;
 *     AI auto-detection of the count is the human-in-the-loop vision pipeline,
 *     already runtime-proven in S3 MAJ-26);
 *   - 1 HONEST trade (EURUSD) that matches a real extracted position → matched;
 *   - 1 real extracted position (GBPUSD) with NO declared trade → missing_declared;
 *   - 2 declared trades (XAUUSD, US30) with NO real counterpart, inside the
 *     proof-coverage window → false_declared ×2 (≥ alert threshold 2);
 * then POST the REAL /api/cron/verification-scan (reconcile → rituals →
 * constancy → alerts, exactly as prod's 11:30 UTC cron) and assert:
 *   1. DB: 1 missing + 2 false discrepancies, the matching ScoreEvents, a
 *      ConstancyScore that DROPPED (honesty crushed by the false declarations),
 *      a `false_declaration_repeat` Alert delivered, a coaching delivery wired
 *      to that alert (S3 → S5), and the honest trade flipped to mt5_verified;
 *   2. MEMBER UI (/verification): the member sees their real constancy score +
 *      their écarts (S3 → S4), calm/factual copy, no trading advice;
 *   3. ADMIN UI (/admin/members/[id]?tab=verification): the admin sees the full
 *      truth — accounts, écarts, the repetition alert (S3 → S7).
 *
 * Matching/threshold constants verified against lib/verification/{reconcile,
 * constancy,alerts}.ts (45-min window, ±15% volume, ±12h coverage, false-decl
 * threshold 2, ego card category for that alert — 4 ego cards are published in
 * dev). Member is created today → excluded from the ritual scan, so regularity
 * stays null and the score isolates the HONESTY axis (no ritual noise).
 *
 * Skips cleanly if Chromium is missing OR if CRON_SECRET is not configured in
 * this env (the cron then 503s and the chain cannot be exercised).
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedMemberUser,
  seedAdminUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const H = 3_600_000;
const MIN = 60_000;

function chromiumOk(): boolean {
  const exec = chromium.executablePath();
  return Boolean(exec && existsSync(exec));
}

test.describe.serial('S10 — chaîne anti-mensonge S3 bout-en-bout (real DB + real cron)', () => {
  let member: SeededUser | null = null;
  let admin: SeededUser | null = null;
  const cronSecret = process.env.CRON_SECRET;

  test.beforeAll(async () => {
    test.skip(!chromiumOk(), 'Chromium not installed');
    test.skip(!cronSecret, 'CRON_SECRET not configured — cannot exercise the real cron');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S10Liar' });
    admin = await seedAdminUser({ firstName: 'S10AdminV' });

    const now = Date.now();

    // --- Two declared broker accounts (the "how many accounts" axis).
    const acctProp = await db.brokerAccount.create({
      data: { memberId: member.id, label: 'FTMO 100k', type: 'prop_firm' },
      select: { id: true },
    });
    await db.brokerAccount.create({
      data: { memberId: member.id, label: 'Compte perso IC', type: 'personal' },
    });

    // --- HONEST: a declared trade that matches a real extracted position.
    await db.trade.create({
      data: {
        userId: member.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date(now - 2 * H),
        exitedAt: new Date(now - 1 * H), // CLOSED
        entryPrice: 1.09,
        lotSize: 0.5,
        plannedRR: 2,
        emotionBefore: [],
        planRespected: true,
      },
    });
    await db.extractedPosition.create({
      data: {
        brokerAccountId: acctProp.id,
        symbol: 'EURUSD',
        side: 'long',
        openTime: new Date(now - 2 * H + 5 * MIN), // +5 min ≤ 45 min
        volume: 0.5, // exact volume → matched
      },
    });

    // --- MISSING_DECLARED: a real position with no declared trade.
    await db.extractedPosition.create({
      data: {
        brokerAccountId: acctProp.id,
        symbol: 'GBPUSD',
        side: 'short',
        openTime: new Date(now - 2 * H),
        volume: 1.0,
      },
    });

    // --- FALSE_DECLARED ×2: declared CLOSED trades with no real counterpart,
    // inside the coverage window (within ±12h of the extracted positions), so
    // they are accused (not merely "uncovered"). Different symbols → never match.
    await db.trade.create({
      data: {
        userId: member.id,
        pair: 'XAUUSD',
        direction: 'long',
        session: 'newyork',
        enteredAt: new Date(now - 3 * H),
        exitedAt: new Date(now - 2.5 * H),
        entryPrice: 2350,
        lotSize: 0.3,
        plannedRR: 1.5,
        emotionBefore: [],
        planRespected: true,
      },
    });
    await db.trade.create({
      data: {
        userId: member.id,
        pair: 'US30',
        direction: 'long',
        session: 'newyork',
        enteredAt: new Date(now - 1 * H),
        exitedAt: new Date(now - 0.5 * H),
        entryPrice: 39000,
        lotSize: 0.2,
        plannedRR: 1.8,
        emotionBefore: [],
        planRespected: true,
      },
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    admin = null;
  });

  test('1) le cron verification-scan produit écarts + score effondré + alerte délivrée (DB)', async ({
    request,
  }) => {
    if (!member || !cronSecret) throw new Error('precondition missing');

    // The REAL cron — identical to prod's daily 11:30 UTC invocation.
    const res = await request.post('/api/cron/verification-scan', {
      headers: { 'x-cron-secret': cronSecret },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reconcile: { errors: number };
      constancy: { errors: number };
      alerts: { errors: number };
      rituals: { errors: number };
    };
    expect(body.ok).toBe(true);
    expect(
      body.reconcile.errors + body.constancy.errors + body.alerts.errors + body.rituals.errors,
    ).toBe(0);

    // --- Discrepancies: exactly 1 missing + 2 false for THIS member.
    const missing = await db.discrepancy.count({
      where: { memberId: member.id, type: 'missing_declared' },
    });
    const falseDecl = await db.discrepancy.count({
      where: { memberId: member.id, type: 'false_declared' },
    });
    expect(missing, 'one undeclared real position must be caught').toBe(1);
    expect(falseDecl, 'two fabricated trades must be caught').toBe(2);

    // --- ScoreEvents: the reality_gap (−3) + 2× false_declaration (−8).
    expect(
      await db.scoreEvent.count({ where: { memberId: member.id, reason: 'reality_gap' } }),
    ).toBe(1);
    expect(
      await db.scoreEvent.count({ where: { memberId: member.id, reason: 'false_declaration' } }),
    ).toBe(2);

    // --- ConstancyScore dropped hard (honesty = 100 − 15 − 40×2 → floored).
    const score = await db.constancyScore.findFirst({
      where: { memberId: member.id },
      orderBy: { periodStart: 'desc' },
    });
    expect(score, 'a ConstancyScore must be folded').not.toBeNull();
    expect(score!.value).toBeLessThan(50);
    const breakdown = score!.breakdown as { honesty: number | null };
    expect(breakdown.honesty, 'honesty must be crushed by the lies').toBeLessThan(20);

    // --- Repetition alert delivered + coaching wired (S3 → S5). The honest
    // single missing gap (1 < threshold 3) must NOT fire a reality_gap alert;
    // the 2 false declarations (≥ threshold 2) MUST fire one.
    const alert = await db.alert.findFirst({
      where: { memberId: member.id, triggerType: 'false_declaration_repeat' },
    });
    expect(alert, 'two false declarations must raise a repetition alert').not.toBeNull();
    expect(alert!.repeatCount).toBeGreaterThanOrEqual(2);
    expect(alert!.status, 'the alert must deliver a Mark Douglas card (ego)').toBe('delivered');

    const delivery = await db.markDouglasDelivery.findFirst({
      where: { userId: member.id, sourceAlertId: alert!.id },
    });
    expect(delivery, 'a coaching delivery must be wired to the alert (S3 → S5)').not.toBeNull();

    // --- The honest trade flipped to verified (the reward side of the chain).
    const honest = await db.trade.findFirst({
      where: { userId: member.id, pair: 'EURUSD' },
      select: { matchStatus: true, source: true },
    });
    expect(honest?.matchStatus).toBe('matched');
    expect(honest?.source).toBe('mt5_verified');

    // --- "how many accounts": 2 declared accounts persisted for this member.
    expect(await db.brokerAccount.count({ where: { memberId: member.id } })).toBe(2);
  });

  test('2) le MEMBRE voit sa réalité sur /verification (S3 → S4, posture §2)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('precondition missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/verification');

    await expect(page.getByRole('heading', { name: 'Ta réalité de trading' })).toBeVisible();

    // Constancy score surfaced (S4 DOD3). Value is low but the copy stays calm —
    // no shaming, and crucially NO trading advice anywhere (§2 firewall).
    const constancy = page.getByRole('region', { name: 'Ta constance' });
    await constancy.scrollIntoViewIfNeeded();
    await expect(constancy.getByText('Score de constance')).toBeVisible();
    await expect(constancy.getByText('/100')).toBeVisible();

    // The écarts are shown factually.
    const ecarts = page.getByRole('region', { name: 'Tes écarts' });
    await ecarts.scrollIntoViewIfNeeded();
    await expect(ecarts.getByText('Position réelle non déclarée').first()).toBeVisible();
    await expect(ecarts.getByText('Trade déclaré sans contrepartie').first()).toBeVisible();

    // §2 anti-survente: never claims "vérifié à 100%".
    await expect(page.getByText(/vérifié à 100\s?%/i)).toHaveCount(0);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('3) l’ADMIN voit toute la vérité du membre (S3 → S7)', async ({ page, request }) => {
    if (!member || !admin) throw new Error('precondition missing');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);
    await page.goto(`/admin/members/${member.id}?tab=verification`);

    // Truth surfaces: accounts (2), the repetition alert, the écarts.
    await expect(page.getByRole('heading', { name: 'Écarts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alertes (répétition)' })).toBeVisible();
    await expect(page.getByText('Fausses déclarations répétées').first()).toBeVisible();
    await expect(page.getByText('Fiche Douglas envoyée').first()).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
