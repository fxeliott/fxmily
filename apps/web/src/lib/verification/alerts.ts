import 'server-only';

import { db } from '@/lib/db';
import { ALERT_LABELS } from './alert-labels';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';
import {
  enqueueDouglasDeliveryNotification,
  enqueueGentleVerificationReminder,
} from '@/lib/notifications/enqueue';
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
    | 'tracking_skipped_no_reason'
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
  {
    // §32 généralisée — repeated unexcused skips of a DUE recurring tracking
    // instrument (S2 universal engine). Discipline territory, never ego/trading.
    triggerType: 'tracking_skipped_repeat',
    discrepancyTypes: ['tracking_skipped_no_reason'],
    threshold: 3,
    cardCategory: 'discipline',
    triggeredByLabel: 'Plusieurs outils de suivi laissés de côté sans motif',
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
        const retried = await dispatchDouglasForAlert(
          memberId,
          timezone,
          existing.id,
          rule,
          count,
          now,
        );
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
    const dispatchedOk = await dispatchDouglasForAlert(
      memberId,
      timezone,
      alert.id,
      rule,
      count,
      now,
    );
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
  repeatCount: number,
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
        // S5 §32-B/E2 — le snapshot trace le MOTIF d'origine (le pattern de
        // discrepancies qui a fait franchir le seuil), pour que l'accompagnement
        // psychologique (carte mentale E1, trace d'évolution E2) remonte au
        // « pourquoi » SANS nouvelle table. Métadonnée pure (types + comptage),
        // jamais de contenu de capture (firewall §21.5). Rétro-compatible :
        // l'ancien shape `{ kind, triggerType }` reste un sous-ensemble valide.
        triggerSnapshot: {
          kind: 'verification_alert',
          triggerType: rule.triggerType,
          motif: {
            discrepancyTypes: [...rule.discrepancyTypes],
            repeatCount,
            threshold: rule.threshold,
            cardCategory: rule.cardCategory,
          },
        },
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

// =============================================================================
// S3 §33 enrichment — « Micro-relance avant l'alerte »
// =============================================================================

/**
 * The alert rule that governs a given discrepancy type (the same mapping the
 * repetition alerts use). Every discrepancy type is covered by exactly one rule
 * → the gentle reminder and the alert share the SAME threshold notion, so they
 * are complementary by construction: below the threshold → gentle nudge, at the
 * threshold → alert.
 */
function ruleForDiscrepancyType(type: string): AlertRule | undefined {
  return ALERT_RULES.find((r) => (r.discrepancyTypes as readonly string[]).includes(type));
}

export interface GentleReminderScanResult {
  readonly membersScanned: number;
  readonly remindersSent: number;
  readonly errors: number;
}

/**
 * S3 §33 — send the « micro-relance » : a single benevolent nudge (with a
 * « donne un motif s'il y a lieu » deep-link) on an ISOLATED unexcused gap, sent
 * BEFORE any repetition alert escalates. Idempotent ≤1 per gap via
 * `Discrepancy.gentleReminderAt`. Strictly metadata (§21.5 : reads the gap's
 * type + flags, never capture content). Strictly psychological (Mark Douglas) —
 * the copy lives in the J9 dispatcher, this only queues the intent.
 */
export async function scanGentleRemindersForAllMembers(
  options: { now?: Date } = {},
): Promise<GentleReminderScanResult> {
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - ALERT_WINDOW_DAYS * 86_400_000);

  const members = await db.user.findMany({
    where: { status: 'active', role: 'member' },
    select: { id: true },
  });

  let remindersSent = 0;
  let errors = 0;

  for (const member of members) {
    try {
      const result = await scanGentleRemindersForMember(member.id, now, windowStart);
      remindersSent += result.remindersSent;
    } catch (err) {
      errors += 1;
      reportError(
        'verification.alerts',
        err instanceof Error ? err : new Error('gentle_reminder_scan_failed'),
        { memberId: member.id },
      );
    }
  }

  return { membersScanned: members.length, remindersSent, errors };
}

/**
 * Per-member gentle reminder pass. Exported so the verification batch can fire
 * it event-driven right after `persistVisionResults` (mirror
 * {@link scanAlertsForMember}). For each FRESH (never-reminded) unexcused gap
 * whose rule count is STILL below the alert threshold, enqueue exactly one
 * gentle reminder and stamp `gentleReminderAt`. A gap already at/over the
 * threshold is left to the alert path (no double-touch).
 */
