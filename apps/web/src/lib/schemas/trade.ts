import { z } from 'zod';

import { tradingViewUrlRequiredSchema } from '@/lib/schemas/tradingview-url';
import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';
import { EMOTION_MAX_PER_MOMENT, isEmotionSlug } from '@/lib/trading/emotions';
import { TRADING_PAIRS } from '@/lib/trading/pairs';

/**
 * Shared trade-form schemas (J2, SPEC §7.3).
 *
 * Single source of truth for both the wizard's per-step `methods.trigger()`
 * validation (RHF + zodResolver) and the Server Action re-validation. The
 * server is the only authority — the wizard's "step OK" UX is best-effort.
 *
 * Numeric inputs come from the form as strings (`type="number"` does NOT
 * coerce in HTML form data); we use `z.coerce.number()` and clamp at the
 * application boundary.
 */

const SESSIONS = ['asia', 'london', 'newyork', 'overlap'] as const;
const DIRECTIONS = ['long', 'short'] as const;
const OUTCOMES = ['win', 'loss', 'break_even'] as const;
/// Tour 10 — factual nature of the exit (mirrors Prisma `TradeExitReason`).
/// The ACT of how the position ended, never a judgement (SPEC §2). Exported
/// for the close form's option list (single source of truth with the enum).
export const TRADE_EXIT_REASONS = [
  'tp_hit',
  'sl_hit',
  'be_exit',
  'manual_before_target',
  'time_exit',
] as const;
export type TradeExitReasonSlug = (typeof TRADE_EXIT_REASONS)[number];
/// V1.5 — Steenbarger setup quality buckets.
const TRADE_QUALITIES = ['A', 'B', 'C'] as const;

/**
 * V1.8 REFLECT — post-outcome bias classification (Q5=A LESSOR-only acted).
 *
 * Allowlist of slugs accepted for `Trade.tags` (Postgres TEXT[] column).
 * Source mapping :
 *   - CFA Institute LESSOR (6 emotional biases — Loss-aversion, Endowment,
 *     Self-control, Status-quo, Overconfidence, Regret-aversion)
 *   - Steenbarger TraderFeed strengths-based (`discipline-high`,
 *     `revenge-trade` — the latter informal but historically canon).
 *
 * Informal slugs (`fomo`, `tilt`, etc.) intentionally EXCLUDED per V1.8
 * decision Q5=A (academic-validated only). Re-evaluation gate: > 5 members
 * request a slug → consider adding in V1.9 with an `informal:` prefix.
 *
 * The const tuple is `readonly` to feed `z.enum` and TypeScript narrowing.
 * Append-only: adding a new slug is non-breaking; removing one would require
 * a DB cleanup migration to avoid orphaned values in existing rows.
 */
export const TRADE_TAG_SLUGS = [
  'loss-aversion',
  'overconfidence',
  'regret-aversion',
  'status-quo',
  'self-control-fail',
  'endowment',
  'discipline-high',
  'revenge-trade',
] as const;

export type TradeTagSlug = (typeof TRADE_TAG_SLUGS)[number];

export const TRADE_TAGS_MAX_PER_TRADE = 3;

export function isTradeTagSlug(value: string): value is TradeTagSlug {
  return (TRADE_TAG_SLUGS as readonly string[]).includes(value);
}

/// Standalone Zod schema for a single tag — used by the TradeTagsPicker UI
/// per-option validation and by tests that need to fuzz individual values.
export const tradeTagSchema = z.enum(TRADE_TAG_SLUGS);

/// Array form for `Trade.tags` — used inside `tradeCloseSchema` and
/// importable for ad-hoc validation (e.g. admin override flows in V1.9+).
export const tradeTagsSchema = z
  .array(z.string())
  .max(TRADE_TAGS_MAX_PER_TRADE, `Maximum ${TRADE_TAGS_MAX_PER_TRADE} tags.`)
  .refine((tags) => tags.every(isTradeTagSlug), { message: 'Tag inconnu.' })
  .refine((tags) => new Set(tags).size === tags.length, { message: 'Doublons interdits.' });

const positivePrice = z.coerce
  .number({ message: 'Prix invalide.' })
  .positive('Le prix doit être positif.')
  .lt(10_000_000, 'Prix improbable.');

const lotSize = z.coerce
  .number({ message: 'Taille invalide.' })
  .positive('La taille doit être positive.')
  .lte(1000, 'Taille trop élevée (max 1000 lots).');

const plannedRR = z.coerce
  .number({ message: 'R:R invalide.' })
  .gte(0.25, 'Le R:R minimum est 0.25.')
  .lte(20, 'Le R:R maximum est 20.');

