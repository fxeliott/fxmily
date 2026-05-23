/**
 * Zod schemas for `PublicTrade` + `PublicTradePartial` (T5 admin CRUD).
 *
 * Three layers:
 *   - `publicTradeCreateSchema`  — admin "create trade" form. status-aware
 *                                  refine (closed → exitedAt+resultR mandatory).
 *   - `publicTradeUpdateSchema`  — admin "edit trade" form. All fields optional.
 *   - `publicTradePartialSchema` — admin "add partial leg" sub-form (TP1/TP2).
 *
 * Hardening (carbone `lib/schemas/card.ts` J7 — TIER 3 fix M5 lineage) :
 *   - `instrument` strict `[A-Z0-9]{3,10}` + `safeFreeText` (NFC) +
 *     `containsBidiOrZeroWidth` reject (Trojan Source defense).
 *   - `setup` 0-100 chars + `safeFreeText` + bidi reject.
 *   - `tags` array 0-10 × 0-50 chars chacun + `safeFreeText` + bidi reject.
 *   - `notes` 0-2000 chars + `safeFreeText` + bidi reject.
 *   - `screenshotUrl` 0-500 chars (URL ou R2 storage key) + safeFreeText.
 *   - `ordinal` int 1..99999 (NULL = auto-derive MAX(ordinal)+1 dans service).
 *   - `riskPercent` numeric > 0, ≤ 99.99 (aligné `Trade.riskPct` V1.5
 *     Decimal(4,2) + Tharp ceiling <100%).
 *   - `resultR` numeric -100..100 (Decimal(6,3) — supporte 100R théorique).
 *   - `enteredAt`/`exitedAt` ISO datetime (DateTime Postgres, pas @db.Date).
 *
 * Cross-field invariants (`.superRefine`) :
 *   - `status='closed'` → `exitedAt` + `resultR` REQUIRED.
 *   - `status='break_even'` → `exitedAt` REQUIRED, `resultR` = 0 ou null.
 *   - `status='open'` → `exitedAt` + `resultR` SHOULD BE null (warn-only
 *     dans le form — le service ne calcule pas `resultPercent` si open).
 *
 * `resultPercent` est computed par le service (`riskPercent × resultR`), pas
 * fourni par le form (single source of truth).
 *
 * Enums référencés depuis `@/generated/prisma/enums` (Prisma 7 const-object
 * pattern). Les const arrays ci-dessous SONT les valeurs canoniques —
 * désynchroniser avec `schema.prisma` casse le type-check immédiatement.
 */

import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

// =============================================================================
// Constants — DOIVENT matcher prisma/schema.prisma:1452+
// =============================================================================

export const PUBLIC_TRADE_SEGMENTS = ['historical', 'live'] as const;
export const PUBLIC_TRADE_STATUSES = ['open', 'closed', 'break_even'] as const;
export const TRADE_DIRECTIONS = ['long', 'short'] as const;
export const TRADE_SESSIONS = ['asia', 'london', 'overlap', 'newyork'] as const;

export const INSTRUMENT_REGEX = /^[A-Z0-9]{3,10}$/;
export const INSTRUMENT_MIN = 3;
export const INSTRUMENT_MAX = 10;
export const SETUP_MAX = 100;
export const TAGS_MAX = 10;
export const TAG_MAX = 50;
export const NOTES_MAX = 2000;
export const SCREENSHOT_URL_MAX = 500;

