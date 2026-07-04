import 'server-only';

import { db } from '@/lib/db';

/**
 * J10 Phase J — Cron heartbeat health check.
 *
 * Every Fxmily cron emits a `cron.<route>.scan` audit row on each run.
 * If the most recent row is older than the cron's expected period (with
 * a tolerance multiplier), the cron is considered unhealthy and we
 * surface the gap to the operator (admin UI + GitHub Actions watcher).
 *
 * Why this design :
 *  - Audit logs are the canonical source of truth for "did the cron run".
 *    Sentry reports failures, but a cron that never fired (cron daemon
 *    crashed, secret mismatch, network broken) doesn't throw — it just
 *    doesn't write a row. The only way to detect "missing" is to look at
 *    the gap from `now`.
 *  - Each cron has its own period and tolerance. A weekly cron should not
 *    page when it's 23h behind ; an every-2-min cron should.
 *  - Tolerance multiplier (×3 by default) absorbs scheduling jitter +
 *    rolling deploys + network blips without false positives.
 */

/**
 * Shared shape for anything that emits a periodic heartbeat audit row —
 * server crons (`cron.*.scan`) and the local AI-worker pipelines
 * (`*.batch.pulled`). One generic report builder serves both dashboards.
 */
interface HeartbeatExpectation<A extends string = string> {
  /** Audit action emitted on each run. */
  action: A;
  /** Human-readable label for the dashboard. */
  label: string;
  /** Expected period in ms (matches the schedule). */
  periodMs: number;
  /** Multiplier applied to `periodMs` to flag a gap as unhealthy. Default 3. */
  toleranceMultiplier?: number;
  /**
   * Multiplier applied to `periodMs` for the green→amber boundary. Default 1.5.
   * Raise it for heartbeats whose SCHEDULER jitters by design (GitHub Actions
   * `schedule` routinely drifts 30-60 min and skips hours under load) so the
   * board doesn't read "Lent" for a watcher that is merely riding GH's queue.
   */
  greenMultiplier?: number;
  /**
   * Tour 12 — window-bounded schedule (UTC). When set, the status is computed
   * from MISSED EXPECTED TICKS instead of raw age: a cron that fires every
   * 15 min inside 05-07h + 18-20h windows is HEALTHY at 12h even though its
   * last row is hours old. Raw-age classification flagged it "amber" all day,
   * every day, between windows — a structural false positive the operator
   * learns to ignore (which is how real incidents slip through).
   */
  windowedScheduleUtc?: { minutes: readonly number[]; hours: readonly number[] };
  /**
   * Tour 12 — ISO date from which this heartbeat is EXPECTED to exist (task
   * installed / cron wired). A missing row before `expectedSince + tolerance`
   * is `pending` (first run not due yet — neutral, calm), not `never_ran`
   * (incident). Without it, a monthly pipeline installed on the 2nd reads
   * "Jamais exécuté" for a month and drags the masthead to "Pas démarré".
   */
  expectedSince?: string;
}

type CronAction =
  | 'cron.checkin_reminders.scan'
  | 'cron.recompute_scores.scan'
  | 'cron.dispatch_douglas.scan'
  | 'cron.weekly_reports.scan'
  | 'cron.dispatch_notifications.scan'
  | 'cron.purge_deleted.scan'
  | 'cron.purge_push_subscriptions.scan'
  | 'cron.purge_audit_log.scan'
  | 'cron.calendar_overdue.scan'
  | 'cron.monthly_debrief_overdue.scan'
  | 'cron.onboarding_profile_overdue.scan'
  | 'cron.weekly_report_overdue.scan'
  | 'cron.verification_scan.scan'
  | 'cron.verification_overdue.scan'
  // S10 — three wired prod crons that were emitting a heartbeat but were NOT
  // monitored here, so a silent failure of any of them never surfaced red.
  | 'meeting.generated' // generate-meetings (admin slug, see lib/auth/audit.ts:312)
  | 'cron.mindset_check_reminders.scan'
  | 'cron.purge_access_requests.scan'
  | 'cron.health.scan';

