import { formatDateTimeLocalInput } from '@/lib/timezones';

/**
 * J10 correctif n°2 — pré-remplissage du champ « date et heure de sortie » du
 * formulaire de clôture (`components/journal/close-trade-form.tsx`).
 *
 * Extrait du composant pour être **testable en environnement node nu** : c'est
 * une fonction de calcul de date, pas du rendu, et le défaut qu'elle corrige
 * était précisément un défaut de calcul que rien ne surveillait.
 *
 * ### Le défaut
 *
 * La valeur proposée était `max(now, entrée + 1 h)`. Sur un trade ouvert depuis
 * moins d'une heure — un scalp, le cas le plus courant — cela proposait une
 * sortie **dans le futur**. Le membre qui validait sans corriger enregistrait
 * une durée de position fausse, et cette durée nourrit l'attribution de
 * session, les moyennes, et les rapports IA. L'heure ajoutée ne mesurait rien :
 * elle était inventée.
 *
 * ### La règle retenue
 *
 * `max(now, enteredAt)` — « maintenant », jamais avant l'entrée.
 *
 * Le plancher à `enteredAt` n'est pas décoratif : `closeTrade` rejette
 * `exitedAt < enteredAt` (`lib/trades/service.ts`) et `tradeOpenSchema` tolère
 * une entrée datée jusqu'à une heure en avant. Sans ce plancher, un tel trade
 * ouvrirait un formulaire structurellement invalide.
 */
export function defaultExitInstant(enteredAt: Date, now: Date = new Date()): Date {
  return new Date(Math.max(now.getTime(), enteredAt.getTime()));
}

/**
 * Même règle, rendue en heure murale `YYYY-MM-DDTHH:mm` pour un
 * `<input type="datetime-local">`, dans le fuseau **réglé** du membre.
 *
 * F2 — le fuseau réglé (ses réglages), pas celui de l'appareil, fait autorité :
 * le serveur réinterprète l'heure murale soumise dans ce même fuseau
 * (`memberWallClock`, `app/journal/actions.ts`). Les deux conversions sont
 * symétriques, donc clôturer sans toucher au champ enregistre exactement
 * l'instant affiché.
 */
export function defaultExitLocalInput(
  enteredAtIso: string,
  timezone: string,
  now: Date = new Date(),
): string {
  return formatDateTimeLocalInput(defaultExitInstant(new Date(enteredAtIso), now), timezone);
}