/**
 * Allowlist scheme pour `screenshotUrl` (T5 audit Phase H — SSRF defense,
 * étendu Phase H+1 — H-1 + H-3).
 *
 * Sans allowlist, un admin (ou XSS chain V2 si admin role escalation future)
 * pouvait stocker `javascript:alert(1)`, `data:text/html,...`, `file:///etc/
 * passwd`, ou `http://169.254.169.254/` (AWS metadata) / `http://localhost:5432/`
 * (network scan interne). La valeur étant rendue sur `trackrecordfxmily.pages
 * .dev` après rebuild static, l'exploit landait au render.
 *
 *   - `^https://[host][:port]/[path][?query][#fragment]` — TLS-only, pas
 *     `http://` pour bloquer mixed content + SSRF localhost. Le hostname doit
 *     avoir au moins un point `.` (rejette `https://localhost`, `https://
 *     intranet`). Phase H+1 H-1 : path autorise `?#&=` pour CDN URLs avec
 *     cache-busting (`?v=2026-05-22`) ou Cloudinary signées (`?token=xyz`) —
 *     extrêmement courant en prod, le regex initial Phase H les rejetait.
 *   - `^public-trades/<key>.{png|jpg|jpeg|webp}` — storage-key R2 carbone J2
 *     `trades/{userId}/{nanoid}.{jpg|png|webp}` adapté T5 (monovendeur Eliot
 *     → préfixe `public-trades/` au lieu du segment `userId`).
 *   - Phase H+1 H-3 : rejet explicite path traversal `..` dans le storage-key
 *     (defense-in-depth — pas exploitable runtime sur static export Cloudflare,
 *     mais évite qu'un futur file-server qui résoudrait le path crée un trou).
 *   - empty string accepté (le champ est optional côté DB).
 */