type CronExpectation = HeartbeatExpectation<CronAction>;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Source of truth : `ops/cron/crontab.fxmily`.
const EXPECTATIONS: readonly CronExpectation[] = [
  {
    action: 'cron.checkin_reminders.scan',
    label: 'Check-in reminders',
    periodMs: 15 * MIN, // every 15 min inside the windows below (crontab.fxmily:56)
    toleranceMultiplier: 80, // still bounds the age bar; status comes from missed ticks
    // `0,15,30,45 5-7,18-20 * * *` — Paris morning + evening check-in windows.
    windowedScheduleUtc: { minutes: [0, 15, 30, 45], hours: [5, 6, 7, 18, 19, 20] },
  },
  {
    action: 'cron.recompute_scores.scan',
    label: 'Behavioral score recompute',
    periodMs: DAY, // 02:00 UTC daily
  },
  {
    action: 'cron.dispatch_douglas.scan',
    label: 'Mark Douglas dispatch',
    periodMs: 6 * HOUR,
  },
  {
    action: 'cron.weekly_reports.scan',
    label: 'Weekly AI digest',
    periodMs: WEEK,
  },
  {
    action: 'cron.dispatch_notifications.scan',
    label: 'Web Push dispatcher',
    periodMs: 2 * MIN,
    toleranceMultiplier: 5, // burst-y by nature; allow 10 min gap
  },
  {
    action: 'cron.purge_deleted.scan',
    label: 'RGPD soft-delete purge',
    periodMs: DAY, // 03:00 UTC daily
  },
  {
    action: 'cron.purge_push_subscriptions.scan',
    label: 'Stale push subscriptions cleanup',
    periodMs: WEEK, // Sun 05:00 UTC
  },
  {
    // J10 V2-roadmap reclassed — audit_log retention 90j (daily 04:00 UTC).
    // Without this purge, the audit_logs table dominates write IOPS at the
    // 1000-member cohort. The cron is daily so default tolerance (×3) is
    // 72h before flagging red — gentler than the dispatcher (10 min).
    action: 'cron.purge_audit_log.scan',
    label: 'Audit log retention purge',
    periodMs: DAY, // 04:00 UTC daily
  },
  {
    // Session 5 §26 — calendar overdue safety-net (DoD#4 permanence). Daily
    // detection-only cron that nudges the admin when members have a filled
    // questionnaire but no generated calendar past the grace window. Monitored
    // here so a broken nudge cron (the very thing guaranteeing permanence)
    // surfaces red instead of silently failing — and it gives the 4 manual IA
    // batches at least one monitored proxy (calendar) in the cron dashboard.
    action: 'cron.calendar_overdue.scan',
    label: 'Calendar overdue nudge',
    periodMs: DAY, // crontab: daily 11:00 UTC (13:00 Paris)
  },
  {
    // Session 5 §25 — monthly debrief overdue safety-net (DoD#2 permanence).
    // Daily detection-only cron that nudges the admin when the last completed
    // month's member debriefs are missing past the grace window. Monitored
    // here so a broken nudge cron surfaces red instead of silently failing.
    action: 'cron.monthly_debrief_overdue.scan',
    label: 'Monthly debrief overdue nudge',
    periodMs: DAY, // crontab: daily 11:10 UTC (13:10 Paris)
  },
  {
    // S2 — onboarding profile overdue safety-net (profilage permanence). Daily
    // detection-only cron that nudges the admin when completed onboarding
    // interviews are missing their MemberProfile past the 24h member-facing
    // promise. Monitored here so a broken nudge cron surfaces red instead of
    // silently failing.
    action: 'cron.onboarding_profile_overdue.scan',
    label: 'Onboarding profile overdue nudge',
    periodMs: DAY, // crontab: daily 11:20 UTC (13:20 Paris)
  },
  {
    // J8 — weekly report overdue safety-net (digest permanence). Daily
    // detection-only cron that nudges the admin when the last completed week's
    // member reports are missing past the grace window. Monitored here so a
    // broken nudge cron surfaces red instead of silently failing.
    action: 'cron.weekly_report_overdue.scan',
    label: 'Weekly report overdue nudge',
    periodMs: DAY, // crontab: daily 11:40 UTC (13:40 Paris)
  },
  {
    // AUTONOMY-1 — MT5 proof vision overdue safety-net (vérification permanence,
    // 5th twin of the calendar/monthly/onboarding/weekly nets — the vision batch
    // was the only local Claude pipeline without an anti-oubli nudge). Daily
    // detection-only cron that nudges the admin when uploaded MT5 proofs stay
    // `pending` past the 24h grace. Monitored here so a broken nudge cron
    // surfaces red instead of silently failing.
    action: 'cron.verification_overdue.scan',
    label: 'Verification overdue nudge',
    periodMs: DAY, // crontab: daily 11:50 UTC (13:50 Paris)
  },
  {
    // S3 §33.5 — daily verification scan (reconcile + rituals + constancy +
    // repetition alerts). Deterministic fold, never drives Claude. Monitored
    // here so a broken scan surfaces red instead of the honesty surface
    // silently going stale.
    action: 'cron.verification_scan.scan',
    label: 'Verification daily scan',
    periodMs: DAY, // crontab: daily 11:30 UTC (13:30 Paris)
  },
  {
    // S10 — V1.7 §30 meeting slot generation (crontab: weekdays 06:00 UTC).
    // Emits the `meeting.generated` admin-slug heartbeat (lib/auth/audit.ts:312),
    // NOT a `cron.*.scan` slug. Previously absent from EXPECTATIONS → a silent
    // failure left /reunions to slowly empty with no red on the dashboard.
    // periodMs=DAY but it only runs Mon–Fri, so the normal Fri→Mon gap is ~72h;
    // toleranceMultiplier 4 (→96h) keeps the weekend amber-at-worst, red only
    // after a genuinely missed weekday run.
    action: 'meeting.generated',
    label: 'Meeting slot generation',
    periodMs: DAY,
    toleranceMultiplier: 4,
  },
  {
    // S10 — V1.5 §27 weekly mindset reminder (crontab: Monday 09:00 UTC).
    // Emits `cron.mindset_check_reminders.scan` (lib/mindset/reminders.ts:76).
    // Previously unmonitored despite being a wired prod cron.
    action: 'cron.mindset_check_reminders.scan',
    label: 'Weekly mindset reminder',
    periodMs: WEEK,
  },
  {
    // S10 — V2.5 access-request RGPD purge (crontab: Sunday 04:00 UTC). Emits
    // `cron.purge_access_requests.scan` (purge-access-requests/route.ts:99).
    // Previously unmonitored — a silent failure would let dormant non-member
    // PII (name+email without account consent) accumulate undetected.
    action: 'cron.purge_access_requests.scan',
    label: 'Access-request RGPD purge',
    periodMs: WEEK,
  },
  {
    // J10 Phase O fix B3 : self-monitor the watcher itself. If `cron-watch.yml`
    // (GitHub Actions hourly schedule) stops running, no `cron.health.scan`
    // audit row appears, and `getCronHealthReport` flags this entry red →
    // operator notices the watcher is broken on the next admin/system visit.
    // Without this entry the cron-watch promise of "self-monitoring" was
    // unkept (route handler emitted the audit row but no expectation
    // checked the gap).
    action: 'cron.health.scan',
    label: 'Health watcher heartbeat',
    periodMs: HOUR, // cron-watch.yml triggers at `15 * * * *`
    // V1.9 TIER B+ : bumped 4 → 6 after run 25842587338 (2026-05-14T04:57Z)
    // false-positive : GH Actions delayed the schedule by 42 min, pushing the
    // self-stale check past the 4h threshold. 6h tolerance still flags real
    // outages of 6 consecutive misses, but absorbs the GH cron jitter that
    // routinely drifts 30-60 min during peak hours.
    toleranceMultiplier: 6,
    // Tour 12 — GH Actions also SKIPS scheduled hours entirely under load
    // (observed 2026-07-04: 04:01 → 07:14 → 09:32, no 05/06/08 runs). A 2h18
    // gap is normal operation for this scheduler, not a slow watcher: green
    // up to 3h, amber 3-6h, red past 6h.
    greenMultiplier: 3,
  },
] as const;

