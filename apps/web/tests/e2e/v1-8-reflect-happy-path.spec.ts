/**
 * V1.8 REFLECT E2E — happy-path : capture / persist / render.
 *
 * Comble le gap documenté de longue date (header de
 * `v1-8-reflect.spec.ts:7-9`) : la suite existante ne couvre QUE les
 * auth-gates anonymes. Aucun test ne prouvait, membre connecté, qu'une
 * revue hebdo / une réflexion ABCD / des tags de trade écrits en base
 * se relisent correctement ET s'affichent sur `/review` et `/reflect`.
 *
 * Couvre les 3 phases du critère "Done quand" :
 *
 *   1. **CAPTURE** — une `WeeklyReview` / `ReflectionEntry` / un
 *      `Trade.tags` créés directement via Prisma sont acceptés par le
 *      schéma DB V1.8 (le typage Prisma 7 garantit le contrat à la
 *      compilation ; le test le re-vérifie au runtime).
 *   2. **PERSIST** — round-trip DB : ce qu'on écrit est ce qu'on relit,
 *      avec les types exacts. Les colonnes `@db.Date`
 *      (`week_start`/`week_end`/`date`) sont ancrées sur le jour civil
 *      Europe/Paris du membre — `localDateOf`/`parseLocalDate` exactement
 *      comme `checkin-happy-path.spec.ts:22,101` (sinon flake nocturne
 *      déterministe 22:00–00:00 UTC, cf. checkin-happy-path commentaire).
 *   3. **RENDER** — `/review` + `/reflect` chargent (membre actif, pas de
 *      bounce `/login`) et affichent la ligne seedée dans leur timeline,
 *      sans error-overlay Next.
 *
 * Ce qui n'est PAS couvert ici (déjà testé ailleurs ou hors scope) :
 *   - Le drive UI des wizards (`<WeeklyReviewWizard>` / `<ReflectionWizard>`
 *     posent leur état via inputs cachés + localStorage — selectors
 *     fragiles ; décision canon `wizard-v1-5-fields.spec.ts:19-26`). La
 *     couche capture est testée au niveau Zod / Server Action par les
 *     Vitest unit/RTL (V1.8 backend tests + V1.9 RTL wizards).
 *   - La crise (`?crisis=high|medium` redirect + persist-quand-même) :
 *     couverte par les Vitest `batch.test.ts` / actions. L'auth-bounce
 *     `/review?crisis=*` reste couvert par `v1-8-reflect.spec.ts`.
 *
 * Cleanup : `WeeklyReview` + `ReflectionEntry` déclarent `onDelete: Cascade`
 * sur la relation `user` (`schema.prisma:1157` + `:1200`, FK Postgres
 * matérialisée par la migration `20260513150000_v1_8_reflect_models`). Le
 * nettoyage est donc assuré par la **cascade FK Postgres déclenchée par le
 * `db.user.deleteMany` final de `cleanupTestUsers`** (`db-helpers.ts:155`)
 * — PAS par un `deleteMany` V1.8 dédié dans le helper (`cleanupTestUsers`
 * n'en liste aucun pour ces 2 tables ; les trades, eux, ont leur deleteMany
 * explicite `db-helpers.ts:150`). Décision verrouillée : ce trou pré-existant
 * du helper partagé (antérieur à ce spec — modèles V1.8 livrés 2026-05-13)
 * n'est volontairement PAS élargi ici (scope = 1 spec, pas l'infra de test
 * partagée par ~7 specs). La doctrine défensive du helper `db-helpers.ts:137-139`
 * (deleteMany explicite pour que les logs soient parlants si une future
 * migration drop la cascade) appartient à la PR de cette future migration,
 * pas à celle-ci. Suivi par une tâche dédiée. La cascade tient aujourd'hui
 * (double-vérifiée code-reviewer + verifier) — pattern de nettoyage
 * identique au sibling canon V1.5.2.
 *
 * Skipping policy (carbone J9 visual) : si Playwright Chromium n'est pas
 * installé, la suite skip avec un message clair plutôt que de planter.
 */

import { existsSync } from 'node:fs';

import { expect, test } from './fixtures';
import { chromium } from './fixtures';

