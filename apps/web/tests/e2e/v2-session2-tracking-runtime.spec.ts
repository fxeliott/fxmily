import { existsSync } from 'node:fs';

import { chromium, expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/**
 * V2 S2 runtime verification — the universal tracking engine's MEMBER LOOP.
 *
 * The pure layers are unit-tested (axes/cadence/coverage/registry/schema/
 * instrument + the Server Action `actions.test.ts`); THIS proves the INTEGRATION
 * against real Postgres through the real Next.js RSC pages on BOTH the desktop
 * and the mobile project:
 *
 *   1. (render)  `/tracking/[instrument]` renders the frozen process-fidelity
 *      instrument as a calm wizard — preamble, one radiogroup per closed
 *      question + the D3 confidence scale, sticky CTA DISABLED until complete.
 *      §2 (BLOQUANT): the closed form carries no market call; §31.2: a « non »
 *      is framed as a repère, never a verdict.
 *   2. (submit)  filling every radiogroup enables the CTA; submitting persists
 *      ONE `TrackingEntry` (real DB row, axis = risk_discipline), lands on
 *      `?done=1` with the calm acknowledgement, and re-renders in edit mode.
 *   3. (gauge)   `/dashboard` shows the completeness widget (reflective coverage
 *      gauge) AND — S6 §32-2 — surfaces the due relevé nudge in the consolidated
 *      « plan du jour », which disappears once the weekly capture exists; the
 *      « Gestion du risque » axis then reads as covered in the gauge.
 *
 * Determinism (canon J-C3): every assertion gates on an auto-waiting
 * `expect(locator)`, `:visible` past the RSC stream buffer, no `networkidle`.
 * Seeds + cleans its own `*.e2e.test@fxmily.local` users.
 */

let freshMember: SeededUser | null = null;
let submitMember: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run.`,
    };
  }
  return { ok: true };
}

async function dismissCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('fxmily.cookie.dismissed', '1');
  });
}

/** Console errors that are dev-server noise, never a real defect. */
function isBenignConsoleError(text: string): boolean {
  return (
    text.includes('Download the React DevTools') ||
    text.includes('favicon') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('V2 S2 — universal tracking engine member loop (capture + dashboard gauge) · §2', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    freshMember = await seedMemberUser({ firstName: 'Trackfresh' });
    submitMember = await seedMemberUser({ firstName: 'Tracksubmit' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    freshMember = null;
    submitMember = null;
  });

  test('render — le wizard rend l’instrument figé, calme, CTA inerte tant qu’incomplet (§2/§31.2)', async ({
    page,
    request,
  }) => {
    if (!freshMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, freshMember.email, freshMember.password);

    await page.goto('/tracking/process-fidelity');

    // The instrument renders (no crash) — the page H1 is its title.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Fidélité à ton cadre/i);

    // The wizard form + preamble are present.
    const form = page.locator('[data-slot="tracking-wizard"]');
    await expect(form).toBeVisible();
    await expect(form).toContainText(/Repense à ta semaine de trading/i);

    // 10 closed questions + the D3 confidence scale = 11 radiogroups.
    await expect(page.getByRole('radiogroup')).toHaveCount(11);

    // The CTA is INERT until the required items + confidence are answered
    // (§3.3 — no surprise submit), and nothing is pre-selected.
    const cta = page.getByRole('button', { name: /Enregistrer mon suivi/i });
    await expect(cta).toBeDisabled();
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);

    // §31.2 — framed as a calm repère, never a verdict.
    await expect(form).toContainText(/un\s+«\s*non\s*»\s+n['’]est pas un échec/i);

    // POSTURE §2 (BLOQUANT) — the closed instrument carries no market call.
    await expect(form).not.toContainText(
      /ach[èe]te maintenant|signal d'achat|niveau d'entrée conseillé|vends? maintenant/i,
    );

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('submit — répondre à tout active le CTA, persiste UNE entrée, atterrit sur ?done=1 (§2)', async ({
    page,
    request,
  }) => {
    if (!submitMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, submitMember.email, submitMember.password);

    await page.goto('/tracking/process-fidelity');
    const form = page.locator('[data-slot="tracking-wizard"]');
    await expect(form).toBeVisible();

    // Answer EVERY radiogroup (required + optional + confidence) by picking the
    // first option in each — deterministic, and enough to complete the form.
    const groups = page.getByRole('radiogroup');
    const total = await groups.count();
    for (let i = 0; i < total; i++) {
      await groups.nth(i).getByRole('radio').first().click();
    }

    const cta = page.getByRole('button', { name: /Enregistrer mon suivi/i });
    await expect(cta).toBeEnabled();
    await cta.click();

    // Calm reveal — lands on ?done=1 with the acknowledgement, re-renders in
    // edit mode (the H1 flips to « Reprendre »).
    await expect(page).toHaveURL(/\/tracking\/process-fidelity\?done=1/);
    await expect(page.locator('[data-slot="tracking-done"]')).toBeVisible();
    await expect(page.locator('[data-slot="tracking-done"]')).toContainText(/c['’]est noté/i);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Reprendre/i);

    // Real DB row: exactly one entry for this member, on the risk_discipline axis,
    // with the first-option answers rebuilt server-side (cut_20h = Oui = true).
    const entries = await db.trackingEntry.findMany({
      where: { userId: submitMember.id, instrumentKey: 'process-fidelity' },
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.axis).toBe('risk_discipline');
    expect(entry.instrumentVersion).toBe('v1');
    expect((entry.responses as Record<string, unknown>).cut_20h).toBe(true);
    // D3 confidence captured (first option = 1), persisted OUTSIDE responses.
    expect(entry.confidenceLevel).toBe(1);
    // D2 reliability metadata persisted EN RÉEL (DoD#7 + Tâche D.2 : « contexte de
    // saisie à chaud/à froid et latence … stockés avec la donnée »). Read back
    // from the SAME real DB row: the wizard measures the mount→submit latency
    // and injects it (tracking-wizard.tsx), so it is always a finite ms ≥ 0; the
    // capture context defaults to the instrument's 'cold' retrospective
    // (process-fidelity-v1.ts). `promptedAt` is null by construction in this
    // self-initiated path (no scheduled push sends it — a future S3+ contract).
    expect(entry.captureContext).toBe('cold');
    expect(typeof entry.responseLatencyMs).toBe('number');
    expect(entry.responseLatencyMs).toBeGreaterThanOrEqual(0);
    expect(entry.promptedAt).toBeNull();

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  // S6 §32-2 — the DUE relevé CTA moved from the coverage widget to the
  // consolidated « plan du jour » (`TodayGuidance` / north-star hero) so the same
  // « faire mon point » action is never offered twice on one page. The widget now
  // owns the reflective coverage GAUGE only; the due nudge (and its disappearance
  // after a weekly capture) is asserted on the guidance surface via
  // `[data-kind="tracking"]` (matches whether it lands in the list or the hero).
  const TRACKING_NUDGE =
    '[data-slot="guidance-action"][data-kind="tracking"], [data-slot="hero-next-action"][data-kind="tracking"]';

  test('gauge — le dashboard rend la jauge de complétude + le relevé dû dans le plan du jour, qui disparaît après capture', async ({
    page,
    request,
  }) => {
    if (!freshMember || !submitMember) throw new Error('seed missing — beforeAll did not run');

    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isBenignConsoleError(msg.text()))
        consoleErrors.push(msg.text());
    });

    // (a) Fresh member — nothing captured → the coverage gauge renders AND the
    // consolidated plan du jour surfaces the due relevé nudge (§32-2).
    await dismissCookieBanner(page);
    await page.goto('/login');
    await loginAs(page, request, freshMember.email, freshMember.password);

    await page.goto('/dashboard');
    const freshWidget = page.locator('[data-slot="tracking-coverage-widget"]:visible');
    await expect(freshWidget).toBeVisible();
    await expect(freshWidget.getByRole('progressbar')).toBeVisible();
    await expect(freshWidget).toHaveAttribute('data-state', 'empty');
    // The due relevé nudge lives in the plan du jour now (single place to look).
    await expect(page.locator(TRACKING_NUDGE).first()).toBeVisible();

    // (b) Member who captured — the risk_discipline axis reads as covered.
    await page.goto('/login');
    await loginAs(page, request, submitMember.email, submitMember.password);

    await page.goto('/dashboard');
    const widget = page.locator('[data-slot="tracking-coverage-widget"]:visible');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-state', 'covered');
    const covered = widget.locator('[data-covered="true"]', { hasText: 'Gestion du risque' });
    await expect(covered).toBeVisible();

    // DoD l.285 « collecte étalée, SANS ENTASSEMENT » proven at the browser:
    // once captured this week, the weekly instrument leaves the due set
    // (nextDueAt advances to next Monday), so the plan du jour no longer offers
    // the relevé nudge — the negative half of the cadence, until now only
    // unit-tested, asserted here on the real rendered dashboard.
    await expect(page.locator(TRACKING_NUDGE)).toHaveCount(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