export type CronStatus = 'green' | 'amber' | 'red' | 'never_ran' | 'pending';

export interface HeartbeatHealthEntry<A extends string = string> {
  action: A;
  label: string;
  periodMs: number;
  /** ISO-8601 of the last successful scan, or null if no audit row at all. */
  lastRanAt: string | null;
  /** ms since the last scan, or null if never ran. */
  ageMs: number | null;
  /** Threshold beyond which we flag the heartbeat as unhealthy. */
  toleranceMs: number;
  status: CronStatus;
  /**
   * Errors reported by the most recent run (read from its heartbeat
   * `metadata.errors`; 0 when the run tracks no per-item errors). A FRESH row
   * with errorCount > 0 means the run FIRED but failed for some/all members —
   * invisible to the age-only check, which just sees "it ran".
   */
  errorCount: number;
  /**
   * True for window-bounded schedules — the UI hides the age/tolerance bar
   * (meaningless between windows) and shows the window note instead.
   */
  windowed: boolean;
  /**
   * `pending` only — ISO instant past which a still-missing first row flips
   * to `never_ran`. Lets the UI say "premier run attendu avant le …".
   */
  firstRunDeadline: string | null;
}

export type CronHealthEntry = HeartbeatHealthEntry<CronAction>;

export interface CronHealthReport {
  ranAt: string;
  /** Worst status across all crons (`red` > `never_ran` > `amber` > `green`). */
  overall: CronStatus;
  entries: CronHealthEntry[];
}