import { localDateOf, parseLocalDate, shiftLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const SEED_EMAIL = 'v1-8-reflect.member.e2e.test@fxmily.local';
const SEED_PASSWORD = 'V1_8-ReflectPwd-2026!';

const PARIS_TZ = 'Europe/Paris';

// Sentinels ASCII (sans accent) placés en tête des champs free-text pour
// rester dans la 1ʳᵉ ligne `line-clamp` et être assertables sans fragilité
// d'encodage. Posture Mark Douglas / SPEC §2 : langage de PROCESS, jamais
// de P&L, jamais d'analyse de marché.
const REVIEW_LESSON_MARKER = 'Marqueur lecon E2E REVIEW';
const REFLECT_TRIGGER_MARKER = 'Marqueur E2E REFLECT declencheur';

let seeded: SeededUser | null = null;

/** Lundi (UTC) de la semaine civile Europe/Paris contenant `now`, en YYYY-MM-DD. */
function currentParisWeekMonday(): string {
  const todayParis = localDateOf(new Date(), PARIS_TZ);
  const probe = parseLocalDate(todayParis); // UTC-midnight Date
  const dow = probe.getUTCDay(); // 0=dim … 6=sam
  const sinceMonday = (dow + 6) % 7; // lun→0, mar→1, … dim→6
  return shiftLocalDate(todayParis, -sinceMonday);
}

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

test.describe('V1.8 REFLECT — happy-path persist/render (weekly review · reflection · trade tags)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    // Idempotent cleanup before seeding (cascade wipes any prior V1.8 rows).
    await cleanupTestUsers();
    seeded = await seedMemberUser({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      firstName: 'V1_8',
      lastName: 'Reflect',
    });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    seeded = null;
  });

  test('CAPTURE + PERSIST: a WeeklyReview round-trips through Prisma (Monday @db.Date, process language)', async () => {
    if (!seeded) throw new Error('seed missing — beforeAll did not run');

    const mondayStr = currentParisWeekMonday();
    const weekStartDate = parseLocalDate(mondayStr);
    const weekEndStr = shiftLocalDate(mondayStr, 6);
    const weekEndDate = parseLocalDate(weekEndStr);

    // The real app only ever writes a Monday-UTC weekStart (Zod
    // `weekStartMondaySchema`) — assert the fixture math is faithful.
    expect(weekStartDate.getUTCDay()).toBe(1);

    const review = await db.weeklyReview.create({
      data: {
        userId: seeded.id,
        weekStart: weekStartDate,
        weekEnd: weekEndDate,
        biggestWin:
          "Marqueur E2E REVIEW. J'ai respecte mon plan de sortie sans trailer le stop par impulsion.",
        biggestMistake:
          "J'ai saute la relecture de ma checklist avant la session de Londres mardi.",
        bestPractice:
          "J'ai note ce qui a marche avant de chercher les erreurs (reverse-journaling).",
        lessonLearned: `${REVIEW_LESSON_MARKER} : sans checklist je devie, je la relis avant chaque session.`,
        nextWeekFocus: 'Relire la checklist a voix haute avant chaque ouverture de session.',
      },
      select: {
        id: true,
        weekStart: true,
        weekEnd: true,
        biggestWin: true,
        biggestMistake: true,
        bestPractice: true,
        lessonLearned: true,
        nextWeekFocus: true,
      },
    });

    // @db.Date round-trips as UTC-midnight Date — serialize like the
    // service does (`weekly-review/service.ts:75`).
    expect(review.weekStart.toISOString().slice(0, 10)).toBe(mondayStr);
    expect(review.weekEnd.toISOString().slice(0, 10)).toBe(weekEndStr);
    expect(review.lessonLearned).toContain(REVIEW_LESSON_MARKER);
    expect(review.biggestWin).toContain('Marqueur E2E REVIEW');
    expect(review.bestPractice).not.toBeNull();
    expect(review.nextWeekFocus.length).toBeGreaterThanOrEqual(10);
  });

  test('CAPTURE + PERSIST: a ReflectionEntry round-trips through Prisma (Ellis ABCD, @db.Date)', async () => {
    if (!seeded) throw new Error('seed missing');

    const todayParis = localDateOf(new Date(), PARIS_TZ);
    const dateDb = parseLocalDate(todayParis);

    const reflection = await db.reflectionEntry.create({
      data: {
        userId: seeded.id,
        date: dateDb,
        triggerEvent: `${REFLECT_TRIGGER_MARKER} : j'ai vu le prix repartir sans moi apres ma sortie.`,
        beliefAuto:
          "Je me suis dit que j'allais rater le mouvement et que je devais rentrer maintenant.",
        consequence:
          "Frustration et envie de revenge-trade ; j'ai failli ouvrir une position non planifiee.",
        disputation:
          "Un trade manque n'est pas une perte ; mon edge est sur la serie, pas sur ce setup.",
      },
      select: {
        id: true,
        date: true,
        triggerEvent: true,
        beliefAuto: true,
        consequence: true,
        disputation: true,
      },
    });

    expect(reflection.date.toISOString().slice(0, 10)).toBe(todayParis);
    expect(reflection.triggerEvent).toContain(REFLECT_TRIGGER_MARKER);
    expect(reflection.beliefAuto.length).toBeGreaterThanOrEqual(10);
    expect(reflection.consequence.length).toBeGreaterThanOrEqual(10);
    expect(reflection.disputation.length).toBeGreaterThanOrEqual(10);
  });

  test('CAPTURE + PERSIST: Trade.tags (LESSOR/Steenbarger) round-trips through Prisma', async () => {
    if (!seeded) throw new Error('seed missing');

    // `tags` is the V1.8 dimension NOT exercised by wizard-v1-5-fields
    // (tradeQuality/riskPct) nor by seedTradeHistory. Slugs are part of
    // TRADE_TAG_SLUGS (`lib/schemas/trade.ts`); DB stays a plain text[].
    const trade = await db.trade.create({
      data: {
        userId: seeded.id,
        pair: 'EURUSD',
        direction: 'long',
        session: 'london',
        enteredAt: new Date('2026-05-12T08:30:00.000Z'),
        entryPrice: 1.085,
        lotSize: 0.1,
        plannedRR: 2,
        outcome: 'loss',
        realizedR: '-1',
        realizedRSource: 'estimated',
        emotionBefore: ['focused'],
        emotionAfter: ['frustrated'],
        planRespected: false,
        hedgeRespected: null,
        tags: ['loss-aversion', 'discipline-high'],
        closedAt: new Date('2026-05-12T11:00:00.000Z'),
      },
      select: { id: true, tags: true },
    });

    expect(trade.tags).toEqual(['loss-aversion', 'discipline-high']);
  });

  test('RENDER: /review loads for the active member and shows the seeded review', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');

    // Shared rows from the PERSIST tests above (beforeAll/afterAll only —
    // no afterEach between tests, sanctioned pattern
    // `wizard-v1-5-fields.spec.ts:216-217`). Serial execution guaranteed
    // by playwright.config `workers: 1` + `fullyParallel: false`.
    await page.goto('/login');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto('/review');
    await page.waitForLoadState('networkidle');

    // Active-member auth gate passed — NOT bounced to /login
    // (`review/page.tsx:45-47`).
    await expect(page).toHaveURL(/\/review/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/miroir/i);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/Tes revues/i);

    // Timeline rendered (only present when recent.length > 0) + the
    // seeded review's lesson visible (`review/page.tsx:136,153`).
    await expect(page.locator('[data-slot="recent-reviews"]')).toBeVisible();
    await expect(page.getByText(new RegExp(REVIEW_LESSON_MARKER))).toBeVisible();

    const errorOverlay = page.locator('[data-nextjs-dialog-overlay]');
    await expect(errorOverlay).toHaveCount(0);
  });

  test('RENDER: /reflect loads for the active member and shows the seeded reflection', async ({
    page,
    request,
  }) => {
    if (!seeded) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, seeded.email, seeded.password);

    await page.goto('/reflect');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/reflect/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Quand la pens/i);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/30 derniers jours/i);

    // Timeline rendered + the seeded reflection's A (triggerEvent)
    // visible (`reflect/page.tsx:130,151`).
    await expect(page.locator('[data-slot="recent-reflections"]')).toBeVisible();
    await expect(page.getByText(new RegExp(REFLECT_TRIGGER_MARKER))).toBeVisible();

    const errorOverlay = page.locator('[data-nextjs-dialog-overlay]');
    await expect(errorOverlay).toHaveCount(0);
  });
});
