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
  /**
   * SHA-256 hex of the file bytes (DoD §33 enrichment « journal de preuves
   * horodaté & inaltérable » — empreinte/audit trail). Surfaced so the member
   * sees a tamper trace next to the timestamp, materialising the « inaltérable »
   * promise. NOT a secret: it is a one-way fingerprint of an image the member
   * uploaded themselves.
   */
  readonly fileHash: string;
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
        fileHash: true,
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
      fileHash: p.fileHash,
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

/**
 * The DECLARED side of a discrepancy (the member's journal trade) — serialized
 * for the « Réalité vs Déclaré » face-à-face (DoD §33). Decimals are converted
 * to numbers at this boundary so the presentation layer never touches Prisma's
 * Decimal. Null when the gap has no declared side (missing_declared / the
 * non-trade rituals).
 */
export interface DiscrepancyDeclaredSide {
  readonly pair: string;
  readonly direction: 'long' | 'short';
  readonly lotSize: number;
  readonly enteredAt: Date;
}

/**
 * The REALITY side of a discrepancy (the position read from the MT5 proof).
 * Null when the gap has no reality side (false_declared / the rituals).
 */
export interface DiscrepancyRealitySide {
  readonly symbol: string;
  readonly side: 'long' | 'short';
  readonly volume: number;
  readonly openTime: Date;
  readonly pnl: number | null;
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
  /** Declared side for the face-à-face (null = no journal trade on this gap). */
  readonly declared: DiscrepancyDeclaredSide | null;
  /** Reality side for the face-à-face (null = no extracted position on this gap). */
  readonly reality: DiscrepancyRealitySide | null;
}

/**
 * Count of écarts still waiting for the member's attention (`status: open`).
 * Powers the dashboard card teaser (S4 — « écarts de vérité au bon endroit »).
 * Count-only, posture §33.2 : a factual number, never a guilt counter.
 */
export async function countOpenDiscrepancies(memberId: string): Promise<number> {
  return db.discrepancy.count({ where: { memberId, status: 'open' } });
}

/**
 * Tour 10 — Map<tradeId, open discrepancy count> for the journal list badge.
 * Mirror of `countUnseenAnnotationsByTrade` (annotations/member-service.ts):
 * ONE groupBy for the whole page, trades without an open écart simply aren't
 * keyed (TradeCard's default 0 keeps the badge hidden). Only écarts anchored
 * to a declared trade (`declaredTradeId`) can badge a card — the account-level
 * types (missing_declared, unfilled_no_reason…) stay on /verification.
 * Posture §33.2 : a factual pointer to lucidity, never a guilt counter.
 */
export async function countOpenDiscrepanciesByTrade(
  memberId: string,
): Promise<Map<string, number>> {
  const grouped = await db.discrepancy.groupBy({
    by: ['declaredTradeId'],
    where: { memberId, status: 'open', declaredTradeId: { not: null } },
    _count: { _all: true },
  });
  return new Map(
    grouped
      .filter((g): g is typeof g & { declaredTradeId: string } => g.declaredTradeId !== null)
      .map((g) => [g.declaredTradeId, g._count._all]),
  );
}

/**
 * Tour 10 — single-trade variant for the detail page (close echo input).
 * A plain indexed count ([memberId, status]) beats reusing the groupBy Map
 * when only ONE trade is on screen.
 */
export async function countOpenDiscrepanciesForTrade(
  memberId: string,
  tradeId: string,
): Promise<number> {
  return db.discrepancy.count({
    where: { memberId, status: 'open', declaredTradeId: tradeId },
  });
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
      // « Réalité vs Déclaré » face-à-face (DoD §33) — the two concrete sides,
      // metadata only (pair/size/time/pnl), NEVER the capture content (§21.5:
      // the reconciliation already ignores OCR prices; the UI shows the rows it
      // matched, not the screenshot text).
      declaredTrade: {
        select: { pair: true, direction: true, lotSize: true, enteredAt: true },
      },
      extractedPosition: {
        select: { symbol: true, side: true, volume: true, openTime: true, pnl: true },
      },
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
    declared: r.declaredTrade
      ? {
          pair: r.declaredTrade.pair,
          direction: r.declaredTrade.direction,
          lotSize: Number(r.declaredTrade.lotSize),
          enteredAt: r.declaredTrade.enteredAt,
        }
      : null,
    reality: r.extractedPosition
      ? {
          symbol: r.extractedPosition.symbol,
          side: r.extractedPosition.side,
          volume: Number(r.extractedPosition.volume),
          openTime: r.extractedPosition.openTime,
          pnl: r.extractedPosition.pnl !== null ? Number(r.extractedPosition.pnl) : null,
        }
      : null,
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
  // findUnique only to distinguish not-found / not-owned for the BOLA error.
  const row = await db.discrepancy.findUnique({
    where: { id: discrepancyId },
    select: { memberId: true },
  });
  if (!row || row.memberId !== memberId) {
    throw new DiscrepancyNotFoundError();
  }
  // RC#7 TX-3 — the status flip must NOT be decided from a stale plain read.
  // The reconcile pipeline can flip this row open→resolved (reality retracted
  // the écart, no fault) concurrently with this submit; deriving the flip from
  // the JS-read status and writing it with an id-only UPDATE would clobber that
  // 'resolved' back to 'acknowledged' (member self-excused), mislabelling the
  // honesty surface. Split the write: always record the reason, and flip status
  // ONLY while the row is still 'open' via the WHERE predicate — a row already
  // re-statused is left untouched, so reality's retraction wins.
  await db.discrepancy.updateMany({
    where: { id: discrepancyId, memberId },
    data: { memberReason: safeFreeText(reason), memberReasonAt: new Date() },
  });
  await db.discrepancy.updateMany({
    where: { id: discrepancyId, memberId, status: 'open' },
    data: { status: 'acknowledged' },
  });
}

/**
 * Tour 11 (chantier G, FINDING 3) — the ADMIN closes a discrepancy by hand.
 *
 * `DiscrepancyStatus` has three states (open / acknowledged / resolved) but only
 * the reconciliation machine ever reached `resolved` : an `acknowledged` gap (the
 * member gave a valid reason) sat there forever with no admin lever. This lets the
 * coach mark such a gap « traité » once they have handled it off-app.
 *
 * Gate-locked `updateMany` (carbone `submitDiscrepancyReason` TX-3, l.364-371) :
 * the WHERE predicate restricts the flip to rows still `open` OR `acknowledged`,
 * so a row the reconcile pipeline concurrently flipped to `resolved` (or that was
 * never in a resolvable state) is left untouched — no lost update, no clobber.
 * ADMIN scope : the caller (Server Action) has already re-checked `role === 'admin'`,
 * so no `memberId` ownership filter is needed here (unlike the member-facing writes).
 *
 * Returns the number of rows flipped (`0` = already resolved / not found), so the
 * action can surface an accurate result without a second read.
 */
export async function resolveDiscrepancyAsAdmin(discrepancyId: string): Promise<number> {
  const result = await db.discrepancy.updateMany({
    where: { id: discrepancyId, status: { in: ['open', 'acknowledged'] } },
    data: { status: 'resolved' },
  });
  return result.count;
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
