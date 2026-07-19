import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportWarning } from '@/lib/observability';
import type { Prisma } from '@/generated/prisma/client';
import type { NotificationType } from '@/generated/prisma/enums';

/**
 * Notification queue — enqueue side (J4 enqueue, J9 dispatch).
 *
 * At J4 we persist the *intent* of a push notification. The actual web-push
 * dispatcher (`lib/push/dispatcher.ts`) is built in J9. Until then the row
 * stays `pending` indefinitely — that's fine, the dispatcher will pick it up
 * once wired.
 *
 * Best-effort by design: a failure to enqueue must NOT roll back the
 * operation that triggered it (e.g. creating an annotation). The caller
 * decides whether to await us or fire-and-forget.
 */

/**
 * Prisma unique-constraint violation (P2002) detector. Kept as an inline
 * `'code' in err` check (no runtime `Prisma` import — the namespace is
 * type-only here) so a benign dedup race on a partial unique index can be
 * folded into a no-op instead of surfacing as a false enqueue failure. Mirrors
 * the inline check in `enqueueCheckinReminder`.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'
  );
}

export interface AnnotationReceivedPayload {
  /** The annotation that was just created. */
  annotationId: string;
  /** The trade it's attached to — used in the dispatch link. */
  tradeId: string;
  /** Author of the correction — UI mentions "1 correction de Eliott". */
  adminId: string;
  /** Whether the annotation has a media attachment (drives the body copy). */
  hasMedia: boolean;
}

/**
 * Enqueue an "annotation received" push notification for the trade owner.
 *
 * Optionally accepts a Prisma transaction client — when called from inside an
 * existing `db.$transaction(...)`, the enqueue stays atomic with the parent
 * mutation. Without a tx the helper writes through the singleton.
 *
 * Returns the enqueued row's id, or null if the write failed (logged, never
 * thrown).
 */
