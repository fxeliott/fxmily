import type { APIRequestContext, Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { TokenBucketLimiter } from '@/lib/rate-limit/token-bucket';

import { loginAs, nextSyntheticCallerIp } from './e2e-auth';

/**
 * Regression guard for the deterministic e2e.yml auth failure.
 *
 * Symptom (pre-fix): `e2e.yml` was RED on `main`. Three specs
 * (`v1-8-reflect-happy-path:267`, `wizard-v1-5-fields:167`+`:210`) failed
 * deterministically at `loginAs` with
 * `no session cookie found after credentials callback`, preceded by
 * repeated `[auth][error] CredentialsSignin` — but only LATE in the run,
 * while earlier specs using the same helper passed, and it survived
 * Playwright's ×2 retries.
 *
 * Root cause: the production Credentials `authorize()` consumes
 * `loginIpLimiter` (burst 10, refill 1 token / 60 s) keyed by
 * `callerIdTrusted()`. Under `next dev` in CI there is no Caddy and no
 * `x-forwarded-for` / `x-real-ip`, so `callerIdTrusted()` returns the
 * literal key `'unknown'` for EVERY request. The whole 46-spec suite then
 * shares one bucket: after ~10 cumulative logins it is drained, refill is
 * far too slow (1/min) to recover between specs, and every later login
 * gets `authorize() === null` → `CredentialsSignin` → no session cookie.
 *
 * Fix: `loginAs` now stamps a unique synthetic `x-forwarded-for` per call
 * (`nextSyntheticCallerIp`), so each login lands in its own fresh bucket —
 * exactly as N real members on N real IPs would. The limiter still runs on
 * every login; it is simply no longer artificially exhausted by the
 * harness collapsing to one origin.
 *
 * These tests reproduce the limiter mechanics with the EXACT production
 * `loginIpLimiter` shape and assert: (a) the old shared-key behavior trips
 * mid-suite, (b) the new per-call IPs never trip.
 */

// Mirror of the production `loginIpLimiter` config
// (`lib/rate-limit/token-bucket.ts:274`). A fresh instance per test so the
// module-level singleton state never bleeds in.
function freshLoginIpLimiter(): TokenBucketLimiter {
  return new TokenBucketLimiter({ bucketSize: 10, refillRate: 1 / 60, maxKeys: 5000 });
}

describe('nextSyntheticCallerIp', () => {
  // Why this matters: the fix relies on every call producing a DISTINCT
  // bucket key. A regression that returns a constant (or wraps cheaply)
  // would silently re-introduce the shared-bucket exhaustion.
  it('yields a unique, well-formed RFC1918 address on every call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const ip = nextSyntheticCallerIp();
      expect(ip).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      for (const octet of ip.split('.').slice(1)) {
        expect(Number(octet)).toBeGreaterThanOrEqual(0);
        expect(Number(octet)).toBeLessThanOrEqual(255);
      }
      expect(seen.has(ip)).toBe(false);
      seen.add(ip);
    }
    expect(seen.size).toBe(5000);
  });
});

