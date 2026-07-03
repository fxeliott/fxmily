import 'server-only';

import { db } from '@/lib/db';

/**
 * Crisis follow-up — the "day after" presence (item 20 volet 2).
 *
 * When `detectCrisis` fired HIGH/MEDIUM on a member's free text, the only
 * member-facing surface was the one-shot `V18CrisisBanner` on the submit
 * redirect (`?crisis=high|medium`). One navigation later, the app had
 * forgotten. This module gives the daily-guidance engine a memory of it:
 * a calm, non-punitive follow-up card for the next 48 hours.
 *
 * SOURCE OF TRUTH — the dedicated audit rows the Server Actions already
 * write on every HIGH/MEDIUM detection (`*.crisis_detected`). No schema
 * change, no new write path; derive-at-render like every other guidance
 * signal. The `(userId, createdAt)` index on `audit_logs` bounds the read.
 *
 * PRIVACY (RGPD §16) — reads ONLY the row's existence, level and timestamp.
 * The matched labels stay in the audit metadata, the raw text was never
 * stored anywhere. The follow-up copy never quotes or paraphrases the
 * member's words.
 */

/**
 * The Server Action slugs recording a HIGH/MEDIUM detection on MEMBER-WRITTEN
 * free text — deliberately NOT the `*.batch` crisis slugs, which screen
 * AI-generated output (a tripped AI report says nothing about the member's
 * state and must never trigger a "how are you" follow-up).
 */
export const CRISIS_AUDIT_ACTIONS = [
  'checkin.crisis_detected',
  'onboarding.interview.crisis_detected',
  'reflection.crisis_detected',
  'weekly_review.crisis_detected',
  'training_debrief.crisis_detected',
] as const;

/** Follow-up window after a detection. 48h covers "the day after" fully. */
export const CRISIS_FOLLOWUP_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface CrisisSignal {
  /** Severity carried by the audit row metadata ('high' | 'medium'). */
  level: 'high' | 'medium';
  /** When the detection happened. */
  detectedAt: Date;
}

/**
 * Most recent HIGH/MEDIUM crisis detection for this member inside the
 * follow-up window, or null. Dedicated `*.crisis_detected` rows exist ONLY
 * for high/medium (the actions skip low/none), so their presence alone is
 * the signal; the metadata level is read defensively with a 'medium'
 * fallback so a malformed row degrades to the softer copy, never a crash.
 */
export async function getRecentCrisisSignal(
  userId: string,
  now: Date = new Date(),
): Promise<CrisisSignal | null> {
  const row = await db.auditLog.findFirst({
    where: {
      userId,
      action: { in: [...CRISIS_AUDIT_ACTIONS] },
      createdAt: { gte: new Date(now.getTime() - CRISIS_FOLLOWUP_WINDOW_MS), lte: now },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, metadata: true },
  });
  if (!row) return null;
  const raw =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>).level
      : undefined;
  return {
    level: raw === 'high' ? 'high' : 'medium',
    detectedAt: row.createdAt,
  };
}
