import 'server-only';

import { readFileSync, statfsSync } from 'node:fs';
import path from 'node:path';

import { localDateOf, localInstantToUtc } from '@/lib/checkin/timezone';
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
   * Tour 12 — window-bounded schedule. When set, the status is computed from
   * MISSED EXPECTED TICKS instead of raw age: a cron that fires every 15 min
   * inside its morning + evening windows is HEALTHY at noon even though its
   * last row is hours old. Raw-age classification flagged it "amber" all day,
   * every day, between windows — a structural false positive the operator
   * learns to ignore (which is how real incidents slip through).
   *
   * Tour 13 (prod bug fix) — the `hours` are wall-clock **Europe/Paris**, NOT
   * UTC. The prod host runs in Europe/Paris (`/etc/localtime`, provisioned
   * 2026-05-02) and Debian `crond` interprets `/etc/cron.d` hour fields in the
   * host's LOCAL time, not UTC. So `crontab.fxmily` expresses Paris hours
   * (`7-9,20-22`) and this model must expect the SAME Paris wall-clock ticks.
   * The previous `windowedScheduleUtc: { hours: [...18,19,20] }` generated
   * expected ticks in UTC, so every evening past ~19:15 UTC the model waited
   * for ticks that crond never fires in UTC → a nightly FALSE red (the 19:37Z
   * cron-watch 503 on 2026-07-04). `countMissedTicks` converts each
   * `minutes × hours` wall-clock Paris tick to a UTC instant (DST-correct via
   * `localInstantToUtc`), so the two agree across CET/CEST.
   */
  windowedScheduleParis?: { minutes: readonly number[]; hours: readonly number[] };
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
  | 'cron.admin_daily_brief.scan'
  | 'cron.verification_scan.scan'
  | 'cron.verification_overdue.scan'
  // S10 — three wired prod crons that were emitting a heartbeat but were NOT
  // monitored here, so a silent failure of any of them never surfaced red.
  | 'meeting.generated' // generate-meetings (admin slug, see lib/auth/audit.ts:312)
  | 'cron.mindset_check_reminders.scan'
  | 'cron.purge_access_requests.scan'
  | 'cron.health.scan'
  // Tour 14 — host autoheal watchdog heartbeat (fxmily-autoheal, every minute
  // on the always-on Hetzner host, POSTs hourly). Lives in the SERVER cron
  // report (not the worker report) because the host never sleeps: a missing
  // heartbeat means the watchdog itself is dead, an incident on prod infra.
  | 'cron.autoheal.heartbeat';

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
    // `0,15,30,45 7-9,20-22 * * *` in `crontab.fxmily` — crond reads these as
    // Europe/Paris LOCAL hours (host tz), covering the member reminder windows
    // (Paris 07:30-09:00 + 20:30-22:00, lib/checkin/timezone.ts) plus grace.
    // Hours below are the SAME Paris wall-clock; countMissedTicks converts them
    // to UTC instants (DST-correct) before comparing with the audit rows.
    windowedScheduleParis: { minutes: [0, 15, 30, 45], hours: [7, 8, 9, 20, 21, 22] },
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
    // Tour 15 — daily ADMIN brief (« point du matin »). Standing report sent
    // once a day so the coach knows where to look without opening the app. A
    // STANDING report (unlike the overdue nudges): it emits a heartbeat every
    // run whether or not there is anything to flag, so a broken brief cron
    // surfaces red here instead of failing silently. `expectedSince` keeps it
    // `pending` (calm "premier run à venir") until the deploy that wires the
    // crontab line has run once, instead of shouting "Jamais exécuté".
    action: 'cron.admin_daily_brief.scan',
    label: 'Daily admin brief',
    periodMs: DAY, // crontab: daily 07:05 Paris local (`5 7 * * *`, TZ=Europe/Paris)
    expectedSince: '2026-07-06T00:00:00Z',
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
  {
    // Tour 14 — host autoheal watchdog heartbeat (P1-4). `fxmily-autoheal` runs
    // every minute on the always-on Hetzner host but POSTs a counts-only
    // heartbeat once an hour. Unlike the WORKER watchdog (personal PC that
    // legitimately sleeps at night → 24h tolerance), the host NEVER sleeps, so
    // a missing hourly heartbeat is a real signal: green ≤ 1.5h, amber ≤ 2h,
    // red past 2h — the watchdog binary is gone, its cron line was stripped, or
    // the app token drifted. `expectedSince` keeps it `pending` (calm "premier
    // run à venir") until the deploy that ships the heartbeat has converged the
    // host, instead of shouting "Jamais exécuté" the moment this expectation
    // lands. A fresh row with escalations > 0 (mapped to metadata.errors by the
    // route) escalates green → amber via buildHeartbeatReport.
    action: 'cron.autoheal.heartbeat',
    label: 'Autoheal watchdog (hôte)',
    periodMs: HOUR,
    toleranceMultiplier: 2, // red past 2h of silence on an always-on host
    expectedSince: '2026-07-05T00:00:00Z',
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
    } else if (expectation.windowedScheduleParis) {
      // Window-bounded cron: classify on missed expected ticks, not raw age.
      const missed = countMissedTicks(expectation.windowedScheduleParis, lastRanAt, now);
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
      windowed: Boolean(expectation.windowedScheduleParis),
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

/** IANA timezone the prod host + crond run in (see `windowedScheduleParis`). */
const HOST_TIMEZONE = 'Europe/Paris';

/** Wall-clock hour (0-23) of a UTC instant in `HOST_TIMEZONE`. Used only to
 *  detect a non-existent spring-forward tick (round-trip guard). */
function parisHourOf(instant: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOST_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(instant)
    .find((p) => p.type === 'hour')?.value;
  const n = Number(hour);
  // en-GB may render midnight as `24` in some ICU versions — normalise to 0.
  return n === 24 ? 0 : n;
}

/**
 * Tour 12 / Tour 13 — count the schedule ticks that SHOULD have fired strictly
 * after `lastRanAt` and up to `now - jitter`, for a window-bounded cron
 * (`minutes × hours`). 0 missed → green ; ≤ 2 → amber ; more → red. A 5-min
 * jitter grace keeps the tick currently firing out of the count.
 *
 * Tour 13 — the `hours` are wall-clock **Europe/Paris** (crond on the prod host
 * reads `/etc/cron.d` in host-local time), so each `minutes × hours` tick is
 * converted to a UTC instant via `localInstantToUtc`, DST-correct across
 * CET/CEST. We iterate over Paris CALENDAR days (via `localDateOf`) so the
 * day boundary matches the crontab's, not UTC midnight.
 *
 * DST edge: on the spring-forward day a wall-clock hour can be non-existent
 * (Paris skips 02:00→03:00). Our windows (07-09h, 20-22h) never touch that
 * hour, but for correctness we skip any tick whose wall-clock does not round
 * trip — `localInstantToUtc` would otherwise fabricate an instant for a tick
 * crond never fires, producing a false `missed`.
 *
 * Iteration is bounded: past a few days of misses the exact count stops
 * mattering (red either way), so we bail out at maxDays / missed > 3.
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
  const maxDays = 8;
  // Anchor on the Paris calendar day of `lastRanAt`; each iteration walks one
  // Paris day forward. Using the Paris day (not UTC) keeps ticks near midnight
  // attributed to the correct crontab day.
  const anchorParisDate = localDateOf(lastRanAt, HOST_TIMEZONE);
  for (let day = 0; day <= maxDays; day += 1) {
    // A UTC noon on the anchor day + `day` days lands unambiguously inside the
    // right Paris day (noon is >12h from either DST edge), so re-reading its
    // Paris date gives the calendar day we want to enumerate ticks for.
    const parisDate = localDateOf(
      new Date(new Date(`${anchorParisDate}T12:00:00Z`).getTime() + day * DAY),
      HOST_TIMEZONE,
    );
    let dayStartMs = Infinity;
    for (const hour of schedule.hours) {
      for (const minute of schedule.minutes) {
        const tickInstant = localInstantToUtc(parisDate, hour, minute, 0, 0, HOST_TIMEZONE);
        // Skip a non-existent wall-clock tick (spring-forward): if converting
        // back does not land on the same Paris hour, crond never fires it.
        const back = localDateOf(tickInstant, HOST_TIMEZONE);
        const backHour = parisHourOf(tickInstant);
        if (back !== parisDate || backHour !== hour) continue;

        const tick = tickInstant.getTime();
        dayStartMs = Math.min(dayStartMs, tick);
        if (tick > lastRanAt.getTime() && tick <= horizon) {
          missed += 1;
          if (missed > 3) return missed; // already red — stop counting
        }
      }
    }
    // Stop once this whole Paris day starts past the horizon (nothing later
    // can be a missed tick within the window).
    if (dayStartMs !== Infinity && dayStartMs > horizon) break;
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
    // Tour 13 — moved from daily 04:10 to an interval; Tour 15 tightened the
    // real cadence to every 5 min (install-worker.ps1, per-pipeline
    // IntervalMinutes). `periodMs` deliberately stays at 20 min: it is the
    // ALERT baseline, not the cadence — green ≤ 30 min tolerates ticks skipped
    // by the inter-pipeline lock (a long `claude --print` holds it), amber up
    // to 24h (PC off overnight is normal and calm), red past 24h (the task
    // itself is broken — the PC was necessarily on at some point that day).
    action: 'verification.batch.pulled',
    label: 'Worker · vision preuves MT5',
    periodMs: 20 * MIN,
    toleranceMultiplier: 72, // 24h
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
 * Tour 16 — HOST ACTIONS PENDING.
 *
 * The heartbeat board tells the operator WHICH signal is red; it does NOT tell
 * them the exact host command to run to clear it. This surface closes that gap:
 * from the (already computed) cron + worker reports it derives the small set of
 * host-side actions that are ACTUALLY detectable from a heartbeat, each with the
 * literal command to run and since when the signal has been open.
 *
 * SCOPE / HONESTY (brief) — we only emit an item when the server has a real
 * signal for it. Two states are host-actionable and detectable here:
 *
 *   1. Autoheal watchdog heartbeat never_ran / red → the root `fxmily-sync-cron`
 *      convergence never installed (or stripped) the hourly heartbeat on the
 *      host. Remediation = re-run the root sync (ops/cron/README.md §bootstrap).
 *   2. Worker watchdog heartbeat never_ran / red → the local-PC watchdog task
 *      that repairs the 6 AI batches is not registered / not POSTing. Remediation
 *      = re-run the worker installer (ops/worker/install-worker.ps1).
 *
 * The brief also asked about (a) an ANOMALOUS worker verification cadence and
 * (b) an apex-down signal. On (a): the worker heartbeat model classifies
 * red/amber/never_ran but does NOT expose a raw cadence number, so we surface
 * the verification pipeline ONLY when its heartbeat is red/never_ran (the honest
 * detectable state), not a fabricated "cadence anomaly". On (b): there is NO
 * server-side apex signal in this codebase (the apex probe lives in
 * cron-watch.yml, GitHub-side), so we deliberately DO NOT invent one here — the
 * card documents that in its own copy rather than showing a hollow row.
 *
 * PURE — folds the two reports (no I/O). `now` only decides the "since" age.
 */

/** Severity of a pending host action. `blocked` = a real incident (red/never
 *  ran); `pending` = a first run not due yet (calm, informational). */
export type HostActionSeverity = 'blocked' | 'pending';

export interface HostActionItem {
  /** Stable key (the heartbeat action) for React lists + dedup. */
  key: string;
  /** Human label of the broken signal. */
  label: string;
  /** One-sentence explanation of what the missing heartbeat means. */
  detail: string;
  /** The literal host command to run (verbatim, copy-pastable). */
  command: string;
  /** Where the command is documented (repo-relative path). */
  reference: string;
  /** ISO instant since when the signal has been open (last run, or the expected
   *  first-run deadline for a never_ran with an `expectedSince`), or null. */
  sinceIso: string | null;
  severity: HostActionSeverity;
}

/** Per-action remediation metadata for the host-actionable heartbeats. */
const HOST_ACTION_REMEDIATION: Record<
  string,
  { detail: string; command: string; reference: string }
> = {
  'cron.autoheal.heartbeat': {
    detail:
      "Le watchdog autoheal de l'hôte n'envoie plus son heartbeat horaire : le cron racine fxmily-sync-cron n'a pas reconvergé l'hôte.",
    command: 'sudo -u fxmily sudo /usr/local/bin/fxmily-sync-cron',
    reference: 'ops/cron/README.md',
  },
  'worker.watchdog.heartbeat': {
    detail:
      'Le watchdog du worker IA (machine locale) ne tourne plus : les 6 batchs Claude ne sont plus auto-réparés.',
    command: 'pwsh -File ops/worker/install-worker.ps1',
    reference: 'ops/worker/README.md',
  },
  'verification.batch.pulled': {
    detail:
      'Le pipeline de vérification des preuves MT5 (machine locale) ne tourne plus : les captures restent en attente.',
    command: 'pwsh -File ops/worker/install-worker.ps1',
    reference: 'ops/worker/README.md',
  },
};

/**
 * Map a heartbeat entry to a host action WHEN it is host-actionable and in a
 * detectable broken/pending state. Returns null otherwise (green/amber entries,
 * or entries with no known host remediation). `red` and `never_ran` are
 * `blocked` (a real gap); `pending` is informational (first run not due yet).
 */
function toHostAction(entry: HeartbeatHealthEntry): HostActionItem | null {
  const remediation = HOST_ACTION_REMEDIATION[entry.action];
  if (!remediation) return null;
  if (entry.status !== 'red' && entry.status !== 'never_ran' && entry.status !== 'pending') {
    return null;
  }
  const severity: HostActionSeverity = entry.status === 'pending' ? 'pending' : 'blocked';
  // "Since" = the last run if it ran at all (red = ran then went stale), else
  // the first-run deadline (never_ran/pending with an expectedSince), else null.
  const sinceIso = entry.lastRanAt ?? entry.firstRunDeadline ?? null;
  return {
    key: entry.action,
    label: entry.label,
    detail: remediation.detail,
    command: remediation.command,
    reference: remediation.reference,
    sinceIso,
    severity,
  };
}

export interface HostActionsReport {
  /** Actionable host items, most-severe first (blocked before pending). */
  items: HostActionItem[];
}

/**
 * Fold the cron + worker reports into the list of pending host actions. PURE
 * (both reports are passed in). Blocked items sort before pending ones so the
 * operator reads the real incidents first.
 */
export function buildHostActionsReport(
  cronReport: CronHealthReport,
  workerReport: WorkerHealthReport,
): HostActionsReport {
  const items = [...cronReport.entries, ...workerReport.entries]
    .map(toHostAction)
    .filter((item): item is HostActionItem => item !== null)
    .sort((a, b) => {
      // blocked (0) before pending (1).
      const rank = (s: HostActionSeverity) => (s === 'blocked' ? 0 : 1);
      return rank(a.severity) - rank(b.severity);
    });
  return { items };
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

/**
 * Tour 13 — disk space health check.
 *
 * The prod container shares a single 40 GB Hetzner CX22 volume with Postgres
 * AND the nightly backups. A full disk is a TOTAL, SILENT failure class: PG
 * refuses writes (the app 500s on every mutation), the backup job aborts
 * mid-dump (so the one artefact that could recover the incident is also
 * destroyed), and NOTHING here surfaces it — the only free-space check lived
 * in `ops/scripts/preflight-check.sh`, run by hand before a deploy, never
 * again after. This makes the check continuous: every `/admin/system` render
 * and every `cron-watch.yml` hit reads the live free bytes.
 *
 * Thresholds reuse preflight-check.sh's `THRESHOLD_DISK_GB=5` as the
 * green→amber boundary (below 5 GB the operator should act before the backup
 * dump — bounded by the DB size — can no longer fit), and add a hard critical
 * floor at 2 GB where PG write failures and a failed dump become imminent.
 *
 * Unlike the heartbeat entries above, disk is an INSTANT probe, not an audit
 * gap: there is no `action` / `periodMs` / `lastRanAt`, so it carries its own
 * shape. `statfsSync('/')` reads the VM filesystem the container sees through
 * overlayfs, so `bavail × bsize` is the real free space on the host volume.
 */

/** Green→amber boundary — mirrors preflight-check.sh THRESHOLD_DISK_GB=5. */
const DISK_WARN_BYTES = 5 * 1024 * 1024 * 1024;
/** Amber→red boundary — PG write failures + a failed backup dump loom below this. */
const DISK_CRITICAL_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * `unknown` mirrors the heartbeat `pending`/`never_ran` neutrality: a platform
 * where `statfsSync` is unavailable or throws (exotic FS, sandbox) is NOT an
 * incident — we simply have no reading, so the card renders neutral, never red,
 * and never crashes the system page.
 */
export type DiskStatus = 'green' | 'amber' | 'red' | 'unknown';

export interface DiskHealth {
  status: DiskStatus;
  /** Free bytes on `/`, or null when the probe failed (status `unknown`). */
  freeBytes: number | null;
  /** Total bytes on `/`, or null when the probe failed. */
  totalBytes: number | null;
  /** The two thresholds, echoed so the UI can explain the buckets. */
  warnBytes: number;
  criticalBytes: number;
}

/**
 * Read live free/total bytes on `/`. Pure sync probe, wrapped so a throwing
 * `statfsSync` (unsupported platform, permission) degrades to `unknown`
 * instead of bubbling up and 500-ing the admin page. `path` is injectable for
 * tests; prod always reads the root the container mounts.
 */
export function getDiskHealth(path = '/'): DiskHealth {
  try {
    const stats = statfsSync(path);
    // `bsize` = fragment size in bytes; `bavail` = blocks free to a non-root
    // user (the honest headroom, not the root-reserved `bfree`).
    const freeBytes = stats.bavail * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const status: DiskStatus =
      freeBytes < DISK_CRITICAL_BYTES ? 'red' : freeBytes < DISK_WARN_BYTES ? 'amber' : 'green';
    return {
      status,
      freeBytes,
      totalBytes,
      warnBytes: DISK_WARN_BYTES,
      criticalBytes: DISK_CRITICAL_BYTES,
    };
  } catch {
    // Exotic platform / permission error: no reading, stay neutral (never red,
    // never a crash of the observability page).
    return {
      status: 'unknown',
      freeBytes: null,
      totalBytes: null,
      warnBytes: DISK_WARN_BYTES,
      criticalBytes: DISK_CRITICAL_BYTES,
    };
  }
}

/**
 * Tour 14 — uploads persistence health (data-loss self-detection).
 *
 * Member uploads (MT5 proofs = the S3 anti-lie evidence, trade + training
 * shots, annotations) are written by `LocalStorageAdapter` under its upload
 * root. That root is `process.env.UPLOADS_DIR` when set, else `<cwd>/.uploads`
 * (kept in sync with apps/web/src/lib/storage/local.ts:44 — the single source
 * of truth for the resolution). If that path resolves onto the container's
 * EPHEMERAL overlay layer (no Docker volume mounted there), every deploy wipes
 * the files while their DB rows survive → 404 on read, silently, with no other
 * signal. This probe reads `/proc/mounts` and reports whether the upload root
 * sits on a persistent volume (a real mount) or the ephemeral overlay/tmpfs.
 *
 * Detection ONLY — it never moves or writes files. The fix is infrastructural
 * (mount the `fxmily-uploads` volume on the upload root + drop the stray
 * `UPLOADS_DIR` from web.env); this card tells the operator whether that
 * convergence has actually landed on the running container.
 *
 * Like `getDiskHealth`, it is an INSTANT sync probe (no audit gap), and any
 * failure to read `/proc/mounts` (non-Linux dev host, sandbox, permission)
 * degrades to `unknown` — neutral, never red, never a crash of the admin page.
 */

/** Filesystem types that live in a container's writable layer and are WIPED on
 *  every `docker compose up -d` (i.e. every deploy). A member upload root on any
 *  of these loses the bytes while the DB rows survive. */
const EPHEMERAL_FS_TYPES = new Set(['overlay', 'overlayfs', 'tmpfs', 'ramfs']);

export type UploadsPersistenceStatus = 'green' | 'amber' | 'red' | 'unknown';

export interface UploadsPersistenceHealth {
  status: UploadsPersistenceStatus;
  /** Resolved upload root inspected (mirrors LocalStorageAdapter). */
  uploadsRoot: string;
  /** Longest-prefix mount point covering the upload root, or null if unresolved. */
  mountPoint: string | null;
  /** Filesystem type backing that mount point, or null when unread. */
  fsType: string | null;
  /** True when `fsType` is a known ephemeral (overlay/tmpfs) writable layer. */
  ephemeral: boolean;
}

/**
 * Resolve the upload root exactly as `LocalStorageAdapter` does. Kept local to
 * avoid importing the storage adapter (heavy `server-only` module) into the
 * health surface; MUST stay in lockstep with apps/web/src/lib/storage/local.ts.
 */
function resolveUploadsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd(), '.uploads');
}