/**
 * Look up the most-recent heartbeat row for each expected action and compute
 * its status. Generic core shared by the server-cron report and the local
 * AI-worker report — same audit-gap semantics, different expectation tables.
 *
 * Single SQL pass (`groupBy` + `_max`) so the cost is constant regardless
 * of audit log volume — Postgres uses the `(action, created_at desc)`
 * index naturally.
 */
async function buildHeartbeatReport<A extends string>(
  expectations: readonly HeartbeatExpectation<A>[],
  now: Date,
): Promise<{ ranAt: string; overall: CronStatus; entries: HeartbeatHealthEntry<A>[] }> {
  const grouped = await db.auditLog.groupBy({
    by: ['action'],
    where: { action: { in: expectations.map((e) => e.action) } },
    _max: { createdAt: true },
  });

  const lastRanByAction = new Map<string, Date>();
  for (const row of grouped) {
    if (row._max.createdAt) lastRanByAction.set(row.action, row._max.createdAt);
  }

  // Second pass: read the heartbeat metadata of each cron's LATEST row so we
  // surface `errors` — a count the routes already write (e.g. verification-scan
  // sums per-member failures) but nothing read. A cron that ran on time yet
  // failed for every member writes a fresh row with errors > 0: green by age,
  // actually broken. Bounded OR over the (action, createdAt) maxima, each
  // served by the (action, created_at) index; skipped when no rows exist.
  const errorsByAction = new Map<string, number>();
  if (lastRanByAction.size > 0) {
    const latestRows = await db.auditLog.findMany({
      where: {
        OR: Array.from(lastRanByAction.entries()).map(([action, createdAt]) => ({
          action,
          createdAt,
        })),
      },
      select: { action: true, metadata: true },
    });
    for (const row of latestRows) {
      const meta = row.metadata as { errors?: unknown } | null;
      const errors = meta && typeof meta.errors === 'number' && meta.errors > 0 ? meta.errors : 0;
      // If two rows share the exact max timestamp, keep the larger error count.
      errorsByAction.set(row.action, Math.max(errorsByAction.get(row.action) ?? 0, errors));
    }
  }

  const entries: HeartbeatHealthEntry<A>[] = expectations.map((expectation) => {
    const lastRanAt = lastRanByAction.get(expectation.action) ?? null;
    const ageMs = lastRanAt ? now.getTime() - lastRanAt.getTime() : null;
    const toleranceMs = expectation.periodMs * (expectation.toleranceMultiplier ?? 3);
    const firstRunDeadline = expectation.expectedSince
      ? new Date(new Date(expectation.expectedSince).getTime() + toleranceMs).toISOString()
      : null;

    let status: CronStatus;
    if (lastRanAt === null || ageMs === null) {
      // No row at all. If the heartbeat was wired recently and its first
      // occurrence is not overdue yet, that absence is EXPECTED — `pending`
      // keeps the board calm and honest instead of shouting "Jamais exécuté"
      // about a monthly task installed two days ago.
      status =
        firstRunDeadline !== null && now.getTime() <= new Date(firstRunDeadline).getTime()
          ? 'pending'
          : 'never_ran';
    } else if (expectation.windowedScheduleUtc) {
      // Window-bounded cron: classify on missed expected ticks, not raw age.
      const missed = countMissedTicks(expectation.windowedScheduleUtc, lastRanAt, now);
      status = missed === 0 ? 'green' : missed <= 2 ? 'amber' : 'red';
    } else if (ageMs <= expectation.periodMs * (expectation.greenMultiplier ?? 1.5)) {
      status = 'green';
    } else if (ageMs <= toleranceMs) {
      status = 'amber';
    } else {
      status = 'red';
    }

    // A cron that ran on schedule but reported errors is NOT healthy: a fresh
    // heartbeat with errors > 0 escalates green → amber, so a cron failing for
    // every member can't hide behind a green age. An already amber/red status
    // (it is also late) is the more severe signal and is left as-is.
    const errorCount = errorsByAction.get(expectation.action) ?? 0;
    if (errorCount > 0 && status === 'green') {
      status = 'amber';
    }

    return {
      action: expectation.action,
      label: expectation.label,
      periodMs: expectation.periodMs,
      lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
      ageMs,
      toleranceMs,
      status,
      errorCount,
      windowed: Boolean(expectation.windowedScheduleUtc),
      firstRunDeadline: status === 'pending' ? firstRunDeadline : null,
    };
  });

  // `pending` counts as healthy for the overall pill: a first run that is not
  // due yet is expected state, not an incident — it must not page the watcher
  // nor drag the masthead to "Incident".
  const overall: CronStatus = entries.some((e) => e.status === 'red')
    ? 'red'
    : entries.some((e) => e.status === 'never_ran')
      ? 'never_ran'
      : entries.some((e) => e.status === 'amber')
        ? 'amber'
        : 'green';

  return { ranAt: now.toISOString(), overall, entries };
}

