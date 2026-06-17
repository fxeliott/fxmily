import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { CLAUDE_LOCAL_SENTINEL, KNOWN_CLAUDE_MODEL_SLUGS } from '@/lib/ai/claude-response';
import { safeFreeText } from '@/lib/text/safe';
import {
  verificationVisionOutputSchema,
  type VerificationVisionOutput,
} from '@/lib/schemas/verification';

// V1.5.2 pseudonymLabel helper — single canonical pseudonymizeMember (mirror
// onboarding batch import rationale: zero pseudonym drift across pipelines).
import { pseudonymizeMember } from '@/lib/weekly-report/builder';

import {
  VERIFICATION_VISION_OUTPUT_JSON_SCHEMA,
  VERIFICATION_VISION_SYSTEM_PROMPT,
  VERIFICATION_VISION_USER_PROMPT_TEMPLATE,
} from './prompt';
import { ALERT_WINDOW_DAYS, scanAlertsForMember } from './alerts';

/**
 * S3 §33.4 — MT5-proof VISION batch (5th local Claude pipeline).
 *
 * Carbon of `onboarding-interview/batch.ts` with the vision delta:
 *
 *   Eliott local Windows                 Hetzner prod (Caddy → fxmily-web)
 *   ════════════════════                ════════════════════════════════════
 *      /verification-batch (slash)
 *      bash ops/scripts/verification-batch-local.sh
 *      │
 *      curl POST X-Admin-Token ─→  /api/admin/verification-batch/pull
 *      │                            (pending proofs metadata, NO image bytes)
 *      │  Loop N proofs :
 *      │   curl GET  proof-image?proofId=… → proof-i.png   (token-gated)
 *      │   claude --print --allowedTools Read  (reads the LOCAL png)
 *      │   core_parse_response → {proofId, userId, output, model}
 *      │
 *      curl POST X-Admin-Token ─→  /api/admin/verification-batch/persist
 *                                   │ gates §5.3 (active-user → ownership →
 *                                   │ Zod.strict → crisis → AMF → model pin)
 *                                   │ account resolve by MT5 login (dedup)
 *                                   │ positions insert (ticket/heuristic dedup)
 *                                   │ proof → done + User.detectedAccountCount
 *
 * Ban-risk mitigation: 9 rules carbone (jitter, 1 invocation/proof, binaire
 * officiel, human-in-the-loop, double-net serveur, audit PII-free).
 *
 * Posture §33.2 : la sortie vision est FACTUELLE ; les gates crisis/AMF
 * tournent quand même sur les champs texte (invariant « tout output IA passe
 * les gates », §5.3) — un screenshot pourrait contenir du texte incrusté.
 */

// =============================================================================
// Public types — wire contract between Hetzner and the local script
// =============================================================================

export interface VerificationBatchEntry {
  /** Real internal proof id — routing key for persist + image download. */
  readonly proofId: string;
  /** Real internal user id. NEVER sent to Anthropic — routing only. */
  readonly userId: string;
  /** Pseudonym label V1.5.2 — safe to log. */
  readonly pseudonymLabel: string;
  /** Image extension (`jpg|png|webp`) — the script MUST save the downloaded
   *  file with this suffix: the claude Read tool detects images by
   *  EXTENSION (a `.img` temp name makes the model see garbage — runtime
   *  finding 2026-06-11, first pipeline run). */
  readonly fileExt: 'jpg' | 'png' | 'webp';
  /** What the member declared at upload (cross-check context, may be null). */
  readonly declaredAccount: {
    readonly id: string;
    readonly label: string;
    readonly accountLogin: string | null;
  } | null;
  readonly declaredAccountType: 'prop_firm' | 'personal' | null;
  readonly uploadedAt: string;
}

export interface VerificationBatchPullEnvelope {
  readonly ranAt: string;
  readonly systemPrompt: string;
  readonly outputJsonSchema: unknown;
  /** `__IMAGE_PATH__` placeholder — the script substitutes its local path. */
  readonly userPromptTemplate: string;
  readonly entries: readonly VerificationBatchEntry[];
}

export type VerificationBatchResultEntry =
  | {
      readonly proofId: string;
      readonly userId: string;
      readonly output: VerificationVisionOutput;
      readonly model?: string;
    }
  | {
      readonly proofId: string;
      readonly userId: string;
      readonly error: string;
    };

export interface VerificationBatchPersistRequest {
  readonly results: readonly VerificationBatchResultEntry[];
}

export interface VerificationBatchPersistResult {
  readonly persisted: number;
  readonly skipped: number;
  readonly errors: number;
}

