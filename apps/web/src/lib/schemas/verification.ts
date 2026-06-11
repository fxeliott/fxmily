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