describe('e2e loginAs rate-limit interaction (deterministic root-cause repro)', () => {
  // Why this matters: this is the executable reproduction of the bug. With
  // the pre-fix behavior (every login collapses to the single
  // `callerIdTrusted` key `'unknown'`), a serial suite that logs in more
  // than `bucketSize` times within a minute trips the limiter — and stays
  // tripped (refill is 1/min, retries happen in seconds). The 11th login
  // is the first to fail, which lines up with the observed "passes early,
  // fails late, sticky across retries" signature.
  it('OLD shared-key behavior: the 11th cumulative login is rejected (root cause)', () => {
    const lim = freshLoginIpLimiter();
    const now = 1_000_000; // frozen clock — no meaningful refill within a fast suite
    const SHARED_KEY = 'unknown'; // what callerIdTrusted() returns with no XFF / x-real-ip

    const decisions = Array.from({ length: 11 }, () => lim.consume(SHARED_KEY, now));

    expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
    expect(decisions[10]?.allowed).toBe(false);
    // And it STAYS rejected on the Playwright retry a few seconds later
    // (well under the 60s needed for a single token to refill).
    expect(lim.consume(SHARED_KEY, now + 3_000).allowed).toBe(false);
  });

  // Why this matters: this is the executable proof of the fix. Simulate a
  // suite far larger than the real one (60 logins ≫ the ~15 loginAs call
  // sites + retries) — with one synthetic IP per login, NONE are ever
  // rejected, because each lands in its own fresh burst-10 bucket.
  it('FIXED per-call IP: 60 sequential logins from distinct synthetic IPs never trip', () => {
    const lim = freshLoginIpLimiter();
    const now = 2_000_000; // frozen clock — prove it works with zero refill help

    for (let i = 0; i < 60; i++) {
      const ip = nextSyntheticCallerIp();
      expect(lim.consume(ip, now).allowed).toBe(true);
    }
  });

  // Why this matters: a single spec re-logging in as the same user (e.g.
  // wizard-v1-5-fields has two RENDER tests on one seeded email) plus
  // Playwright's ×2 retries must still stay under the burst budget. With a
  // unique IP per call this is trivially true even if every login retried
  // the maximum number of times.
  it('FIXED per-call IP: even a 3× retried login stays comfortably under burst 10', () => {
    const lim = freshLoginIpLimiter();
    const now = 3_000_000;
    // 5 specs × 1 login × (1 initial + 2 retries) = 15 logins, all distinct IPs.
    for (let i = 0; i < 15; i++) {
      expect(lim.consume(nextSyntheticCallerIp(), now).allowed).toBe(true);
    }
  });
});

/**
 * `loginAs` doit ÉCHOUER BRUYAMMENT quand le login échoue.
 *
 * LE DÉFAUT. Le helper ne traitait un login comme échoué que si le callback
 * répondait >= 400. Or Auth.js v5 refuse par une **302**. Le contrôle suivant
 * — « trouve un cookie de session dans le pot du fixture `request` » — cherche
 * dans un pot PARTAGÉ par tous les `loginAs` d'un même test, et **44 tests en
 * enchaînent de 2 à 8**, souvent en basculant admin ↔ membre. Après un premier
 * login réussi, ce pot contient déjà une session : le helper la renvoyait comme
 * si elle appartenait au second membre. Le test appelant interrogeait alors
 * silencieusement la mauvaise personne, et rendait des verdicts faux dans les
 * deux sens.
 *
 * CE QUI A ÉTÉ MESURÉ, ET CE QUE ÇA A TUÉ. Deux gardes plus « évidents » ont
 * été écrits, puis réfutés par le runtime — `tests/e2e/e2e-auth-helper.spec.ts`
 * en garde la mesure contre un build de production :
 *
 *   · « l'URL finale contient `error=` » → AVEUGLE dès qu'une session est déjà
 *     en place. Auth.js redirige bien vers `/login?error=…` (302 vérifiée avec
 *     `maxRedirects: 0`), mais `/login` renvoie un membre connecté vers
 *     `/dashboard` : la seconde redirection efface le signal.
 *   · « la valeur du cookie a changé » → AVEUGLE aussi : la requête suivie
 *     fait tourner le JWT, donc la valeur change même quand le login a échoué.
 *
 * Le seul signal fiable est l'IDENTITÉ : `/api/auth/session` disait, lui,
 * qu'on était toujours le membre précédent. La bonne question n'est pas « une
 * session a-t-elle été émise ? » mais « est-ce la session de la personne
 * demandée ? ».
 *
 * Ce faux serveur reproduit exactement ce comportement — y compris le fait
 * qu'un refus ne dérange PAS la session en place — pour que la reproduction
 * soit fidèle et non une maquette arrangeante.
 */
