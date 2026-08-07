import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * J10 correctif n°3 — la garde qui rend la dérive impossible, pas seulement
 * corrigée.
 *
 * Corriger les deux magasins de caféine ne sert à rien si un troisième lecteur
 * apparaît demain en lisant `caffeineMl` ou `value.cups` directement, avec sa
 * propre idée de l'unité. Ce test balaie l'arborescence RÉELLE de `src/` — il
 * ne consulte aucune liste de fichiers écrite à la main — et refuse toute
 * lecture de caféine hors des points connus.
 *
 * Pour ajouter un lecteur légitime : passe par `lib/habit/caffeine.ts`. Si tu
 * dois vraiment toucher au champ brut, ajoute le fichier ci-dessous ET écris
 * pourquoi. Le coût de cette ligne est exactement le but : elle force à se
 * demander dans quelle unité on lit.
 */

const SRC = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Fichiers autorisés à toucher un champ brut de caféine, et à quel titre.
 * Chemins relatifs à `apps/web/src`, séparateurs POSIX.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  // LE module canonique — c'est lui qui définit l'unité.
  ['lib/habit/caffeine.ts', 'source unique de vérité sur la caféine'],
  // Écriture : le membre saisit, le schéma valide, le service persiste.
  ['app/checkin/actions.ts', 'écrit caffeineMl depuis le formulaire de check-in'],
  ['app/track/actions.ts', 'écrit value.cups depuis le wizard TRACK'],
  ['lib/schemas/checkin.ts', 'valide caffeineMl à la frontière'],
  ['lib/schemas/habit-log.ts', 'valide value.cups à la frontière'],
  ['lib/checkin/service.ts', 'persiste et relit la ligne de check-in'],
  ['lib/checkin/prefill.ts', 'ré-affiche la valeur saisie dans son propre formulaire'],
  ['lib/habit/today-log.ts', 'ré-affiche les tasses du jour dans le wizard TRACK'],
  ['components/checkin/evening-checkin-wizard.tsx', 'saisit les millilitres'],
  // Transport : recopie la colonne sans l'interpréter.
  ['lib/weekly-report/loader.ts', 'transporte la ligne de check-in telle quelle'],
  ['lib/monthly-debrief/loader.ts', 'transporte la ligne de check-in telle quelle'],
  // Lecture analytique : passe par le module canonique (imports vérifiés plus bas).
  // Il y en a DEUX, et c'est structurel : le pare-feu §21.5 interdit aux modules
  // de rapport d'importer `@/lib/analytics`, d'où un extracteur jumeau côté
  // domaine `habit`. Corriger l'un sans l'autre laisse la moitié du défaut.
  ['lib/analytics/habit-trade-correlation.ts', 'lit via caffeineFromHabitLog'],
  ['lib/habit/pillars.ts', 'lit via caffeineFromHabitLog (jumeau du précédent)'],
  // Affichage : rend l'unité saisie, sans conversion, et la nomme.
  ['components/track/caffeine-zones-bar.tsx', 'affiche les zones en tasses'],
  ['components/track/caffeine-habit-wizard.tsx', 'saisit les tasses'],
  ['components/checkin/checkin-day-list.tsx', 'affiche « N mL caféine », unité écrite'],
]);

/**
 * Les DEUX lecteurs ANALYTIQUES : ceux qui produisent un scalaire destiné à
 * être comparé, moyenné ou corrélé. Ce sont eux qui peuvent produire un
 * chiffre faux si l'unité dérive, donc eux qui doivent passer par le module
 * canonique. Ils sont volontairement séparés (le pare-feu §21.5 interdit aux
 * modules de rapport d'importer `@/lib/analytics`).
 */
const ANALYTICS_READERS = [
  'lib/analytics/habit-trade-correlation.ts',
  'lib/habit/pillars.ts',
] as const;

