import { NextResponse, type NextRequest } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { constantTimeEqual } from '@/lib/auth/constant-time';
import { env } from '@/lib/env';
import { flushSentry, reportError } from '@/lib/observability';
import { callerIdTrusted, cronLimiter } from '@/lib/rate-limit/token-bucket';
import { reconcileAllMembers } from '@/lib/verification/reconcile';
import {
  recomputeConstancyForAllMembers,
  scanMeetingNoShowsForAllMembers,
  scanRitualsForAllMembers,
  scanTrackingSkipsForAllMembers,
} from '@/lib/verification/constancy';
import {
  scanAlertsForAllMembers,
  scanGentleRemindersForAllMembers,
} from '@/lib/verification/alerts';

/**
 * Cron endpoint — S3 §33.5 daily verification scan.
 *
 * Six DETERMINISTIC sub-scans, in dependency order :
 *   1. reconcile     — declared trades ↔ extracted positions (gaps → écarts)
 *   2. rituals       — yesterday's check-ins (filled / forgot events, idempotent)
 *   3. meetingNoShows— §31 généralisée : meetings whose rattrapage window closed
 *   4. trackingSkips — §32 généralisée : DUE recurring tracking instruments left
 *                      unfilled past their grace (discipline metadata, §21.5-clean)
 *   5. constancy     — weekly ConstancyScore fold + upsert
 *   6. alerts        — repetition-only alerts + Mark Douglas dispatch (S5)
 *   7. gentleReminders— §33 « micro-relance » : a single benevolent nudge on an
 *                      ISOLATED below-threshold gap (BEFORE any alert escalates)
 *
 * Scans 3-4 run BEFORE the fold so their fresh gaps land in this run's
 * constancy + alerts. Scan 7 runs after alerts (complementary by threshold: a
 * gap below the alert threshold gets a gentle nudge, a gap at it gets an alert).
 *
 * It NEVER drives Claude (the vision batch stays human-in-the-loop §5.4) —
 * it only folds rows already produced. Heartbeat audit on EVERY run
 * (`cron.verification_scan.scan`, counts-only PII-free) → `health.ts`.
 *
 * Wiring expected in production : Hetzner crontab daily 11:30 UTC →
 *   curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *        https://app.fxmilyapp.com/api/cron/verification-scan
 *
 * Auth/rate-limit/dev-window : carbon-copy of `calendar-overdue-alert`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'cron_disabled', detail: 'CRON_SECRET not configured.' },
      { status: 503 },
    );
  }

  const id = callerIdTrusted(req);
  const decision = cronLimiter.consume(id);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  const provided = req.headers.get('x-cron-secret');
  if (!provided || !constantTimeEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?at=ISO dev override (double-gated, strict T-required) — mirror siblings.
  const isProdRuntime = env.NODE_ENV === 'production' || env.AUTH_URL.startsWith('https://');
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');
  let now: Date | undefined;
  if (!isProdRuntime && atParam && /[Tt ]/.test(atParam)) {
    const parsed = new Date(atParam);
    if (!Number.isNaN(parsed.getTime())) now = parsed;
  }
  const opts = now ? { now } : {};

  try {
    const reconcile = await reconcileAllMembers(opts);
    const rituals = await scanRitualsForAllMembers(opts);
    // §31 généralisée — meeting no-shows whose rattrapage window just closed.
    // BEFORE the fold so the new gaps land in this run's constancy + alerts.
    const meetingNoShows = await scanMeetingNoShowsForAllMembers(opts);
    // §32 généralisée — recurring tracking instruments left unfilled past their
    // grace. ALSO before the fold so the new gaps feed this run's discipline axis.
    const trackingSkips = await scanTrackingSkipsForAllMembers(opts);
    const constancy = await recomputeConstancyForAllMembers(opts);
    const alerts = await scanAlertsForAllMembers(opts);
    // §33 micro-relance — one benevolent nudge on isolated below-threshold gaps.
    const gentleReminders = await scanGentleRemindersForAllMembers(opts);

    // Heartbeat on EVERY run — `health.ts` monitors this slug.
    await logAudit({
      action: 'cron.verification_scan.scan',
      metadata: {
        ranAt: (now ?? new Date()).toISOString(),
        reconcileMembers: reconcile.membersScanned,
        tradesMatched: reconcile.tradesMatched,
        discrepanciesCreated: reconcile.discrepanciesCreated,
        ritualMembers: rituals.membersScanned,
        forgotEvents: rituals.forgotEvents,
        meetingsClosed: meetingNoShows.meetingsClosed,
        meetingMissDiscrepancies: meetingNoShows.discrepanciesCreated,
        trackingInstrumentsScanned: trackingSkips.instrumentsScanned,
        trackingSkipDiscrepancies: trackingSkips.discrepanciesCreated,
        scoresUpserted: constancy.scoresUpserted,
        alertsCreated: alerts.alertsCreated,
        deliveriesDispatched: alerts.deliveriesDispatched,
        gentleRemindersSent: gentleReminders.remindersSent,
        errors:
          reconcile.errors +
          rituals.errors +
          meetingNoShows.errors +
          trackingSkips.errors +
          constancy.errors +
          alerts.errors +
          gentleReminders.errors,
      },
    });

    return NextResponse.json({
      ok: true,
      reconcile,
      rituals,
      meetingNoShows,
      trackingSkips,
      constancy,
      alerts,
      gentleReminders,
    });
  } catch (err) {
    reportError('cron.verification-scan', err, { route: '/api/cron/verification-scan' });
    await flushSentry();
    return NextResponse.json({ ok: false, error: 'scan_failed' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