/**
 * Tour 12 — count the schedule ticks that SHOULD have fired strictly after
 * `lastRanAt` and up to `now - jitter`, for a window-bounded cron
 * (`minutes × hours`, UTC, every day). 0 missed → green ; ≤ 2 → amber ;
 * more → red. A 5-min jitter grace keeps the tick currently firing out of
 * the count. Iteration is bounded: past ~7 days of misses the exact count
 * stops mattering (red either way), so we bail out early.
 */
function countMissedTicks(
  schedule: { minutes: readonly number[]; hours: readonly number[] },
  lastRanAt: Date,
  now: Date,
): number {
  const JITTER_MS = 5 * MIN;
  const horizon = now.getTime() - JITTER_MS;
  if (horizon <= lastRanAt.getTime()) return 0;

  let missed = 0;
  const cursor = new Date(lastRanAt.getTime());
  cursor.setUTCSeconds(0, 0);
  const maxDays = 8;
  for (let day = 0; day <= maxDays; day += 1) {
    const base = new Date(cursor.getTime() + day * DAY);
    for (const hour of schedule.hours) {
      for (const minute of schedule.minutes) {
        const tick = Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth(),
          base.getUTCDate(),
          hour,
          minute,
        );
        if (tick > lastRanAt.getTime() && tick <= horizon) {
          missed += 1;
          if (missed > 3) return missed; // already red — stop counting
        }
      }
    }
    if (base.getTime() > horizon) break;
  }
  return missed;
}

