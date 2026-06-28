import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditGroupByMock = vi.fn<(...args: unknown[]) => unknown>();
const auditFindManyMock = vi.fn<(...args: unknown[]) => unknown>();
const userCountMock = vi.fn<(...args: unknown[]) => unknown>();
const pushCountMock = vi.fn<(...args: unknown[]) => unknown>();
const auditCountMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: {
    auditLog: { groupBy: auditGroupByMock, findMany: auditFindManyMock, count: auditCountMock },
    user: { count: userCountMock },
    pushSubscription: { count: pushCountMock },
  },
}));

const { getCronHealthReport, getSystemSnapshot } = await import('./health');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => {
  auditGroupByMock.mockReset();
  auditFindManyMock.mockReset();
  // Default: no heartbeat carries errors, so the metadata pass is a no-op for
  // the tests that only exercise the age-based classification.
  auditFindManyMock.mockResolvedValue([]);
  userCountMock.mockReset();
  pushCountMock.mockReset();
  auditCountMock.mockReset();
});

describe('getCronHealthReport', () => {
  /**
   * Why this matters : the dashboard branches on `overall` to colour the
   * top-of-page pill. A green run must produce `overall: 'green'` AND
   * every entry's status must be `green`. We pin both.
   */
  it("returns 'green' when every cron's last run is within 1.5× its period", async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date(now.getTime() - 5 * MIN) },
      },
      {
        action: 'cron.recompute_scores.scan',
        _max: { createdAt: new Date(now.getTime() - 10 * HOUR) },
      },
      {
        action: 'cron.dispatch_douglas.scan',
        _max: { createdAt: new Date(now.getTime() - 3 * HOUR) },
      },
      {
        action: 'cron.weekly_reports.scan',
        _max: { createdAt: new Date(now.getTime() - 2 * DAY) },
      },
      {
        action: 'cron.dispatch_notifications.scan',
        _max: { createdAt: new Date(now.getTime() - 60_000) },
      },
      {
        action: 'cron.purge_deleted.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        action: 'cron.purge_push_subscriptions.scan',
        _max: { createdAt: new Date(now.getTime() - DAY) },
      },
      {
        // J10 V2-roadmap — audit_log retention purge (daily, age 12h → green).
        action: 'cron.purge_audit_log.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // Session 5 §26 — calendar overdue nudge (daily, age 12h → green).
        action: 'cron.calendar_overdue.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // Session 5 §25 — monthly debrief overdue nudge (daily, age 12h → green).
        action: 'cron.monthly_debrief_overdue.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S6 audit §30 — weekly report overdue nudge (daily, age 12h → green).
        action: 'cron.weekly_report_overdue.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S2 — onboarding profile overdue nudge (daily, age 12h → green).
        action: 'cron.onboarding_profile_overdue.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S3 §33.5 — daily verification scan (daily, age 12h → green).
        action: 'cron.verification_scan.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S21 — verification proof overdue nudge (daily, age 12h → green).
        action: 'cron.verification_overdue.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S10 — meeting slot generation (period DAY, age 12h → green).
        action: 'meeting.generated',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
      {
        // S10 — weekly mindset reminder (period WEEK, age 2d → green).
        action: 'cron.mindset_check_reminders.scan',
        _max: { createdAt: new Date(now.getTime() - 2 * DAY) },
      },
      {
        // S10 — access-request RGPD purge (period WEEK, age 1d → green).
        action: 'cron.purge_access_requests.scan',
        _max: { createdAt: new Date(now.getTime() - DAY) },
      },
      {
        // J10 Phase O fix B3 — the watcher's own heartbeat (period=1h,
        // tolerance=4h) needs a fresh row to land green.
        action: 'cron.health.scan',
        _max: { createdAt: new Date(now.getTime() - 30 * MIN) },
      },
    ]);

    const report = await getCronHealthReport(now);

    expect(report.overall).toBe('green');
    expect(report.entries).toHaveLength(18);
    expect(report.entries.every((e) => e.status === 'green')).toBe(true);
    expect(report.ranAt).toBe(now.toISOString());
  });

  /**
   * Why this matters : a cron that's slightly over 1.5× period but under
   * its tolerance must be `amber`, not `green` (operator should look at
   * it but not page). The dispatcher (period 2 min, tolerance 10 min) is
   * the typical offender on a deploy.
   */
  it('classifies cron between 1.5× period and tolerance as amber', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      // dispatch-notifications : period=2min, tolerance=10min, age=4min → amber
      {
        action: 'cron.dispatch_notifications.scan',
        _max: { createdAt: new Date(now.getTime() - 4 * MIN) },
      },
    ]);

    const report = await getCronHealthReport(now);
    const dispatcher = report.entries.find((e) => e.action === 'cron.dispatch_notifications.scan');

    expect(dispatcher?.status).toBe('amber');
    // The other 6 crons have no row → never_ran. `red` would shadow but
    // we expect `never_ran` to be the worst here.
    expect(report.overall === 'red' || report.overall === 'never_ran').toBe(true);
  });

  /**
   * Why this matters : a cron whose last run is past its tolerance MUST
   * be `red` so cron-watch.yml opens an issue. Pin the exact threshold
   * (period × tolerance multiplier).
   */
  it('classifies cron past its tolerance as red', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    // recompute-scores : period=24h, default tolerance multiplier=3 → 72h
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.recompute_scores.scan',
        _max: { createdAt: new Date(now.getTime() - 80 * HOUR) },
      },
    ]);

    const report = await getCronHealthReport(now);
    const recompute = report.entries.find((e) => e.action === 'cron.recompute_scores.scan');

    expect(recompute?.status).toBe('red');
    expect(report.overall).toBe('red');
  });

  /**
   * Why this matters : a fresh deploy (no audit history yet) MUST surface
   * as `never_ran` so the operator knows the cron daemon hasn't connected
   * yet. We pin that distinct from `red` so the UI can render a different
   * label ("Jamais exécuté" vs "Stale").
   */
  it("classifies cron with no audit row as 'never_ran'", async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([]);

    const report = await getCronHealthReport(now);

    expect(report.entries.every((e) => e.status === 'never_ran')).toBe(true);
    expect(report.entries.every((e) => e.lastRanAt === null)).toBe(true);
    expect(report.entries.every((e) => e.ageMs === null)).toBe(true);
    expect(report.overall).toBe('never_ran');
  });

  /**
   * Why this matters : red shadows everything else. A single red cron
   * drives the `overall` pill to red even if 6 others are green —
   * the page MUST surface the worst.
   */
  it('overall=red dominates green/amber/never_ran', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date(now.getTime() - 5 * MIN) },
      }, // green
      {
        action: 'cron.recompute_scores.scan',
        _max: { createdAt: new Date(now.getTime() - 100 * HOUR) },
      }, // red — period=24h, tolerance=72h, age=100h > tolerance
    ]);

    const report = await getCronHealthReport(now);
    expect(report.overall).toBe('red');
  });

  /**
   * Why this matters : the age check only sees "did it run", never "did it
   * SUCCEED". A cron that fires on schedule but fails for every member writes a
   * fresh heartbeat with errors > 0 — green by age, actually broken. errorCount
   * escalates such a run to amber so it can't hide.
   */
  it('escalates a green-by-age cron to amber when its latest run reported errors', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    // verification-scan ran 12h ago → green on age alone (period = 1 day).
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.verification_scan.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
    ]);
    // ...but its heartbeat says it failed for 5 members.
    auditFindManyMock.mockResolvedValueOnce([
      { action: 'cron.verification_scan.scan', metadata: { errors: 5 } },
    ]);

    const report = await getCronHealthReport(now);
    const scan = report.entries.find((e) => e.action === 'cron.verification_scan.scan');

    expect(scan?.status).toBe('amber');
    expect(scan?.errorCount).toBe(5);
  });

  /**
   * Why this matters : a healthy heartbeat (errors: 0) must NOT be downgraded —
   * errorCount escalation fires strictly on errors > 0.
   */
  it('leaves a green cron green when its latest run reported zero errors', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.verification_scan.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
    ]);
    auditFindManyMock.mockResolvedValueOnce([
      { action: 'cron.verification_scan.scan', metadata: { errors: 0 } },
    ]);

    const report = await getCronHealthReport(now);
    const scan = report.entries.find((e) => e.action === 'cron.verification_scan.scan');

    expect(scan?.status).toBe('green');
    expect(scan?.errorCount).toBe(0);
  });

  /**
   * Why this matters : the report's entries.length is fixed (one per known cron
   * action). Adding a new cron must require an explicit update to
   * `EXPECTATIONS` — drift between code + crontab is a high-risk class of bug.
   * S10 raised the count 13 → 16 (the 3 wired prod crons that were emitting a
   * heartbeat but were not being monitored: generate-meetings,
   * mindset-check-reminders, purge-access-requests).
   * S6 audit raised it 16 → 17 (the weekly-report overdue safety-net, the 4th
   * overdue net alongside calendar/monthly/onboarding).
   * S21 raised it 17 → 18 (the verification-proof overdue safety-net, closing
   * the last AI pipeline that had no anti-forget net — §33).
   */
  it('always returns exactly 18 entries (S21 — added the verification overdue net)', async () => {
    auditGroupByMock.mockResolvedValueOnce([]);
    const report = await getCronHealthReport();
    expect(report.entries).toHaveLength(18);
    // self-monitoring of the watcher (cron-watch.yml).
    expect(report.entries.map((e) => e.action)).toContain('cron.health.scan');
    // audit_log retention purge (V2-roadmap reclassed).
    expect(report.entries.map((e) => e.action)).toContain('cron.purge_audit_log.scan');
    // Session 5 §26 — calendar overdue safety-net heartbeat.
    expect(report.entries.map((e) => e.action)).toContain('cron.calendar_overdue.scan');
    // Session 5 §25 — monthly debrief overdue safety-net heartbeat.
    expect(report.entries.map((e) => e.action)).toContain('cron.monthly_debrief_overdue.scan');
    // S6 audit §30 — weekly report overdue safety-net heartbeat (4th overdue net).
    expect(report.entries.map((e) => e.action)).toContain('cron.weekly_report_overdue.scan');
    // S2 — onboarding profile overdue safety-net heartbeat.
    expect(report.entries.map((e) => e.action)).toContain('cron.onboarding_profile_overdue.scan');
    // S3 §33.5 — daily verification scan heartbeat.
    expect(report.entries.map((e) => e.action)).toContain('cron.verification_scan.scan');
    // S21 §33 — verification-proof overdue safety-net heartbeat (5th overdue net).
    expect(report.entries.map((e) => e.action)).toContain('cron.verification_overdue.scan');
    // S10 — the three crons promoted to monitored this session.
    expect(report.entries.map((e) => e.action)).toContain('meeting.generated');
    expect(report.entries.map((e) => e.action)).toContain('cron.mindset_check_reminders.scan');
    expect(report.entries.map((e) => e.action)).toContain('cron.purge_access_requests.scan');
  });
});