/// V1.5 — Risk percentage of account capital. Tharp rule: 1-2% typical.
/// Capped at 99.99 % defensively (degenerate case = full account on one trade).
/// **`gt(0)` not `gte(0)`** — security-auditor M3 (2026-05-09) : `0 %` is
/// semantically ambiguous vs NULL ("captured = 0" vs "not captured"). Force
/// the user to either omit the field (NULL) or enter a real positive value.
///
/// **FR locale support** (audit L2, 2026-05-09) : a French user typing
/// `1,5` (decimal comma) used to fail with `Number('1,5') = NaN`. The
/// preprocess step normalises a single comma to a dot before coercion.
/// Multiple commas / mixed locale stays rejected.
const riskPctSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      // Replace a single FR decimal comma with a dot. Reject inputs with
      // multiple commas (locale ambiguity → user typed something weird).
      const commaCount = (trimmed.match(/,/g) ?? []).length;
      if (commaCount === 1) return trimmed.replace(',', '.');
    }
    return v;
  },
  z.coerce
    .number({ message: 'Risque % invalide.' })
    .gt(0, 'Le risque doit être strictement positif (laisse vide si non capturé).')
    .lt(100, 'Le risque doit rester sous 100 % du compte.'),
);

const pairSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (v): v is (typeof TRADING_PAIRS)[number] => (TRADING_PAIRS as readonly string[]).includes(v),
    {
      message: 'Paire non autorisée.',
    },
  );

/** Pre-entry emotions: at least 1 — SPEC §7.3 makes the tag mandatory. */
const emotionTagsRequired = z
  .array(z.string())
  .min(1, 'Choisis au moins une émotion.')
  .max(EMOTION_MAX_PER_MOMENT, `Maximum ${EMOTION_MAX_PER_MOMENT} émotions.`)
  .refine((tags) => tags.every(isEmotionSlug), { message: 'Émotion inconnue.' })
  .refine((tags) => new Set(tags).size === tags.length, { message: 'Doublons interdits.' });

