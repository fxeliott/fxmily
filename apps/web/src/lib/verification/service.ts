import 'server-only';

import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';
import { safeFreeText } from '@/lib/text/safe';
import type { BrokerAccountCreateInput } from '@/lib/schemas/verification';

/**
 * S3 — Vérification & Honnêteté radicale (SPEC §33) : member-facing service
 * layer for broker accounts + MT5 proofs.
 *
 * Scope of THIS file (PR « proof upload ») : declare accounts, list the
 * verification overview, delete a proof. The vision pipeline (§33.4), the
 * reconciliation engine and the constancy score (§33.5) live in their own
 * modules — they consume these rows, they don't own them.
 *
 * Posture §33.2 — everything here is FACTUAL (rows, statuses, counts). No
 * advice, no judgement; the honest copy lives at the UI layer.
 */

export class BrokerAccountLimitError extends Error {
  override readonly name = 'BrokerAccountLimitError';
  constructor() {
    super('Broker account limit reached.');
  }
}

export class ProofNotFoundError extends Error {
  override readonly name = 'ProofNotFoundError';
  constructor() {
    super('Proof not found or access denied.');
  }
}

/** Defensive cap — a member managing more than this many accounts is a data
 *  entry error, not a real cohort scenario (prop firms cap challenges too). */
export const MAX_BROKER_ACCOUNTS_PER_MEMBER = 20;

/**
 * Create a member-declared broker account. AI-detected rows (`detectedByAI`)
 * are created by the vision pipeline persist gate, never here.
 */
export async function createBrokerAccount(
  memberId: string,
  input: BrokerAccountCreateInput,
): Promise<{ id: string }> {
  const count = await db.brokerAccount.count({ where: { memberId } });
  if (count >= MAX_BROKER_ACCOUNTS_PER_MEMBER) {
    throw new BrokerAccountLimitError();
  }
  return db.brokerAccount.create({
    data: {
      memberId,
      label: safeFreeText(input.label),
      type: input.type,
      brokerName: input.brokerName ? safeFreeText(input.brokerName) : null,
      detectedByAI: false,
    },
    select: { id: true },
  });
}

export interface VerificationProofView {
  readonly id: string;
  readonly fileKey: string;
  readonly readUrl: string;
  readonly accountType: 'prop_firm' | 'personal' | null;
  readonly ocrStatus: 'pending' | 'done' | 'failed';
  readonly uploadedAt: Date;
  readonly brokerAccountId: string | null;
  readonly extractedPositionsCount: number;
}

export interface VerificationAccountView {
  readonly id: string;
  readonly label: string;
  readonly type: 'prop_firm' | 'personal';
  readonly brokerName: string | null;
  readonly detectedByAI: boolean;
  readonly confidence: number | null;
  readonly createdAt: Date;
  readonly proofsCount: number;
  readonly positionsCount: number;
}

export interface VerificationOverview {
  readonly accounts: readonly VerificationAccountView[];
  readonly proofs: readonly VerificationProofView[];
  readonly pendingProofsCount: number;
}

/**
 * Member `/verification` page payload — accounts + proofs, newest first.
 * Read-only; counts are aggregated in two grouped queries (no N+1).
 */
