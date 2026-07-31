/**
 * LE HARNAIS D'AUTHENTIFICATION EST GARDÉ COMME DU CODE DE PRODUCTION.
 *
 * `loginAs` est appelé **151 fois dans 63 des 76 specs** (mesuré le
 * 2026-07-31, ce fichier compris), et **44 tests** enchaînent de 2 à 8 logins
 * dans un seul bloc — souvent en basculant admin ↔ membre.
 * S'il se trompe de personne, il ne casse pas : il rend des verdicts faux,
 * dans les deux sens. C'est le pire défaut possible dans une suite de tests,
 * parce qu'il se déguise en succès.
 *
 * CE QUE CE SPEC PROUVE, ET QU'AUCUN TEST UNITAIRE NE PEUT PROUVER.
 * Les gardes de `loginAs` reposent sur deux faits qui appartiennent au
 * SERVEUR et au CLIENT HTTP de Playwright, pas à notre code :
 *
 *   (A) Auth.js v5 refuse un login avec une **302 vers `?error=…`**, jamais
 *       avec un statut >= 400 — le seul contrôle d'échec qu'avait le helper.
 *   (B) `APIResponse.url()` de Playwright rend l'URL **finale, après
 *       redirections suivies** — sans quoi le garde qui cherche `error=`
 *       dedans regarderait l'URL de la requête et ne verrait jamais rien.
 *
 * Le test unitaire (`src/test/e2e-auth.test.ts`) modélise (A) et (B) dans un
 * faux serveur : il DÉCIDE ce que `url()` renvoie. Il ne peut donc pas dire
 * non si l'hypothèse est fausse — c'est une tautologie déguisée en preuve.
 * Une sonde en Node prouverait (A) mais pas (B) : `fetch` n'est pas le client
 * HTTP de Playwright. Seul un spec Playwright contre le vrai serveur ferme
 * les deux d'un coup, et c'est exactement ce que fait celui-ci.
 *
 * Il n'a pas besoin de navigateur : il parle au serveur avec le même fixture
 * `request` que `loginAs`.
 */
import { expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser } from '@/test/db-helpers';
import { loginAs, nextSyntheticCallerIp } from '@/test/e2e-auth';

const EMAIL_A = 'harness-auth-a.member.e2e.test@fxmily.local';
const EMAIL_B = 'harness-auth-b.member.e2e.test@fxmily.local';
const PASSWORD_A = 'HarnessAuth-A-2026!';
const PASSWORD_B = 'HarnessAuth-B-2026!';