/**
 * Parse a `/proc/mounts` body into `{ mountPoint, fsType }` records. Fields are
 * space-separated: `device mountPoint fsType options dump pass`; path fields
 * octal-escape spaces/tabs/newlines/backslash (`\040 \011 \012 \134`), which we
 * decode so a mount point with a space still matches. Exported for unit tests.
 */
export function parseProcMounts(body: string): { mountPoint: string; fsType: string }[] {
  const unescape = (field: string): string =>
    field.replace(/\\(040|011|012|134)/g, (_, code) => {
      switch (code) {
        case '040':
          return ' ';
        case '011':
          return '\t';
        case '012':
          return '\n';
        default:
          return '\\';
      }
    });
  const records: { mountPoint: string; fsType: string }[] = [];
  for (const line of body.split('\n')) {
    if (line.trim().length === 0) continue;
    const [, mountPoint, fsType] = line.split(' ');
    if (mountPoint === undefined || fsType === undefined) continue;
    records.push({ mountPoint: unescape(mountPoint), fsType });
  }
  return records;
}

/**
 * Pick the mount whose mount point is the LONGEST prefix of `target` — the same
 * longest-prefix rule `df`/`findmnt` use to attribute a path to its filesystem.
 * A mount point matches when `target` equals it or lives under it (`/` matches
 * everything as the shortest fallback). Exported for unit tests.
 */