export async function enqueueAnnotationNotification(
  recipientUserId: string,
  payload: AnnotationReceivedPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'annotation_received',
        // Cast: Prisma's JSON column is `JsonValue` which includes index
        // signatures we don't model on our payload type.
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Audit only outside a transaction — embedding audit in a tx would
    // commit/rollback together with the parent op, which isn't what we want
    // (audit is best-effort, the parent op is the source of truth).
    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'annotation_received',
          tradeId: payload.tradeId,
          annotationId: payload.annotationId,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — console-only hid a chronic enqueue failure from Sentry
    // (server console.error is not captured). Best-effort: still return null so
    // creating the annotation never rolls back over a queue hiccup.
    reportWarning('annotation.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// J-T3 — Mode Entraînement admin corrections (SPEC §21)
// =============================================================================

export interface TrainingAnnotationReceivedPayload {
  /** The training annotation that was just created. */
  trainingAnnotationId: string;
  /** The backtest it's attached to — used in the dispatch deep-link. */
  trainingTradeId: string;
  /** Author of the correction — UI mentions "1 correction de Eliott". */
  adminId: string;
  /** Whether the correction has a media attachment (drives the body copy). */
  hasMedia: boolean;
}

/**
 * Enqueue a "backtest correction received" push for the backtest owner.
 *
 * Carbon mirror of `enqueueAnnotationNotification`, but with the DISTINCT
 * `training_annotation_received` type and a training-only payload. STATISTICAL
 * ISOLATION (§21.5): a backtest correction must never reuse the real-trade
 * `annotation_received` slug/payload — the dispatcher, preferences, email
 * fallback and audit all branch on the distinct type so the two coaching
 * signals can never conflate. PII-free: the payload carries ids only, never
 * the member's backtest P&L.
 *
 * Best-effort: returns the row id, or null if the write failed (logged,
 * never thrown). Optionally joins a parent `db.$transaction`.
 */
export async function enqueueTrainingAnnotationNotification(
  recipientUserId: string,
  payload: TrainingAnnotationReceivedPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'training_annotation_received',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'training_annotation_received',
          trainingTradeId: payload.trainingTradeId,
          trainingAnnotationId: payload.trainingAnnotationId,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort.
    reportWarning('training-annotation.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface TrainingReplyReceivedPayload {
  /** The annotation the member just replied to. */
  trainingAnnotationId: string;
  /** The backtest it's attached to — used in the admin deep-link. */
  trainingTradeId: string;
  /** The member who replied — drives the admin deep-link `/admin/members/<id>/…`.
   * §21.5/§16: an id only, NEVER the reply text nor any backtest P&L. */
  memberId: string;
}

/**
 * Enqueue a "member replied to a backtest correction" push for the ADMIN who
 * authored the correction (S8 V2 §32-4). The reverse direction of
 * {@link enqueueTrainingAnnotationNotification}: there, the admin corrects and
 * the MEMBER is notified; here, the member replies and the ADMIN is notified,
 * closing the coaching loop without the admin polling each backtest.
 *
 * `recipientAdminId` is the correction author (the reply only ever lands on an
 * annotation that admin wrote). Carbon mirror of the other enqueuers:
 * best-effort (returns the row id, or null if the write failed — logged, never
 * thrown, so a member's reply is never rolled back over a queue hiccup).
 * PII-free payload: ids only, never the reply text (§21.5/§16).
 */
export async function enqueueTrainingReplyNotification(
  recipientAdminId: string,
  payload: TrainingReplyReceivedPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientAdminId,
        type: 'training_reply_received',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientAdminId,
        metadata: {
          notificationId: row.id,
          type: 'training_reply_received',
          trainingTradeId: payload.trainingTradeId,
          trainingAnnotationId: payload.trainingAnnotationId,
          memberId: payload.memberId,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort.
    reportWarning('training-reply.enqueue', 'enqueue_failed', {
      userId: recipientAdminId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// V1.4 §25 — Monthly AI debrief ready (member-facing, mirror J9)
// =============================================================================

export interface MonthlyDebriefReadyPayload {
  /** The persisted `MonthlyDebrief` row — deep-links the member page. */
  debriefId: string;
  /** Local 1st-of-month `YYYY-MM-DD` — PII-free audit/observability only. */
  monthStart: string;
}

/**
 * Enqueue a "monthly debrief ready" push for the member (SPEC §25.2 — push
 * `monthly_debrief_ready` + member email; NO admin monthly push by design).
 *
 * Carbon mirror of `enqueueAnnotationNotification`: best-effort (returns the
 * row id, or null if the write failed — logged, never thrown, so the J-M2
 * batch persist never rolls back a debrief over a queue hiccup). Optionally
 * joins a parent `db.$transaction`. PII-free payload: ids + the local month
 * date only, never the member's real or backtest P&L (§21.5/RGPD §16).
 */
export async function enqueueMonthlyDebriefNotification(
  recipientUserId: string,
  payload: MonthlyDebriefReadyPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'monthly_debrief_ready',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'monthly_debrief_ready',
          debriefId: payload.debriefId,
          monthStart: payload.monthStart,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort.
    reportWarning('monthly-debrief.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// Session 3 §28 — Mark Douglas drift alert delivered (member-facing immediate
// nudge). Completes the J9 reception chain (enum/buildPayload/TTL/preference)
// whose EMISSION was never wired: the trigger engine created the delivery row
// but enqueued no push, so a drift was only visible by PULL (opening the
// dashboard). Push-only (see EMAIL_FALLBACK_SKIP_TYPES) — calm, ≤1/day
// (engine anti-spam). Preference is default-on / opt-OUT (preferences.ts:38) —
// an active member with a push subscription receives it without a new consent
// gesture; they can disable it in notification preferences. SPEC §2 / anti
// Black-Hat: the card copy reframes calmly, never "you are tilting".
// =============================================================================

export interface DouglasCardDeliveredPayload {
  /** The `MarkDouglasDelivery` row just created (audit trail / dedup). */
  deliveryId: string;
  /** Card slug — deep-links `/library/<slug>` (dispatcher `buildPayload`). */
  cardSlug: string;
}

/**
 * Enqueue a "Mark Douglas card delivered" push for the member when the trigger
 * engine surfaces a drift card. Carbon mirror of
 * {@link enqueueMonthlyDebriefNotification}: best-effort (returns the row id,
 * or null if the write failed — logged, never thrown, so a real-time/cron
 * dispatch never rolls back the delivery over a queue hiccup). PII-free
 * payload: ids + slug only, never the trigger snapshot's counts/P&L.
 */
export async function enqueueDouglasDeliveryNotification(
  recipientUserId: string,
  payload: DouglasCardDeliveredPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'douglas_card_delivered',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'douglas_card_delivered',
          deliveryId: payload.deliveryId,
          cardSlug: payload.cardSlug,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — was console-only, so a genuine Douglas-delivery enqueue
    // failure hid from Sentry: the §28 drift card was persisted (the dispatch is
    // audited) but its PUSH-channel emission silently never queued, and an
    // operator had no signal. The queue insert has NO partial unique index for
    // `douglas_card_delivered` (dedup is upstream on MarkDouglasDelivery), so any
    // error here is a real failure, never a benign dedup race — surface it.
    // Mirror enqueueMindsetCheckNotification. Still best-effort: return null so a
    // real-time/cron dispatch never rolls back over a queue hiccup.
    reportWarning('douglas.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// V1.5 §27 — Mindset check ready (member-facing weekly nudge, mirror J9)
// =============================================================================

export interface MindsetCheckReadyPayload {
  /** Monday `YYYY-MM-DD` of the week the nudge is for — deep-links
   *  `/mindset/new`. PII-free; the member hasn't filled it yet (it's a
   *  gentle reminder, not a "content ready" signal — SPEC §27.2). */
  weekStart: string;
}

/**
 * Enqueue a gentle "your weekly mindset check is available" push for the
 * member (SPEC §27.2/§27.4 — push `mindset_check_ready`, NO email, no
 * fanfare; anti-FOMO canon §7.9/§23).
 *
 * Carbon mirror of `enqueueMonthlyDebriefNotification`: best-effort (returns
 * the row id, or null if the write failed — logged, never thrown, so a
 * reminder-scan hiccup never breaks the run). PII-free payload: only the
 * local Monday date, never anything from the real or backtest edge
 * (§21.5/§27.7/RGPD §16). Idempotency is enforced at the DB by the partial
 * unique index `notification_queue_pending_mindset_dedup` (user, weekStart) —
 * the app-side scan skip is the fast path, and a concurrent / re-fired run that
 * races it raises P2002 which we fold to a no-op here (RC#4).
 */
export async function enqueueMindsetCheckNotification(
  recipientUserId: string,
  payload: MindsetCheckReadyPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'mindset_check_ready',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'mindset_check_ready',
          weekStart: payload.weekStart,
        },
      });
    }

    return row.id;
  } catch (err) {
    // P2002 on the partial unique index `notification_queue_pending_mindset_dedup`
    // → a concurrent / re-fired weekly scan already enqueued this member's nudge
    // for this `weekStart`. Benign dedup race, NOT a failure: fold to a no-op
    // (return the existing pending row's id) so it never pollutes Sentry with a
    // false `enqueue_failed`. Mirror `enqueueCheckinReminder`.
    if (isUniqueViolation(err)) {
      if (!tx) {
        const existing = await db.notificationQueue.findFirst({
          where: { userId: recipientUserId, type: 'mindset_check_ready', status: 'pending' },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      return null;
    }
    // A-Z observability — was console-only, so a genuine weekly-nudge enqueue
    // failure hid in the scan's `skipped` count and the WEEKLY cron showed
    // green even if every member's nudge failed. Surface to Sentry; the scan
    // also tallies it into the heartbeat `errors` field. Mirror service.ts:478.
    reportWarning('mindset.reminders', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// S3 §33 — Micro-relance avant l'alerte (member-facing gentle nudge, mirror J9)
// =============================================================================

export interface GentleVerificationReminderPayload {
  /** The isolated unexcused gap this single benevolent nudge is about —
   *  deep-links `/verification` (where the member gives a motif). PII-free:
   *  an id only, never the capture content or any P&L (§21.5/RGPD §16). */
  discrepancyId: string;
}

/**
 * Enqueue ONE gentle « micro-relance » push for the member when an isolated
 * unexcused gap appears BELOW the repetition threshold (SPEC §33 enrichment :
 * « avant de faire monter une alerte, l'app envoie d'abord un rappel
 * bienveillant unique avec demande de motif »). The accompaniment is strictly
 * psychological (honnêteté/discipline, Mark Douglas) — NEVER a trading advice.
 *
 * Carbon mirror of {@link enqueueMindsetCheckNotification}: best-effort
 * (returns the row id, or null if the write failed — logged, never thrown, so a
 * gentle-scan hiccup never breaks the verification run). Idempotency is enforced
 * at the DB by the partial unique index `notification_queue_pending_gentle_dedup`
 * (user, discrepancyId): the scan stamping `Discrepancy.gentleReminderAt` is the
 * fast path, and a concurrent / re-fired run that races it raises P2002 which we
 * fold to a no-op here (RC#4). PII-free payload : a discrepancy id only.
 */
export async function enqueueGentleVerificationReminder(
  recipientUserId: string,
  payload: GentleVerificationReminderPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'verification_gentle_reminder',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'verification_gentle_reminder',
          discrepancyId: payload.discrepancyId,
        },
      });
    }

    return row.id;
  } catch (err) {
    // P2002 on the partial unique index `notification_queue_pending_gentle_dedup`
    // → a concurrent / re-fired verification scan already enqueued the gentle
    // nudge for this `discrepancyId`. Benign dedup race: fold to a no-op
    // (return the existing pending row's id), never log it as a failure.
    if (isUniqueViolation(err)) {
      if (!tx) {
        const existing = await db.notificationQueue.findFirst({
          where: {
            userId: recipientUserId,
            type: 'verification_gentle_reminder',
            status: 'pending',
          },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      return null;
    }
    // Audit ERR-3 — a real DB failure here dropped a member's gentle nudge
    // silently (console-only, invisible to Sentry AND uncounted by the scan).
    // Surface it, best-effort — return null keeps the caller's flow unchanged.
    reportWarning('verification.reminders', 'gentle_enqueue_failed', {
      userId: recipientUserId,
      discrepancyId: payload.discrepancyId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return null;
  }
}

// =============================================================================
// Tour 14 — MT5 proof analysed (member-facing verdict, mirror monthly debrief)
// =============================================================================

export interface ProofAnalyzedPayload {
  /** Proofs of this member that reached `done` (read) in this batch run. */
  analyzedCount: number;
  /** Proofs of this member terminally refused (`failed`) in this batch run. */
  failedCount: number;
}

/**
 * Enqueue ONE « ta capture a été analysée » push for the member after the vision
 * batch flips at least one of their proofs to a TERMINAL state (`done`/`failed`)
 * (Tour 14 — vérification non bloquante et informée). This closes the loop the
 * `/verification` poller opens: the member is told the verdict is ready even if
 * they left the page, so they never have to reload to find out.
 *
 * Carbon mirror of {@link enqueueMonthlyDebriefNotification}: member-facing,
 * best-effort (returns the row id, or null if the write failed — logged, never
 * thrown, so the batch persist never rolls back an analysed proof over a queue
 * hiccup), optionally joins a parent `db.$transaction`. PII-free payload: only
 * two counts, never a symbol, a broker, or any P&L (§21.5/RGPD §16).
 *
 * One push per member per run by construction — the caller aggregates all of a
 * member's terminal proofs into a single call (never one push per proof), so
 * there is no per-proof dedup index to race on (unlike the mindset/gentle nudges);
 * a benign double-run would at worst enqueue a second calm verdict, not spam.
 */
export async function enqueueProofAnalyzedNotification(
  recipientUserId: string,
  payload: ProofAnalyzedPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'verification_proof_analyzed',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'verification_proof_analyzed',
          analyzedCount: payload.analyzedCount,
          failedCount: payload.failedCount,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort: return
    // null so a queue hiccup never rolls back a committed proof analysis.
    reportWarning('verification.proof-analyzed.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// =============================================================================
// J5 — Check-in reminders
// =============================================================================

export interface CheckinReminderPayload {
  /** "morning" or "evening" — drives the J9 push title/body. */
  slot: 'morning' | 'evening';
  /** YYYY-MM-DD the reminder is for, in the user's local TZ. */
  date: string;
  /**
   * Tour 12 (action 2) — the member's current check-in streak (consecutive days
   * with ≥1 check-in), computed by the scan. Optional so every existing caller
   * compiles unchanged. Used ONLY to build the calm streak-aware copy line; the
   * scalar itself is PII-free (§21.5). 0/1 ⇒ no streak line (default copy).
   */
  streak?: number;
}

/**
 * Tour 12 (action 2) — the calm, continuity-framed streak line stored in the
 * reminder payload and read by the J9 dispatcher `buildPayload` as the push body.
 *
 * POSTURE §31.2 (BLOQUANT, tested by anti-dark-pattern suites): continuity ONLY,
 * NEVER a countdown, NEVER a loss threat ("ne casse pas ta série" is forbidden).
 * We acknowledge what's already behind the member — a fact, not a stake. Below 2
 * days there is no streak worth naming, so we return `null` and the dispatcher
 * keeps the existing neutral copy (no regression, and no "1 jour" awkwardness).
 *
 * Pure + FR, ponctuation simple, jamais de tiret cadratin (contrainte Eliott).
 */
export function buildStreakReminderLine(
  streak: number | undefined,
  slot: 'morning' | 'evening',
): string | null {
  if (typeof streak !== 'number' || streak < 2) return null;
  const tail =
    slot === 'morning' ? 'Ton check-in du matin t’attend.' : 'Ton check-in du soir t’attend.';
  return `${streak} jours d’affilée derrière toi. ${tail}`;
}

/**
 * Enqueue a check-in reminder push for a single user (J5).
 *
 * Race-safe idempotency keyed on (userId, type, payload.date) via a unique
 * partial index `notification_queue_pending_checkin_dedup` (see migration
 * 20260507100000_j5_notification_dedup). Two concurrent calls with the same
 * payload result in one row — the second `INSERT` raises Prisma's P2002 which
 * we catch and resolve to a no-op "already enqueued" result.
 *
 * Returns the row id (existing or new) on success, null on a non-recoverable
 * DB failure (logged, never thrown — best-effort by design).
 */
export async function enqueueCheckinReminder(
  userId: string,
  payload: CheckinReminderPayload,
): Promise<string | null> {
  const type = payload.slot === 'morning' ? 'checkin_morning_reminder' : 'checkin_evening_reminder';

  // Tour 12 (action 2) — persist the ready-made calm streak line (or omit it) so
  // the copy stays under code review here and the J9 dispatcher only READS it.
  // The raw `streak` scalar is dropped from the stored payload; only the derived
  // line (or nothing) is kept, along with slot/date needed for dedup + deep-link.
  const streakLine = buildStreakReminderLine(payload.streak, payload.slot);
  const storedPayload: { slot: 'morning' | 'evening'; date: string; streakLine?: string } = {
    slot: payload.slot,
    date: payload.date,
    ...(streakLine ? { streakLine } : {}),
  };

  try {
    const row = await db.notificationQueue.create({
      data: {
        userId,
        type,
        payload: storedPayload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    // P2002 unique-violation on the partial index → an enqueue won the race.
    // Look up the existing row (we still want to return its id) and return.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      const existing = await db.notificationQueue.findFirst({
        where: { userId, type, status: 'pending' },
        select: { id: true, payload: true },
      });
      if (
        existing &&
        typeof existing.payload === 'object' &&
        existing.payload !== null &&
        !Array.isArray(existing.payload) &&
        (existing.payload as Record<string, unknown>).date === payload.date
      ) {
        return existing.id;
      }
      // The conflict was on a different date in the same (user, type) slot —
      // shouldn't happen because the index is keyed on date too, but
      // defensive: log and bail.
      console.warn('[notifications.enqueue.checkin] P2002 with unmatched date', {
        userId,
        type,
        date: payload.date,
      });
      return null;
    }
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    // A-Z observability — a genuine enqueue failure (NOT the P2002 no-op above)
    // was console-only, so the scan bucketed it as "skipped" and the cron
    // stayed green-by-age. Surface it to Sentry AND let the scan tally it into
    // the heartbeat `errors` field (health.ts escalates green→amber on >0).
    // Mirrors lib/scoring/service.ts:478 (the recompute observability fix).
    reportWarning('checkin.reminders', 'enqueue_failed', { userId, type, code });
    return null;
  }
}

/**
 * Bulk enqueue: returns the count of newly-created reminders. Existing pending
 * rows are not duplicated. Skips a user when their slot is already filled for
 * `today` (passed in the input — caller decides who's eligible).
 */
export async function enqueueCheckinRemindersBulk(
  recipients: Array<{ userId: string; slot: 'morning' | 'evening'; date: string }>,
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;
  for (const r of recipients) {
    const id = await enqueueCheckinReminder(r.userId, { slot: r.slot, date: r.date });
    if (id) enqueued += 1;
    else skipped += 1;
  }
  return { enqueued, skipped };
}

/** Type-narrowing helper for J9 dispatcher (kept here so all queue knobs sit together). */
export const NOTIFICATION_TYPES_CHECKIN = new Set<NotificationType>([
  'checkin_morning_reminder',
  'checkin_evening_reminder',
]);

// =============================================================================
// J2 — Resend hardening + notifications vague 1 (SPEC §18.2). Two member-facing
// nudges that fall back to email when a push subscription isn't installed:
//   · calendar_ready         — the §26 adaptive weekly calendar was published.
//   · weekly_review_reminder — active-but-no-review Sunday nudge (REFLECT V1.8).
// Both are engagement nudges → `isTransactional` stays default-false, so the J9
// email fallback is frequency-capped (see NotificationQueue.isTransactional /
// SPEC §18.2). PII-free payloads: a local week date only, never any edge/P&L.
// =============================================================================

export interface CalendarReadyPayload {
  /** Monday `YYYY-MM-DD` (Europe/Paris) of the week the calendar covers —
   *  deep-links `/calendrier`. PII-free: a local week date only (§16). */
  weekStart: string;
}

/**
 * Enqueue a calm "ton plan de la semaine est prêt" push for the member when the
 * §26 adaptive calendar is published (email fallback when push isn't installed).
 *
 * Carbon mirror of `enqueueMonthlyDebriefNotification`: a SIMPLE insert with NO
 * dedup — the calendar publish hook fires at most once per member per week, so
 * there is nothing to race on here. Best-effort (returns the row id, or null if
 * the write failed — logged, never thrown, so publishing the calendar never
 * rolls back over a queue hiccup). Optionally joins a parent `db.$transaction`.
 * `isTransactional` stays default-false (engagement nudge; SPEC §18.2 cap).
 */
export async function enqueueCalendarReadyNotification(
  recipientUserId: string,
  payload: CalendarReadyPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'calendar_ready',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'calendar_ready',
          weekStart: payload.weekStart,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort: return
    // null so a queue hiccup never rolls back a just-published calendar.
    reportWarning('calendar-ready.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface WeeklyReviewReminderPayload {
  /** Monday `YYYY-MM-DD` (Europe/Paris) of the week the review is for —
   *  deep-links `/review`. Also the app-level dedup key (see below). PII-free:
   *  a local week date only, never anything from the member's edge (§16). */
  weekStart: string;
}

/**
 * Enqueue a gentle "ta revue de la semaine t'attend" push for a member who was
 * active this week but hasn't written their weekly review yet (REFLECT V1.8) —
 * email fallback when push isn't installed. Calm Sunday nudge, posture SPEC §2
 * (a mirror, never a trading advice).
 *
 * "Max 1 per week" (J2 requirement) is enforced by an APPLICATION-LEVEL dedup:
 * unlike `enqueueMindsetCheckNotification` / `enqueueGentleVerificationReminder`
 * there is NO partial unique index in the DB for `weekly_review_reminder`, so we
 * pre-check for an existing row (same user + type + `payload.weekStart`) whose
 * status isn't terminally `failed`, and no-op if found. That is sufficient here
 * because the emission is a SINGLE weekly cron on a SINGLE instance — the classic
 * concurrent double-fire that would need a DB unique index doesn't happen, and a
 * benign re-run inside the same weekly scan just converges on the existing row.
 * Only a terminally `failed` prior row is allowed to be re-enqueued (retry).
 *
 * Best-effort: returns the row id (new or existing), or null if the write failed
 * (logged, never thrown). Optionally joins a parent `db.$transaction`.
 */
export async function enqueueWeeklyReviewReminderNotification(
  recipientUserId: string,
  payload: WeeklyReviewReminderPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    // App-level dedup (no DB partial unique index for this type). A non-terminal
    // row (pending → dispatching → sent) for this (user, weekStart) means the
    // member was already nudged this week → no-op. Mirrors how the neighbouring
    // dedup helpers read the queue status, minus the terminal `failed` state.
    const existing = await client.notificationQueue.findFirst({
      where: {
        userId: recipientUserId,
        type: 'weekly_review_reminder',
        status: { in: ['pending', 'dispatching', 'sent'] },
        payload: { path: ['weekStart'], equals: payload.weekStart },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'weekly_review_reminder',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'weekly_review_reminder',
          weekStart: payload.weekStart,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort: return
    // null so a weekly-scan hiccup never breaks the run.
    reportWarning('weekly-review-reminder.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface DataExportReadyPayload {
  /** The `DataExportJob` whose zip is ready — deep-links `/account/data`. */
  jobId: string;
  /** Archive size in bytes (drives no copy; PII-free telemetry only). */
  byteSize: number;
  /** How many media files made it into the zip (PII-free count). */
  mediaCount: number;
}

/**
 * J6 (admin-scale, scope 6) — notify a member their asynchronous RGPD export
 * (JSON + photos) is ready to download. Fired by `runDataExportJob` once the zip
 * is flushed to disk. Deep-links `/account/data` where the download appears.
 *
 * PII-FREE (§16): the payload carries only the opaque jobId + counts — never a
 * filename, media key, or any row content. Best-effort: returns the row id, or
 * null if the write failed (logged, never thrown — a queue hiccup must not roll
 * back a completed export).
 */
export async function enqueueDataExportReadyNotification(
  recipientUserId: string,
  payload: DataExportReadyPayload,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  try {
    const row = await client.notificationQueue.create({
      data: {
        userId: recipientUserId,
        type: 'data_export_ready',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (!tx) {
      await logAudit({
        action: 'notification.enqueued',
        userId: recipientUserId,
        metadata: {
          notificationId: row.id,
          type: 'data_export_ready',
          jobId: payload.jobId,
        },
      });
    }

    return row.id;
  } catch (err) {
    // A-Z observability — see enqueueAnnotationNotification. Best-effort: return
    // null so a queue hiccup never rolls back a completed export.
    reportWarning('data-export-ready.enqueue', 'enqueue_failed', {
      userId: recipientUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
