import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { sendVerificationOverdueAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';

/**
 * AUTONOMY-1 — MT5 proof vision permanence safety-net (5th twin of the
 * permanence net class : §26 calendar `lib/calendar/overdue.ts` + §25 monthly
 * `lib/monthly-debrief/overdue.ts` + S2 onboarding
 * `lib/onboarding-interview/overdue.ts` + J8 weekly `lib/weekly-report/overdue.ts`).
 *
 * The MT5 verification pipeline is : member uploads an MT5 history screenshot
 * (`Mt5AccountProof.ocrStatus='pending'`) → MANUAL local Claude VISION batch
 * (`ops/scripts/verification-batch-local.sh` / `/verification-batch`, ban-risk
 * human-in-the-loop §5.4 — the generation is NEVER cronned, see
 * `lib/verification/batch.ts:27-57`) → accounts + positions extracted, proof
 * flips to `done`. The silent failure mode is the exact twin of the other four
 * gaps : the admin forgets the batch, and a member who uploaded a proof NEVER
 * gets it analysed — their account/positions stay unextracted, indefinitely,
 * with no signal. The four sibling pipelines all have a `*-overdue-alert` cron ;
 * the vision batch was the ONLY local Claude pipeline without one.
 *
 * This module is the safety-net : a read-only scan, run by a daily server
 * cron, that nudges the ADMIN when pending proofs are missing their analysis
 * past the grace window. It never drives Claude — it only counts rows and
 * emails the operator. Pure-read, posture §2-clean (counts + a timestamp only ;
 * no proofId, no member id, no broker label, no extracted P&L leaves it).
 */

/**
 * Grace (hours after upload) before a still-pending proof is "overdue". 24h
 * aligns with the sibling onboarding net (the other per-row, timestamp-based
 * grace) and the daily cron cadence : the admin gets a calm 1-day buffer to run
 * the batch before any nudge fires. Unlike the monthly/weekly nets (global
 * period window) the grace here is PER-PROOF : each upload opens its own 24h
 * window.
 */
const OVERDUE_GRACE_HOURS = 24;

export interface OverdueVerificationScan {
  /** Pending MT5 proofs of ACTIVE members whose 24h grace has expired
   *  (uploadedAt ≤ now − 24h). The coverage is the proof leaving `pending`
   *  (`done` = analysed, `failed` = a content verdict the member can re-shoot) —
   *  the batch flips the status in the same persist as the extraction, so there
   *  is no separate dispatch step to track (unlike the monthly `sentToMemberAt`).
   *  0 while every pending proof is still inside its grace window. */
  overdueCount: number;
  /** ISO instant of the OLDEST overdue upload (how long the most patient member
   *  has been waiting), or null when nothing is overdue. A bare timestamp —
   *  deliberately the only non-count field, PII-free. */
  oldestUploadedAt: string | null;
  /** True when there ARE pending proofs but every one of them is still inside
   *  its 24h grace (nothing broken yet → calm). */
  withinGrace: boolean;
  /** ISO instant of the scan. */
  scannedAt: string;
}

/**
 * Read-only scan. ONE index-bounded read on `@@index([ocrStatus, uploadedAt])`
 * (the same index the vision batch pull uses) : the Prisma relation filters push
 * the whole candidate logic (pending + active member) into a single query ; the
 * per-proof grace split is done in JS on the returned timestamps. No writes. The
 * select is `uploadedAt` only — no proof id, no member id, no broker label
 * (PII-free by construction).
 */
export async function scanOverdueVerifications(
  options: { now?: Date } = {},
): Promise<OverdueVerificationScan> {
  const now = options.now ?? new Date();
  const graceThreshold = new Date(now.getTime() - OVERDUE_GRACE_HOURS * 60 * 60 * 1000);

  const rows = await db.mt5AccountProof.findMany({
    where: {
      // Only proofs still awaiting analysis — `done` (analysed) and `failed`
      // (a `not_mt5_history` content verdict) never owe a batch run, exactly
      // like the batch pull predicate (`lib/verification/batch.ts:139`).
      ocrStatus: 'pending',
      // A member who left (soft-delete / deletion pipeline) is no longer owed
      // an analysis — mirror of the batch pull's `member: { status: 'active' }`
      // filter and the sibling nets' active-user predicate.
      member: { status: 'active' },
    },
    select: { uploadedAt: true },
  });

  const uploadedAts = rows.map((r) => r.uploadedAt);

  // Per-proof grace : overdue ⇔ the 24h courtesy window has fully elapsed. `≤`
  // on purpose — at exactly +24h the proof is overdue (mirror onboarding net).
  const overdue = uploadedAts.filter((d) => d.getTime() <= graceThreshold.getTime());
  const oldestOverdue = overdue.length > 0 ? overdue.reduce((min, d) => (d < min ? d : min)) : null;

  return {
    overdueCount: overdue.length,
    oldestUploadedAt: oldestOverdue ? oldestOverdue.toISOString() : null,
    withinGrace: overdue.length === 0 && uploadedAts.length > 0,
    scannedAt: now.toISOString(),
  };
}

export type OverdueAlertEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_attempted';

export interface VerificationOverdueAlertResult extends OverdueVerificationScan {
  alerted: boolean;
  emailOutcome: OverdueAlertEmailOutcome;
}

/**
 * Scan + (if overdue) nudge the admin. Side-effect-bounded, mirror of
 * `runOnboardingProfileOverdueAlert` / `runMonthlyDebriefOverdueAlert` :
 *   - ALWAYS one PII-free heartbeat audit (`cron.verification_overdue.scan`)
 *     consumed by `lib/system/health.ts` — emitted every run, so an overdue
 *     proof never blinds the monitor.
 *   - overdue > 0 → admin email (best-effort, `WEEKLY_REPORT_RECIPIENT`) +
 *     `reportWarning`. Email failure degrades to the Sentry warning, never
 *     throws back into the cron.
 *
 * Anti-spam by cadence (daily) : ≤ 1 nudge/day while overdue, stops the moment
 * the vision batch is run. It never drives Claude — count + email only.
 */
export async function runVerificationOverdueAlert(
  options: { now?: Date } = {},
): Promise<VerificationOverdueAlertResult> {
  const scan = await scanOverdueVerifications(options);

  let emailOutcome: OverdueAlertEmailOutcome = 'not_attempted';

  if (scan.overdueCount > 0) {
    reportWarning('cron.verification-overdue', 'verifications_overdue', {
      overdueCount: scan.overdueCount,
      oldestUploadedAt: scan.oldestUploadedAt,
    });

    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      try {
        const { delivered } = await sendVerificationOverdueAlertEmail({
          to: recipient,
          overdueCount: scan.overdueCount,
          oldestUploadedAt: scan.oldestUploadedAt,
        });
        emailOutcome = delivered ? 'sent' : 'skipped';
      } catch (err) {
        emailOutcome = 'failed';
        reportWarning('cron.verification-overdue', 'admin_email_failed', {
          error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
  }

  await logAudit({
    action: 'cron.verification_overdue.scan',
    metadata: {
      overdueCount: scan.overdueCount,
      oldestUploadedAt: scan.oldestUploadedAt,
      withinGrace: scan.withinGrace,
      alerted: scan.overdueCount > 0,
      emailOutcome,
      scannedAt: scan.scannedAt,
    },
  });

  return { ...scan, alerted: scan.overdueCount > 0, emailOutcome };
}