export function mountForPath(
  target: string,
  mounts: { mountPoint: string; fsType: string }[],
): { mountPoint: string; fsType: string } | null {
  let best: { mountPoint: string; fsType: string } | null = null;
  for (const mount of mounts) {
    const mp = mount.mountPoint;
    const isPrefix =
      target === mp || mp === '/' || target.startsWith(mp.endsWith('/') ? mp : `${mp}/`);
    if (!isPrefix) continue;
    if (best === null || mp.length > best.mountPoint.length) best = mount;
  }
  return best;
}

/**
 * Inspect where the member upload root lives. `procMounts` + `uploadsRoot` are
 * injectable for tests; prod reads `/proc/mounts` and resolves the root the
 * running container actually uses.
 *
 *   red     → upload root is on the ephemeral overlay/tmpfs layer: proofs are
 *             being lost on every deploy RIGHT NOW.
 *   green   → upload root is on a persistent mount (Docker volume / bind).
 *   unknown → `/proc/mounts` unreadable or the root can't be attributed to a
 *             mount (non-Linux dev host, sandbox) — neutral, no reading.
 */
export function getUploadsPersistenceHealth(
  procMounts = '/proc/mounts',
  uploadsRoot = resolveUploadsRoot(),
): UploadsPersistenceHealth {
  const neutral: UploadsPersistenceHealth = {
    status: 'unknown',
    uploadsRoot,
    mountPoint: null,
    fsType: null,
    ephemeral: false,
  };
  let body: string;
  try {
    body = readFileSync(procMounts, 'utf8');
  } catch {
    // Non-Linux dev host / sandbox: no /proc, no reading — stay neutral.
    return neutral;
  }

  const mount = mountForPath(uploadsRoot, parseProcMounts(body));
  if (mount === null) {
    // Could not attribute the root to any mount — report unknown rather than
    // guessing persistence from a partial read.
    return neutral;
  }

  const ephemeral = EPHEMERAL_FS_TYPES.has(mount.fsType.toLowerCase());
  return {
    status: ephemeral ? 'red' : 'green',
    uploadsRoot,
    mountPoint: mount.mountPoint,
    fsType: mount.fsType,
    ephemeral,
  };
}