export async function getVerificationOverview(memberId: string): Promise<VerificationOverview> {
  const [accounts, proofs, positionsByAccount, positionsByProof] = await Promise.all([
    db.brokerAccount.findMany({
      where: { memberId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        type: true,
        brokerName: true,
        detectedByAI: true,
        confidence: true,
        createdAt: true,
        _count: { select: { proofs: true } },
      },
    }),
    db.mt5AccountProof.findMany({
      where: { memberId },
      orderBy: { uploadedAt: 'desc' },
      // Bounded like `listDiscrepancies` (take 50) — with the prescribed usage
      // (regular captures per account) an unbounded list grows forever and
      // each row renders a signed <img> on /verification (S4 DOD4-V3).
      take: 48,
      select: {
        id: true,
        fileKey: true,
        accountType: true,
        ocrStatus: true,
        uploadedAt: true,
        brokerAccountId: true,
      },
    }),
    db.extractedPosition.groupBy({
      by: ['brokerAccountId'],
      where: { brokerAccount: { memberId } },
      _count: { _all: true },
    }),
    db.extractedPosition.groupBy({
      by: ['proofId'],
      where: { brokerAccount: { memberId }, proofId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const positionsCountByAccount = new Map(
    positionsByAccount.map((g) => [g.brokerAccountId, g._count._all]),
  );
  const positionsCountByProof = new Map(positionsByProof.map((g) => [g.proofId, g._count._all]));

  const storage = selectStorage();

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      brokerName: a.brokerName,
      detectedByAI: a.detectedByAI,
      confidence: a.confidence,
      createdAt: a.createdAt,
      proofsCount: a._count.proofs,
      positionsCount: positionsCountByAccount.get(a.id) ?? 0,
    })),
    proofs: proofs.map((p) => ({
      id: p.id,
      fileKey: p.fileKey,
      readUrl: storage.getReadUrl(p.fileKey),
      accountType: p.accountType,
      ocrStatus: p.ocrStatus,
      uploadedAt: p.uploadedAt,
      brokerAccountId: p.brokerAccountId,
      extractedPositionsCount: positionsCountByProof.get(p.id) ?? 0,
    })),
    pendingProofsCount: proofs.filter((p) => p.ocrStatus === 'pending').length,
  };
}

export class DiscrepancyNotFoundError extends Error {
  override readonly name = 'DiscrepancyNotFoundError';
  constructor() {
    super('Discrepancy not found or access denied.');
  }
}

export interface DiscrepancyView {
  readonly id: string;
  readonly type:
    | 'missing_declared'
    | 'false_declared'
    | 'mismatch'
    | 'unfilled_no_reason'
    | 'meeting_missed_no_reason'
    | 'tracking_skipped_no_reason';
  readonly severity: number;
  readonly status: 'open' | 'acknowledged' | 'resolved';
  readonly reasoning: string | null;
  readonly memberReason: string | null;
  readonly detectedAt: Date;
}

/**
 * Count of écarts still waiting for the member's attention (`status: open`).
 * Powers the dashboard card teaser (S4 — « écarts de vérité au bon endroit »).
 * Count-only, posture §33.2 : a factual number, never a guilt counter.
 */
export async function countOpenDiscrepancies(memberId: string): Promise<number> {
  return db.discrepancy.count({ where: { memberId, status: 'open' } });
}

/** Member-facing list — newest first, the excused ones stay visible (the
 *  history doesn't rewrite itself; only the score forgives, §33.5). */
export async function listDiscrepancies(memberId: string): Promise<readonly DiscrepancyView[]> {
  const rows = await db.discrepancy.findMany({
    where: { memberId },
    orderBy: { detectedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      type: true,
      severity: true,
      status: true,
      claudeReasoning: true,
      memberReason: true,
      detectedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    status: r.status,
    reasoning: r.claudeReasoning,
    memberReason: r.memberReason,
    detectedAt: r.detectedAt,
  }));
}

/**
 * The member explains a gap (« motif valable » DoD §29). Sets the reason +
 * flips `open → acknowledged`. The constancy fold then EXCLUDES the linked
 * negative events — « le score remonte » when the member faces reality.
 */
export async function submitDiscrepancyReason(
  memberId: string,
  discrepancyId: string,
  reason: string,
): Promise<void> {
  const row = await db.discrepancy.findUnique({
    where: { id: discrepancyId },
    select: { memberId: true, status: true },
  });
  if (!row || row.memberId !== memberId) {
    throw new DiscrepancyNotFoundError();
  }
  await db.discrepancy.update({
    where: { id: discrepancyId },
    data: {
      memberReason: safeFreeText(reason),
      memberReasonAt: new Date(),
      ...(row.status === 'open' ? { status: 'acknowledged' as const } : {}),
    },
  });
}

/**
 * Delete one of the member's proofs. The DB row is the source of truth — the
 * storage object is deleted best-effort (never blocks the user-facing flow;
 * orphans are swept by the purge path). Extracted positions SURVIVE the proof
 * deletion by design (`ExtractedPosition.proofId` is SetNull): once a reality
 * has been read, removing the screenshot does not erase the history — that is
 * the whole point of the honesty surface (§33.1).
 */
export async function deleteProof(memberId: string, proofId: string): Promise<void> {
  const proof = await db.mt5AccountProof.findUnique({
    where: { id: proofId },
    select: { memberId: true, fileKey: true },
  });
  if (!proof || proof.memberId !== memberId) {
    throw new ProofNotFoundError();
  }

  await db.mt5AccountProof.delete({ where: { id: proofId } });

  const storage = selectStorage();
  try {
    await storage.delete(proof.fileKey);
  } catch (err) {
    console.warn('[verification.deleteProof] storage cleanup failed (non-fatal)', err);
  }
}
