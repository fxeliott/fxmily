import type { GuidanceAction } from '@/lib/daily-guidance/service';

/**
 * Ordre des « prochaines actions » sur /objectifs — logique PURE (pas de
 * `server-only`, pas de DB), testée en isolation comme `./projection`.
 *
 * Le guidage du jour est déjà trié « most-now-first », mais /objectifs le
 * re-priorise par ÉTAT pour mettre en avant ce qui est encore faisable :
 *   1. `todo`   — un geste à faire maintenant.
 *   2. `missed` — un rattrapage encore actionnable (S6 §32-2), aligné sur le
 *      fallback délibéré du dashboard (`dashboard/page.tsx`). C'EST une action.
 *   3. `info`   — un repère informatif (ex. une réunion du jour), ni à-faire ni fait.
 *   4. `done`   — déjà accompli, gardé en queue de liste.
 *
 * Régression S6 corrigée ici : `missed` (nouvel état de l'union `GuidanceState`)
 * tombait dans le catch-all avec `done`, SOUS `info` — ce qui enterrait un
 * rattrapage faisable derrière une réunion informative dans le hero d'objectifs.
 */
export const MAX_NEXT_ACTIONS = 4;

export function stateRank(state: GuidanceAction['state']): number {
  return state === 'todo' ? 0 : state === 'missed' ? 1 : state === 'info' ? 2 : 3;
}

/**
 * Trie une copie des actions du guidage par état (todo → missed → info → done)
 * en préservant l'ordre relatif d'origine (tri stable), puis garde au plus
 * `MAX_NEXT_ACTIONS`. Pur ⇒ ne mute jamais l'entrée.
 */
export function orderGuidanceActions(actions: ReadonlyArray<GuidanceAction>): GuidanceAction[] {
  return [...actions]
    .sort((a, b) => stateRank(a.state) - stateRank(b.state))
    .slice(0, MAX_NEXT_ACTIONS);
}
