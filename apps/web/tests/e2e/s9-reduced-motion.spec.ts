/**
 * S9 · DoD §35 box 3 — `prefers-reduced-motion` honoured AT RUNTIME.
 *
 * The design system claims a defence-in-depth reduced-motion contract: a global
 * net (`globals.css` `@media (prefers-reduced-motion: reduce)` →
 * `*,*::before,*::after { animation-duration: 0.01ms !important; … }`) plus
 * Framer `MotionConfig reducedMotion="user"`. This spec PROVES the net at runtime
 * by emulating the OS preference and asserting that every element which declares
 * an animation collapses its duration to ~0 (≤ 1ms). Public surfaces only (no
 * auth) — `/` carries the splash/hero orbs and `/login` the login orbs, the
 * densest ambient animations in the app.
 *
 *   pnpm --filter @fxmily/web exec playwright test s9-reduced-motion --project=chromium
 */

import { expect, test } from '@playwright/test';

const ANIMATED_ROUTES = ['/', '/login', '/rejoindre'];

test.describe('S9 DoD §35 box 3 — reduced-motion runtime', () => {
  for (const route of ANIMATED_ROUTES) {
    test(`reduced-motion neutralises animations on ${route}`, async ({ page }) => {
      test.setTimeout(60_000);
      // Emulate the OS preference imperatively (more reliable than `test.use`).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Sanity: the media query MUST be active, else the assertion below is moot.
      const mqActive = await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
      expect(mqActive, 'prefers-reduced-motion: reduce not emulated').toBe(true);

      // Collect, for every element that declares a running animation, its
      // computed animation-duration in ms. Under the reduced-motion net they must
      // all be ≤ 1ms (the net pins 0.01ms !important).
      const offenders = await page.evaluate(() => {
        const toMs = (v: string): number =>
          v
            .split(',')
            .map((s) => s.trim())
            .reduce((max, one) => {
              const n = one.endsWith('ms')
                ? parseFloat(one)
                : one.endsWith('s')
                  ? parseFloat(one) * 1000
                  : 0;
              return Number.isFinite(n) && n > max ? n : max;
            }, 0);
        const bad: { tag: string; cls: string; name: string; durMs: number }[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const cs = getComputedStyle(el);
          if (cs.animationName && cs.animationName !== 'none') {
            const durMs = toMs(cs.animationDuration);
            if (durMs > 1) {
              bad.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.getAttribute('class') || '').slice(0, 60),
                name: cs.animationName,
                durMs,
              });
            }
          }
        }
        return bad;
      });

      expect(
        offenders,
        `elements with a non-neutralised animation under reduced-motion on ${route}:\n` +
          offenders.map((o) => `  ${o.tag}.${o.cls} :: ${o.name} ${o.durMs}ms`).join('\n'),
      ).toEqual([]);
    });
  }
});
