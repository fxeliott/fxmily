import { z } from 'zod';

import { containsBidiOrZeroWidth } from '@/lib/text/safe';

/**
 * S3 — Vérification & Honnêteté radicale (SPEC §33) : Zod boundary for the
 * member-facing verification surface (broker accounts + MT5 proofs).
 *
 * Posture §33.2 — the verification concerns FACTS (accounts owned, proofs
 * uploaded), never the member's analyses. Free text is bounded, trimmed and
 * bidi-rejected (mirror of the journal/annotation sanitization canon: REJECT
 * rather than silently strip, cf. `lib/text/safe.ts`).
 */

// =============================================================================
// Constants
// =============================================================================

/** Mirror of the Prisma `BrokerAccountType` enum (SPEC §33.3). */
export const PROOF_ACCOUNT_TYPES = ['prop_firm', 'personal'] as const;
export type ProofAccountType = (typeof PROOF_ACCOUNT_TYPES)[number];

export const BROKER_ACCOUNT_LABEL_MIN_CHARS = 2;
export const BROKER_ACCOUNT_LABEL_MAX_CHARS = 80;
export const BROKER_NAME_MAX_CHARS = 80;

// =============================================================================
// Field-level schemas
// =============================================================================

const accountLabelSchema = z
  .string()
  .trim()
  .min(BROKER_ACCOUNT_LABEL_MIN_CHARS, 'Donne un nom court à ce compte (ex. « FTMO 100k »).')
  .max(BROKER_ACCOUNT_LABEL_MAX_CHARS, `Maximum ${BROKER_ACCOUNT_LABEL_MAX_CHARS} caractères.`)
  .refine((v) => !containsBidiOrZeroWidth(v), 'Le nom contient des caractères invalides.');

const brokerNameSchema = z
  .string()
  .trim()
  .max(BROKER_NAME_MAX_CHARS, `Maximum ${BROKER_NAME_MAX_CHARS} caractères.`)
  .refine(
    (v) => !containsBidiOrZeroWidth(v),
    'Le nom du broker contient des caractères invalides.',
  );

// =============================================================================
// Member inputs
// =============================================================================

/**
 * `createBrokerAccountAction` — the member declares one of their broker
 * accounts (prop firm or personal). The vision pipeline may later create
 * additional `detectedByAI` rows when proofs reveal accounts the member did
 * not declare (the « réalité vs déclaré » signal, §33.3).
 */
export const brokerAccountCreateSchema = z
  .object({
    label: accountLabelSchema,
    type: z.enum(PROOF_ACCOUNT_TYPES),
    brokerName: brokerNameSchema.optional(),
  })
  .strict();

export type BrokerAccountCreateInput = z.infer<typeof brokerAccountCreateSchema>;

/**
 * `submitDiscrepancyReasonAction` — the member explains a gap (« motif
 * valable », DoD §29: an excused absence is NOT indiscipline). Free text →
 * safeFreeText at the service + crisis routing at the action (member input).
 */
export const DISCREPANCY_REASON_MIN_CHARS = 5;
export const DISCREPANCY_REASON_MAX_CHARS = 500;

export const discrepancyReasonSchema = z
  .object({
    discrepancyId: z.string().regex(/^[a-z0-9]{8,40}$/),
    reason: z
      .string()
      .trim()
      .min(DISCREPANCY_REASON_MIN_CHARS, 'Explique en quelques mots (5 caractères minimum).')
      .max(DISCREPANCY_REASON_MAX_CHARS, `Maximum ${DISCREPANCY_REASON_MAX_CHARS} caractères.`)
      .refine((v) => !containsBidiOrZeroWidth(v), 'Le motif contient des caractères invalides.'),
  })
  .strict();

export type DiscrepancyReasonInput = z.infer<typeof discrepancyReasonSchema>;

// =============================================================================
// S3 §33.4 — Vision pipeline output (one MT5-history proof → account header +
// extracted positions). Shape validated against TWO real runtime probes
// (2026-06-11, claude-opus-4-8 --allowedTools Read on synthetic MT5 PNGs:
// desktop-terminal layout + mobile layout — exact field-level extraction).
// =============================================================================

export const VISION_MAX_POSITIONS_PER_PROOF = 300;

/** MT5 logins are numeric in practice; tolerate alnum/dash defensively. */
const ACCOUNT_LOGIN_REGEX = /^[A-Za-z0-9-]{1,32}$/;

/** ISO-8601 datetime string the vision prompt mandates (offset included). */
const isoDateTimeSchema = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Datetime ISO invalide.');