const SCREENSHOT_URL_HTTPS_REGEX =
  /^https:\/\/[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/[\w./%~+\-?#&=]*)?$/;
const SCREENSHOT_URL_STORAGE_REGEX = /^public-trades\/[\w./-]+\.(png|jpg|jpeg|webp)$/i;

export const ORDINAL_MIN = 1;
export const ORDINAL_MAX = 99999;
export const RISK_PERCENT_MIN = 0.01;
export const RISK_PERCENT_MAX = 99.99;
export const RESULT_R_MIN = -100;
export const RESULT_R_MAX = 100;
export const CLOSED_PERCENT_MIN = 0.01;
export const CLOSED_PERCENT_MAX = 100;

// =============================================================================
// Sub-schemas — hardened free-text fields
// =============================================================================

/**
 * Instrument tag (EURUSD, XAUUSD, US30, USOIL…). NFC + reject bidi/zero-width,
 * uppercased before validation (admin can paste lower-case → we upper). Regex
 * `[A-Z0-9]{3,10}` matche les tickers fxmily v1 (forex majors + metals +
 * indices US + futures CFD). Si Eliot ajoute un instrument exotique (e.g.
 * "BTCUSD"), il passera ; "EUR/USD" sera rejeté (admin doit normaliser).
 */
const instrumentSchema = z
  .string()
  .trim()
  .min(INSTRUMENT_MIN)
  .max(INSTRUMENT_MAX)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform((s) => safeFreeText(s).toUpperCase())
  .refine((s) => INSTRUMENT_REGEX.test(s), {
    message: 'Instrument doit être en majuscules alphanumériques (3-10 chars).',
  });

const setupSchema = z
  .string()
  .trim()
  .max(SETUP_MAX)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(TAG_MAX)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const tagsSchema = z.array(tagSchema).max(TAGS_MAX);

const notesSchema = z
  .string()
  .trim()
  // T5 audit Phase H+1 — code-reviewer IMPORTANT-6 : consistency avec
  // `instrumentSchema` / `setupSchema` / `tagSchema` qui appliquent tous
  // `.trim()` early. Un admin qui paste avec trailing `\n\n\n` voyait ces
  // chars compter sur `NOTES_MAX=2000` + persisté en DB → display drift
  // sur la vitrine publique. Trim avant max-check assure que la marge
  // utilisable matche bien `NOTES_MAX`.
  .max(NOTES_MAX)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

const screenshotUrlSchema = z
  .string()
  .trim()
  .max(SCREENSHOT_URL_MAX)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  // T5 audit Phase H — SSRF defense. Allowlist scheme HTTPS ou storage-key
  // R2 (cf. const regex au-dessus + JSDoc). Rejette `javascript:` / `data:`
  // / `file://` / `http://localhost` / IP literals / protocol-relative `//`.
  // Phase H+1 H-3 : rejet explicite `..` path traversal en pré-check.
  // Phase H+2 H-IPLIT : rejet IPv4 + IPv6 literal hosts pour vraiment tenir
  // la promesse JSDoc anti-SSRF. La regex HTTPS de base acceptait
  // `https://169.254.169.254/` (AWS metadata) + `https://192.168.1.1/` (LAN)
  // + `https://[::1]/` (IPv6 loopback) car `[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+`
  // matche aussi des digits + dots. Non-exploitable V1 (la vitrine
  // `apps/track-record` ne consomme PAS `screenshotUrl` actuellement —
  // 0 `<img>` server-rendered) mais LATENT pour T6 wiring vitrine.
  // Pattern : pre-check via 2 lookahead regex avant l'allowlist match.
  .refine(
    (s) =>
      s === '' ||
      (!s.includes('..') &&
        // IPv4 literal reject : rejette TOUT host numérique 4-segments
        // (superset volontaire — pas de check per-range, on n'autorise
        // simplement aucune IP literale). Cas connus couverts :
        // AWS metadata 169.254.169.254, LAN 192.168/16, CGNAT 100.64/10,
        // loopback 127/8, IP publiques routables 8.8.8.8 etc. Policy V1 :
        // DNS hostname OBLIGATOIRE (le dot-rule de SCREENSHOT_URL_HTTPS_REGEX
        // rejette aussi `https://2130706433/` decimal-encoded, hors hex form
        // `0x7f.0x0.0x0.0x1` qui passerait : V2 T6 wire-time fix via WHATWG
        // URL parser + DNS resolve check).
        !/^https:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(s) &&
        // IPv6 literal reject : `https://[::1]/...` (loopback) ou
        // `https://[fe80::1]/...` (link-local) — le bracket `[` est le
        // marqueur RFC 3986 d'un IPv6 host literal.
        !/^https:\/\/\[/.test(s) &&
        (SCREENSHOT_URL_HTTPS_REGEX.test(s) || SCREENSHOT_URL_STORAGE_REGEX.test(s))),
    {
      message:
        'URL https:// (avec domaine DNS valide, pas IP literal) ou storage-key public-trades/...{png,jpg,webp} requis (pas de `..`).',
    },
  );

// =============================================================================
// Enum schemas — alignés `@/generated/prisma/enums`
// =============================================================================

const segmentSchema = z.enum(PUBLIC_TRADE_SEGMENTS);
const statusSchema = z.enum(PUBLIC_TRADE_STATUSES);
const directionSchema = z.enum(TRADE_DIRECTIONS);
const sessionSchema = z.enum(TRADE_SESSIONS);

const ordinalSchema = z.number().int().min(ORDINAL_MIN).max(ORDINAL_MAX);

/**
 * **Phase H+4 TIER 2 stress-test #4 — FR locale comma support.**
 *
 * V1.5.2 a fixé ce pattern pour `Trade.riskPct` (cf. `apps/web/CLAUDE.md`
 * V1.5.2 section "FR locale + close-out"). Eliot tape habituellement en
 * locale FR (`1,5` au lieu de `1.5`), or `Number("1,5") === NaN`, ce qui
 * faisait que `numFieldNullable` mappait silencieusement à `null` côté
 * form-shaper (H+1 H-4 distinction NaN→null) → input admin disparaissait
 * sans erreur visible.
 *
 * Fix : `z.preprocess` remplace la PREMIÈRE virgule par un point AVANT le
 * `z.coerce.number()`. Conséquences :
 *   - `"1,5"` → `"1.5"` → `1.5` ✅
 *   - `"2,5"` → `"2.5"` → `2.5` ✅
 *   - `"1,5,7"` → `"1.5,7"` → `Number("1.5,7") === NaN` → Zod reject avec
 *     "Risque % doit être un nombre fini" (clear error vs silent clear)
 *   - `"1.5"` (déjà point) → inchangé → `1.5` ✅
 *   - `1.5` (number direct) → inchangé → `1.5` ✅
 */
const frLocaleCommaPreprocess = (v: unknown): unknown =>
  typeof v === 'string' ? v.replace(',', '.') : v;

/**
 * Risk percent (% de capital risqué — 0.50, 1.00, 2.00). Stocké en % brut
 * cf. schema.prisma:1480-1483 (1.0 = 1%, pas 0.01). Decimal(4,2) ⇒ 99.99 max.
 * Min 0.01 (1 pb) défense contre `0` qui briserait `resultPercent =
 * riskPercent × resultR` (toujours = 0 ⇒ équivalent BE silencieux).
 */
const riskPercentSchema = z.preprocess(
  frLocaleCommaPreprocess,
  z.coerce
    .number()
    .finite({ message: 'Risque % doit être un nombre fini.' })
    .gt(0, { message: 'Risque % doit être > 0.' })
    .max(RISK_PERCENT_MAX, { message: `Risque % doit être ≤ ${RISK_PERCENT_MAX}.` })
    // T5 audit fix #3 — Prisma Decimal(4,2) arrondit silencieusement à 2 décimales
    // si on lui envoie 99.995 → 100.00 → P2000 numeric out of range. Reject côté
    // Zod AVANT le write avec un message clair plutôt qu'un crash Prisma.
    .multipleOf(0.01, { message: 'Risque % doit avoir au plus 2 décimales.' }),
);

/** R-multiple atteint (1R = +1×risque, -1R = stop, 0R = BE). Decimal(6,3). */
const resultRSchema = z.preprocess(
  frLocaleCommaPreprocess,
  z.coerce
    .number()
    .finite({ message: 'R doit être un nombre fini.' })
    .min(RESULT_R_MIN, { message: `R doit être ≥ ${RESULT_R_MIN}.` })
    .max(RESULT_R_MAX, { message: `R doit être ≤ ${RESULT_R_MAX}.` })
    // Decimal(6,3) — max 3 décimales (cf. fix #3 ci-dessus).
    .multipleOf(0.001, { message: 'R doit avoir au plus 3 décimales.' }),
);

/**
 * **Phase H+5 TIER 1 #1 — timezone drift fix**
 *
 * Le sub-agent code-reviewer Phase H+5 (`a764abee43e6775ab`) a détecté un
 * vrai bug data-corruption silencieux : le form admin pré-remplit
 * `<input type="datetime-local">` avec un wall-clock Paris (e.g.
 * `"2026-05-22T12:00"` pour un trade stocké `2026-05-22T10:00Z`). Quand
 * l'admin re-submit SANS toucher au champ, FormData ré-envoie la string.
 * `z.coerce.date()` appelle `new Date("2026-05-22T12:00")` qui interprète
 * la string comme **local-time du serveur runtime**. Sur Hetzner prod UTC,
 * c'est `2026-05-22T12:00:00Z` ⇒ drift +2h vs intent admin. **Drift
 * cumulatif silencieux** à chaque save innocent (le trade glisse
 * progressivement en avant à chaque édition).
 *
 * Fix : preprocess les strings au format datetime-local SANS TZ designator
 * (`YYYY-MM-DDTHH:MM[:SS]`) en les interprétant comme Europe/Paris
 * (fuseau projet par construction, SPEC §2 + §16). Pour strings avec TZ
 * (Z, +HH:MM) OU Date objects → pass-through inchangé.
 *
 * Pourquoi pas une lib (date-fns-tz) : éviter une dépendance nouvelle pour
 * un fix scopé. L'algorithme via `Intl.DateTimeFormat` natif Node 22 LTS
 * (ICU bundled) gère DST automatiquement (offset query à l'instant naïf).
 */
function parisLocalDatetimeToUtc(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se = '00'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(se);

  // Phase H+7 — calendar validity gate (stress-test #7 closure).
  // `Date.UTC(2026, 12, 1, ...)` silently rolls invalid month/day vers le
  // mois/année suivant(e) → Feb 29 sur année non-bisextile → Mar 1 ; mois
  // 13 → Jan année+1. Sans ce gate, admin tape `2026-13-01T12:00` et finit
  // avec un trade silencieusement décalé en Jan 2027. Return null → le
  // preprocess flow vers `z.coerce.date()` → `new Date()` invalid → `.refine`
  // sur dateTimeSchema attrape avec "Date invalide.".
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    return null;
  }

  // Naive UTC : treat the wall-clock numbers as if they were UTC.
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(naiveUtcMs)) return null;
  const naiveUtc = new Date(naiveUtcMs);

  // Find what time it IS in Paris when the actual UTC is `naiveUtc`.
  // The diff = Paris-vs-UTC offset at that instant (DST-aware).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(naiveUtc);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');

  // Note : the en-CA locale formats `hour: '2-digit', hour12: false` as
  // "24" for midnight (00:00 in Europe/Paris is displayed as "24"). On
  // collapse 24 → 0 pour cohérence avec Date.UTC.
  const pH = get('hour') === 24 ? 0 : get('hour');
  const parisAsUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    pH,
    get('minute'),
    get('second'),
  );
  const offsetMs = parisAsUtcMs - naiveUtcMs;

  return new Date(naiveUtcMs - offsetMs);
}

