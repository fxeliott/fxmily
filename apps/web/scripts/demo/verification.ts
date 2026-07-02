/**
 * S3 — Vérification & Honnêteté radicale MT5 (SPEC §33). This module seeds the
 * REALITY side of the demo member's story: declared broker accounts, uploaded
 * MT5 proofs (vision-analysed), positions extracted from those proofs, the
 * declarative ↔ reality discrepancies they reveal, the weekly constancy score
 * trajectory, and the event-sourced journal that explains why the score moved.
 *
 * The demo tells a coherent improvement arc (posture §33.2 — a mirror, never a
 * sanction): MANY excused/handled gaps early in the window, FEWER (and only a
 * couple still open) recently; the constancy score climbs ~60 → ~88 week over
 * week. Some extracted positions match the member's already-seeded declared
 * trades (the honest core), others have no declared counterpart (→ a
 * `missing_declared` gap, long since acknowledged with a reason).
 *
 * Self-contained: imports ONLY `./_shared.js` (no `@/lib/*`, no `server-only`)
 * so it runs under plain `tsx` with just DATABASE_URL set. Idempotent re-run
 * (byte-identical): accounts / proofs / constancy scores UPSERT on their
 * `@@unique` keys; the create-only tables whose @@unique constraints sit on
 * NULLABLE columns (ExtractedPosition / Discrepancy / ScoreEvent) are cleared
 * member-scoped first (§0 below) — never touching the demo user, who is
 * wiped + recreated by the orchestrator.
 */
import { type SeedCtx, at, mondayOf, makePrng, pick, clamp, round } from './_shared.js';

// =============================================================================
// Static content pools (kept §2-clean — factual labels, never market advice)
// =============================================================================

/** Static §2-clean reasoning strings (mirror the deterministic engine's copy). */
const REASONING = {
  missing_declared:
    'Une position lue dans ton historique MT5 n’a pas de trade correspondant dans ton journal.',
  false_declared:
    'Un trade déclaré dans ton journal n’a pas de contrepartie dans l’historique MT5 fourni sur la période.',
  mismatch: 'Le trade déclaré et la position réelle correspondent, mais les volumes divergent.',
  unfilled_no_reason:
    'Journée sans aucun check-in (matin et soir vides), sans motif déclaré pour le moment.',
} as const;

/** Member reasons — the « motif valable » that makes the score forgive (§29). */
const MEMBER_REASONS = [
  'J’étais en déplacement, journée off prévue.',
  'Coupure internet ce jour-là, rattrapé le lendemain.',
  'Petite saisie en double, position fermée aussitôt, corrigé.',
  'Semaine de repos décidée, pas de trading.',
] as const;

// =============================================================================
// Seeder
// =============================================================================

