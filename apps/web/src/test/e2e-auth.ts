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
 * UN SEUL prédicat, utilisé partout où l'on cherche le cookie de session.
 *
 * Il en existait deux, écrits différemment (`includes` ici, `some(...)` là).
 * Le risque n'était pas cosmétique : la prochaine main qui ajoute le support
 * des cookies chunkés (`authjs.session-token.0` / `.1`, émis par `@auth/core`
 * au-delà de ~4 ko) le ferait à l'endroit évident — la lecture d'après — et
 * pas à la lecture d'avant, qui rendrait alors `null`. Le garde anti-recyclage
 * se **désarmerait de lui-même**, en silence. Un seul point de vérité rend ce
 * scénario impossible.
 */
function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_NAMES.includes(name);
}

/**
 * Each `loginAs` call must present a DISTINCT client IP.
 *
 * The production Credentials `authorize()` consumes `loginIpLimiter`
 * (burst 10, refill 1 token / 60 s, keyed by `callerIdTrusted()`) on every
 * login — a deliberate credential-stuffing defense. Under `next dev` in CI
 * there is no Caddy and no `x-forwarded-for` / `x-real-ip`, so
 * `callerIdTrusted()` collapses every request to the literal key
 * `'unknown'`. The full e2e suite then drains that single shared bucket
 * after ~10 cumulative logins, and every later `loginAs` gets
 * `CredentialsSignin` with no session cookie — a deterministic,
 * retry-proof failure that masquerades as a flake.
 *
 * Presenting a unique synthetic IP per call gives each login its own fresh
 * bucket, exactly as N real members on N real IPs would. The limiter stays
 * fully exercised (it still runs on every login) — it is just no longer
 * artificially exhausted by the harness collapsing to one origin.
 *
 * `callerIdTrusted` reads the LAST `x-forwarded-for` entry; under `next
 * dev` there is no upstream proxy so our single value is both first and
 * last. RFC 1918 private addresses make it obvious these are synthetic.
 */
let syntheticCallerSeq = 0;

/**
 * Un octet propre au PROCESSUS de test, et ce n'est pas de la cosmétique.
 *
 * Le compteur ci-dessus repart de zéro à chaque exécution ; le limiteur, lui,
 * vit dans le serveur. Contre un serveur de longue durée (le cas en local :
 * un `next start` gardé ouvert entre deux séries), le 1er login du 11ᵉ run
 * réutilise `10.0.0.1` pour la 11ᵉ fois et se fait refuser — un échec qui
 * ressemble à un bug du produit et n'en est pas. Mesuré le 2026-07-31 : c'est
 * ainsi que le spec du harnais a rougi sur un login pourtant légitime.
 *
 * En CI le serveur est neuf à chaque job, donc le problème ne s'y voyait pas —
 * raison de plus pour le fermer, puisqu'il ne frappe QUE le poste de travail.
 */
const PROCESS_OCTET = process.pid & 0xff;

export function nextSyntheticCallerIp(): string {
  syntheticCallerSeq += 1;
  const n = syntheticCallerSeq;
  // 10.<processus>.<b>.<c> — 16 bits par processus, très au-delà du nombre de
  // logins qu'une suite effectue (~150 avec les retries).
  return `10.${PROCESS_OCTET}.${(n >> 8) & 0xff}.${n & 0xff}`;
}

/**
 * Retry a Playwright request ONLY on a thrown network-level error — under
 * `next dev` in CI the server compiles routes on-demand and can momentarily
 * drop a connection (`socket hang up` / `ECONNRESET` / `ECONNREFUSED`),
 * surfacing as a thrown error before any HTTP response. That is a transient
 * harness/dev-server hiccup, not an auth failure.
 *
 * IMPORTANT: Playwright's `request.get/post` resolve (do NOT throw) on HTTP
 * 4xx/5xx — those are returned as a response and handled by the caller's
 * explicit `status()` checks. So this wrapper NEVER retries a real auth
 * rejection (e.g. a 401 from a wrong password); it only re-attempts when the
 * request threw at the socket layer. Retries reuse the same synthetic caller
 * IP, so the per-IP login bucket (burst 10) easily absorbs 2 extra attempts.
 */
