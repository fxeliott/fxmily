import 'server-only';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';
import { enqueueDouglasDeliveryNotification } from '@/lib/notifications/enqueue';
import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';

/**
 * S3 §33.5 — Alertes sur RÉPÉTITION + jonction coaching S5 (Mark Douglas).
 *
 * Invariant BLOQUANT (§33.8 + DoD §31 #4) : une alerte ne se déclenche
 * JAMAIS sur un manquement isolé — uniquement quand le même pattern se
 * répète dans la fenêtre. L'accompagnement est STRICTEMENT psychologique :
 * la sortie d'une alerte est une fiche Mark Douglas (discipline/ego) livrée
 * par le canal coaching existant (`MarkDouglasDelivery.sourceAlertId`),
 * jamais un conseil de trading — `Alert.category` est structurellement
 * `psychological` (enum mono-valeur).
 *
 * Les écarts EXCUSÉS (memberReason renseigné — « motif valable » DoD §29)
 * ne comptent pas dans la répétition : un membre qui explique n'est pas un
 * membre qui fuit.
 */

export const ALERT_WINDOW_DAYS = 14;

export interface AlertRule {
  readonly triggerType: string;
  readonly discrepancyTypes: readonly (
    | 'unfilled_no_reason'
    | 'missing_declared'
    | 'mismatch'
    | 'false_declared'
    | 'meeting_missed_no_reason'
  )[];
  readonly threshold: number;
  /** Coaching card category (S5 junction) — Mark Douglas territory only. */
  readonly cardCategory: 'discipline' | 'ego';
  /** FR label for `MarkDouglasDelivery.triggeredBy` (member-visible). */
  readonly triggeredByLabel: string;
}

/** Repetition thresholds — ALL ≥ 2 (§33.8 « jamais sur un manquement isolé »). */
export const ALERT_RULES: readonly AlertRule[] = [
  {
    triggerType: 'forgot_no_reason_repeat',
    discrepancyTypes: ['unfilled_no_reason'],
    threshold: 3,
    cardCategory: 'discipline',
    triggeredByLabel: 'Plusieurs journées sans suivi, sans motif',
  },
  {
    triggerType: 'reality_gap_repeat',
    discrepancyTypes: ['missing_declared', 'mismatch'],
    threshold: 3,
    cardCategory: 'ego',
    triggeredByLabel: 'Plusieurs écarts répétés entre ton déclaré et ton historique réel',
  },
  {
    triggerType: 'false_declaration_repeat',
    discrepancyTypes: ['false_declared'],
    threshold: 2,
    cardCategory: 'ego',
    triggeredByLabel: 'Des trades déclarés sans contrepartie réelle, plusieurs fois',
  },
  {
    // §31 généralisée — repeated unexcused meeting no-shows (discipline, not ego).
    triggerType: 'meeting_missed_repeat',
    discrepancyTypes: ['meeting_missed_no_reason'],
    threshold: 3,
    cardCategory: 'discipline',
    triggeredByLabel: 'Plusieurs réunions manquées sans motif',
  },
];

export interface AlertScanResult {
  readonly membersScanned: number;
  readonly alertsCreated: number;
  readonly deliveriesDispatched: number;
  readonly errors: number;
}

export async function scanAlertsForAllMembers(
  options: { now?: Date } = {},
): Promise<AlertScanResult> {
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - ALERT_WINDOW_DAYS * 86_400_000);

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    // timezone: the member-day cap is an EXPERIENCE invariant — « aujourd'hui »
    // must be the member's local day, exactly like the trigger engine
    // (S4 review: a hardcoded Paris day leaked 2 cards into one member-day
    // for non-Paris timezones around date boundaries).
    select: { id: true, timezone: true },
  });

  let alertsCreated = 0;
  let deliveriesDispatched = 0;
  let errors = 0;

  for (const member of members) {
    try {
      const result = await scanAlertsForMember(
        member.id,
        member.timezone || 'Europe/Paris',
        now,
        windowStart,
      );
      alertsCreated += result.created;
      deliveriesDispatched += result.dispatched;
    } catch (err) {
      errors += 1;
      reportError(
        'verification.alerts',
        err instanceof Error ? err : new Error('alert_scan_failed'),
        { memberId: member.id },
      );
    }
  }

  return { membersScanned: members.length, alertsCreated, deliveriesDispatched, errors };
}