/**
 * Date ISO compatible Postgres `DateTime`. Pas `@db.Date` ici (PublicTrade
 * stocke un instant, pas un jour civil — différencie un trade entré 14:32
 * vs 14:33 dans le même session london).
 *
 * Phase H+5 TIER 1 #1 : preprocess datetime-local strings (HTML5 input
 * format sans TZ) → interprété Europe/Paris. Strings avec TZ designator
 * (Z, +HH:MM) ET Date objects → pass-through. Voir
 * `parisLocalDatetimeToUtc` ci-dessus pour le rationale.
 */
const dateTimeSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    // Has TZ designator (Z or ±HH:MM[:SS]) → pass-through (admin script /
    // serialization paths emit ISO with TZ, parsable by Date directly).
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(v)) return v;
    // datetime-local format (YYYY-MM-DDTHH:MM[:SS], no TZ) → interpret as
    // Europe/Paris local wall-clock.
    const parisDate = parisLocalDatetimeToUtc(v);
    if (parisDate) return parisDate;
    // Phase H+7 stress-test #7 closure — calendar validity gate KO OU format
    // non-datetime-local sans TZ. Return Invalid Date explicit pour que
    // `z.coerce.date({ error: 'Date invalide.' })` rejette avec le message
    // custom (vs (a) silent roll-over côté V8 sur `new Date("2026-02-30")`
    // qui parse en Mar 2, OU (b) Zod default "Invalid input: expected date").
    return new Date(NaN);
  },
  z.coerce.date({ error: () => ({ message: 'Date invalide.' }) }),
);

