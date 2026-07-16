import 'server-only';

import type { ZodError } from 'zod';

import type { ProofFailureReason } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { selectStorage } from '@/lib/storage';
import { enqueueProofAnalyzedNotification } from '@/lib/notifications/enqueue';
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import { detectAMFViolation } from '@/lib/safety/amf-detection';
import { CLAUDE_LOCAL_SENTINEL, KNOWN_CLAUDE_MODEL_SLUGS } from '@/lib/ai/claude-response';
import { safeFreeText } from '@/lib/text/safe';
import {
  verificationBatchResultEntrySchema,
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
import { reconcileOneMember } from './reconcile';

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
      // `| undefined` matches what Zod `.optional()` actually infers under
      // exactOptionalPropertyTypes — Gate 0 assigns `entryParsed.data` here.
      readonly model?: string | undefined;
    }
  | {
      readonly proofId: string;
      readonly userId: string;
      readonly error: string;
      /** Tour 18 — factual note of the non-MT5 screen the model saw. */
      readonly observed?: string | undefined;
    };

/**
 * Wire-level entry as accepted by the persist ROUTE : the addressing IDs are
 * schema-guaranteed, everything else (output/error/model) is untrusted until
 * Gate 0 re-parses the entry against the strict
 * `verificationBatchResultEntrySchema` union. Mirror of the onboarding
 * per-entry fix (2026-07-02): validating entry CONTENT at the envelope made
 * persist all-or-nothing.
 */
export type VerificationBatchPersistWireEntry = {
  readonly proofId: string;
  readonly userId: string;
} & Record<string, unknown>;

export interface VerificationBatchPersistRequest {
  readonly results: readonly VerificationBatchPersistWireEntry[];
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

/**
 * Anti-loop cap (2026-07-10 quota-burn incident): a proof whose entry keeps
 * failing Zod (Gate 0/4) stays `pending`, so `loadPendingProofsEnvelope`
 * re-serves it and the worker re-pays the same `claude --print` every tick —
 * 7h+ straight before anyone noticed. After this many `invalid_output`
 * audits inside the window below, the proof is terminally failed (the
 * member re-shoots a fresh capture).
 */
export const INVALID_OUTPUT_MAX_ATTEMPTS = 3;
const INVALID_OUTPUT_ATTEMPT_WINDOW_MS = 7 * 86_400_000;

/** Terminal skip reason when the extraction carries `account.login: null`
 *  (MT5 MOBILE layout shows no account header — nothing to reconcile on). */
export const ACCOUNT_LOGIN_UNREADABLE_REASON = 'account_login_unreadable';

/**
 * Compact per-entry Zod failure summary for `invalid_output` audit rows.
 * A top-level union failure always reports `issuesCount: 1` (one
 * `invalid_union` issue) — which is exactly how the 2026-07-10 login-null
 * loop stayed opaque for hours. Walking union branches yields deduped
 * `path: code` strings so the audit says WHICH field broke. Bounded to 8.
 */
function summarizeZodIssues(error: ZodError): string[] {
  const paths = new Set<string>();
  const walk = (issues: readonly unknown[]): void => {
    for (const raw of issues) {
      if (paths.size >= 8) return;
      if (typeof raw !== 'object' || raw === null) continue;
      const issue = raw as { code?: unknown; path?: unknown; errors?: unknown };
      if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
        for (const branch of issue.errors) {
          if (Array.isArray(branch)) walk(branch);
        }
        continue;
      }
      const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
      const code = typeof issue.code === 'string' ? issue.code : 'unknown';
      paths.add(`${path || '(root)'}: ${code}`);
    }
  };
  walk(error.issues);
  return [...paths];
}