export async function getCronHealthReport(now: Date = new Date()): Promise<CronHealthReport> {
  return buildHeartbeatReport(EXPECTATIONS, now);
}

/**
 * J6 — Local AI-worker heartbeat health check.
 *
 * The 6 Claude batch pipelines run on Eliott's PC via Windows Task Scheduler
 * (source of truth: `ops/worker/install-worker.ps1`). Each pull endpoint
 * writes a `<pipeline>.batch.pulled` audit row on EVERY call — even when it
 * returns 0 entries — so the audit gap is a true "did the worker tick" signal,
 * exactly like the server crons above.
 *
 * Deliberately NOT merged into `/api/cron/health` / cron-watch.yml: the worker
 * host is a personal machine that is legitimately off at night, and the GitHub
 * watcher would open a false-positive issue every evening. The member-facing
 * guarantee stays with the 5 server-side overdue-nudge crons (monitored in
 * EXPECTATIONS); this report tells the operator whether generation is CURRENT
 * or merely guaranteed-eventually. `seance.batch.pulled` is excluded on
 * purpose — the séances pipeline is pulled on demand, it has no expected
 * period, so an age-based status would lie.
 *
 * Tolerances are wider than the server crons: amber = "the PC is probably
 * off, expected overnight"; red = "the worker missed enough consecutive
 * occurrences that StartWhenAvailable can no longer explain the gap".
 */
type WorkerPipelineAction =
  | 'onboarding.batch.pulled'
  | 'verification.batch.pulled'
  | 'calendar.batch.pulled'
  | 'weekly_report.batch.pulled'
  | 'monthly_debrief.batch.pulled'
  | 'member_profile_monthly.batch.pulled'
  | 'worker.watchdog.heartbeat';

const MONTH = 30 * DAY;

// Tour 12 — the 6 pipeline tasks were (re)installed on the host on this date
// (install-worker.ps1, 6/6 registered). Before that instant + tolerance, a
// missing first row is `pending`, not `never_ran`.
const WORKER_INSTALLED_AT = '2026-07-02T00:00:00Z';