// =============================================================================
// Create / Update — admin form schemas
// =============================================================================

/**
 * Create form input. Cross-field refine enforce les invariants lifecycle :
 *   - closed       → exitedAt + resultR required
 *   - break_even   → exitedAt required, resultR ∈ {0, null}
 *   - open         → exitedAt + resultR doivent être null (form-level warn)
 *
 * `ordinal` optionnel : si absent, service auto-derive `MAX(ordinal) + 1`.
 * Cohérent admin V1 (Eliot ajoute le prochain live trade sans calculer 140).
 */
export const publicTradeCreateSchema = z
  .object({
    segment: segmentSchema,
    ordinal: ordinalSchema.optional(),
    instrument: instrumentSchema,
    direction: directionSchema.nullable().optional(),
    enteredAt: dateTimeSchema,
    exitedAt: dateTimeSchema.nullable().optional(),
    riskPercent: riskPercentSchema,
    resultR: resultRSchema.nullable().optional(),
    status: statusSchema,
    session: sessionSchema.nullable().optional(),
    setup: setupSchema.nullable().optional(),
    tags: tagsSchema.default([]),
    notes: notesSchema.nullable().optional(),
    screenshotUrl: screenshotUrlSchema.nullable().optional(),
    isPublished: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === 'closed') {
      if (!data.exitedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exitedAt'],
          message: 'exitedAt requis quand status = closed.',
        });
      }
      if (data.resultR === null || data.resultR === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resultR'],
          message: 'resultR requis quand status = closed.',
        });
      }
    }
    if (data.status === 'break_even') {
      if (!data.exitedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exitedAt'],
          message: 'exitedAt requis quand status = break_even.',
        });
      }
      if (data.resultR !== null && data.resultR !== undefined && data.resultR !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resultR'],
          message: 'resultR doit être 0 (ou vide) quand status = break_even.',
        });
      }
    }
    // Phase H+4 TIER 1 stress-test #1 — `status=open` doit avoir `exitedAt`
    // et `resultR` VIDES. Sans cette branche, l'admin pouvait persister un
    // trade "open" avec un `exitedAt` + `resultR` non-null (latent bug qui
    // polluerait les agrégats T6 vitrine + retrouve un état incohérent à
    // l'edit). Le JSDoc l.243 annonçait l'invariant comme "form-level warn"
    // mais aucune ligne ne le warn → fix par addIssue strict.
    if (data.status === 'open') {
      if (data.exitedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exitedAt'],
          message: 'exitedAt doit être vide quand status = open.',
        });
      }
      if (data.resultR !== null && data.resultR !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resultR'],
          message: 'resultR doit être vide quand status = open.',
        });
      }
    }
    if (data.exitedAt && data.exitedAt < data.enteredAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exitedAt'],
        // T5 audit Phase H — code-reviewer BLOQUANT-4 : le prédicat `<` accepte
        // l'égalité `exitedAt === enteredAt` (cf. `math.test.ts` qui pin cette
        // acceptance comme edge boundary légitime). Le message dit donc
        // "non-antérieur" (pas "postérieur" qui implique strict afterness).
        message: 'exitedAt ne doit pas être antérieur à enteredAt.',
      });
    }
  });