/**
 * Tour 13 — verification backlog health.
 *
 * The verification pipeline now ticks every 5 min (install-worker.ps1, Tour
 * 15), so an uploaded MT5 proof should turn from `pending` to `done`/`failed`
 * within minutes, not overnight. This is an INSTANT probe (a single indexed
 * count + min-timestamp on `mt5_account_proofs`), NOT an audit-gap heartbeat:
 * it reads the OLDEST still-`pending` proof and flags how long the member has
 * been waiting for their reality to be read.
 *
 *   red   → oldest pending > 6h  (the 5-min worker would have caught it; the
 *           pipeline or the local PC is stuck — honest, not alarmist).
 *   amber → oldest pending > 1h  (running late; worth an eye).
 *   green → a backlog exists but it is fresh (< 1h — normal in-flight state).
 *   idle  → nothing pending at all (neutral, calm — the healthy steady state).
 *
 * Scoped to ACTIVE members to mirror the pull's own eligibility predicate
 * (`loadPendingProofsEnvelope` only pulls `member.status = 'active'`): a proof
 * from a soft-deleted member is never analysed, so it must not redden the board.
 */
const VERIFICATION_BACKLOG_AMBER_MS = HOUR;
const VERIFICATION_BACKLOG_RED_MS = 6 * HOUR;