export async function scanGentleRemindersForMember(
  memberId: string,
  now: Date,
  windowStart: Date,
): Promise<{ remindersSent: number }> {
  // Fresh gaps only: unexcused (memberReason null), not retracted by reality
  // (status != resolved), and never nudged before (gentleReminderAt null).
  const fresh = await db.discrepancy.findMany({
    where: {
      memberId,
      detectedAt: { gte: windowStart },
      memberReason: null,
      status: { not: 'resolved' },
      gentleReminderAt: null,
    },
    orderBy: { detectedAt: 'asc' },
    select: { id: true, type: true },
  });
  if (fresh.length === 0) return { remindersSent: 0 };

  // Full unexcused set (incl. already-reminded) → the repetition state per rule.
  const allUnexcused = await db.discrepancy.findMany({
    where: {
      memberId,
      detectedAt: { gte: windowStart },
      memberReason: null,
      status: { not: 'resolved' },
    },
    select: { type: true },
  });

  let remindersSent = 0;
  for (const gap of fresh) {
    const rule = ruleForDiscrepancyType(gap.type);
    if (!rule) continue;
    const count = allUnexcused.filter((d) =>
      (rule.discrepancyTypes as readonly string[]).includes(d.type),
    ).length;
    // At/over the threshold → alert territory, the repetition alert handles it.
    if (count >= rule.threshold) continue;

    const enqueued = await enqueueGentleVerificationReminder(memberId, { discrepancyId: gap.id });
    if (enqueued === null) continue; // best-effort: a queue hiccup → retry next scan.

    // Stamp AFTER a successful enqueue so a failed push is retried, never lost.
    await db.discrepancy.update({
      where: { id: gap.id },
      data: { gentleReminderAt: now },
    });
    remindersSent += 1;
    await logAudit({
      action: 'verification.gentle_reminder.sent',
      userId: memberId,
      metadata: { discrepancyId: gap.id, discrepancyType: gap.type },
    });
  }

  return { remindersSent };
}

// =============================================================================
// S4 §33/§34 — Surface membre des alertes de dérive (lecture seule)
// =============================================================================

export type AlertStatusView = 'open' | 'delivered' | 'dismissed';

export interface AlertView {
  readonly id: string;
  readonly triggerType: string;
  /** Libellé d'affichage FR canonique (ALERT_LABELS, parité testée vs ALERT_RULES). */
  readonly label: string;
  readonly repeatCount: number;
  readonly threshold: number;
  readonly status: AlertStatusView;
  readonly createdAt: Date;
}

const ALERT_FEED_WINDOW_DAYS = 30;
const ALERT_FEED_CAP = 20;

/**
 * S4 §33/§34 — flux membre des alertes de RÉPÉTITION déclenchées pour le membre,
 * du plus récent au plus ancien. Fenêtre 30 j, plafonné à 20 lignes (liste bornée,
 * pas de scroll infini). DoD §34 : « les alertes de dérive se déclenchent ET
 * s'affichent » côté membre — c'est le read manquant qui rend cette case vraie.
 *
 * Read-only par construction (aucun scan/writer appelé) — sûr dans n'importe quel
 * RSC. Le libellé vient de la carte canonique {@link ALERT_LABELS} (parité testée
 * vs `ALERT_RULES`), jamais d'une dérivation maison. `Alert.category` est l'enum
 * mono-valeur `psychological` : ce flux ne peut JAMAIS exposer un signal de marché
 * (§2 / §33.2) — il liste des FAITS de répétition, le coaching Mark Douglas étant
 * livré par le canal existant (`MarkDouglasDelivery.sourceAlertId`).
 */
export async function listRecentAlertsForMember(
  memberId: string,
  options: { now?: Date } = {},
): Promise<readonly AlertView[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ALERT_FEED_WINDOW_DAYS * 86_400_000);

  const rows = await db.alert.findMany({
    where: { memberId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: ALERT_FEED_CAP,
    select: {
      id: true,
      triggerType: true,
      repeatCount: true,
      threshold: true,
      status: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    triggerType: r.triggerType,
    label: ALERT_LABELS[r.triggerType] ?? r.triggerType,
    repeatCount: r.repeatCount,
    threshold: r.threshold,
    status: r.status as AlertStatusView,
    createdAt: r.createdAt,
  }));
}