async function requestWithRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastErr)}`);
}

/**
 * Log in via the real Auth.js v5 Credentials flow:
 *   1. GET /api/auth/csrf → cookie `authjs.csrf-token` + JSON `{ csrfToken }`.
 *   2. POST /api/auth/callback/credentials?json=true with form fields
 *      { csrfToken, email, password, callbackUrl } → **302** vers `callbackUrl`
 *      en cas de succès, vers `/login?error=…` en cas de refus. (Le `?json=true`
 *      ne suffit PAS à obtenir un corps JSON sur cette version — mesuré contre
 *      un build de production, pas déduit de la doc. Playwright suit la
 *      redirection, d'où un `status()` final de 200 dans les DEUX cas.)
 *   3. Demander à `/api/auth/session` QUI le serveur croit que nous sommes, et
 *      refuser si ce n'est pas le membre demandé.
 *   4. Pull the session cookie out of the API request context cookie jar
 *      and inject it into the Playwright `page` browser context.
 *
 * L'étape 3 existe parce que le pot à cookies est PARTAGÉ par tous les
 * `loginAs` d'un même test (44 tests en enchaînent de 2 à 8, souvent en
 * basculant admin ↔ membre). Sans elle, un login refusé renvoyait « succès »
 * avec la session du membre précédent, et le test appelant interrogeait
 * silencieusement la mauvaise personne. Voir `e2e-auth.test.ts` pour la
 * reproduction exécutable et `tests/e2e/e2e-auth-helper.spec.ts` pour la
 * mesure contre un vrai serveur.
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

  // One synthetic client IP for this whole login attempt — keeps the
  // per-IP login rate-limit bucket fresh (see `nextSyntheticCallerIp`).
  const callerIp = nextSyntheticCallerIp();

  // Step 1 — fetch CSRF token (sets the csrf cookie in the request context).
  const csrfRes = await requestWithRetry('GET /api/auth/csrf', () =>
    request.get('/api/auth/csrf', {
      headers: { 'x-forwarded-for': callerIp },
    }),
  );
  if (csrfRes.status() !== 200) {
    throw new Error(`csrf endpoint returned ${csrfRes.status()}`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // Step 2 — submit credentials with the CSRF token in the form body.
  const callbackRes = await requestWithRetry('POST /api/auth/callback/credentials', () =>
    request.post('/api/auth/callback/credentials?json=true', {
      form: {
        csrfToken,
        email,
        password,
        callbackUrl: `${origin}/dashboard`,
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': callerIp,
      },
    }),
  );
  if (callbackRes.status() >= 400) {
    throw new Error(
      `credentials callback returned ${callbackRes.status()}: ${await callbackRes.text()}`,
    );
  }

  // ⚠️ UN LOGIN REFUSÉ NE RÉPOND PAS >= 400 — MESURÉ, PAS SUPPOSÉ.
  //
  // Sondé contre un build de production local : identifiants faux, pot vide ⇒
  // `302 → /login?error=CredentialsSignin&code=credentials`, que Playwright
  // suit jusqu'à un 200. Le contrôle `>= 400` ci-dessus ne voit donc RIEN.
  //
  // Ce garde-ci n'est PAS le filet principal — il ne couvre que le cas où
  // aucune session n'est déjà en place (voir l'étape 3, qui couvre l'autre).
  // Il est gardé parce qu'il échoue plus tôt et nomme le code d'erreur
  // d'Auth.js, ce qui rend le diagnostic immédiat au lieu de renvoyer à un
  // « ce n'est pas la bonne personne » plus abstrait.
  const finalUrl = callbackRes.url();
  if (/[?&]error=/.test(finalUrl)) {
    const code = /[?&]error=([^&]+)/.exec(finalUrl)?.[1] ?? 'inconnu';
    throw new Error(
      `credentials login REFUSED for ${email}: ${code} (final URL: ${finalUrl}). ` +
        `Le helper s'arrête ici volontairement : poursuivre injecterait la session du login précédent.`,
    );
  }

  // Step 4 — find the session cookie in the request context cookie jar and
  // forward it to the browser context Playwright will navigate with.
  const cookies = await request.storageState();
  const sessionCookie = cookies.cookies.find((c) => isSessionCookieName(c.name));
  if (!sessionCookie) {
    throw new Error(
      `no session cookie found after credentials callback (got: ${cookies.cookies.map((c) => c.name).join(', ')})`,
    );
  }

  // ⚠️ LE SEUL CONTRÔLE QUI TIENNE : DEMANDER AU SERVEUR QUI IL CROIT QUE
  // NOUS SOMMES. Le reste — statut, URL, valeur du cookie — a été mesuré
  // insuffisant, un par un.
  //
  // Ce qui se passe RÉELLEMENT quand le pot porte déjà une session valide et
  // qu'on tente un second login avec de mauvais identifiants (mesuré contre un
  // build de production, `tests/e2e/e2e-auth-helper.spec.ts` en garde la
  // trace) : Auth.js ne tente même pas l'authentification. Il redirige vers le
  // `callbackUrl` — donc **`/dashboard`, sans `error=`** — et fait tourner le
  // JWT au passage, donc **la valeur du cookie CHANGE**. Un contrôle sur
  // l'URL ne voit rien ; un contrôle sur « la valeur a-t-elle changé ? » ne
  // voit rien non plus. Les deux étaient des filets à trous, et c'est le
  // runtime qui l'a dit, pas une relecture.
  //
  // `/api/auth/session` répond, lui, sans ambiguïté : c'était toujours le
  // membre PRÉCÉDENT. La question juste n'est donc pas « une session a-t-elle
  // été émise ? » mais « la session est-elle celle de la personne demandée ? ».
  const whoamiRes = await requestWithRetry('GET /api/auth/session', () =>
    request.get('/api/auth/session', { headers: { 'x-forwarded-for': callerIp } }),
  );
  const whoami = (await whoamiRes.json()) as { user?: { email?: string | null } } | null;
  const signedInAs = whoami?.user?.email ?? null;
  if (signedInAs?.toLowerCase() !== email.toLowerCase()) {
    throw new Error(
      `credentials login for ${email} did NOT sign that member in: /api/auth/session reports ` +
        `${signedInAs ?? '(nobody)'}. Refusing to hand back a session that belongs to someone else — ` +
        `the calling test would silently assert against the wrong member.`,
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