test.describe('Harnais d’auth — un login refusé doit lever, jamais rendre la session précédente', () => {
  // Un seul semis pour tout le fichier : `seedMemberUser` crée (il n'upsert
  // pas), donc deux tests qui sèment le même e-mail se heurtent à la contrainte
  // d'unicité. Le partage est sans risque ici — le pot à cookies, lui, est
  // recréé par test, et c'est de lui seul que parle ce fichier.
  test.beforeAll(async () => {
    await cleanupTestUsers();
    await seedMemberUser({
      email: EMAIL_A,
      password: PASSWORD_A,
      firstName: 'Harness',
      lastName: 'MembreA',
    });
    await seedMemberUser({
      email: EMAIL_B,
      password: PASSWORD_B,
      firstName: 'Harness',
      lastName: 'MembreB',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
  });

  test('(A)+(B) le serveur signale le refus dans l’URL FINALE, et Playwright la rend', async ({
    request,
  }) => {
    // On parle au serveur exactement comme `loginAs`, mais on regarde ce que
    // le couple serveur+client rend RÉELLEMENT — sans passer par le helper.
    // L'IP vient du même générateur que `loginAs` : une adresse codée en dur
    // finirait par épuiser son seau de rate-limit contre un serveur local
    // gardé ouvert, et ce spec rougirait pour une raison qui n'est pas la
    // sienne.
    const ip = nextSyntheticCallerIp();
    const csrfRes = await request.get('/api/auth/csrf', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(csrfRes.status()).toBe(200);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const res = await request.post('/api/auth/callback/credentials?json=true', {
      form: {
        csrfToken,
        email: 'ce-membre-nexiste-pas.harness@fxmily.local',
        password: 'MotDePasseTotalementFaux-2026!',
        callbackUrl: `${new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin}/dashboard`,
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': ip,
      },
    });

    // (A) — le fait qui rendait l'ancien contrôle aveugle : PAS de 4xx/5xx.
    expect(
      res.status(),
      'un login refusé qui répondrait >= 400 rendrait le garde `error=` inutile — mais aussi ' +
        'inoffensif. Si cette assertion tombe, relire le garde avant de la « corriger ».',
    ).toBeLessThan(400);

    // (B) — la sémantique dont dépend le garde ①. Si `url()` rendait l'URL de
    // la REQUÊTE, on lirait `/api/auth/callback/credentials?json=true` et le
    // garde serait mort en silence.
    expect(
      res.url(),
      "APIResponse.url() ne rend pas l'URL finale après redirection : le garde `error=` de " +
        'loginAs ne peut plus rien voir. Il faut alors un autre signal de refus.',
    ).toMatch(/[?&]error=/);
  });

  test('POURQUOI seul le contrôle d’identité tient : le serveur ne signale RIEN quand une session est déjà en place', async ({
    page,
    request,
  }) => {
    await loginAs(page, request, EMAIL_A, PASSWORD_A);
    const before = (await request.storageState()).cookies.find((c) =>
      c.name.endsWith('authjs.session-token'),
    );

    const ip1 = nextSyntheticCallerIp();
    const csrfRes = await request.get('/api/auth/csrf', {
      headers: { 'x-forwarded-for': ip1 },
    });
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
    const res = await request.post('/api/auth/callback/credentials?json=true', {
      form: {
        csrfToken,
        email: EMAIL_B,
        password: 'ce-nest-pas-le-bon-mot-de-passe',
        callbackUrl: `${origin}/dashboard`,
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': ip1,
      },
    });
    const after = (await request.storageState()).cookies.find((c) =>
      c.name.endsWith('authjs.session-token'),
    );

    // POURQUOI l'URL finale ment : on refait le MÊME appel sans suivre les
    // redirections. Auth.js signale bien le refus — il redirige vers
    // `/login?error=…` — mais `/login` renvoie un membre déjà connecté vers
    // `/dashboard`. La deuxième redirection efface la première. C'est mesuré
    // ici plutôt que raconté, parce que c'est toute la différence entre « le
    // serveur ne dit rien » et « le serveur le dit, et on regarde trop tard ».
    const ip2 = nextSyntheticCallerIp();
    const csrf2 = await request.get('/api/auth/csrf', {
      headers: { 'x-forwarded-for': ip2 },
    });
    const { csrfToken: csrfToken2 } = (await csrf2.json()) as { csrfToken: string };
    const direct = await request.post('/api/auth/callback/credentials?json=true', {
      form: {
        csrfToken: csrfToken2,
        email: EMAIL_B,
        password: 'ce-nest-pas-le-bon-mot-de-passe',
        callbackUrl: `${new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin}/dashboard`,
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': ip2,
      },
      maxRedirects: 0,
    });
    expect(direct.status(), 'le refus est bien une redirection').toBe(302);
    expect(
      direct.headers()['location'],
      'la PREMIÈRE redirection porte le refus ; c’est la suivante (/login → /dashboard pour un ' +
        'membre déjà connecté) qui l’efface',
    ).toMatch(/[?&]error=/);
    const whoami = await (
      await request.get('/api/auth/session', { headers: { 'x-forwarded-for': ip1 } })
    ).json();

    // Les trois faits ci-dessous ont été MESURÉS, et chacun a tué un garde que
    // j'avais écrit avant de mesurer. Ils sont épinglés ici parce que le jour
    // où l'un d'eux changera, le garde d'identité pourra être simplifié — et
    // parce que sans eux, quelqu'un réintroduira « il suffit de regarder
    // l'URL » en toute bonne foi.

    // ① L'URL finale ne dit RIEN : Auth.js redirige vers le callbackUrl.
    expect(
      res.url(),
      "si le serveur signalait le refus dans l'URL même quand une session est en place, un " +
        'garde `error=` suffirait — la mesure dit le contraire',
    ).not.toMatch(/[?&]error=/);

    // ② Le statut ne dit rien non plus.
    expect(res.status()).toBeLessThan(400);

    // ③ Le cookie CHANGE (rotation du JWT), donc « la valeur a-t-elle
    //    changé ? » ne peut pas distinguer un vrai login d'un refus.
    expect(
      after?.value,
      'un garde fondé sur « la valeur du cookie a changé » serait aveugle ici',
    ).not.toBe(before?.value);

    // ④ Et pourtant la session appartient TOUJOURS au premier membre. C'est le
    //    seul signal qui dise la vérité, et c'est celui que `loginAs` utilise.
    expect(
      (whoami as { user?: { email?: string } } | null)?.user?.email,
      'la session devrait encore être celle de A — si ce n’est plus le cas, le comportement ' +
        "d'Auth.js a changé et le garde d'identité doit être relu",
    ).toBe(EMAIL_A);
  });

  test('un login refusé APRÈS un login réussi lève, au lieu de rendre la session du premier', async ({
    page,
    request,
  }) => {
    // 1) Login légitime : le pot du fixture `request` contient désormais une
    //    session valide — celle de A.
    const first = await loginAs(page, request, EMAIL_A, PASSWORD_A);
    expect(first.sessionToken).toBeTruthy();

    // 2) Login de B avec un mauvais mot de passe. C'est LE scénario du défaut :
    //    sans garde, le helper trouvait la session de A dans le pot et
    //    l'annonçait comme celle de B.
    await expect(
      loginAs(page, request, EMAIL_B, 'ce-nest-pas-le-bon-mot-de-passe'),
      'un login refusé doit lever ; sinon le test appelant croit parler à B et interroge A',
    ).rejects.toThrow(/did NOT sign that member in/);

    // 3) Et le jeton de A n'a pas été recyclé au passage.
    const stillA = await loginAs(page, request, EMAIL_A, PASSWORD_A);
    expect(
      stillA.sessionToken,
      'deux logins successifs du MÊME membre doivent rendre deux jetons distincts — ' +
        "c'est l'hypothèse dont dépend le second filet de loginAs",
    ).not.toBe(first.sessionToken);
  });
});