/**
 * S6 (DOD3-01) — COUNT of the psychological alerts triggered for a member inside
 * `[rangeStart, rangeEnd]` (by `createdAt`). A read-only primitive consumed by the
 * retrospective reports (weekly/monthly) so they can surface « N alerte(s) » of
 * the period. Count-only by construction — `Alert.category` is the mono-value
 * enum `psychological` (a trading alert is structurally impossible) and an alert
 * only exists on REPETITION (`repeatCount >= threshold`, §33.8), never on an
 * isolated miss. Posture §2/§33.2 : a factual number, never a guilt counter, never
 * market advice. NEVER call `scanAlertsForAllMembers` (a writer) from a report
 * pipeline — this is the read counterpart.
 */
export async function countAlertsInRange(
  memberId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<number> {
  return db.alert.count({
    where: { memberId, createdAt: { gte: rangeStart, lte: rangeEnd } },
  });
}

/**
 * S4 §30 — exported so the verification batch can fire it event-driven right
 * after `persistVisionResults`, instead of waiting for the 11:30 UTC cron.
 * Idempotent by construction (Alert dedup per triggerType in the window +
 * P2002 on the delivery), so the cron's later pass adds nothing.
 */
export async function scanAlertsForMember(
  memberId: string,
  timezone: string,
  now: Date,
  windowStart: Date,
): Promise<{ created: number; dispatched: number }> {
  // UNEXCUSED discrepancies in the window, grouped client-side (3 rules max).
  // `resolved` excluded too: an accusation retracted by reality (the proof
  // arrived and confirmed the trade) must never feed a repetition alert.
  const discrepancies = await db.discrepancy.findMany({
    where: {
      memberId,
      detectedAt: { gte: windowStart },
      memberReason: null,
      status: { not: 'resolved' },
    },
    select: { type: true },
  });
  if (discrepancies.length === 0) return { created: 0, dispatched: 0 };

  const existingAlerts = await db.alert.findMany({
    where: { memberId, createdAt: { gte: windowStart } },
    select: { id: true, triggerType: true, repeatCount: true, status: true },
  });

  let created = 0;
  let dispatched = 0;

  for (const rule of ALERT_RULES) {
    const count = discrepancies.filter((d) =>
      (rule.discrepancyTypes as readonly string[]).includes(d.type),
    ).length;
    if (count < rule.threshold) continue;

    const existing = existingAlerts.find((a) => a.triggerType === rule.triggerType);
    if (existing) {
      // One alert per pattern per window — refresh the count, never spam.
      if (existing.repeatCount !== count && existing.status !== 'dismissed') {
        await db.alert.update({ where: { id: existing.id }, data: { repeatCount: count } });
      }
      // S4 — an alert created but never delivered (no published card in the
      // category, or the member's daily Douglas slot was already used) is
      // RETRIED at each daily scan instead of silently staying `open`
      // forever. Still ≤1 fiche/membre/jour : the cap inside
      // `dispatchDouglasForAlert` governs every attempt.
      if (existing.status === 'open') {
        const retried = await dispatchDouglasForAlert(memberId, timezone, existing.id, rule, now);
        if (retried) {
          dispatched += 1;
          await db.alert.update({ where: { id: existing.id }, data: { status: 'delivered' } });
        }
      }
      continue;
    }

    const alert = await db.alert.create({
      data: {
        memberId,
        triggerType: rule.triggerType,
        repeatCount: count,
        threshold: rule.threshold,
      },
      select: { id: true },
    });
    created += 1;
    await logAudit({
      action: 'verification.alert.created',
      userId: memberId,
      metadata: {
        alertId: alert.id,
        triggerType: rule.triggerType,
        repeatCount: count,
        threshold: rule.threshold,
      },
    });

    // S5 junction — deliver a Mark Douglas card through the EXISTING coaching
    // channel (never a shame blast). The « ≤1 fiche/membre/jour » cap is
    // enforced INSIDE `dispatchDouglasForAlert` (S4 DOD2-T2-1) — a member
    // already served today gets the alert card at tomorrow's scan instead.
    const dispatchedOk = await dispatchDouglasForAlert(memberId, timezone, alert.id, rule, now);
    if (dispatchedOk) {
      dispatched += 1;
      await db.alert.update({ where: { id: alert.id }, data: { status: 'delivered' } });
    }
    // No card available → the alert stays `open` (admin sees it in S7).
  }

  return { created, dispatched };
}

/**
 * Pick a published card in the rule's category (highest priority, not
 * already delivered to this member in the window) and create the delivery
 * carrying `sourceAlertId`. P2002 on (userId, cardId, triggeredOn) → the
 * member already received this card today: counts as dispatched.
 */
async function dispatchDouglasForAlert(
  memberId: string,
  timezone: string,
  alertId: string,
  rule: AlertRule,
  now: Date,
): Promise<boolean> {
  // Member-local day — MUST match the trigger engine's `triggeredOn` canon
  // (engine.ts computes it from `user.timezone`) or the two paths disagree
  // on « aujourd'hui » and the shared member-day cap leaks.
  const triggeredOn = parseLocalDate(localDateOf(now, timezone));
  const recent = await db.markDouglasDelivery.findMany({
    where: {
      userId: memberId,
      createdAt: { gte: new Date(now.getTime() - ALERT_WINDOW_DAYS * 86_400_000) },
    },
    select: { cardId: true, triggeredOn: true, sourceAlertId: true },
  });

  // S5 Jalon D décision (a) — PRIORITÉ alerte-S3 sur la fiche routine du jour.
  // Le cap reste « ≤1 fiche ALERTE par membre par jour » (anti-spam des alertes),
  // mais une alerte vérité (mensonge/ego/discipline) N'EST PLUS étouffée par une
  // fiche ROUTINE déjà partie le matin (dispatch-douglas 00/06 UTC court AVANT
  // verification-scan 11:30 UTC). Avant : toute fiche du jour bloquait → alerte
  // reportée J+1 par retry. Après : seule une autre alerte du jour bloque ; sur
  // un jour de conflit le membre reçoit la routine PUIS l'alerte (≤2), l'urgence
  // psychologique prime sur l'anti-spam strict (tradeoff tranché, réversible).
  // La routine, elle, cède toujours (engine.ts skippe si une fiche est déjà partie).
  const today = triggeredOn.getTime();
  if (recent.some((r) => r.triggeredOn.getTime() === today && r.sourceAlertId !== null)) {
    return false;
  }

  const recentCardIds = new Set(recent.map((r) => r.cardId));

  const cards = await db.markDouglasCard.findMany({
    where: { published: true, category: rule.cardCategory },
    orderBy: { priority: 'desc' },
    select: { id: true, slug: true },
    take: 10,
  });
  const card = cards.find((c) => !recentCardIds.has(c.id)) ?? cards[0];
  if (!card) {
    // S4 DOD2-T3-2 — an empty published catalogue in this category means the
    // repetition alert can NEVER reach the member. Loud signal (Sentry), calm
    // product behavior (alert stays `open`, retried daily, admin sees it).
    reportError('verification.alerts', new Error('alert_dispatch_no_published_card'), {
      memberId,
      alertId,
      cardCategory: rule.cardCategory,
    });
    return false;
  }
  try {
    const row = await db.markDouglasDelivery.create({
      data: {
        userId: memberId,
        cardId: card.id,
        triggeredBy: rule.triggeredByLabel,
        triggerSnapshot: { kind: 'verification_alert', triggerType: rule.triggerType },
        triggeredOn,
        sourceAlertId: alertId,
      },
      select: { id: true },
    });
    await logAudit({
      action: 'douglas.dispatched',
      userId: memberId,
      metadata: {
        deliveryId: row.id,
        cardId: card.id,
        cardSlug: card.slug,
        triggerKind: 'verification_alert',
        sourceAlertId: alertId,
      },
    });
    await enqueueDouglasDeliveryNotification(memberId, {
      deliveryId: row.id,
      cardSlug: card.slug,
    });
    return true;
  } catch (err) {
    const isUnique =
      typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
    if (isUnique) return true; // already delivered this card today — fine.
    reportError(
      'verification.alerts',
      err instanceof Error ? err : new Error('alert_dispatch_failed'),
      { memberId, alertId },
    );
    return false;
  }
}
