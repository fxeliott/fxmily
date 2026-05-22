/**
 * FormData → Zod input shapers for the Public Track Record admin (T5).
 *
 * Extracted from `actions.ts` (`'use server'` + chains `@/auth` → `next-auth`
 * → server-only graph) so unit tests can import the pure helpers without
 * dragging the entire Next/Auth runtime into Vitest. Pattern carbone
 * `lib/admin/public-trade-math.ts` (extrait du service pour testabilité).
 *
 * No `'use server'`, no `@/auth`, no `next/*`, no DB imports here.
 */

import { NOTES_MAX, SCREENSHOT_URL_MAX, SETUP_MAX } from '@/lib/schemas/public-trade';

// =============================================================================
// Field-level helpers
// =============================================================================

/**
 * Extrait + cast un champ FormData en string trimmé, ou `undefined` si vide.
 * Cap defensif à 2048 chars (anti-DoS — chaque field individuel borné, le
 * service en plus borne via Zod).
 *
 * Utilisé sur le CREATE path : un champ absent du form (ou vide) signifie
 * "non fourni" = laisse Zod appliquer ses defaults. Pour l'UPDATE path où
 * l'admin peut vouloir explicitement *effacer* un nullable field, voir
 * `strFieldNullable` ci-dessous.
 */
export function strField(fd: FormData, key: string, maxLen = 2048): string | undefined {
  const v = fd.get(key);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.length > maxLen) return t.slice(0, maxLen);
  return t;
}

/**
 * Variante `strField` pour le UPDATE path qui distingue 3 états :
 *   - `undefined` : le champ n'est PAS dans la FormData (form n'a pas envoyé
 *     l'input du tout — ex. partial update API non-form). Service-side =
 *     "ne touche pas, garde la valeur existante".
 *   - `null` : le champ est présent dans la FormData MAIS valeur vide après
 *     trim. Signal explicite "l'admin veut effacer ce champ". Service-side =
 *     "écris NULL en DB".
 *   - `string` : valeur non-vide, comme strField.
 *
 * T5 audit Phase H — code-reviewer BLOQUANT-1 : sans cette distinction, un
 * admin qui efface un champ nullable (`notes`, `exitedAt`, `screenshotUrl`,
 * etc.) sur le form edit voyait silencieusement la valeur DB conservée. Pire :
 * impossible de re-ouvrir un trade `closed → open` en effaçant `exitedAt`.
 */
export function strFieldNullable(
  fd: FormData,
  key: string,
  maxLen = 2048,
): string | null | undefined {
  if (!fd.has(key)) return undefined;
  const v = fd.get(key);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > maxLen) return t.slice(0, maxLen);
  return t;
}

/**
 * Variante numérique de `strFieldNullable`. Empty input → `null` (clear),
 * absent du form → `undefined` (keep), non-vide → coerce en number.
 *
 * **Sémantique « admin invalide »** distinguée en 2 cas (T5 audit Phase H+1 H-4) :
 *   - `NaN` (input non-numérique type `"abc"`, `"NaN"` literal) → `null`
 *     ("admin a tapé du garbage → on clear le champ silencieusement, garde
 *     l'UX simple : pas de message Zod confusant pour une frappe complète").
 *   - `±Infinity` (overflow numérique : `"1e500"`, `"-1e500"`, `"Infinity"`)
 *     → **pass-through** (`Infinity`/`-Infinity`). Le Zod `.finite()` refine
 *     en aval rejette avec un message clair "R doit être un nombre fini"
 *     → admin VOIT son erreur au lieu du silent-clear.
 *
 * Avant H-4 : `Number.isFinite(n) ? n : null` mappait Infinity + NaN
 * indistinctement à null → admin qui tape `1e500` (vrai nombre overflow)
 * voyait son R disparaître sans erreur visible.
 */
export function numFieldNullable(
  fd: FormData,
  key: string,
  maxLen = 16,
): number | null | undefined {
  const raw = strFieldNullable(fd, key, maxLen);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const n = Number(raw);
  // `NaN` (input non-parsable comme nombre) → silent clear.
  // `±Infinity` (overflow) → pass-through, Zod `.finite()` rejette en aval.
  return Number.isNaN(n) ? null : n;
}

/**
 * Lit un boolean depuis FormData. HTML checkbox absente = false ; valeur
 * 'on'/'true'/'1' = true ; 'off'/'false'/'0' = false. Default = fallback.
 */
export function boolField(fd: FormData, key: string, fallback = false): boolean {
  const v = fd.get(key);
  if (typeof v !== 'string') return fallback;
  const t = v.trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(t)) return true;
  if (['off', 'false', '0', 'no'].includes(t)) return false;
  return fallback;
}

/**
 * Parse un input `tags` en CSV (`news, FOMC, partagé`). Le service Zod tag
 * schema fait le trim + safeFreeText par tag. Cap aligné sur la capacité
 * théorique Zod (`TAGS_MAX=10` × `TAG_MAX=50` = 500 chars + marge séparateurs
 * = 600). Au-delà, Zod max 10 × 50 chars couvre — mais sans ce nouveau cap,
 * un admin qui paste accidentellement 4000 chars verrait `tag #11+` silencieusement
 * tronqué mid-tag par `.slice(0, 200)`. T5 audit Phase H+1 code-reviewer
 * IMPORTANT-5 : raise cap 200 → 600 pour ne plus jamais clip mid-tag.
 */
export const TAGS_FIELD_RAW_CAP = 600;