export async function seedVerification(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, log } = ctx;
  const memberId = ctx.userId;
  const rand = makePrng(701);

  // ---------------------------------------------------------------------------
  // 0. Idempotence for the create-only tables. ExtractedPosition / Discrepancy /
  //    ScoreEvent carry no natural upsert key for ALL their rows (Discrepancy's
  //    two @@unique constraints are on NULLABLE columns — meetingId / trackingRef
  //    — so most rows can't be upserted, and Postgres treats NULLs as distinct so
  //    a plain re-create would either collide on the one trackingRef row or pile
  //    up duplicates). We therefore clear THIS MEMBER's verification-owned rows
  //    first (member-scoped — never touches the demo user, who is wiped+recreated
  //    by the orchestrator). ScoreEvent.relatedDiscrepancyId is SetNull, so order:
  //    events → discrepancies → positions. Accounts/proofs/scores below upsert on
  //    their @@unique keys and are left in place.
  await db.scoreEvent.deleteMany({ where: { memberId } });
  await db.discrepancy.deleteMany({ where: { memberId } });
  await db.extractedPosition.deleteMany({ where: { brokerAccount: { memberId } } });

  // ---------------------------------------------------------------------------
  // 1. Broker accounts (1 prop firm + 1 personal). The prop-firm row is the one
  //    the vision pipeline "detected"; the personal one is member-declared.
  // ---------------------------------------------------------------------------
  const propAccount = await db.brokerAccount.upsert({
    where: { memberId_accountLogin: { memberId, accountLogin: '51022087' } },
    create: {
      memberId,
      label: 'FTMO 100k',
      type: 'prop_firm',
      brokerName: 'FTMO',
      accountLogin: '51022087',
      detectedByAI: true,
      confidence: 0.94,
      createdAt: at(ctx.now, 84, 9, 12),
    },
    update: {},
    select: { id: true },
  });

  const personalAccount = await db.brokerAccount.upsert({
    where: { memberId_accountLogin: { memberId, accountLogin: '30418862' } },
    create: {
      memberId,
      label: 'Compte perso IC Markets',
      type: 'personal',
      brokerName: 'IC Markets',
      accountLogin: '30418862',
      detectedByAI: false,
      confidence: null,
      createdAt: at(ctx.now, 70, 10, 5),
    },
    update: {},
    select: { id: true },
  });

  // ---------------------------------------------------------------------------
  // 2. MT5 proofs (analysed). Stable fileHash per proof = the @@unique dedup key.
  //    Spread across the window so the "journal de preuves horodaté" looks real.
  // ---------------------------------------------------------------------------
  const proofSpecs: ReadonlyArray<{
    accountId: string;
    accountType: 'prop_firm' | 'personal';
    daysAgo: number;
    hash: string;
  }> = [
    { accountId: propAccount.id, accountType: 'prop_firm', daysAgo: 72, hash: 'a1f4c2e7d9b0' },
    { accountId: propAccount.id, accountType: 'prop_firm', daysAgo: 38, hash: 'b2e5d3f8a0c1' },
    { accountId: personalAccount.id, accountType: 'personal', daysAgo: 31, hash: 'c3a6e4091bd2' },
    { accountId: propAccount.id, accountType: 'prop_firm', daysAgo: 9, hash: 'd4b7f5102ce3' },
  ];

  const proofIds: string[] = [];
  for (let i = 0; i < proofSpecs.length; i++) {
    const spec = proofSpecs[i];
    if (!spec) continue;
    const fileHash = `${spec.hash}${'0'.repeat(64 - spec.hash.length)}`;
    const proof = await db.mt5AccountProof.upsert({
      where: { memberId_fileHash: { memberId, fileHash } },
      create: {
        memberId,
        brokerAccountId: spec.accountId,
        fileKey: `proofs/${memberId}/demo-proof-${i + 1}.png`,
        fileHash,
        accountType: spec.accountType,
        ocrStatus: 'done',
        claudeRunId: `demo-run-${i + 1}`,
        uploadedAt: at(ctx.now, spec.daysAgo, 11, 20 + i),
      },
      update: {},
      select: { id: true },
    });
    proofIds.push(proof.id);
  }

  // ---------------------------------------------------------------------------
  // 3. Extracted positions (the REALITY side). The vision pipeline read these
  //    from the proofs. Some line up with the member's declared trades (same
  //    symbol/day/side — the honest match), one does NOT (→ missing_declared).
  // ---------------------------------------------------------------------------
  // Anchor a handful of positions ON the same civil days as declared trades so
  // they read as "matched reality". We don't FK them to a Trade here (the
  // reconciliation engine owns that link); the alignment is what tells the story.
  const positionSpecs: ReadonlyArray<{
    proofIdx: number;
    daysAgo: number;
    utcHour: number;
    symbol: string;
    side: 'long' | 'short';
    ticket: string;
    winning: boolean;
  }> = [
    {
      proofIdx: 0,
      daysAgo: 73,
      utcHour: 9,
      symbol: 'EURUSD',
      side: 'long',
      ticket: '8801234',
      winning: false,
    },
    {
      proofIdx: 0,
      daysAgo: 71,
      utcHour: 13,
      symbol: 'XAUUSD',
      side: 'short',
      ticket: '8801251',
      winning: true,
    },
    {
      proofIdx: 1,
      daysAgo: 40,
      utcHour: 10,
      symbol: 'NAS100',
      side: 'long',
      ticket: '8809932',
      winning: true,
    },
    {
      proofIdx: 1,
      daysAgo: 37,
      utcHour: 14,
      symbol: 'GBPUSD',
      side: 'short',
      ticket: '8810014',
      winning: false,
    },
    // This one has NO declared counterpart → it materialises a missing_declared gap.
    {
      proofIdx: 2,
      daysAgo: 30,
      utcHour: 11,
      symbol: 'US30',
      side: 'long',
      ticket: '7700481',
      winning: true,
    },
    {
      proofIdx: 2,
      daysAgo: 28,
      utcHour: 15,
      symbol: 'USDJPY',
      side: 'long',
      ticket: '7700559',
      winning: false,
    },
    {
      proofIdx: 3,
      daysAgo: 8,
      utcHour: 9,
      symbol: 'EURUSD',
      side: 'long',
      ticket: '8830027',
      winning: true,
    },
    {
      proofIdx: 3,
      daysAgo: 7,
      utcHour: 13,
      symbol: 'XAUUSD',
      side: 'long',
      ticket: '8830088',
      winning: true,
    },
  ];

  const extractedIds: string[] = [];
  let missingDeclaredPositionId: string | null = null;
  for (let i = 0; i < positionSpecs.length; i++) {
    const spec = positionSpecs[i];
    if (!spec) continue;
    const proofId = proofIds[spec.proofIdx] ?? null;
    // Resolve the account from the proof spec so positions live under the right account.
    const proofSpec = proofSpecs[spec.proofIdx];
    const brokerAccountId = proofSpec ? proofSpec.accountId : propAccount.id;

    const openTime = at(ctx.now, spec.daysAgo, spec.utcHour, 10 + i);
    const closeTime = new Date(openTime.getTime() + (25 + Math.floor(rand() * 90)) * 60_000);
    const volume = round(0.1 + rand() * 0.6, 2);
    const entryPrice = round(1.0 + rand() * 0.6, 5);
    const exitDelta = round((spec.winning ? 1 : -1) * Math.abs(entryPrice * 0.012), 5);
    const exitPrice = round(
      spec.side === 'long' ? entryPrice + exitDelta : entryPrice - exitDelta,
      5,
    );
    const pnl = round((spec.winning ? 1 : -1) * (40 + rand() * 180), 2);

    const created = await db.extractedPosition.create({
      data: {
        brokerAccountId,
        proofId,
        ticket: spec.ticket,
        symbol: spec.symbol,
        side: spec.side,
        openTime,
        closeTime,
        volume,
        entryPrice,
        exitPrice,
        pnl,
        source: 'mt5_screen_ocr',
        confidence: round(clamp(0.82 + rand() * 0.16, 0, 1), 2),
      },
      select: { id: true },
    });
    extractedIds.push(created.id);
    // The US30 position (proof #3, daysAgo 30) is the "real but never declared" one.
    if (spec.ticket === '7700481') missingDeclaredPositionId = created.id;
  }

  // A representative declared trade (already in DB) to hang a `mismatch` /
  // `false_declared` gap onto its journal side. Pick the oldest few so the gap
  // lands early in the window (the improvement arc). Null-safe: if the demo
  // trades aren't present for any reason, the trade-side gaps are simply skipped.
  const oldDeclaredTrades = await db.trade.findMany({
    where: { userId: memberId },
    orderBy: { enteredAt: 'asc' },
    take: 4,
    select: { id: true },
  });

  // ---------------------------------------------------------------------------
  // 4. Discrepancies — the improvement arc. Older gaps are RESOLVED/ACKNOWLEDGED
  //    (with a memberReason), recent ones are mostly handled too, with just 1-2
  //    fresh `open` gaps. detectedAt drives the ordering on /verification.
  // ---------------------------------------------------------------------------
  interface DiscSpec {
    type:
      | 'missing_declared'
      | 'false_declared'
      | 'mismatch'
      | 'unfilled_no_reason'
      | 'meeting_missed_no_reason'
      | 'tracking_skipped_no_reason';
    daysAgo: number;
    severity: number;
    status: 'open' | 'acknowledged' | 'resolved';
    withReason: boolean;
    declaredTradeId: string | null;
    extractedPositionId: string | null;
    reasoning: string;
    trackingRef: string | null;
  }

  const discSpecs: DiscSpec[] = [
    // --- Early window: many gaps, all eventually faced (resolved/acknowledged) ---
    {
      type: 'unfilled_no_reason',
      daysAgo: 78,
      severity: 1,
      status: 'resolved',
      withReason: true,
      declaredTradeId: null,
      extractedPositionId: null,
      reasoning: REASONING.unfilled_no_reason,
      trackingRef: null,
    },
    {
      type: 'false_declared',
      daysAgo: 70,
      severity: 3,
      status: 'resolved',
      withReason: true,
      declaredTradeId: oldDeclaredTrades[0]?.id ?? null,
      extractedPositionId: null,
      reasoning: REASONING.false_declared,
      trackingRef: null,
    },
    {
      type: 'mismatch',
      daysAgo: 58,
      severity: 1,
      status: 'acknowledged',
      withReason: true,
      declaredTradeId: oldDeclaredTrades[1]?.id ?? null,
      extractedPositionId: extractedIds[2] ?? null,
      reasoning: REASONING.mismatch,
      trackingRef: null,
    },
    {
      type: 'tracking_skipped_no_reason',
      daysAgo: 44,
      severity: 1,
      status: 'resolved',
      withReason: true,
      declaredTradeId: null,
      extractedPositionId: null,
      reasoning:
        'L’instrument de suivi « Fidélité au process » de la semaine concernée n’a pas été rempli dans le délai de rattrapage, sans motif déclaré.',
      trackingRef: 'process-fidelity@2026-W18',
    },
    // --- Mid window: the real-but-undeclared position, faced with a reason ---
    {
      type: 'missing_declared',
      daysAgo: 29,
      severity: 2,
      status: 'acknowledged',
      withReason: true,
      declaredTradeId: null,
      extractedPositionId: missingDeclaredPositionId,
      reasoning: REASONING.missing_declared,
      trackingRef: null,
    },
    // --- Recent window: just a couple of fresh, still-open gaps to act on ---
    {
      type: 'unfilled_no_reason',
      daysAgo: 4,
      severity: 1,
      status: 'open',
      withReason: false,
      declaredTradeId: null,
      extractedPositionId: null,
      reasoning: REASONING.unfilled_no_reason,
      trackingRef: null,
    },
    {
      type: 'meeting_missed_no_reason',
      daysAgo: 2,
      severity: 1,
      status: 'open',
      withReason: false,
      declaredTradeId: null,
      extractedPositionId: null,
      reasoning:
        'Une réunion programmée n’a pas été suivie (ni en direct ni en replay) dans le délai de rattrapage de 30 jours, sans motif déclaré.',
      trackingRef: null,
    },
  ];

  const discrepancyIds: string[] = [];
  let openDiscrepancies = 0;
  for (let i = 0; i < discSpecs.length; i++) {
    const spec = discSpecs[i];
    if (!spec) continue;
    const detectedAt = at(ctx.now, spec.daysAgo, 6, 30);
    // trackingRef-bearing rows dedup on (memberId, trackingRef); everything else
    // on the meetingId @@unique (NULL here → never collides). Create-only is safe
    // because the orchestrator wipes the demo user first; we keep determinism via
    // the seeded PRNG. Trade/meeting/tracking gaps have stable content per run.
    const memberReason = spec.withReason ? pick(rand, MEMBER_REASONS) : null;
    const created = await db.discrepancy.create({
      data: {
        memberId,
        type: spec.type,
        severity: spec.severity,
        status: spec.status,
        claudeReasoning: spec.reasoning,
        declaredTradeId: spec.declaredTradeId,
        extractedPositionId: spec.extractedPositionId,
        trackingRef: spec.trackingRef,
        memberReason,
        memberReasonAt: memberReason ? at(ctx.now, spec.daysAgo - 1, 18, 0) : null,
        detectedAt,
      },
      select: { id: true },
    });
    discrepancyIds.push(created.id);
    if (spec.status === 'open') openDiscrepancies++;
  }

  // ---------------------------------------------------------------------------
  // 5. ScoreEvents — append-only journal explaining why the score moved. Spread
  //    over the window: more negatives early, more "filled" positives recently.
  //    Negatives reference the discrepancy they came from (some excused → the
  //    fold forgives them). listRecentScoreEvents reads delta/reason/excused.
  // ---------------------------------------------------------------------------
  interface EventSpec {
    daysAgo: number;
    delta: number;
    reason: 'filled' | 'forgot_no_reason' | 'reality_gap' | 'false_declaration';
    discrepancyIdx: number | null;
  }
  const eventSpecs: EventSpec[] = [
    { daysAgo: 78, delta: -1, reason: 'forgot_no_reason', discrepancyIdx: 0 },
    { daysAgo: 70, delta: -8, reason: 'false_declaration', discrepancyIdx: 1 },
    { daysAgo: 64, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 58, delta: -4, reason: 'reality_gap', discrepancyIdx: 2 },
    { daysAgo: 50, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 44, delta: -1, reason: 'forgot_no_reason', discrepancyIdx: 3 },
    { daysAgo: 36, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 29, delta: -4, reason: 'reality_gap', discrepancyIdx: 4 },
    { daysAgo: 22, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 15, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 9, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 4, delta: -1, reason: 'forgot_no_reason', discrepancyIdx: 5 },
    { daysAgo: 3, delta: 1, reason: 'filled', discrepancyIdx: null },
    { daysAgo: 1, delta: 1, reason: 'filled', discrepancyIdx: null },
  ];

  let scoreEvents = 0;
  for (const ev of eventSpecs) {
    const relatedDiscrepancyId =
      ev.discrepancyIdx !== null ? (discrepancyIds[ev.discrepancyIdx] ?? null) : null;
    await db.scoreEvent.create({
      data: {
        memberId,
        delta: ev.delta,
        reason: ev.reason,
        relatedDiscrepancyId,
        createdAt: at(ctx.now, ev.daysAgo, 7, 0),
      },
    });
    scoreEvents++;
  }

  // ---------------------------------------------------------------------------
  // 6. ConstancyScore — weekly trajectory, value climbing ~60 → ~88. periodStart
  //    is the ISO Monday (@db.Date); breakdown JSON { honesty, regularity,
  //    discipline } each 0-100 (the read path maps any non-number axis to null).
  //    Newest week (weeksAgo 0) drives the hero card via getLatestConstancyScore.
  // ---------------------------------------------------------------------------
  const WEEKS = 8;
  let constancyScores = 0;
  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    // 0 at the oldest week → 1 at the current week.
    const t = (WEEKS - 1 - weeksAgo) / (WEEKS - 1);
    const periodStart = mondayOf(ctx.now, weeksAgo);
    const periodEnd = new Date(periodStart.getTime() + 6 * 86_400_000);

    const honesty = round(clamp(60 + t * 29 + (rand() - 0.5) * 3, 0, 100), 1);
    const regularity = round(clamp(58 + t * 31 + (rand() - 0.5) * 4, 0, 100), 1);
    const discipline = round(clamp(55 + t * 30 + (rand() - 0.5) * 4, 0, 100), 1);
    // value = weighted mean (honesty .40, regularity .35, discipline .25), mirror
    // the engine's fold so the hero number is coherent with its breakdown.
    const value = round(honesty * 0.4 + regularity * 0.35 + discipline * 0.25, 1);

    const breakdown: { honesty: number; regularity: number; discipline: number } = {
      honesty,
      regularity,
      discipline,
    };

    await db.constancyScore.upsert({
      where: { memberId_periodStart: { memberId, periodStart } },
      create: {
        memberId,
        value,
        breakdown: breakdown as unknown as object,
        periodStart,
        periodEnd,
        computedAt: new Date(periodEnd.getTime() + 86_400_000),
      },
      update: {
        value,
        breakdown: breakdown as unknown as object,
        periodEnd,
      },
    });
    constancyScores++;
  }

  const summary = {
    brokerAccounts: 2,
    mt5Proofs: proofIds.length,
    extractedPositions: extractedIds.length,
    discrepancies: discrepancyIds.length,
    openDiscrepancies,
    scoreEvents,
    constancyScores,
  };
  log(
    `  verification: ${summary.brokerAccounts} accounts, ${summary.mt5Proofs} proofs, ` +
      `${summary.extractedPositions} positions, ${summary.discrepancies} discrepancies ` +
      `(${openDiscrepancies} open), ${scoreEvents} score events, ${constancyScores} weekly scores`,
  );
  return summary;
}