// Phase P review T1.2 — strip bidi/zero-width to defend against
// Trojan-Source on the admin trade view + Claude weekly summary input.
const notesSchema = z
  .string()
  .trim()
  .max(2000, 'Note trop longue (2000 max).')
  .refine((v) => !containsBidiOrZeroWidth(v), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  .optional();

/// Tour 13 — optional member explanation attached to a TradingView link (entry
/// or exit): what they saw on the screen, in their own words. Shorter cap than
/// `notesSchema` (500 vs 2000) — it is a focused caption on ONE chart, not the
/// full trade débrief. Same Trojan-Source hardening chain as `notesSchema`
/// (bidi/zero-width reject then `safeFreeText`): the value is rendered to the
/// coach AND fed to the weekly/monthly IA loaders as untrusted member input.
const tradingViewNoteSchema = z
  .string()
  .trim()
  .max(500, 'Explication trop longue (500 max).')
  .refine((v) => !containsBidiOrZeroWidth(v), 'Caractères de contrôle interdits.')
  .transform(safeFreeText)
  .optional();

/**
 * S26 — tri-state management-adherence answer, answered at close. Verbatim clone
 * of `processComplete`'s coercion: `true`/`false` from the radio, `'na'`/`''`/
 * absent → `null` (not answered). OPTIONAL — a new required field would break the
 * shared-wizard e2e (CANON). SPEC §2: the ACT of following the member's OWN
 * execution rule, never a market call.
 */
const managementAdherence = z
  .union([z.boolean(), z.literal('na'), z.literal('true'), z.literal('false'), z.literal('')])
  .optional()
  .transform((v) => {
    if (v === undefined || v === 'na' || v === '') return null;
    if (typeof v === 'string') return v === 'true';
    return v;
  });

/**
 * Pre-entry block (steps 1–6 of the wizard).
 *
 * J1 pivot (capture → lien, actée par Eliott) : the pre-entry PROOF is now a
 * mandatory TradingView link (`tradingViewEntryUrl`), NOT an uploaded
 * screenshot. Tour 13 — the schema no longer accepts ANY image key: no form
 * has sent `screenshotEntryKey` since J1 and only the verification flow
 * uploads, so the API surface is closed. The pre-J1 `screenshotEntryKey` DB
 * column + the display of existing captures are untouched. The link is
 * hardened in the shared `lib/schemas/tradingview-url` module.
 */
export const tradeOpenSchema = z
  .object({
    pair: pairSchema,
    direction: z.enum(DIRECTIONS, { message: 'Direction invalide.' }),
    session: z.enum(SESSIONS, { message: 'Session invalide.' }),
    enteredAt: z.coerce
      .date({ message: 'Date invalide.' })
      .min(new Date('2000-01-01'), { message: 'Date trop ancienne.' })
      // Re-evaluated on every parse — `Date.now()` captured here is fixed at
      // module-load time otherwise, which would make a long-running server
      // reject increasingly old "now" timestamps.
      .refine((d) => d.getTime() <= Date.now() + 60 * 60 * 1000, {
        message: 'Date dans le futur.',
      }),
    entryPrice: positivePrice,
    lotSize,
    stopLossPrice: positivePrice.optional().nullable(),
    plannedRR,
    /// V1.5 — Optional setup quality classification. Wizard UI capture
    /// position TBD (dedicated step or inline in step 4) — Eliott to validate.
    tradeQuality: z.enum(TRADE_QUALITIES).optional(),
    /// V1.5 — Optional risk percentage of account. Capture in step 3 alongside
    /// stop-loss and lot size when the member knows their account size.
    riskPct: riskPctSchema.optional(),
    emotionBefore: emotionTagsRequired,
    /**
     * TIER1 fix (S2 audit 2026-06-11) : the wizard submits FormData, so
     * `planRespected` arrives as the STRING "false" when the member answers
     * « Non » — and `z.coerce.boolean()` turns ANY non-empty string into
     * `true` (`Boolean("false") === true`). Every declared plan violation was
     * silently persisted as a plan respect, corrupting the flagship axis
     * (discipline scoring, `planRespectRate` Claude counters, the
     * `plan_violations_in_window` trigger). Same robust pattern as
     * `hedgeRespected` below and `formBoolean` in `schemas/checkin.ts` —
     * which already documents this exact footgun.
     */
    planRespected: z
      .union([z.boolean(), z.literal('true'), z.literal('false')], {
        error: 'Réponds par oui ou non.',
      })
      .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
    /** Tri-state: true / false / null (= N/A). The form sends `'na'` for N/A. */
    hedgeRespected: z
      .union([z.boolean(), z.literal('na'), z.literal('true'), z.literal('false')])
      .transform((v) => {
        if (v === 'na') return null;
        if (typeof v === 'string') return v === 'true';
        return v;
      }),
    notes: notesSchema,
    // J1 — mandatory TradingView entry link (replaces the former screenshot
    // upload). Tour 13 — no API path accepts an image key anymore: only the
    // verification flow uploads. The legacy `screenshotEntryKey` column and the
    // DISPLAY of pre-J1 captures are untouched; the schema just stops accepting
    // a key that no form has sent since J1.
    tradingViewEntryUrl: tradingViewUrlRequiredSchema,
    // Tour 13 — optional member explanation of the entry screen (500 max).
    tradingViewEntryNote: tradingViewNoteSchema,
  })
  .superRefine((data, ctx) => {
    // Sanity check stopLossPrice direction relative to entry. We don't reject
    // here (computeRealizedR falls back to estimated) — just warn at the
    // form level so the user knows the SL won't help precision.
    // Soft-validation lives in the UI; the server accepts both sides because
    // some users genuinely log "trailing-stop above entry" on a long.
    if (data.stopLossPrice == null) return;
    if (data.direction === 'long' && data.stopLossPrice >= data.entryPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['stopLossPrice'],
        message: 'Pour un long, le stop-loss doit être inférieur au prix d’entrée.',
      });
    }
    if (data.direction === 'short' && data.stopLossPrice <= data.entryPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['stopLossPrice'],
        message: 'Pour un short, le stop-loss doit être supérieur au prix d’entrée.',
      });
    }
  });

export type TradeOpenInput = z.infer<typeof tradeOpenSchema>;

/**
 * Post-exit block (step 7, or close-out flow on /journal/[id]/close).
 */