/** Oldest-first cap per pull — one run stays bounded (re-run for the rest;
 *  the pull is idempotent: only `pending` proofs are picked). */
export const MAX_PROOFS_PER_PULL = 25;

// =============================================================================
// Pull side — pending proofs metadata (images travel via proof-image GET)
// =============================================================================

/** Runtime-validated extension (audit T3-3 — no lying cast): falls back to
 *  png, which the script ALSO re-allowlists (defense in depth). */
function proofFileExt(fileKey: string): 'jpg' | 'png' | 'webp' {
  const ext = fileKey.split('.').pop();
  return ext === 'jpg' || ext === 'png' || ext === 'webp' ? ext : 'png';
}

export async function loadPendingProofsEnvelope(
  options: { now?: Date } = {},
): Promise<VerificationBatchPullEnvelope> {
  const now = options.now ?? new Date();
  const ranAt = now.toISOString();

  const proofs = await db.mt5AccountProof.findMany({
    where: { ocrStatus: 'pending', member: { status: 'active' } },
    select: {
      id: true,
      memberId: true,
      accountType: true,
      uploadedAt: true,
      fileKey: true,
      brokerAccount: { select: { id: true, label: true, accountLogin: true } },
    },
    orderBy: { uploadedAt: 'asc' },
    take: MAX_PROOFS_PER_PULL,
  });

  const entries: VerificationBatchEntry[] = proofs.map((p) => ({
    proofId: p.id,
    userId: p.memberId,
    pseudonymLabel: pseudonymizeMember(p.memberId),
    fileExt: proofFileExt(p.fileKey),
    declaredAccount: p.brokerAccount
      ? {
          id: p.brokerAccount.id,
          label: p.brokerAccount.label,
          accountLogin: p.brokerAccount.accountLogin,
        }
      : null,
    declaredAccountType: p.accountType,
    uploadedAt: p.uploadedAt.toISOString(),
  }));

  await logAudit({
    action: 'verification.batch.pulled',
    metadata: { ranAt, entriesCount: entries.length },
  });

  return {
    ranAt,
    systemPrompt: VERIFICATION_VISION_SYSTEM_PROMPT,
    outputJsonSchema: VERIFICATION_VISION_OUTPUT_JSON_SCHEMA,
    userPromptTemplate: VERIFICATION_VISION_USER_PROMPT_TEMPLATE,
    entries,
  };
}

// =============================================================================
// Persist side — validate + materialise accounts/positions
// =============================================================================

/** Wire error slug for the model's "this is not an MT5 history" refusal —
 *  the ONLY error that flips the proof to `failed` (a claude/parse error
 *  leaves it `pending`, retryable at the next run). */
export const NOT_MT5_HISTORY_ERROR = 'not_mt5_history';

function positionHeuristicKey(args: {
  symbol: string;
  side: string;
  openTimeMs: number;
  volume: number;
}): string {
  return `${args.symbol}|${args.side}|${args.openTimeMs}|${args.volume.toFixed(4)}`;
}

