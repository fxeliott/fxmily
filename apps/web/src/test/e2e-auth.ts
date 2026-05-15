/**
 * Playwright auth helpers — log a seeded test user in via the real
 * Auth.js v5 Credentials flow (POST /api/auth/callback/credentials with the
 * CSRF dance), then return a Playwright `Page` with the session cookie set.
 *
 * Why not "set the cookie directly":
 *   - The session cookie is JWE-encrypted with `AUTH_SECRET`. Encoding it
 *     ourselves duplicates Auth.js internals and breaks every time the
 *     library bumps. Going through the real flow exercises the same code
 *     path a member uses, so a regression in `authorize()` (e.g. a bad
 *     password compare) shows up here too.
 *
 * Reference: the Smoke-test J2 close-out used the same pattern via curl;
 * this just wraps it in a typed helper for Playwright tests.
 */

import type { APIRequestContext, Page } from '@playwright/test';

interface LoginResult {
  /** The session-token cookie value (in case the test wants to inspect it). */
  sessionToken: string;
}

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token', // production-style name
];

/**
 * Log in via the real Auth.js v5 Credentials flow:
 *   1. GET /api/auth/csrf → cookie `authjs.csrf-token` + JSON `{ csrfToken }`.
 *   2. POST /api/auth/callback/credentials?json=true with form fields
 *      { csrfToken, email, password, callbackUrl } → 200 + JSON `{ url }`.
 *   3. Pull the session cookie out of the API request context cookie jar
 *      and inject it into the Playwright `page` browser context.
 */
export async function loginAs(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<LoginResult> {
  // V1.9 hygiène 2026-05-15 — root cause of smoke-tour-j6 e2e.yml first-run
  // failure : `page.context().pages()[0]?.url()` returns `'about:blank'`
  // (truthy string) when the browser context is fresh, so the
  // `?? 'http://localhost:3000'` fallback is bypassed. `new URL('about:blank').origin`
  // returns the literal string `'null'`, which then becomes the
  // `callbackUrl: 'null/dashboard'` form field. Auth.js v5 validates the
  // callbackUrl with `new URL(...)` and throws `TypeError: Invalid URL`,
  // which kills the credentials callback before the session cookie is set.
  // Fix: read the configured `PLAYWRIGHT_BASE_URL` directly (same source
  // of truth as `playwright.config.ts:28`).
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const origin = new URL(baseURL).origin;

  // Step 1 — fetch CSRF token (sets the csrf cookie in the request context).
  const csrfRes = await request.get('/api/auth/csrf');
  if (csrfRes.status() !== 200) {
    throw new Error(`csrf endpoint returned ${csrfRes.status()}`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // Step 2 — submit credentials with the CSRF token in the form body.
  const callbackRes = await request.post('/api/auth/callback/credentials?json=true', {
    form: {
      csrfToken,
      email,
      password,
      callbackUrl: `${origin}/dashboard`,
    },
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  if (callbackRes.status() >= 400) {
    throw new Error(
      `credentials callback returned ${callbackRes.status()}: ${await callbackRes.text()}`,
    );
  }

  // Step 3 — find the session cookie in the request context cookie jar and
  // forward it to the browser context Playwright will navigate with.
  const cookies = await request.storageState();
  const sessionCookie = cookies.cookies.find((c) =>
    SESSION_COOKIE_NAMES.some((name) => c.name === name),
  );
  if (!sessionCookie) {
    throw new Error(
      `no session cookie found after credentials callback (got: ${cookies.cookies.map((c) => c.name).join(', ')})`,
    );
  }

  // Playwright `addCookies` accepts either { url } OR { domain + path }.
  // The cookie object from `storageState` carries both, but mixing them with
  // a fresh `url` triggers "Cookie should have either url or domain". Pick
  // exactly the minimum shape the cookie needs, anchored to our origin.
  await page.context().addCookies([
    {
      name: sessionCookie.name,
      value: sessionCookie.value,
      url: origin,
      httpOnly: sessionCookie.httpOnly,
      secure: sessionCookie.secure,
      sameSite: sessionCookie.sameSite,
    },
  ]);

  return { sessionToken: sessionCookie.value };
}