/**
 * Tour 13 — purge a proof's stored screen once it reaches a TERMINAL state.
 * The verification screens exist « QU'À la vérification, traités à la volée et
 * jamais conservés » : the second a proof is analysed (`done`) or terminally
 * refused (`failed` via NOT_MT5_HISTORY), the image file is deleted and
 * `filePurgedAt` is stamped. The proof ROW survives (audit trail, per-member
 * dedup hash, extracted positions) — only the bytes go.
 *
 * Idempotent: a proof already purged (`filePurgedAt` set) is a no-op, so a
 * re-run / double-persist never double-deletes nor re-stamps. TRANSIENT
 * failures (proof stays `pending`) deliberately keep their file for the retry.
 *
 * Best-effort by design (mirror `storage.delete` contract): a delete error is
 * logged, not thrown — it must never undo a committed persist. A file left
 * behind by a delete blip is swept the next time the proof is (re)touched, or
 * by `ops/scripts/purge-legacy-media.sh`.
 */
async function purgeProofFile(args: {
  proofId: string;
  fileKey: string;
  alreadyPurged: boolean;
  ranAt: string;
  userId: string;
}): Promise<void> {
  if (args.alreadyPurged) return;
  try {
    await selectStorage().delete(args.fileKey);
    await db.mt5AccountProof.update({
      where: { id: args.proofId },
      data: { filePurgedAt: new Date() },
    });
    await logAudit({
      action: 'verification.proof.file_purged',
      userId: args.userId,
      metadata: { ranAt: args.ranAt, proofId: args.proofId },
    });
  } catch (err) {
    reportError(
      'verification.batch.purge',
      err instanceof Error ? err : new Error('proof_file_purge_failed'),
      { userId: args.userId, proofId: args.proofId },
    );
  }
}

function positionHeuristicKey(args: {
  symbol: string;
  side: string;
  openTimeMs: number;
  volume: number;
}): string {
  return `${args.symbol}|${args.side}|${args.openTimeMs}|${args.volume.toFixed(4)}`;
}

