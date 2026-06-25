import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S4 DOD2-T2-1 — the alert→Douglas junction honors the member-day cap
 * (« ≤ 1 fiche par membre par jour », shared with the trigger engine) and
 * RETRIES `open` alerts at each daily scan (an undelivered alert used to
 * stay open forever). Scan + dispatch run REAL; db / audit / observability /
 * notifications are mocked.
 */

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    discrepancy: { findMany: vi.fn() },
    alert: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    markDouglasCard: { findMany: vi.fn() },
    markDouglasDelivery: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDouglasDeliveryNotification: vi.fn().mockResolvedValue(null),
}));

import { db } from '@/lib/db';
import { reportError } from '@/lib/observability';

import { scanAlertsForAllMembers } from './alerts';

// 10:00 UTC in June = 12:00 Paris → triggeredOn (Paris) = 2026-06-11 at UTC
// midnight (`parseLocalDate` canon).
const NOW = new Date('2026-06-11T10:00:00.000Z');
const TODAY_TRIGGERED_ON = new Date('2026-06-11T00:00:00.000Z');
const YESTERDAY_TRIGGERED_ON = new Date('2026-06-10T00:00:00.000Z');

const CARD = { id: 'card-ego-1', slug: 'l-arrogance-precede-la-chute' };

// 2 × false_declared → crosses the `false_declaration_repeat` threshold (2).
const TWO_LIES = [{ type: 'false_declared' }, { type: 'false_declared' }];

interface Arm {
  discrepancies?: Array<{ type: string }>;
  existingAlerts?: Array<{
    id: string;
    triggerType: string;
    repeatCount: number;
    status: string;
  }>;
  deliveries?: Array<{ cardId: string; triggeredOn: Date; sourceAlertId?: string | null }>;
  cards?: Array<{ id: string; slug: string }>;
}

function arm({
  discrepancies = TWO_LIES,
  existingAlerts = [],
  deliveries = [],
  cards = [CARD],
}: Arm) {
  vi.mocked(db.user.findMany).mockResolvedValue([
    { id: 'member-1', timezone: 'Europe/Paris' },
  ] as never);
  vi.mocked(db.discrepancy.findMany).mockResolvedValue(discrepancies as never);
  vi.mocked(db.alert.findMany).mockResolvedValue(existingAlerts as never);
  vi.mocked(db.alert.create).mockResolvedValue({ id: 'alert-new' } as never);
  vi.mocked(db.alert.update).mockResolvedValue({ id: 'alert-new' } as never);
  vi.mocked(db.markDouglasDelivery.findMany).mockResolvedValue(deliveries as never);
  vi.mocked(db.markDouglasCard.findMany).mockResolvedValue(cards as never);
  vi.mocked(db.markDouglasDelivery.create).mockResolvedValue({ id: 'delivery-1' } as never);
}

describe('scanAlertsForAllMembers — member-day cap + open-alert retry (S4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('control — free daily slot: alert created AND card dispatched with sourceAlertId', async () => {
    arm({ deliveries: [{ cardId: 'card-x', triggeredOn: YESTERDAY_TRIGGERED_ON }] });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(1);
    expect(r.deliveriesDispatched).toBe(1);
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
    const data = vi.mocked(db.markDouglasDelivery.create).mock.calls[0]![0] as {
      data: { sourceAlertId: string };
    };
    expect(data.data.sourceAlertId).toBe('alert-new');
    expect(db.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-new' },
      data: { status: 'delivered' },
    });
  });

  it('🚨 priority (Jalon D-a) — a ROUTINE card delivered TODAY does NOT block the alert', async () => {
    // Routine engine card (sourceAlertId: null) went out this morning. The S3
    // truth alert (mensonge/ego/discipline) must STILL reach the member same-day.
    arm({
      deliveries: [{ cardId: 'card-x', triggeredOn: TODAY_TRIGGERED_ON, sourceAlertId: null }],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(1);
    expect(r.deliveriesDispatched).toBe(1);
    expect(db.markDouglasDelivery.create).toHaveBeenCalledTimes(1);
    expect(db.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-new' },
      data: { status: 'delivered' },
    });
  });

  it('🚨 cap — an ALERT card already delivered TODAY blocks a second alert; alert stays open', async () => {
    // ≤1 ALERT/day still holds: a same-day alert-sourced delivery blocks.
    arm({
      deliveries: [
        { cardId: 'card-x', triggeredOn: TODAY_TRIGGERED_ON, sourceAlertId: 'alert-earlier' },
      ],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(1);
    expect(r.deliveriesDispatched).toBe(0);
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
    // No status flip → tomorrow's scan retries.
    expect(db.alert.update).not.toHaveBeenCalled();
  });

  it('🚨 retry — an existing OPEN alert is re-dispatched at the next scan (was: stuck forever)', async () => {
    arm({
      existingAlerts: [
        {
          id: 'alert-old',
          triggerType: 'false_declaration_repeat',
          repeatCount: 2,
          status: 'open',
        },
      ],
      deliveries: [],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(0); // no duplicate alert
    expect(r.deliveriesDispatched).toBe(1);
    expect(db.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-old' },
      data: { status: 'delivered' },
    });
  });

  it('delivered alert is NOT retried (retry targets open only)', async () => {
    arm({
      existingAlerts: [
        {
          id: 'alert-done',
          triggerType: 'false_declaration_repeat',
          repeatCount: 2,
          status: 'delivered',
        },
      ],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.deliveriesDispatched).toBe(0);
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
  });

  it('dismissed alert is NEVER retried (the member or admin closed it)', async () => {
    arm({
      existingAlerts: [
        {
          id: 'alert-dismissed',
          triggerType: 'false_declaration_repeat',
          repeatCount: 2,
          status: 'dismissed',
        },
      ],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.deliveriesDispatched).toBe(0);
    expect(db.markDouglasDelivery.create).not.toHaveBeenCalled();
  });

  it('no published card in the category → loud Sentry signal, alert stays open', async () => {
    arm({ cards: [] });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(1);
    expect(r.deliveriesDispatched).toBe(0);
    expect(
      vi
        .mocked(reportError)
        .mock.calls.some(([, err]) =>
          err instanceof Error ? err.message === 'alert_dispatch_no_published_card' : false,
        ),
    ).toBe(true);
  });

  // §32 généralisée — the tracking-skip repetition rule fires through the SAME
  // engine as every other pattern (discipline territory, threshold 3, §33.8).
  it('🚨 §32 — 3 unexcused tracking skips fire `tracking_skipped_repeat` + a discipline card', async () => {
    arm({
      discrepancies: [
        { type: 'tracking_skipped_no_reason' },
        { type: 'tracking_skipped_no_reason' },
        { type: 'tracking_skipped_no_reason' },
      ],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(1);
    expect(r.deliveriesDispatched).toBe(1);
    const data = vi.mocked(db.alert.create).mock.calls[0]![0] as {
      data: { triggerType: string; threshold: number };
    };
    expect(data.data.triggerType).toBe('tracking_skipped_repeat');
    expect(data.data.threshold).toBe(3);
  });

  it('§32 — an ISOLATED pair of skips stays below threshold → no alert (« jamais sur un manquement isolé »)', async () => {
    arm({
      discrepancies: [
        { type: 'tracking_skipped_no_reason' },
        { type: 'tracking_skipped_no_reason' },
      ],
    });
    const r = await scanAlertsForAllMembers({ now: NOW });
    expect(r.alertsCreated).toBe(0);
    expect(db.alert.create).not.toHaveBeenCalled();
  });
});