describe('loginAs — un login refusé ne doit JAMAIS rendre la session du login précédent', () => {
  const ORIGIN = 'http://localhost:3000';
  /** URL finale d'un refus quand PERSONNE n'est connecté (mesurée). */
  const FAILURE_URL = `${ORIGIN}/login?error=CredentialsSignin&code=credentials`;

  function makeHarness(accounts: Record<string, string>) {
    /** Le pot à cookies du fixture `request`, partagé entre les appels. */
    const jar: {
      name: string;
      value: string;
      domain: string;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax';
    }[] = [];
    /** Ce qui finit réellement dans le navigateur. */
    const injected: { name: string; value: string }[] = [];
    /** Qui le serveur croit que nous sommes — la vérité d'`/api/auth/session`. */
    let sessionOwner: string | null = null;
    let minted = 0;

    const setSessionCookie = (value: string) => {
      const existing = jar.find((c) => c.name === 'authjs.session-token');
      if (existing) existing.value = value;
      else
        jar.push({
          name: 'authjs.session-token',
          value,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        });
    };

    const request = {
      get: async (url: string) => {
        if (url.includes('/api/auth/session')) {
          return {
            status: () => 200,
            json: async () => (sessionOwner ? { user: { email: sessionOwner } } : {}),
          };
        }
        return {
          status: () => 200,
          json: async () => ({ csrfToken: 'csrf-fixe-pour-le-test' }),
        };
      },
      post: async (
        _url: string,
        opts: {
          form: { email: string; password: string; callbackUrl: string };
          headers: Record<string, string>;
        },
      ) => {
        const { email, password } = opts.form;
        // Le harnais ne se contente pas de répondre : il VÉRIFIE ce que le
        // helper envoie. Deux régressions documentées dans `e2e-auth.ts`
        // passeraient sinon inaperçues ici — l'IP synthétique par appel (sans
        // laquelle la suite épuise un seul seau de rate-limit) et le
        // `callbackUrl` absolu (dont la forme `null/dashboard` avait tué la
        // pose du cookie en mai).
        expect(opts.headers['x-forwarded-for']).toMatch(/^10\.\d+\.\d+\.\d+$/);
        expect(opts.form.callbackUrl).toBe(`${ORIGIN}/dashboard`);

        // Le vrai serveur normalise la casse de l'e-mail ; la maquette aussi,
        // sinon elle validerait un `loginAs` qui échouerait en vrai.
        const normalised = email.toLowerCase();
        if (accounts[normalised] === password) {
          minted += 1;
          sessionOwner = normalised;
          setSessionCookie(`JWE-${normalised}-${minted}`);
          return { status: () => 200, text: async () => '', url: () => `${ORIGIN}/dashboard` };
        }

        // REFUS. Deux comportements distincts, tous deux mesurés :
        if (sessionOwner) {
          // Une session est en place → Auth.js redirige vers /login?error=,
          // puis /login renvoie le connecté vers /dashboard. L'URL finale ne
          // porte donc AUCUNE erreur, et le JWT tourne au passage : la valeur
          // du cookie change. La session, elle, reste celle du membre d'avant.
          minted += 1;
          setSessionCookie(`JWE-${sessionOwner}-rotate-${minted}`);
          return { status: () => 200, text: async () => '', url: () => `${ORIGIN}/dashboard` };
        }
        // Personne n'est connecté → l'URL finale porte bien le refus.
        return { status: () => 200, text: async () => '', url: () => FAILURE_URL };
      },
      storageState: async () => ({ cookies: jar.map((c) => ({ ...c })) }),
    } as unknown as APIRequestContext;

    const page = {
      context: () => ({
        addCookies: async (cookies: { name: string; value: string }[]) => {
          injected.push(...cookies.map((c) => ({ name: c.name, value: c.value })));
        },
      }),
    } as unknown as Page;

    return { request, page, injected };
  }

  it('modélise fidèlement le succès : le cookie fraîchement émis part au navigateur', async () => {
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp' });
    const { sessionToken } = await loginAs(h.page, h.request, 'a@fxmily.local', 'bon-mdp');

    expect(sessionToken).toBe('JWE-a@fxmily.local-1');
    expect(h.injected).toEqual([{ name: 'authjs.session-token', value: 'JWE-a@fxmily.local-1' }]);
  });

  it('LE DÉFAUT : après un succès, un login refusé lève — et NI l’URL NI le cookie ne pouvaient le dire', async () => {
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp', 'b@fxmily.local': 'autre-mdp' });

    const first = await loginAs(h.page, h.request, 'a@fxmily.local', 'bon-mdp');
    expect(first.sessionToken).toBe('JWE-a@fxmily.local-1');

    // Dans ce scénario — le scénario RÉEL — l'URL finale est `/dashboard` et la
    // valeur du cookie a changé. Seul le contrôle d'identité peut refuser.
    await expect(
      loginAs(h.page, h.request, 'b@fxmily.local', 'mauvais-mdp'),
      "un login refusé doit lever ; sans ça le test suivant interroge silencieusement le membre A alors qu'il croit parler à B",
    ).rejects.toThrow(/did NOT sign that member in.*a@fxmily\.local/s);

    // Et surtout : RIEN de neuf n'a été injecté dans le navigateur.
    expect(
      h.injected,
      'la session du membre A a été réinjectée pour le membre B — contamination croisée',
    ).toEqual([{ name: 'authjs.session-token', value: 'JWE-a@fxmily.local-1' }]);
  });

  it('pas de faux positif : deux logins VALIDES successifs passent et portent des jetons distincts', async () => {
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp', 'b@fxmily.local': 'autre-mdp' });

    const first = await loginAs(h.page, h.request, 'a@fxmily.local', 'bon-mdp');
    const second = await loginAs(h.page, h.request, 'b@fxmily.local', 'autre-mdp');

    expect(first.sessionToken).not.toBe(second.sessionToken);
    expect(h.injected.map((c) => c.value)).toEqual([
      'JWE-a@fxmily.local-1',
      'JWE-b@fxmily.local-2',
    ]);
  });

  it('pas de faux positif non plus quand le MÊME membre se reconnecte (jeton renouvelé)', async () => {
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp' });

    await loginAs(h.page, h.request, 'a@fxmily.local', 'bon-mdp');
    const again = await loginAs(h.page, h.request, 'a@fxmily.local', 'bon-mdp');

    expect(again.sessionToken).toBe('JWE-a@fxmily.local-2');
  });

  it('la casse de l’e-mail ne fabrique pas un faux refus', async () => {
    // Le serveur normalise volontiers les e-mails ; comparer sans replier la
    // casse ferait rejeter un login parfaitement valide.
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp' });
    const r = await loginAs(h.page, h.request, 'A@Fxmily.Local', 'bon-mdp');
    expect(r.sessionToken).toBe('JWE-a@fxmily.local-1');
  });

  it('premier login refusé (pot vide) : le message nomme le refus d’Auth.js, pas une identité manquante', async () => {
    // Ici PERSONNE n'est connecté : l'URL finale porte `error=`, et c'est le
    // garde le plus précoce qui parle. Ce test est ce qui empêche ce garde
    // d'être supprimé « puisque l'identité suffit » — il échoue plus tôt et
    // nomme le code d'Auth.js, ce qu'un « ce n'est pas la bonne personne »
    // ne dirait pas.
    const h = makeHarness({ 'a@fxmily.local': 'bon-mdp' });

    await expect(loginAs(h.page, h.request, 'a@fxmily.local', 'mauvais-mdp')).rejects.toThrow(
      /REFUSED for a@fxmily\.local: CredentialsSignin/,
    );
    expect(h.injected).toEqual([]);
  });
});