// TXN-1 (RC#8) — advisory-lock key derivation. A fixed int4 namespace + a
// deterministic in-process FNV-1a 32-bit hash of the proofId, fed to the
// DOCUMENTED `pg_advisory_xact_lock(int4, int4)` overload. Hashing in JS (not
// via Postgres' undocumented `hashtext()`) keeps the key stable and version-
// proof. A hash collision only causes a harmless spurious serialization.
const PROOF_PERSIST_LOCK_NS = 0x1f2e3d4c; // "verification.proof.persist" namespace
function proofPersistLockKey(proofId: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < proofId.length; i++) {
    h ^= proofId.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime, 32-bit via imul
  }
  return h | 0; // coerce to signed int4 (Postgres `integer`)
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
        // Tour 13 — the stored screen is purged the moment a proof reaches a
        // TERMINAL state (done / failed): `fileKey` locates the bytes to
        // delete, `filePurgedAt` makes the purge idempotent (a re-run finds it
        // already null-file and skips).
        fileKey: true,
        filePurgedAt: true,
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
  // Tour 14 — per-member terminal-proof counters for THIS run, aggregated so the
  // member gets ONE calm « analyse prête » push (never one-per-proof). `analyzed`
  // counts proofs flipped to `done`, `failed` counts proofs terminally refused
  // (`not_mt5_history`). Enqueued once after the loop; PII-free (counts only).
  const verdictByMember = new Map<string, { analyzed: number; failed: number }>();
  const bumpVerdict = (userId: string, key: 'analyzed' | 'failed') => {
    const current = verdictByMember.get(userId) ?? { analyzed: 0, failed: 0 };
    current[key] += 1;
    verdictByMember.set(userId, current);
  };

  // Terminal soft-failure sequence — flip to `failed`, count toward the
  // member's verdict push, purge the stored screen. Exactly what the
  // `not_mt5_history` wire-error path has always done; factored out
  // (2026-07-10) because the null-login skip and the invalid-output attempt
  // cap now share it. Order matters: flip THEN purge (the purge stamps
  // `filePurgedAt` on the already-terminal row).
  const flipProofToFailedAndPurge = async (
    proofRow: { id: string; fileKey: string; filePurgedAt: Date | null },
    userId: string,
    failureReason: ProofFailureReason,
  ): Promise<void> => {
    await db.mt5AccountProof.update({
      where: { id: proofRow.id },
      // J4.1 — the failure reason is written in the SAME update that flips the
      // proof to terminal `failed`, so the /verification screen can render a
      // calm, specific message instead of the generic « Lecture impossible ».
      data: { ocrStatus: 'failed', claudeRunId: ranAt, failureReason },
    });
    bumpVerdict(userId, 'failed');
    await purgeProofFile({
      proofId: proofRow.id,
      fileKey: proofRow.fileKey,
      alreadyPurged: proofRow.filePurgedAt !== null,
      ranAt,
      userId,
    });
  };

  // Ordinal of THIS invalid-output attempt for a proof: prior audit rows in
  // the 7-day window + 1. Fails open to 1 on a count error — never
  // terminal-fail a proof on uncertain data.
  const countInvalidOutputAttempts = async (proofId: string): Promise<number> => {
    try {
      const prior = await db.auditLog.count({
        where: {
          action: 'verification.batch.invalid_output',
          createdAt: { gt: new Date(Date.now() - INVALID_OUTPUT_ATTEMPT_WINDOW_MS) },
          metadata: { path: ['proofId'], equals: proofId },
        },
      });
      return prior + 1;
    } catch {
      reportWarning('verification.batch', 'invalid_output_attempt_count_failed', { proofId });
      return 1;
    }
  };

  for (const rawEntry of request.results) {
    // Gate 0 — strict per-entry union re-parse. This validation used to live
    // at the route envelope; moved here (2026-07-02, mirror onboarding) so
    // ONE invalid AI output only skips THAT entry instead of 400-rejecting
    // the whole lot. Same audit slug as Gate 4 — both mean "this entry's
    // content failed Zod".
    const entryParsed = verificationBatchResultEntrySchema.safeParse(rawEntry);
    if (!entryParsed.success) {
      errors += 1;
      const attempt = await countInvalidOutputAttempts(rawEntry.proofId);
      await logAudit({
        action: 'verification.batch.invalid_output',
        userId: rawEntry.userId,
        metadata: {
          ranAt,
          proofId: rawEntry.proofId,
          issuesCount: entryParsed.error.issues.length,
          issuePaths: summarizeZodIssues(entryParsed.error),
          attempt,
          gate: 'entry_union',
        },
      });
      // Attempt cap — the proof would otherwise be re-served (and re-paid)
      // forever. Ownership is re-checked inline: Gates 1-2 have not run on
      // this branch, so a forged userId must never flip someone else's proof.
      if (attempt >= INVALID_OUTPUT_MAX_ATTEMPTS) {
        const proofForCap = proofById.get(rawEntry.proofId);
        if (
          proofForCap &&
          proofForCap.memberId === rawEntry.userId &&
          proofForCap.ocrStatus === 'pending'
        ) {
          await flipProofToFailedAndPurge(proofForCap, rawEntry.userId, 'ANALYSIS_UNREADABLE');
          await logAudit({
            action: 'verification.batch.skipped',
            userId: rawEntry.userId,
            metadata: {
              ranAt,
              proofId: rawEntry.proofId,
              reason: 'invalid_output_attempts_exhausted',
              attempts: attempt,
            },
          });
        }
      }
      continue;
    }
    const entry: VerificationBatchResultEntry = entryParsed.data;
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
        // Terminal `failed` → the member learns the capture could not be read
        // (they re-shoot via a fresh upload — the screen is purged, never
        // retried from storage); counted toward this run's verdict push.
        await flipProofToFailedAndPurge(proof, entry.userId, 'NOT_MT5_SCREEN');
      }
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          reason: entry.error.slice(0, 200),
          // Tour 18 — "dis ce que tu vois" : record the model's factual note of
          // the non-MT5 screen it saw, so a member's "ça ne marche pas" resolves
          // to a legible "l'IA a vu un graphique TradingView, pas un historique".
          ...(entry.observed ? { observed: entry.observed.slice(0, 300) } : {}),
        },
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
      const attempt = await countInvalidOutputAttempts(entry.proofId);
      await logAudit({
        action: 'verification.batch.invalid_output',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          issuesCount: parsed.error.issues.length,
          issuePaths: summarizeZodIssues(parsed.error),
          attempt,
        },
      });
      // Attempt cap — mirror of Gate 0 (ownership already proven by Gate 2,
      // `done` already excluded by Gate 3, so only `pending` needs checking).
      if (attempt >= INVALID_OUTPUT_MAX_ATTEMPTS && proof.ocrStatus === 'pending') {
        await flipProofToFailedAndPurge(proof, entry.userId, 'ANALYSIS_UNREADABLE');
        await logAudit({
          action: 'verification.batch.skipped',
          userId: entry.userId,
          metadata: {
            ranAt,
            proofId: entry.proofId,
            reason: 'invalid_output_attempts_exhausted',
            attempts: attempt,
          },
        });
      }
      continue;
    }
    const output = parsed.data;

    // Null-login terminal skip (2026-07-10) — the MT5 MOBILE history layout
    // shows no account number, so an honest extraction can carry
    // `account.login: null` (the prompt now says so explicitly). Without the
    // header there is NOTHING to reconcile on: the login is THE account
    // resolution key (§33.3 « réalité vs déclaré »), and the looping members'
    // declared rows all had `accountLogin: null` too. Persisting would
    // corrupt that signal, so this is the same CONTENT verdict as
    // `not_mt5_history`: terminal `failed`, nothing persisted, the member
    // re-shoots a capture that includes the account header.
    if (output.account.login === null) {
      skipped += 1;
      if (proof.ocrStatus === 'pending') {
        await flipProofToFailedAndPurge(proof, entry.userId, 'LOGIN_NOT_FOUND');
      }
      await logAudit({
        action: 'verification.batch.skipped',
        userId: entry.userId,
        metadata: {
          ranAt,
          proofId: entry.proofId,
          reason: ACCOUNT_LOGIN_UNREADABLE_REASON,
          ...(output.screenObservation ? { observed: output.screenObservation.slice(0, 300) } : {}),
        },
      });
      continue;
    }

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
      bumpVerdict(entry.userId, 'analyzed');
      // Terminal `done` (flipped inside materialiseProofExtraction's txn) → the
      // screen has been read; purge the stored image immediately (the extracted
      // positions ARE the retained record now, not the screenshot).
      await purgeProofFile({
        proofId: entry.proofId,
        fileKey: proof.fileKey,
        alreadyPurged: proof.filePurgedAt !== null,
        ranAt,
        userId: entry.userId,
      });
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
          // Tour 18 — "le voir et le dire" : the model's own statement of the
          // screen it read (MT5 desktop/mobile + account + row count). Persisted
          // to the audit as the human-legible proof the vision actually looked.
          ...(output.screenObservation
            ? { screenObservation: output.screenObservation.slice(0, 300) }
            : {}),
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

  // S4 §30 «alerte sans délai» — for every member whose proof persisted this
  // run, RECONCILE the freshly inserted positions THEN scan for repetition
  // alerts, mirroring the 11:30 UTC cron's reconcile→alerts order. Without the
  // reconcile, the scan would read the discrepancy table as the last cron left
  // it (the new positions haven't surfaced their gaps yet) and the «sans délai»
  // alert would never actually fire — only the latency would *look* reduced.
  // Per member, isolated (a failure never undoes a committed persist) and
  // idempotent (the cron re-runs both daily; Alert dedup + P2002 on delivery),
  // scoped to role:'member' to match the cron's eligibility predicate exactly.
  // Repetition gating (thresholds ≥2/3, §31#4 anti-honte) is untouched.
  if (touchedMemberIds.size > 0) {
    const alertsNow = new Date();
    const windowStart = new Date(alertsNow.getTime() - ALERT_WINDOW_DAYS * 86_400_000);
    const members = await db.user.findMany({
      where: { id: { in: [...touchedMemberIds] }, role: 'member' },
      select: { id: true, timezone: true },
    });
    for (const member of members) {
      try {
        await reconcileOneMember(member.id, alertsNow);
        await scanAlertsForMember(
          member.id,
          member.timezone || 'Europe/Paris',
          alertsNow,
          windowStart,
        );
      } catch (alertErr) {
        reportError(
          'verification.batch.alert_scan',
          alertErr instanceof Error ? alertErr : new Error('post_persist_alert_scan_failed'),
          { userId: member.id },
        );
      }
    }
  }

  // Tour 14 — « vérification informée » : one calm verdict push per member whose
  // proof reached a terminal state this run (done or failed). Best-effort (the
  // enqueuer never throws) and isolated so a queue hiccup never undoes a committed
  // persist. Covers `failed`-only members too (verdictByMember is the superset of
  // touchedMemberIds, which holds only `done`). The `/verification` poller shows
  // the result in-page; this push reaches members who left the page.
  for (const [userId, verdict] of verdictByMember) {
    if (verdict.analyzed === 0 && verdict.failed === 0) continue;
    await enqueueProofAnalyzedNotification(userId, {
      analyzedCount: verdict.analyzed,
      failedCount: verdict.failed,
    });
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
  // Invariant: the null-login terminal skip in `persistVisionResults` runs
  // BEFORE materialisation — a null login has no resolution key and must
  // never reach this point.
  const rawLogin = output.account.login;
  if (rawLogin === null) throw new Error('login_null_output_is_not_materialisable');
  const login = safeFreeText(rawLogin);
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

  // TXN-1 (RC#8) — serialize concurrent persists of the SAME proof. The partial
  // unique index `extracted_positions_account_ticket_uniq` only covers TICKETED
  // rows (WHERE ticket IS NOT NULL); ticket-less mobile-MT5 positions have NO DB
  // dedup. Two overlapping `persistVisionResults` POSTs for the same `pending`
  // proof (a retry/double-invoke) could both read `existing` empty and both
  // insert the same ticket-less rows → reality double-counted (inflated
  // positionsCount + duplicate `missing_declared` discrepancies + duplicate
  // negative ScoreEvents). A transaction-scoped advisory lock keyed on the proof
  // makes the loser WAIT for the winner to commit, then re-read `existing` (now
  // populated) so its heuristic filter excludes the inserted rows. Within-batch
  // identical-heuristic rows are unchanged (the filter only compares against
  // committed DB rows), so no legitimate duplicate trade is collapsed — strictly
  // safer than a second partial unique index, which would. The insert + proof
  // flip are now atomic, closing the old crash-between-them gap too.
  const insertedCount = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PROOF_PERSIST_LOCK_NS}::int4, ${proofPersistLockKey(proofId)}::int4)`;

    const existing = await tx.extractedPosition.findMany({
      where: {
        brokerAccountId: accountId,
        OR: [
          ...(tickets.length > 0 ? [{ ticket: { in: tickets } }] : []),
          ...(parsedPositions.length > 0
            ? [{ openTime: { gte: windowStart, lte: windowEnd } }]
            : []),
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

    // `skipDuplicates` remains the race-safe backstop for TICKETED rows (the
    // partial unique index turns a loser's row into ON CONFLICT DO NOTHING);
    // the advisory lock above covers the ticket-less rows it cannot. `count`
    // is the rows ACTUALLY inserted (≤ toInsert.length), so reporting is true.
    let count = 0;
    if (toInsert.length > 0) {
      const inserted = await tx.extractedPosition.createMany({
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
        skipDuplicates: true,
      });
      count = inserted.count;
    }

    // --- Proof → done + (re)attach to the resolved account (atomic with the
    // insert under the same lock). ---
    await tx.mt5AccountProof.update({
      where: { id: proofId },
      data: { ocrStatus: 'done', brokerAccountId: accountId, claudeRunId: args.ranAt },
    });

    return count;
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
    positionsInserted: insertedCount,
    positionsDeduplicated: parsedPositions.length - insertedCount,
    detectedAccountCount,
  };
}