// Source of truth: `ops/worker/install-worker.ps1` ($Pipelines + triggers).
const WORKER_EXPECTATIONS: readonly HeartbeatExpectation<WorkerPipelineAction>[] = [
  {
    // Task Scheduler interval trigger, every 20 min while the PC is on.
    // Green ≤ 30 min (worker alive), amber up to 24h (PC off overnight is
    // normal and calm), red past 24h: the PC was necessarily on at some point
    // that day, so zero ticks in 24h means the task itself is broken
    // (unregistered, lock stuck, bash path gone) — not just a sleeping host.
    action: 'onboarding.batch.pulled',
    label: 'Worker · profils onboarding',
    periodMs: 20 * MIN,
    toleranceMultiplier: 72, // 24h
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Daily 04:10 local. StartWhenAvailable replays a missed run at boot, so
    // default ×3 (72h) only reddens after 3 consecutive fully-missed days.
    action: 'verification.batch.pulled',
    label: 'Worker · vision preuves MT5',
    periodMs: DAY,
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Weekly, Monday 05:10 local. ×2 → red only after TWO missed Mondays —
    // one missed occurrence is amber (vacation, PC off), two is a dead task.
    action: 'calendar.batch.pulled',
    label: 'Worker · calendriers semaine',
    periodMs: WEEK,
    toleranceMultiplier: 2,
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Weekly, Sunday 05:40 local. Same ×2 rationale as the calendar pipeline.
    action: 'weekly_report.batch.pulled',
    label: 'Worker · digests hebdo',
    periodMs: WEEK,
    toleranceMultiplier: 2,
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Monthly, day 1 06:10 local. ×2 (60d) → red after two missed months.
    action: 'monthly_debrief.batch.pulled',
    label: 'Worker · débriefs mensuels',
    periodMs: MONTH,
    toleranceMultiplier: 2,
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Monthly, day 2 06:40 local (J-E deep re-profiling, staggered one day
    // after the debrief batch). With `expectedSince`, the month before its
    // first scheduled run reads `pending` (calm "premier run à venir"), not
    // `never_ran` — which was dragging the masthead to "Pas démarré".
    action: 'member_profile_monthly.batch.pulled',
    label: 'Worker · re-profilage mensuel',
    periodMs: MONTH,
    toleranceMultiplier: 2,
    expectedSince: WORKER_INSTALLED_AT,
  },
  {
    // Tour 12 — the worker WATCHDOG's own heartbeat (self-healing layer).
    // ops/worker/watchdog.ps1 runs every 30 min on the host, repairs dead
    // tasks, then POSTs /api/admin/worker-watchdog/heartbeat. Monitored here
    // for the same reason as cron.health.scan: a guardian nobody watches is
    // a broken promise. ×48 → red only after 24h of silence (PC off at night
    // is normal), and `expectedSince` keeps it `pending` until the task is
    // actually installed.
    action: 'worker.watchdog.heartbeat',
    label: 'Worker · watchdog (auto-réparation)',
    periodMs: 30 * MIN,
    toleranceMultiplier: 48, // 24h
    expectedSince: '2026-07-04T12:00:00Z',
  },
] as const;

export type WorkerHealthEntry = HeartbeatHealthEntry<WorkerPipelineAction>;

export interface WorkerHealthReport {
  ranAt: string;
  /** Worst status across all pipelines (`red` > `never_ran` > `amber` > `green`). */
  overall: CronStatus;
  entries: WorkerHealthEntry[];
}

export async function getWorkerHealthReport(now: Date = new Date()): Promise<WorkerHealthReport> {
  return buildHeartbeatReport(WORKER_EXPECTATIONS, now);
}

/**
 * Aggregate counts useful on the admin dashboard alongside cron health.
 *
 * `Promise.all` 5 parallel `count()` queries — each hits a `userId` /
 * `status` index (verified). Constant cost regardless of cohort size.
 */
export interface SystemSnapshot {
  members: {
    active: number;
    deletionScheduled: number;
    softDeleted: number;
  };
  push: {
    activeSubscriptions: number;
  };
  audit: {
    last24h: number;
  };
}

export async function getSystemSnapshot(now: Date = new Date()): Promise<SystemSnapshot> {
  const last24h = new Date(now.getTime() - DAY);
  const [active, deletionScheduled, softDeleted, activeSubscriptions, audit24h] = await Promise.all(
    [
      db.user.count({ where: { status: 'active', deletedAt: null } }),
      db.user.count({ where: { status: 'active', deletedAt: { not: null } } }),
      db.user.count({ where: { status: 'deleted' } }),
      db.pushSubscription.count(),
      db.auditLog.count({ where: { createdAt: { gte: last24h } } }),
    ],
  );

  return {
    members: { active, deletionScheduled, softDeleted },
    push: { activeSubscriptions },
    audit: { last24h: audit24h },
  };
}
