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
  })
  .strict();

export type VerificationVisionOutput = z.infer<typeof verificationVisionOutputSchema>;

/**
 * Wire schema for `POST /api/admin/verification-batch/persist` (mirror of
 * the onboarding `batchPersistRequestSchema` union rationale: success and
 * error entries share the routing keys, no `kind` discriminator on wire).
 */
export const verificationBatchPersistRequestSchema = z
  .object({
    results: z
      .array(
        z.union([
          z
            .object({
              proofId: z.string().regex(/^[a-z0-9]{8,40}$/),
              userId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
              output: verificationVisionOutputSchema,
              model: z.string().max(64).optional(),
            })
            .strict(),
          z
            .object({
              proofId: z.string().regex(/^[a-z0-9]{8,40}$/),
              userId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
              error: z.string().min(1).max(200),
            })
            .strict(),
        ]),
      )
      .max(1000),
  })
  .strict();