export const tradeCloseSchema = z
  .object({
    exitedAt: z.coerce
      .date({ message: 'Date de sortie invalide.' })
      .refine((d) => d.getTime() <= Date.now() + 60 * 60 * 1000, {
        message: 'Date dans le futur.',
      }),
    exitPrice: positivePrice,
    outcome: z.enum(OUTCOMES, { message: 'Résultat invalide.' }),
    /// Tour 10 — factual nature of the exit, next to `outcome`. OPTIONAL with
    /// the same null-mapping discipline as `processComplete`: absent/'' → null
    /// (not answered — NO required-field gate, CANON). Unknown values reject.
    exitReason: z
      .union([z.enum(TRADE_EXIT_REASONS), z.literal('')])
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    /// Emotions felt DURING the open position (recalled at close). Required,
    /// mirroring `emotionAfter` — closes the "avant / pendant / après" axis
    /// (master prompt §22). Same `emotionTagsRequired` rule (1–3 allowlisted).
    emotionDuring: emotionTagsRequired,
    emotionAfter: emotionTagsRequired,
    /// SPEC §28/§21 — "oublis" tracking axis. Did the member follow ALL their
    /// process at close, without forgetting steps? Tri-state, answered at close:
    /// `true` (rien oublié), `false` (forgot/missed something), `null` (not
    /// answered — OPTIONAL, NO required-field gate: a new required field breaks
    /// the shared-wizard e2e — CANON). The form sends `'na'`/absent for "not
    /// answered". Mirror of `hedgeRespected`'s tri-state coercion + `tags`'
    /// optionality. SPEC §2: tracks the ACT of completeness/forgetting only.
    processComplete: z
      .union([z.boolean(), z.literal('na'), z.literal('true'), z.literal('false'), z.literal('')])
      .optional()
      .transform((v) => {
        if (v === undefined || v === 'na' || v === '') return null;
        if (typeof v === 'string') return v === 'true';
        return v;
      }),
    /// S26 — « Fidélité à la gestion » (3 management hard-rules of the method).
    /// Each is an EXACT clone of `processComplete`'s tri-state coercion: optional,
    /// absent/''/'na' → null (not answered — NO required-field gate, CANON). SPEC
    /// §2: the ACT of following YOUR OWN execution rule, never a market call.
    slPerRule: managementAdherence,
    movedToBe: managementAdherence,
    partialAtTarget: managementAdherence,
    /// V1.8 REFLECT — post-outcome bias tags (CFA LESSOR + Steenbarger).
    /// Optional: V1 trades closed before V1.8 stay valid; UI defaults to empty.
    /// Member self-assigned at close (Q3=A) — see `TRADE_TAG_SLUGS` allowlist.
    tags: tradeTagsSchema.optional().default([]),
    notes: notesSchema,
    // J1 — mandatory TradingView exit link (replaces the former screenshot
    // upload at close). Tour 13 — no API path accepts an image key anymore
    // (mirror of the entry side): only the verification flow uploads. The
    // legacy `screenshotExitKey` column and the DISPLAY of pre-J1 captures are
    // untouched; the schema just stops accepting a key no form has sent.
    tradingViewExitUrl: tradingViewUrlRequiredSchema,
    // Tour 13 — optional member explanation of the exit screen (500 max).
    tradingViewExitNote: tradingViewNoteSchema,
  })
  .strict(); // invariant #6 — reject unknown keys (raw is hand-built in journal/actions.ts)

export type TradeCloseInput = z.infer<typeof tradeCloseSchema>;

/**
 * Combined schema for the "fill everything in one go" path.
 * Used by the wizard's final submit when the user filled the post-exit block
 * directly (vs saving the open trade and closing it later).
 */
export const tradeFullSchema = z
  .object({
    open: tradeOpenSchema,
    close: tradeCloseSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.close && data.close.exitedAt < data.open.enteredAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['close', 'exitedAt'],
        message: 'La sortie doit être après l’entrée.',
      });
    }
  });

export type TradeFullInput = z.infer<typeof tradeFullSchema>;

/**
 * Per-step field lists used by `methods.trigger(stepFields)` in the wizard.
 * Step indices are 0-based, matching `?step=N` in the URL.
 */
export const WIZARD_STEPS = [
  // 0 — when & what
  ['pair', 'enteredAt'],
  // 1 — direction & session
  ['direction', 'session'],
  // 2 — prices & sizing (V1.5: + riskPct, captured next to SL since the formula
  //                      riskPct = (entry - SL) * lotSize / accountBalance ties them)
  ['entryPrice', 'lotSize', 'stopLossPrice', 'riskPct'],
  // 3 — risk plan
  ['plannedRR'],
  // 4 — discipline & emotion before (V1.5: + tradeQuality at the top of the step,
  //                                  Steenbarger setup classification before discipline tags)
  ['tradeQuality', 'planRespected', 'hedgeRespected', 'emotionBefore'],
  // 5 — entry proof: TradingView link (J1 pivot, replaces the screenshot upload)
  //     + Tour 13 optional member explanation of the screen (validated for length).
  ['tradingViewEntryUrl', 'tradingViewEntryNote'],
  // 6 — outcome fields. NOT rendered by the open wizard (it caps at step 5 /
  // « Étape X sur 6 ») — this entry documents the CLOSE flow's field group
  // (`/journal/[id]/close`) so both flows share one field map (S4 DOD4-F1 :
  // kept on purpose, not dead code).
  [
    'exitedAt',
    'exitPrice',
    'outcome',
    'emotionDuring',
    'emotionAfter',
    'tradingViewExitUrl',
    'notes',
  ],
] as const;

export const WIZARD_TOTAL_STEPS = WIZARD_STEPS.length;