describe('getSystemSnapshot', () => {
  /**
   * Why this matters : the dashboard expects all 5 counters under stable
   * paths. A schema rename in `User` would silently break the snapshot
   * if we don't pin the count() WHERE clauses.
   */
  it('runs 5 parallel count queries with correct WHERE clauses', async () => {
    userCountMock
      .mockResolvedValueOnce(30) // active
      .mockResolvedValueOnce(2) // scheduled
      .mockResolvedValueOnce(1); // soft-deleted
    pushCountMock.mockResolvedValueOnce(45);
    auditCountMock.mockResolvedValueOnce(1240);

    const now = new Date('2026-05-09T12:00:00.000Z');
    const snap = await getSystemSnapshot(now);

    expect(snap).toEqual({
      members: { active: 30, deletionScheduled: 2, softDeleted: 1 },
      push: { activeSubscriptions: 45 },
      audit: { last24h: 1240 },
    });
    // Active = status='active' AND deletedAt=null
    expect(userCountMock.mock.calls[0]?.[0]).toEqual({
      where: { status: 'active', deletedAt: null },
    });
    // Scheduled = status='active' AND deletedAt NOT null
    expect(userCountMock.mock.calls[1]?.[0]).toEqual({
      where: { status: 'active', deletedAt: { not: null } },
    });
    // Soft-deleted = status='deleted'
    expect(userCountMock.mock.calls[2]?.[0]).toEqual({
      where: { status: 'deleted' },
    });
    // Audit volume last 24h
    const auditCall = auditCountMock.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(auditCall.where.createdAt.gte.toISOString()).toBe(
      new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});