export async function persistVisionResults(
  request: VerificationBatchPersistRequest,
): Promise<VerificationBatchPersistResult> {
  const ranAt = new Date().toISOString();

  // Pre-fetch lookup sets — the laptop is untrusted (forged ids defense).
  const userIds = Array.from(new Set(request.results.map((r) => r.userId)));
  const proofIds = Array.from(new Set(request.results.map((r) => r.proofId)));

  const [activeUsers, proofs] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds }, status: 'active' },
      select: { id: true },
    }),
    db.mt5AccountProof.findMany({
      where: { id: { in: proofIds } },
      select: {
        id: true,
        memberId: true,
        ocrStatus: true,
        brokerAccountId: true,
        accountType: true,
      },
    }),
  ]);
  const activeUserSet = new Set(activeUsers.map((u) => u.id));
  const proofById = new Map(proofs.map((p) => [p.id, p]));

  let persisted = 0;
  let skipped = 0;
  let errors = 0;
  // S4 §30 — members whose proof persisted this run ; each is alert-scanned
  // ONCE after the loop (event-driven), never per-proof, to avoid redundant
  // scans when a member uploads several proofs in the same batch.
  const touchedMemberIds = new Set<string>();

  for (const entry of request.results) {
    const proof = proofById.get(entry.proofId);

    // Gate 1 — active user (forged userId defense).
    if (!activeUserSet.has(entry.userId)) {
      skipped += 1;
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, reason: 'unknown_or_inactive_user' },
      });
      continue;
    }

    // Gate 2 — proof exists + belongs to the claimed user.
    if (!proof || proof.memberId !== entry.userId) {
      skipped += 1;
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, reason: 'proof_not_found_or_owner_mismatch' },
      });
      if (proof && proof.memberId !== entry.userId) {
        reportWarning('verification.batch', 'proof_owner_mismatch_suspicious', {
          userId: entry.userId,
          proofId: entry.proofId,
        });
      }
      continue;
    }

    // Wire error path — `not_mt5_history` is a CONTENT verdict → proof flips
    // to `failed` (the member sees « Lecture impossible » and can re-shoot).
    // Any other error (claude_exit_N, invalid_json_response, download_failed)
    // is TRANSIENT → the proof stays `pending` and retries at the next run.
    if ('error' in entry) {
      skipped += 1;
      // `pending` guard (adverse-review): a stale/contradictory second batch
      // must never flip an already-analysed (`done`) proof back to `failed`
      // while its positions remain — the verdict only applies pre-analysis.
      if (entry.error === NOT_MT5_HISTORY_ERROR && proof.ocrStatus === 'pending') {
        await db.mt5AccountProof.update({
          where: { id: entry.proofId },
          data: { ocrStatus: 'failed', claudeRunId: ranAt },
        });
      }
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, reason: entry.error.slice(0, 200) },
      });
      continue;
    }

    // Gate 3 — idempotency: an already-analysed proof is never re-written.
    if (proof.ocrStatus === 'done') {
      skipped += 1;
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, reason: 'already_analyzed' },
      });
      continue;
    }

    // Gate 4 — Zod strict (anti enum-fuzzing / hallucinated keys).
    const parsed = verificationVisionOutputSchema.safeParse(entry.output);
    if (!parsed.success) {
      errors += 1;
      await logAudit({
        action: 'verification.batch.invalid_output',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, issuesCount: parsed.error.issues.length },
      });
      continue;
    }
    const output = parsed.data;

    // Gate 5 — crisis + AMF on every text field (§5.3 invariant: ALL AI
    // output passes the gates — a screenshot can carry burned-in text that
    // the model echoes into broker/label/symbol).
    const textCorpus = [
      output.account.broker ?? '',
      output.account.label ?? '',
      ...output.positions.map((p) => p.symbol),
    ].join('\n');
    const crisis = detectCrisis(textCorpus);
    if (crisis.level === 'high' || crisis.level === 'medium') {
      skipped += 1;
      await logAudit({
        action: 'verification.batch.crisis_detected',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          level: crisis.level,
          matchedLabels: crisis.matches.map((m) => m.label),
        },
      });
      reportWarning('verification.batch', 'crisis_signal_in_vision_output', {
        userId: entry.userId,
        proofId: entry.proofId,
        level: crisis.level,
      });
      continue;
    }
    const amf = detectAMFViolation(textCorpus);
    if (amf.suspected) {
      skipped += 1;
      await logAudit({
        action: 'verification.batch.amf_violation',
        userId: entry.userId,
        metadata: { ranAt, proofId: entry.proofId, matchedLabels: amf.matchedLabels },
      });
      reportWarning('verification.batch', 'amf_violation_in_vision_output', {
        userId: entry.userId,
        proofId: entry.proofId,
        matchedLabels: amf.matchedLabels,
      });
      continue;
    }

    // Model attribution pin (mirror weekly/monthly/calendar/onboarding
    // "BLOQUANT 5") — forged strings fall back to the honest sentinel.
    const model = entry.model
      ? KNOWN_CLAUDE_MODEL_SLUGS.includes(entry.model) ||
        entry.model === CLAUDE_LOCAL_SENTINEL ||
        entry.model.startsWith('mock:')
        ? entry.model
        : CLAUDE_LOCAL_SENTINEL
      : CLAUDE_LOCAL_SENTINEL;

    try {
      const result = await materialiseProofExtraction({
        memberId: entry.userId,
        proofId: entry.proofId,
        declaredAccountId: proof.brokerAccountId,
        declaredAccountType: proof.accountType,
        output,
        ranAt,
      });

      persisted += 1;
      touchedMemberIds.add(entry.userId);
      await logAudit({
        action: 'verification.proof.analyzed',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          accountId: result.accountId,
          accountCreated: result.accountCreated,
          positionsInserted: result.positionsInserted,
          positionsDeduplicated: result.positionsDeduplicated,
          detectedAccountCount: result.detectedAccountCount,
          confidence: output.confidence,
          claudeModelVersion: model,
          mocked: model.startsWith('mock:'),
        },
      });
    } catch (err) {
      errors += 1;
      await logAudit({
        action: 'verification.batch.persist_failed',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        },
      });
      reportError(
        'verification.batch',
        err instanceof Error ? err : new Error('verification_persist_failed_unknown'),
        { userId: entry.userId, proofId: entry.proofId },
      );
    }
  }

  // S4 §30 «alerte sans délai» — event-driven alert scan for every member
  // whose proof persisted this run, so a REPEATED discrepancy raises its Mark
  // Douglas card immediately instead of waiting for the next 11:30 UTC cron.
  // Isolated per member (a scan failure never undoes a committed persist) and
  // idempotent (Alert dedup per window + P2002 on delivery) so the cron's later
  // pass adds nothing. The repetition gating (thresholds ≥2/3, §31#4 anti-honte)
  // is untouched — only the LATENCY shrinks.
  if (touchedMemberIds.size > 0) {
    const alertsNow = new Date();
    const windowStart = new Date(alertsNow.getTime() - ALERT_WINDOW_DAYS * 86_400_000);
    const memberTimezones = await db.user.findMany({
      where: { id: { in: [...touchedMemberIds] } },
      select: { id: true, timezone: true },
    });
    const tzById = new Map(memberTimezones.map((u) => [u.id, u.timezone || 'Europe/Paris']));
    for (const memberId of touchedMemberIds) {
      try {
        await scanAlertsForMember(
          memberId,
          tzById.get(memberId) ?? 'Europe/Paris',
          alertsNow,
          windowStart,
        );
      } catch (alertErr) {
        reportError(
          'verification.batch.alert_scan',
          alertErr instanceof Error ? alertErr : new Error('post_persist_alert_scan_failed'),
          { userId: memberId },
        );
      }
    }
  }

  await logAudit({
    action: 'verification.batch.persisted',
    metadata: { ranAt, persisted, skipped, errors, total: request.results.length },
  });

  return { persisted, skipped, errors };
}