const visionAccountSchema = z
  .object({
    login: z.string().regex(ACCOUNT_LOGIN_REGEX, 'Login MT5 invalide.'),
    broker: z.string().max(120).nullable(),
    currency: z.string().max(8).nullable(),
    label: z.string().max(120).nullable(),
    accountTypeGuess: z.enum(PROOF_ACCOUNT_TYPES).nullable(),
  })
  .strict();

const visionPositionSchema = z
  .object({
    /** MT5 ticket/order number when the layout prints it (desktop history). */
    ticket: z.string().max(32).nullable(),
    symbol: z.string().min(1).max(32),
    side: z.enum(['buy', 'sell']),
    openTime: isoDateTimeSchema,
    closeTime: isoDateTimeSchema.nullable(),
    /** Lots. Probe-validated: 0.10–0.50 typical; cap defends against OCR junk. */
    volume: z.number().positive().max(100_000),
    entryPrice: z.number().nullable(),
    exitPrice: z.number().nullable(),
    /** Net profit of the row as printed (account currency). */
    pnl: z.number().nullable(),
  })
  .strict();

/**
 * The strict success shape Claude must return for ONE proof image. The
 * "not an MT5 history" refusal path travels as a wire-level `error` entry
 * (the orchestrator detects `{"error":"not_mt5_history"}` and downgrades the
 * entry), so the server-side success schema stays single-shape.
 */
export const verificationVisionOutputSchema = z
  .object({
    account: visionAccountSchema,
    positions: z.array(visionPositionSchema).max(VISION_MAX_POSITIONS_PER_PROOF),
    /** Global reading confidence 0-1 (drives `BrokerAccount.confidence`). */
    confidence: z.number().min(0).max(1),
    /**
     * Tour 18 — "le voir et le dire" : a short factual sentence in which the
     * model states WHAT screen it actually looked at (MT5 desktop/mobile, the
     * account, how many closed rows). Optional so a clean extraction never fails
     * for a missing note, but the prompt mandates it — it doubles as a vision
     * sanity signal (a coherent observation matching the extracted data is
     * evidence the model truly read the image, not hallucinated the schema).
     */
    screenObservation: z.string().max(300).optional(),
  })
  .strict();

export type VerificationVisionOutput = z.infer<typeof verificationVisionOutputSchema>;

const proofIdWireSchema = z.string().regex(/^[a-z0-9]{8,40}$/);
const wireUserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/**
 * Strict per-entry union — re-parsed PER-ENTRY by `persistVisionResults`
 * (Gate 0), NOT by the route envelope. Mirror of the onboarding
 * `batchResultEntrySchema` fix (2026-07-02 prod incident): validating entry
 * CONTENT at the envelope made persist all-or-nothing — ONE hallucinated key
 * in ONE vision output 400-rejected the whole lot and the scheduled worker
 * re-paid every `claude --print` at the next tick.
 */
export const verificationBatchResultEntrySchema = z.union([
  z
    .object({
      proofId: proofIdWireSchema,
      userId: wireUserIdSchema,
      output: verificationVisionOutputSchema,
      model: z.string().max(64).optional(),
    })
    .strict(),
  z
    .object({
      proofId: proofIdWireSchema,
      userId: wireUserIdSchema,
      error: z.string().min(1).max(200),
      /**
       * Tour 18 — "dis ce que tu vois" on the non-MT5 refusal path: the model's
       * factual note of the screen it actually saw (e.g. "Graphique TradingView,
       * pas un historique de positions"). Optional + kept OUT of the `error`
       * slug so the exact `not_mt5_history` terminal-verdict match is unaffected;
       * surfaced in the `verification.batch.skipped` audit for observability.
       */
      observed: z.string().max(300).optional(),
    })
    .strict(),
]);

/** Addressing skeleton (envelope-validated) — entry content passes through
 *  untrusted until Gate 0. Carbone onboarding `batchEntrySkeletonSchema`. */
const verificationBatchEntrySkeletonSchema = z
  .object({
    proofId: proofIdWireSchema,
    userId: wireUserIdSchema,
  })
  .passthrough();

/**
 * Wire schema for `POST /api/admin/verification-batch/persist`. The route
 * validates the ENVELOPE only (array bounds + per-entry addressing skeleton);
 * entry content is validated per-entry by `persistVisionResults` against
 * `verificationBatchResultEntrySchema` (defense-in-depth — never trust the
 * laptop, but never reject the whole lot for one bad AI output either).
 */
export const verificationBatchPersistRequestSchema = z
  .object({
    results: z.array(verificationBatchEntrySkeletonSchema).max(1000),
  })
  .strict();
