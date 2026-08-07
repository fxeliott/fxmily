/**
 * J10 — le membre colle un emoji composé dans ses notes, dans un VRAI navigateur.
 *
 * ## Pourquoi ce test existe alors qu'un test unitaire couvre déjà le routage
 *
 * `trade-form-wizard-error-routing.test.tsx` monte le vrai composant sous jsdom
 * et prouve le routage. Il ne prouve PAS le parcours : il part d'un brouillon
 * pré-semé dans `localStorage`, il simule la Server Action, et il ne traverse ni
 * la validation d'étape, ni le réseau, ni Zod côté serveur. Autrement dit il
 * répond à « le routage fonctionne-t-il ? », jamais à « le membre s'en sort-il ? ».
 *
 * Ce spec-ci répond à la seconde question, et c'est la seule qui compte pour
 * quelqu'un qui utilise l'application.
 *
 * ## Le geste reproduit, et pourquoi il est ordinaire
 *
 * `notesSchema` (`lib/schemas/trade.ts`) refuse les caractères de largeur nulle.
 * Or l'emoji 👩‍💻 n'est PAS un caractère : c'est une séquence de trois points de
 * code dont le liant U+200D (ZERO WIDTH JOINER). Un membre qui colle un emoji
 * composé depuis son téléphone, ou du texte copié depuis une page web, introduit
 * donc un caractère refusé sans jamais l'avoir tapé et sans pouvoir le voir.
 *
 * Avant J10 ce refus était SILENCIEUX : le champ n'affichait aucune erreur.
 * Le premier correctif J10 a routé l'erreur vers l'étape du champ… mais `notes`
 * n'appartenait à aucune étape RENDUE, l'index visé sortait du tableau d'icônes,
 * et le wizard entier se démontait — un écran mort, avec un brouillon empoisonné
 * qui reste dans `localStorage`. Le correctif est donc en trois parties, et
 * seul un parcours réel peut dire si l'ensemble tient.
 *
 * ## Critères, posés AVANT l'exécution
 *
 * PASS — le membre s'en sort : le wizard reste monté du début à la fin, et
 *        l'erreur est nommée SUR l'écran qui porte le champ `notes`.
 * FAIL — le wizard se démonte (écran mort), OU la sauvegarde est refusée sans
 *        qu'aucun texte n'en nomme la cause, OU le membre reste bloqué sans
 *        explication.
 *
 * Le test n'IMPOSE PAS le mécanisme. Que le refus vienne de la validation
 * d'étape (côté client, au clic sur « Suivant ») ou du serveur (au moment de
 * sauvegarder), les deux sont des issues acceptables — ce qui ne l'est pas,
 * c'est l'écran mort ou le silence. Figer le mécanisme ferait de ce test un
 * miroir de l'implémentation courante ; ce qu'on veut geler, c'est l'expérience.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

/** 👩‍💻 = U+1F469 + U+200D + U+1F4BB. Le liant central est le caractère refusé. */
const COMPOSED_EMOJI = '\u{1F469}‍\u{1F4BB}';
const POISONED_NOTES = `Setup vu en session ${COMPOSED_EMOJI} rien de spécial`;

let member: SeededUser | null = null;

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