// =============================================================================
// Materialisation — account resolve (login dedup) + positions insert
// =============================================================================

interface MaterialiseArgs {
  readonly memberId: string;
  readonly proofId: string;
  readonly declaredAccountId: string | null;
  readonly declaredAccountType: 'prop_firm' | 'personal' | null;
  readonly output: VerificationVisionOutput;
  readonly ranAt: string;
}

interface MaterialiseResult {
  readonly accountId: string;
  readonly accountCreated: boolean;
  readonly positionsInserted: number;
  readonly positionsDeduplicated: number;
  readonly detectedAccountCount: number;
}

/**
 * Resolve THE account row for the proof's MT5 login, insert the extracted
 * positions (deduplicated), flip the proof to `done` and refresh the member's
 * `detectedAccountCount`.
 *
 * Account resolution order (§30 « nombre exact de comptes ») :
 *   1. a row already carries (memberId, accountLogin=login) → reuse it;
 *   2. the proof was attached to a declared account whose login is still
 *      null → BACKFILL that row's login (the member's own declaration gets
 *      verified, not duplicated). P2002 race → re-resolve by login;
 *   3. otherwise → CREATE a `detectedByAI` row (an account the member never
 *      declared — the « réalité vs déclaré » signal).
 */
async function materialiseProofExtraction(args: MaterialiseArgs): Promise<MaterialiseResult> {
  const { memberId, proofId, output } = args;
  const login = safeFreeText(output.account.login);
  const brokerName = output.account.broker
    ? safeFreeText(output.account.broker).slice(0, 80)
    : null;
  const ocrLabel = output.account.label ? safeFreeText(output.account.label).slice(0, 80) : null;

  let accountId: string | null = null;
  let accountCreated = false;

  // 1. Existing row for this login.
  const byLogin = await db.brokerAccount.findUnique({
    where: { memberId_accountLogin: { memberId, accountLogin: login } },
    select: { id: true },
  });
  if (byLogin) {
    accountId = byLogin.id;
  }

  // 2. Backfill the member-declared row the proof was attached to.
  if (accountId === null && args.declaredAccountId !== null) {
    const declared = await db.brokerAccount.findUnique({
      where: { id: args.declaredAccountId },
      select: { id: true, memberId: true, accountLogin: true, brokerName: true },
    });
    if (declared && declared.memberId === memberId && declared.accountLogin === null) {
      try {
        await db.brokerAccount.update({
          where: { id: declared.id },
          data: {
            accountLogin: login,
            confidence: output.confidence,
            ...(declared.brokerName === null && brokerName !== null ? { brokerName } : {}),
          },
        });
        accountId = declared.id;
      } catch (err) {
        // P2002 — another row grabbed this login between the findUnique and
        // the update (concurrent persist). Re-resolve by login.
        const isUnique =
          typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
        if (!isUnique) throw err;
        const winner = await db.brokerAccount.findUnique({
          where: { memberId_accountLogin: { memberId, accountLogin: login } },
          select: { id: true },
        });
        if (winner) accountId = winner.id;
      }
    }
  }

  // 3. Create the AI-detected row.
  if (accountId === null) {
    const type =
      output.account.accountTypeGuess ?? args.declaredAccountType ?? ('personal' as const);
    try {
      const created = await db.brokerAccount.create({
        data: {
          memberId,
          label: ocrLabel ?? `${brokerName ?? 'Compte MT5'} ${login}`,
          type,
          brokerName,
          accountLogin: login,
          detectedByAI: true,
          confidence: output.confidence,
        },
        select: { id: true },
      });
      accountId = created.id;
      accountCreated = true;
    } catch (err) {
      const isUnique =
        typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
      if (!isUnique) throw err;
      const winner = await db.brokerAccount.findUnique({
        where: { memberId_accountLogin: { memberId, accountLogin: login } },
        select: { id: true },
      });
      if (!winner) throw err;
      accountId = winner.id;
    }
  }

  // --- Positions insert with dedup (ticket primary, heuristic fallback). ---
  const parsedPositions = output.positions.map((p) => ({
    ticket: p.ticket,
    symbol: p.symbol.toUpperCase().slice(0, 32),
    side: p.side === 'buy' ? ('long' as const) : ('short' as const),
    openTime: new Date(p.openTime),
    closeTime: p.closeTime ? new Date(p.closeTime) : null,
    volume: p.volume,
    entryPrice: p.entryPrice,
    exitPrice: p.exitPrice,
    pnl: p.pnl,
  }));

  const tickets = parsedPositions.map((p) => p.ticket).filter((t): t is string => t !== null);
  const openTimes = parsedPositions.map((p) => p.openTime.getTime());
  const windowStart = new Date(Math.min(...openTimes, Date.now()));
  const windowEnd = new Date(Math.max(...openTimes, 0));

  const existing = await db.extractedPosition.findMany({
    where: {
      brokerAccountId: accountId,
      OR: [
        ...(tickets.length > 0 ? [{ ticket: { in: tickets } }] : []),
        ...(parsedPositions.length > 0 ? [{ openTime: { gte: windowStart, lte: windowEnd } }] : []),
      ],
    },
    select: { ticket: true, symbol: true, side: true, openTime: true, volume: true },
  });
  const existingTickets = new Set(existing.map((e) => e.ticket).filter((t) => t !== null));
  const existingHeuristic = new Set(
    existing.map((e) =>
      positionHeuristicKey({
        symbol: e.symbol,
        side: e.side,
        openTimeMs: e.openTime.getTime(),
        volume: Number(e.volume),
      }),
    ),
  );

  const toInsert = parsedPositions.filter((p) => {
    if (p.ticket !== null && existingTickets.has(p.ticket)) return false;
    return !existingHeuristic.has(
      positionHeuristicKey({
        symbol: p.symbol,
        side: p.side,
        openTimeMs: p.openTime.getTime(),
        volume: p.volume,
      }),
    );
  });

  if (toInsert.length > 0) {
    await db.extractedPosition.createMany({
      data: toInsert.map((p) => ({
        brokerAccountId: accountId as string,
        proofId,
        ticket: p.ticket,
        symbol: p.symbol,
        side: p.side,
        openTime: p.openTime,
        closeTime: p.closeTime,
        volume: p.volume,
        entryPrice: p.entryPrice,
        exitPrice: p.exitPrice,
        pnl: p.pnl,
        source: 'mt5_screen_ocr' as const,
        confidence: args.output.confidence,
      })),
    });
  }

  // --- Proof → done + (re)attach to the resolved account. ---
  await db.mt5AccountProof.update({
    where: { id: proofId },
    data: { ocrStatus: 'done', brokerAccountId: accountId, claudeRunId: args.ranAt },
  });

  // --- Evidence-based account count (§30): DISTINCT MT5 logins proven so
  // far. Honest by construction — declared-but-never-proven accounts don't
  // inflate it, and it never decreases on its own.
  const detectedAccountCount = await db.brokerAccount.count({
    where: { memberId, accountLogin: { not: null } },
  });
  await db.user.update({
    where: { id: memberId },
    data: { detectedAccountCount },
  });

  return {
    accountId,
    accountCreated,
    positionsInserted: toInsert.length,
    positionsDeduplicated: parsedPositions.length - toInsert.length,
    detectedAccountCount,
  };
}