export function tagsField(fd: FormData): string[] {
  const v = fd.get('tags');
  if (typeof v !== 'string') return [];
  const raw = v.trim();
  if (raw.length === 0) return [];
  return raw
    .slice(0, TAGS_FIELD_RAW_CAP)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// =============================================================================
// CommonInput + composite shapers
// =============================================================================

export interface CommonInput {
  segment?: string | undefined;
  ordinal?: number | undefined;
  instrument?: string | undefined;
  direction?: string | null | undefined;
  enteredAt?: string | undefined;
  exitedAt?: string | null | undefined;
  riskPercent?: number | undefined;
  resultR?: number | null | undefined;
  status?: string | undefined;
  session?: string | null | undefined;
  setup?: string | null | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
  screenshotUrl?: string | null | undefined;
  isPublished?: boolean | undefined;
}

/**
 * Construit un input object à partir de FormData. Les champs vides
 * deviennent `undefined` (Zod treats undefined as "not provided" → permet
 * d'avoir des optional schemas qui ne tombent pas sur `null` quand le user
 * laisse blank).
 *
 * Pour `nullable` fields (direction, exitedAt, etc.), le caller décide après
 * (sur create ils sont laissés undefined, sur update on les passe explicitement
 * en null si le user a coché "clear").
 */
export function shapeFormData(fd: FormData): CommonInput {
  const ordinalRaw = strField(fd, 'ordinal', 16);
  const riskRaw = strField(fd, 'riskPercent', 16);
  const resultRRaw = strField(fd, 'resultR', 16);

  return {
    segment: strField(fd, 'segment', 32),
    ordinal: ordinalRaw !== undefined ? Number(ordinalRaw) : undefined,
    instrument: strField(fd, 'instrument', 32),
    direction: strField(fd, 'direction', 32),
    enteredAt: strField(fd, 'enteredAt', 64),
    exitedAt: strField(fd, 'exitedAt', 64),
    riskPercent: riskRaw !== undefined ? Number(riskRaw) : undefined,
    resultR: resultRRaw !== undefined ? Number(resultRRaw) : undefined,
    status: strField(fd, 'status', 32),
    session: strField(fd, 'session', 32),
    setup: strField(fd, 'setup', SETUP_MAX),
    tags: tagsField(fd),
    notes: strField(fd, 'notes', NOTES_MAX),
    screenshotUrl: strField(fd, 'screenshotUrl', SCREENSHOT_URL_MAX),
    // T5 audit fix #14 — HTML checkbox absent = unchecked. Fallback DOIT être
    // `false`, sinon `<input type="checkbox" defaultChecked={false}>` non touché
    // par l'admin enverrait null → fallback `true` → impossible de créer un
    // brouillon. Le form set `defaultChecked={true}` au create (le browser
    // envoie 'on' tant que l'admin ne décoche pas) ⇒ default = published OK.
    isPublished: boolField(fd, 'isPublished', false),
  };
}

/**
 * Variante de `shapeFormData` pour le UPDATE path.
 *
 * T5 audit Phase H — code-reviewer BLOQUANT-1 : les nullable fields (`direction`,
 * `exitedAt`, `resultR`, `session`, `setup`, `notes`, `screenshotUrl`) doivent
 * pouvoir être effacés explicitement par l'admin. Utilise `*Nullable` helpers
 * qui retournent `null` quand le form envoie une valeur vide.
 *
 * Les fields NON-nullable (segment, ordinal, instrument, enteredAt, riskPercent,
 * status, tags, isPublished) gardent le comportement `undefined` = "non fourni
 * = keep existing" (Zod superRefine + service `validateLifecycleInvariants`
 * post-merge attrapent les invariants violés).
 *
 * @invariant Le form UI rend INCONDITIONNELLEMENT les 14 inputs (cf.
 * `components/admin/track-record/public-trade-form.tsx`) — aucun
 * `{condition && <input>}` rendu conditionnel. Si cette convention est
 * cassée demain (rendu conditionnel d'un nullable field), le fix BLOQUANT-1
 * régresse SILENCIEUSEMENT : `fd.has(absentField)` → `false` →
 * `strFieldNullable` retourne `undefined` (keep existing) au lieu de `null`
 * (clear). L'admin croit avoir effacé un champ et il reste en DB. Phase H+1
 * code-reviewer H-2 : commentaire d'ancrage du contrat pour éviter cette
 * régression latente.
 */
export function shapeFormDataForUpdate(fd: FormData): CommonInput {
  const ordinalRaw = strField(fd, 'ordinal', 16);
  const riskRaw = strField(fd, 'riskPercent', 16);

  return {
    segment: strField(fd, 'segment', 32),
    ordinal: ordinalRaw !== undefined ? Number(ordinalRaw) : undefined,
    instrument: strField(fd, 'instrument', 32),
    direction: strFieldNullable(fd, 'direction', 32),
    enteredAt: strField(fd, 'enteredAt', 64),
    exitedAt: strFieldNullable(fd, 'exitedAt', 64),
    riskPercent: riskRaw !== undefined ? Number(riskRaw) : undefined,
    resultR: numFieldNullable(fd, 'resultR', 16),
    status: strField(fd, 'status', 32),
    session: strFieldNullable(fd, 'session', 32),
    setup: strFieldNullable(fd, 'setup', SETUP_MAX),
    tags: tagsField(fd),
    notes: strFieldNullable(fd, 'notes', NOTES_MAX),
    screenshotUrl: strFieldNullable(fd, 'screenshotUrl', SCREENSHOT_URL_MAX),
    isPublished: boolField(fd, 'isPublished', false),
  };
}