test.describe('J10 — un caractère invisible collé dans les notes ne laisse jamais le membre sans issue', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'J10Notes' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('le wizard reste debout et nomme la cause sur l’écran du champ', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing — beforeAll did not run');

    // Une erreur React non rattrapée remonte ici AVANT de casser l'affichage :
    // c'est le détecteur d'écran mort le plus direct dont on dispose.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/journal/new');
    const wizardHeading = page.locator('h1#wizard-heading');

    // Étape 1/6 — Quand & quelle paire (`enteredAt` est pré-rempli à maintenant).
    await expect(wizardHeading).toHaveText('Quand & quelle paire');
    await page.getByLabel('Paire', { exact: true }).fill('EURUSD');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Étape 2/6 — Direction & session. Session explicite : l'auto-détection
    // dépend de l'heure murale, ce qui rendrait le run non déterministe.
    await expect(wizardHeading).toHaveText('Direction & session');
    await page.getByRole('radio', { name: 'Long', exact: true }).click();
    await page.getByRole('radio', { name: /^Londres/ }).click();
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Étape 3/6 — Prix & taille. Stop sous l'entrée (long) pour satisfaire le
    // `superRefine` de direction.
    await expect(wizardHeading).toHaveText('Prix & taille');
    await page.getByLabel("Prix d'entrée").fill('1.085');
    await page.getByLabel('Taille (lots / contrats)').fill('0.10');
    await page.getByLabel('Stop-loss (optionnel mais recommandé)').fill('1.08');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Étape 4/6 — Plan : R:R prévu. La valeur par défaut du curseur est valide.
    await expect(wizardHeading).toHaveText('Plan : R:R prévu');
    await page.getByRole('button', { name: /Suivant/ }).click();

    // Étape 5/6 — Discipline & émotion : c'est l'écran qui PORTE le champ notes.
    await expect(wizardHeading).toHaveText('Discipline & émotion');
    await page.getByRole('group', { name: 'Plan respecté ?' }).getByText('Oui').click();
    await page.getByRole('group', { name: 'Hedge respecté ?' }).getByText('N/A').click();
    await page.getByRole('button', { name: 'Calme', exact: true }).click();

    // Le geste : coller (pas taper) un texte contenant l'emoji composé.
    const notes = page.locator('#notes');
    await expect(notes).toBeVisible();
    await notes.fill(POISONED_NOTES);
    await expect(notes).toHaveValue(POISONED_NOTES);

    await page.getByRole('button', { name: /Suivant/ }).click();

    // ── Issue A : la validation d'étape a refusé tout de suite. Acceptable, à
    // condition que la cause soit nommée sur CET écran.
    const stayedOnStep5 = await wizardHeading
      .filter({ hasText: 'Discipline & émotion' })
      .isVisible()
      .catch(() => false);

    if (!stayedOnStep5) {
      // ── Issue B : le wizard a laissé passer → on va jusqu'à la sauvegarde,
      // c'est le serveur qui refusera.
      await expect(wizardHeading).toHaveText("Lien TradingView d'entrée");
      const entryBox = page.locator('#tradingViewEntryUrl');
      await entryBox.click();
      await entryBox.pressSequentially('https://www.tradingview.com/x/J10Notes1/');
      const submitBtn = page.getByRole('button', { name: 'Sauvegarder le trade' });
      await expect(submitBtn).toBeEnabled();
      await submitBtn.click();
    }

    // ── Le verdict, identique dans les deux cas ────────────────────────────

    // 1. Le wizard est TOUJOURS monté. C'est le cœur du test : sur le code
    //    d'avant correctif, le composant se démonte ici et ce `h1` disparaît.
    await expect(wizardHeading).toBeVisible({ timeout: 60_000 });

    // 2. Le membre est (ou est revenu) sur l'écran qui porte le champ.
    await expect(wizardHeading).toHaveText('Discipline & émotion');

    // 3. Le champ est marqué en erreur ET la cause est écrite à l'écran.
    await expect(page.locator('#notes')).toHaveAttribute('aria-invalid', 'true');
    const alerts = page.getByRole('alert');
    await expect(alerts.filter({ hasText: /caractères de contrôle/i }).first()).toBeVisible();

    // 4. Ce que le membre a écrit n'a pas été jeté : il peut corriger sur place.
    await expect(page.locator('#notes')).toHaveValue(POISONED_NOTES);

    // 5. Aucune exception React n'a été levée pendant tout le parcours.
    expect(pageErrors, `erreurs page inattendues : ${pageErrors.join(' | ')}`).toEqual([]);

    // 6. Et il s'en sort vraiment : retirer l'emoji débloque la sauvegarde.
    //    Sans cette étape, le test prouverait seulement que l'app dit non
    //    proprement — jamais qu'il existe un chemin vers le oui.
    await page.locator('#notes').fill('Setup vu en session, rien de special');
    await page.getByRole('button', { name: /Suivant/ }).click();
    await expect(wizardHeading).toHaveText("Lien TradingView d'entrée");
    const entry = page.locator('#tradingViewEntryUrl');
    if ((await entry.inputValue()) === '') {
      await entry.click();
      await entry.pressSequentially('https://www.tradingview.com/x/J10Notes2/');
    }
    const save = page.getByRole('button', { name: 'Sauvegarder le trade' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/\/journal\/[^/]+$/, { timeout: 60_000 });
    expect(pageErrors, `erreurs page inattendues : ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