export type VerificationBacklogStatus = 'green' | 'amber' | 'red' | 'idle';

export interface VerificationBacklogHealth {
  status: VerificationBacklogStatus;
  /** Number of proofs still `pending` for active members. */
  pendingCount: number;
  /** Age in ms of the OLDEST pending proof, or null when the queue is empty. */
  oldestPendingAgeMs: number | null;
  /** ISO upload instant of the oldest pending proof, or null when idle. */
  oldestPendingAt: string | null;
  /** Thresholds echoed so the UI can explain the buckets. */
  amberMs: number;
  redMs: number;
}

export async function getVerificationBacklogHealth(
  now: Date = new Date(),
): Promise<VerificationBacklogHealth> {
  const [pendingCount, oldest] = await Promise.all([
    db.mt5AccountProof.count({
      where: { ocrStatus: 'pending', member: { status: 'active' } },
    }),
    db.mt5AccountProof.findFirst({
      where: { ocrStatus: 'pending', member: { status: 'active' } },
      orderBy: { uploadedAt: 'asc' },
      select: { uploadedAt: true },
    }),
  ]);

  if (pendingCount === 0 || !oldest) {
    return {
      status: 'idle',
      pendingCount: 0,
      oldestPendingAgeMs: null,
      oldestPendingAt: null,
      amberMs: VERIFICATION_BACKLOG_AMBER_MS,
      redMs: VERIFICATION_BACKLOG_RED_MS,
    };
  }

  const oldestPendingAgeMs = Math.max(0, now.getTime() - oldest.uploadedAt.getTime());
  const status: VerificationBacklogStatus =
    oldestPendingAgeMs > VERIFICATION_BACKLOG_RED_MS
      ? 'red'
      : oldestPendingAgeMs > VERIFICATION_BACKLOG_AMBER_MS
        ? 'amber'
        : 'green';

  return {
    status,
    pendingCount,
    oldestPendingAgeMs,
    oldestPendingAt: oldest.uploadedAt.toISOString(),
    amberMs: VERIFICATION_BACKLOG_AMBER_MS,
    redMs: VERIFICATION_BACKLOG_RED_MS,
  };
}
