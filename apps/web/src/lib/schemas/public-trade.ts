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
 * Risk percent (% de capital risqué — 0.50, 1.00, 2.00). Stocké en % brut
 * cf. schema.prisma:1480-1483 (1.0 = 1%, pas 0.01). Decimal(4,2) ⇒ 99.99 max.
 * Min 0.01 (1 pb) défense contre `0` qui briserait `resultPercent =
 * riskPercent × resultR` (toujours = 0 ⇒ équivalent BE silencieux).
 */
const riskPercentSchema = z.coerce
  .number()
  .finite({ message: 'Risque % doit être un nombre fini.' })
  .gt(0, { message: 'Risque % doit être > 0.' })
  .max(RISK_PERCENT_MAX, { message: `Risque % doit être ≤ ${RISK_PERCENT_MAX}.` })
  // T5 audit fix #3 — Prisma Decimal(4,2) arrondit silencieusement à 2 décimales
  // si on lui envoie 99.995 → 100.00 → P2000 numeric out of range. Reject côté
  // Zod AVANT le write avec un message clair plutôt qu'un crash Prisma.
  .multipleOf(0.01, { message: 'Risque % doit avoir au plus 2 décimales.' });

/** R-multiple atteint (1R = +1×risque, -1R = stop, 0R = BE). Decimal(6,3). */
const resultRSchema = z.coerce
  .number()
  .finite({ message: 'R doit être un nombre fini.' })
  .min(RESULT_R_MIN, { message: `R doit être ≥ ${RESULT_R_MIN}.` })
  .max(RESULT_R_MAX, { message: `R doit être ≤ ${RESULT_R_MAX}.` })
  // Decimal(6,3) — max 3 décimales (cf. fix #3 ci-dessus).
  .multipleOf(0.001, { message: 'R doit avoir au plus 3 décimales.' });

/**
 * Date ISO compatible Postgres `DateTime`. Pas `@db.Date` ici (PublicTrade
 * stocke un instant, pas un jour civil — différencie un trade entré 14:32
 * vs 14:33 dans le même session london).
 */
const dateTimeSchema = z.coerce.date();

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
