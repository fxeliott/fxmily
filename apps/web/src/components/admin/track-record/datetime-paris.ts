/**
 * T5 admin track-record — Paris-timezone datetime formatting helper.
 *
 * **Phase H+8 — client-side companion du Phase H+5 server preprocess.**
 *
 * Le `<input type="datetime-local">` du form admin pré-remplit avec une
 * string `YYYY-MM-DDTHH:mm` représentant un wall-clock local. Le serveur
 * Phase H+5 (`parisLocalDatetimeToUtc` dans `lib/schemas/public-trade.ts`)
 * assume que cette string EST en heure de Paris et reconstitue le UTC.
 *
 * Le contrat exige donc que le client émette TOUJOURS en Paris-wall-clock,
 * indépendamment du fuseau horaire du browser de l'admin.
 *
 * **Bug latent fixé Phase H+8** : avant ce fix, `toDatetimeLocal` utilisait
 * `d.getTimezoneOffset()` qui retourne l'offset du BROWSER. Pour un admin
 * en France métropolitaine V1, c'était cohérent par chance. Mais :
 *   - Eliot en déplacement NY (UTC-4) : pre-fill `06:00` (NY clock) → submit
 *     → server interprète Paris → UTC `04:00` → drift -6h
 *   - Browser sur runtime serveur Next 16 (SSR) : `getTimezoneOffset` runs
 *     server-side = UTC → drift random
 *
 * Fix : utiliser `Intl.DateTimeFormat` avec `timeZone: 'Europe/Paris'`
 * explicite. Le format `en-CA` fournit `YYYY-MM-DD` natif zero-padded, le
 * `hour12: false` garantit `00-23`. Symétrique avec la helper serveur
 * `parisLocalDatetimeToUtc` (même `Intl` + même `Europe/Paris`).
 *
 * Pourquoi pas une lib (date-fns-tz, luxon) : éviter une dep nouvelle pour
 * un fix scopé. Node 22 LTS bundle full ICU → tous les browsers modernes
 * + SSR Next 16 supportent. Cohérent SPEC §16.
 */

/**
 * Convertit un ISO string (ou Date) en valeur `datetime-local`
 * (YYYY-MM-DDTHH:mm) **toujours interprétée en Europe/Paris**, peu importe
 * le fuseau du runtime (browser ou serveur).
 *
 * Pour `null`/`undefined` ou input invalide → `''` (input vide).
 *
 * **Round-trip Phase H+5 + H+8 garanti** :
 *   1. DB stocke `2026-05-22T10:00:00.000Z` (Paris noon CEST)
 *   2. `toDatetimeLocal(iso)` → `"2026-05-22T12:00"` (Paris wall-clock)
 *   3. Form pre-fills input avec `"2026-05-22T12:00"`
 *   4. Admin submit sans toucher → FormData carrie `"2026-05-22T12:00"`
 *   5. Server `parisLocalDatetimeToUtc` interprète Paris → `2026-05-22T10:00Z`
 *   6. DB row identique (no drift) ✓
 */
export function toDatetimeLocal(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '';

    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';

    // en-CA `hour: '2-digit', hour12: false` produit "24" pour minuit Europe/Paris
    // (au lieu de "00"). On collapse → "00" pour cohérence avec
    // `<input type="datetime-local">` qui n'accepte pas "24:00".
    const rawHour = get('hour');
    const hour = rawHour === '24' ? '00' : rawHour;

    const year = get('year');
    const month = get('month');
    const day = get('day');
    const minute = get('minute');

    if (!year || !month || !day || !hour || !minute) return '';

    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return '';
  }
}
