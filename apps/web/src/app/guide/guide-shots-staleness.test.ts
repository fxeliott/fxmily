import { describe, expect, it } from 'vitest';

import { GUIDE_CATALOG } from './guide-catalog';
import type { GuideShotManifest } from './guide-shots';
import rawManifest from './guide-shots.manifest.json';

import { routeSourceHash } from '@/test/guide-shot-source';

/**
 * PÉREMPTION DES VIGNETTES DU GUIDE — le rapport qui manquait.
 *
 * ⚠️ CE FICHIER RÉPARE UNE ÉTIQUETTE QUI MENTAIT. `guide-shots.test.ts`
 * contenait un test nommé « le hash de source enregistré reste calculable (le
 * pré-contrôle du job nocturne tient) ». Le pré-contrôle nocturne en question
 * n'existait pas : `guide-surfaces.yml` n'a jamais eu d'étape de péremption, et
 * `sourceHash` était écrit par le générateur sans être relu par personne. Le
 * test gardait donc la calculabilité d'une fonction au nom d'un job imaginaire.
 * Ce fichier EST ce job. L'étiquette redevient vraie.
 *
 * CE QU'IL MESURE
 * ---------------
 * Le manifeste enregistre, pour chaque route, l'empreinte de ses sources à
 * l'instant où sa capture a été prise. Recalculer cette empreinte aujourd'hui
 * et la comparer dit si l'écran a pu bouger depuis la photo.
 *
 * POURQUOI IL NE TOURNE PAS SUR LES PR — ET C'EST MESURÉ, PAS SUPPOSÉ
 * -------------------------------------------------------------------
 * Mesuré le 2026-07-30 : une capture périmée sur 24, `/guide`, et pour la seule
 * raison qu'un COMMENTAIRE de `guide-shots.ts` avait changé dans la journée.
 * L'empreinte porte sur les octets des fichiers de la route ; une JSDoc corrigée
 * la fait bouger autant qu'une refonte. En porte bloquante, ce test serait rouge
 * sur une PR touchant une route (`dashboard/page.tsx` : 13 commits sur 30 jours)
 * et exigerait à chaque fois une régénération Playwright complète — avec base de
 * données et navigateur — pour un commit qui n'a parfois changé qu'une phrase.
 * Un garde qu'on apprend à contourner ne garde rien.
 *
 * Il s'arme donc par `GUIDE_SHOTS_STALENESS=1`, comme `guide-surfaces-walk`
 * s'arme par `GUIDE_WALK=1`, et le job nocturne le lance en `continue-on-error`.
 * C'est un RAPPORT, pas une porte : il rend visible ce qui ne l'était pas du
 * tout. La différence avec l'état d'avant n'est pas « bloquant vs non
 * bloquant », c'est « détecté vs jamais détecté ».
 *
 * LIMITE HONNÊTE, la même que celle du hash lui-même : l'empreinte ne couvre
 * que les fichiers du DOSSIER de la route. Une refonte d'un composant partagé
 * ou d'un token de `globals.css` change l'écran sans faire bouger un seul de ces
 * hashes. Ce rapport voit la dérive locale, pas la dérive globale.
 */

const manifest = rawManifest as GuideShotManifest;

/** Vrai quand le job nocturne l'arme (`guide-surfaces.yml`). */
const ARMED = process.env.GUIDE_SHOTS_STALENESS === '1';

describe.skipIf(!ARMED)('vignettes du guide — péremption (rapport nocturne)', () => {
  it('le rapport a de la matière (garde de la garde)', () => {
    // Sans ça, un manifeste vidé rendrait le test suivant trivialement vert.
    expect(Object.keys(manifest).length).toBe(GUIDE_CATALOG.length);
    expect(GUIDE_CATALOG.length).toBeGreaterThan(0);
  });

  it('aucune capture ne date d’avant une modification de sa route', () => {
    const stale: string[] = [];
    const unresolvable: string[] = [];

    for (const [href, record] of Object.entries(manifest)) {
      const current = routeSourceHash(href);
      if (current === null) {
        // Route rendue par un segment dynamique parent : pas de dossier propre,
        // donc rien à comparer. Cas légitime, listé pour rester visible.
        unresolvable.push(href);
        continue;
      }
      if (current !== record.sourceHash) {
        stale.push(`${href} (capture prise sur ${record.sourceHash}, sources à ${current})`);
      }
    }

    // Non fatal en soi, mais dit à voix haute combien d'entrées échappent au
    // rapport : si ce nombre grimpait, le rapport se viderait sans le dire.
    expect(
      unresolvable.length,
      `routes sans dossier propre (hors du champ du rapport) : ${unresolvable.join(', ')}`,
    ).toBeLessThan(GUIDE_CATALOG.length / 2);

    expect(
      stale,
      `Captures potentiellement périmées :\n  ${stale.join('\n  ')}\n\n` +
        `Régénérer : \`pnpm --filter @fxmily/web guide:shots\` (Playwright + base locale).\n` +
        `Si seuls des COMMENTAIRES ont changé dans le dossier de la route, l'écran n'a ` +
        `pas bougé et cette ligne est un faux positif connu — l'empreinte porte sur les ` +
        `octets, pas sur le rendu.`,
    ).toEqual([]);
  });
});