/**
 * Les lecteurs d'AFFICHAGE : ils ré-affichent au membre, dans l'unité qu'il a
 * saisie, la valeur qu'il a saisie. Aucune conversion, donc aucun risque
 * d'unité — leur faire traverser le module canonique n'apporterait rien.
 *
 * La distinction n'est pas cosmétique : c'est ce test qui me l'a apprise, en
 * refusant de considérer `today-log.ts` comme un lecteur analytique alors que
 * je l'y avais rangé.
 */
const DISPLAY_READERS = ['lib/habit/today-log.ts'] as const;

/** Le champ millilitres du check-in, ou le champ tasses du suivi d'habitude. */
const RAW_CAFFEINE_FIELD = /\bcaffeineMl\b|\bcups\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      walk(full, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function relPosix(abs: string): string {
  return abs.slice(SRC.length).replaceAll('\\', '/').replace(/^\/+/, '');
}

describe('caffeine has a single source of truth', () => {
  const files = walk(SRC)
    .map(relPosix)
    // Les tests et les jeux d'essai fabriquent des valeurs : ils ne sont pas
    // des lecteurs de production.
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !f.startsWith('test/'))
    .filter((f) => !f.startsWith('scripts/'));

  it('finds the source tree (the sweep is not silently empty)', () => {
    // Contrôle de falsification : un balayage qui ne trouve rien passerait
    // tous les tests suivants sans rien prouver.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('lib/habit/caffeine.ts');
  });

  it('has no raw caffeine field read outside the allowed list', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const body = readFileSync(join(SRC, file), 'utf8');
      if (RAW_CAFFEINE_FIELD.test(body)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowed list honest — every entry still touches caffeine', () => {
    // Une liste blanche qui garde des entrées périmées finit par autoriser des
    // fichiers que plus personne n'a examinés.
    const stale: string[] = [];
    for (const [file] of ALLOWED) {
      let body: string;
      try {
        body = readFileSync(join(SRC, file), 'utf8');
      } catch {
        stale.push(`${file} (absent)`);
        continue;
      }
      if (!RAW_CAFFEINE_FIELD.test(body)) stale.push(`${file} (ne touche plus la caféine)`);
    }
    expect(stale).toEqual([]);
  });

  it('routes BOTH analytics readers through the canonical module', () => {
    for (const reader of ANALYTICS_READERS) {
      const body = readFileSync(join(SRC, reader), 'utf8');
      expect(body, `${reader} doit importer le module canonique`).toContain(
        "from '@/lib/habit/caffeine'",
      );
      expect(body, `${reader} doit lire via caffeineFromHabitLog`).toContain(
        'caffeineFromHabitLog(',
      );
    }
  });

  it('classifies every caffeine parser as analytics or display, none unclassified', () => {
    // Toute nouvelle lecture du schéma caféine doit être RANGÉE : soit elle
    // produit un scalaire comparable (et passe par le module canonique), soit
    // elle ré-affiche la saisie du membre. Un parseur non classé est
    // précisément la porte par laquelle une troisième unité entrerait.
    const parsers = files.filter((f) =>
      readFileSync(join(SRC, f), 'utf8').includes('caffeineValueSchema.safeParse'),
    );
    const classified = [...ANALYTICS_READERS, ...DISPLAY_READERS].sort();
    expect(parsers.sort()).toEqual(classified);
  });

  it('keeps display readers free of any unit conversion', () => {
    // Un lecteur d'affichage qui se mettrait à convertir sortirait de sa
    // catégorie sans le dire — et personne ne saurait plus quelle unité est
    // montrée au membre.
    for (const reader of DISPLAY_READERS) {
      const body = readFileSync(join(SRC, reader), 'utf8');
      expect(body, `${reader} ne doit pas convertir`).not.toContain('caffeineCupsToMl');
      expect(body, `${reader} ne doit pas convertir`).not.toContain('caffeineMlToCups');
    }
  });
});