export type PublicTradeCreateInput = z.infer<typeof publicTradeCreateSchema>;

/**
 * Update form input. Tous les champs optionnels (le form peut envoyer un
 * subset). On refait le cross-field refine UNIQUEMENT si `status` est présent
 * dans le payload : service-side, l'invariant complet est vérifié post-merge
 * avec l'état actuel DB (cf. `updatePublicTrade`).
 */
export const publicTradeUpdateSchema = z
  .object({
    segment: segmentSchema.optional(),
    ordinal: ordinalSchema.optional(),
    instrument: instrumentSchema.optional(),
    direction: directionSchema.nullable().optional(),
    enteredAt: dateTimeSchema.optional(),
    exitedAt: dateTimeSchema.nullable().optional(),
    riskPercent: riskPercentSchema.optional(),
    resultR: resultRSchema.nullable().optional(),
    status: statusSchema.optional(),
    session: sessionSchema.nullable().optional(),
    setup: setupSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    notes: notesSchema.nullable().optional(),
    screenshotUrl: screenshotUrlSchema.nullable().optional(),
    isPublished: z.boolean().optional(),
  })
  .strict();

export type PublicTradeUpdateInput = z.infer<typeof publicTradeUpdateSchema>;

// =============================================================================
// Partial — admin "add leg" sub-form (TP1/TP2/...)
// =============================================================================

/**
 * Partial leg (clôture partielle). closedPercent + closedAtR + closedAt.
 *   - `closedAtR` Decimal(6,3) — R atteint sur cette leg (1.5R = TP1 à +1.5R).
 *   - `closedPercent` Decimal(5,2) — % de la position fermée (0..100).
 *   - `closedAt` DateTime — instant de la clôture leg.
 *   - `notes` optional, hardened.
 */
export const publicTradePartialSchema = z
  .object({
    closedAtR: resultRSchema, // réutilise validation -100..100 + .finite() + multipleOf(0.001)
    closedPercent: z.coerce
      .number()
      .finite({ message: '% fermé doit être un nombre fini.' })
      .min(CLOSED_PERCENT_MIN, {
        message: `% fermé doit être ≥ ${CLOSED_PERCENT_MIN}.`,
      })
      .max(CLOSED_PERCENT_MAX, {
        message: `% fermé doit être ≤ ${CLOSED_PERCENT_MAX}.`,
      })
      // Decimal(5,2) — max 2 décimales (fix #3).
      .multipleOf(0.01, { message: '% fermé doit avoir au plus 2 décimales.' }),
    closedAt: dateTimeSchema,
    notes: notesSchema.nullable().optional(),
  })
  .strict();

export type PublicTradePartialInput = z.infer<typeof publicTradePartialSchema>;
