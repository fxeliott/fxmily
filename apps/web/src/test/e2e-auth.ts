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
 * Le prédicat « ce cookie est-il un cookie de session ? », nommé une fois.
 *
 * ⚠️ Il ne reconnaît PAS les cookies chunkés (`authjs.session-token.0` / `.1`,
 * émis par `@auth/core` au-delà de ~4 ko). Aujourd'hui ce n'est pas un trou
 * silencieux : un JWE chunké ferait échouer bruyamment sur « no session cookie
 * found ». Si le jour vient d'ajouter ce support, il doit l'être ICI — c'est
 * la seule raison pour laquelle ce prédicat est une fonction plutôt qu'un
 * `includes` en ligne.
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
  // L'URL finale est retenue ici pour ENRICHIR le message d'échec plus bas ;
  // elle ne décide de rien par elle-même (voir l'étape 3).
  const finalUrl = callbackRes.url();

  // ⚠️ LE SEUL CONTRÔLE QUI TIENNE : DEMANDER AU SERVEUR QUI IL CROIT QUE
  // NOUS SOMMES. Le reste — statut, URL, valeur du cookie — a été mesuré
  // insuffisant, un par un.
  //
  // Ce qui se passe RÉELLEMENT quand le pot porte déjà une session valide et
  // qu'on tente un second login avec de mauvais identifiants (mesuré contre un
  // build de production, `tests/e2e/e2e-auth-helper.spec.ts` en garde la
  // trace) : Auth.js signale bien le refus, mais `/login` renvoie un membre
  // déjà connecté vers `/dashboard` — l'URL FINALE ne porte donc **aucune**
  // erreur — et la requête suivie fait tourner le JWT, donc **la valeur du
  // cookie CHANGE**. Un contrôle sur l'URL ne voit rien ; un contrôle sur
  // « la valeur a-t-elle changé ? » ne voit rien non plus. Les deux étaient
  // des filets à trous, et c'est le runtime qui l'a dit, pas une relecture.
  //
  // Ce contrôle passe AVANT celui de l'URL, et l'ordre est délibéré : l'URL
  // finale appartient à l'APPLICATION (ce sont ses redirections qui la
  // façonnent), pas à Auth.js. Une redirection légitime vers, disons,
  // `/onboarding?error=profil_incomplet` ferait crier `REFUSED` sur un login
  // parfaitement réussi. L'identité, elle, ne se laisse pas réécrire par une
  // redirection ; elle tranche donc en premier, et le motif `error=` ne sert
  // plus qu'à enrichir le message quand le login a VRAIMENT échoué.
  const whoamiRes = await requestWithRetry('GET /api/auth/session', async () => {
    const res = await request.get('/api/auth/session', {
      headers: { 'x-forwarded-for': callerIp },
    });
    if (res.status() !== 200) {
      // Dans le retry, pas après : un 502 passager ou une page d'erreur HTML
      // rendrait `.json()` illisible (« Unexpected token '<' »), sans label ni
      // seconde chance. C'est exactement la classe d'échec que ce fichier
      // existe pour éliminer.
      throw new Error(`/api/auth/session returned ${res.status()}`);
    }
    return (await res.json()) as { user?: { email?: string | null } } | null;
  });

  const signedInAs = whoamiRes?.user?.email ?? null;
  if (signedInAs?.toLowerCase() !== email.toLowerCase()) {
    // Si Auth.js a nommé la cause dans l'URL (cas « personne n'était connecté »),
    // on la reprend : « CredentialsSignin » est un diagnostic, « ce n'est pas
    // la bonne personne » n'en est pas un.
    const code = /[?&]error=([^&]+)/.exec(finalUrl)?.[1] ?? null;
    throw new Error(
      `credentials login for ${email} did NOT sign that member in: /api/auth/session reports ` +
        `${signedInAs ?? '(nobody)'}` +
        (code ? ` — Auth.js refused with ${code} (final URL: ${finalUrl})` : '') +
        `. Refusing to hand back a session that belongs to someone else — ` +
        `the calling test would silently assert against the wrong member.`,
    );
  }

  // Step 4 — find the session cookie in the request context cookie jar and
  // forward it to the browser context Playwright will navigate with.
  //
  // APRÈS le contrôle d'identité, et pas avant : c'est sur l'état du pot au
  // moment du `whoami` que le serveur s'est prononcé. Prélever le cookie plus
  // tôt reviendrait à prouver l'identité d'une photo et à en injecter une
  // autre.
  const cookies = await request.storageState();
  const sessionCookies = cookies.cookies.filter((c) => isSessionCookieName(c.name));
  const sessionCookie = sessionCookies[0];
  if (!sessionCookie) {
    throw new Error(
      `no session cookie found after credentials callback (got: ${cookies.cookies.map((c) => c.name).join(', ')})`,
    );
  }
  if (sessionCookies.length > 1) {
    // Deux cookies de session dans le pot (par exemple `authjs.session-token`
    // ET `__Secure-authjs.session-token`, ou deux domaines) : le serveur a
    // tranché sur l'ENSEMBLE, alors qu'on n'en injecte qu'un, choisi par ordre
    // d'insertion. Le silence ici serait un pari.
    throw new Error(
      `ambiguous session state: the jar holds ${sessionCookies.length} session cookies ` +
        `(${sessionCookies.map((c) => `${c.name}@${c.domain}`).join(', ')}). ` +
        `Refusing to guess which one /api/auth/session just answered for.`,
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
