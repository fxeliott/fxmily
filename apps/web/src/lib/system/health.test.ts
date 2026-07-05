import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditGroupByMock = vi.fn<(...args: unknown[]) => unknown>();
const auditFindManyMock = vi.fn<(...args: unknown[]) => unknown>();
const userCountMock = vi.fn<(...args: unknown[]) => unknown>();
const pushCountMock = vi.fn<(...args: unknown[]) => unknown>();
const auditCountMock = vi.fn<(...args: unknown[]) => unknown>();
// Tour 13 — disk probe. `getDiskHealth` calls `node:fs` statfsSync; mock it so
// the thresholds/error path are deterministic and platform-independent (the CI
// runner and Windows dev both give real-but-irrelevant free space otherwise).
const statfsSyncMock = vi.fn<(...args: unknown[]) => unknown>();
// Tour 14 — uploads-persistence probe reads /proc/mounts via readFileSync.
const readFileSyncMock = vi.fn<(...args: unknown[]) => unknown>();
// Tour 13 — verification backlog probe reads mt5AccountProof.count + findFirst.
const proofCountMock = vi.fn<(...args: unknown[]) => unknown>();
const proofFindFirstMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/db', () => ({
  db: {
    auditLog: { groupBy: auditGroupByMock, findMany: auditFindManyMock, count: auditCountMock },
    user: { count: userCountMock },
    pushSubscription: { count: pushCountMock },
    mt5AccountProof: { count: proofCountMock, findFirst: proofFindFirstMock },
  },
}));

vi.mock('node:fs', () => ({
  statfsSync: (...args: unknown[]) => statfsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

const {
  getCronHealthReport,
  getDiskHealth,
  getSystemSnapshot,
  getWorkerHealthReport,
  getVerificationBacklogHealth,
  getUploadsPersistenceHealth,
  parseProcMounts,
  mountForPath,
} = await import('./health');

const GIB = 1024 * 1024 * 1024;
/** Build a `statfsSync`-shaped result with `bsize`=4096 and the given free/total GiB. */
function statfs(freeGiB: number, totalGiB: number) {
  const bsize = 4096;
  return {
    bsize,
    blocks: Math.round((totalGiB * GIB) / bsize),
    bavail: Math.round((freeGiB * GIB) / bsize),
    bfree: Math.round((freeGiB * GIB) / bsize),
    b_free: 0,
    files: 0,
    ffree: 0,
    type: 0,
  };
}

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
  statfsSyncMock.mockReset();
  readFileSyncMock.mockReset();
  proofCountMock.mockReset();
  proofFindFirstMock.mockReset();
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
      {
        // Tour 14 — host autoheal watchdog heartbeat (period=1h, tolerance=2h,
        // green ≤ 1.5h). A 30-min-old row lands green.
        action: 'cron.autoheal.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 30 * MIN) },
      },
    ]);

    const report = await getCronHealthReport(now);

    expect(report.overall).toBe('green');
    expect(report.entries).toHaveLength(19);
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
   * Tour 12 / Tour 13 — window-bounded classification. Check-in reminders fire
   * every 15 min ONLY inside the Paris windows 07-09h + 20-22h. The prod host
   * runs Europe/Paris and crond reads the crontab in LOCAL time, so the model
   * expects Paris WALL-CLOCK ticks converted to UTC (DST-correct). Raw-age
   * classification flagged the cron amber all day between windows — a structural
   * false positive. With `windowedScheduleParis`, status = missed expected
   * ticks.
   *
   * Tour 13 regression pin: the OLD `windowedScheduleUtc: hours [5,6,7,18,19,20]`
   * generated UTC ticks that no longer match the crontab, so every evening past
   * ~19:15 UTC the model waited for ticks crond never fires → nightly false red
   * (the 2026-07-04 19:37Z cron-watch 503). These cases build their instants
   * from Paris wall-clock in BOTH DST seasons and must stay green off-window.
   */
  it('keeps the cron green between the Paris windows in SUMMER (CEST) — 0 missed', async () => {
    // The Paris evening window is 20:00-22:45 (hours 20,21,22 × :00/:15/:30/:45),
    // so the LAST scheduled tick is 22:45 Paris. Summer: 22:45 Paris = 20:45Z.
    // Now 23:30 Paris (21:30Z) — past the last tick, before tomorrow's 07:00
    // Paris morning window → 0 missed → green.
    const now = new Date('2026-07-04T21:30:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date('2026-07-04T20:45:00.000Z') }, // 22:45 Paris
      },
    ]);

    const report = await getCronHealthReport(now);
    const checkin = report.entries.find((e) => e.action === 'cron.checkin_reminders.scan');

    expect(checkin?.status).toBe('green');
    expect(checkin?.windowed).toBe(true);
  });

  it('keeps the cron green between the Paris windows in WINTER (CET) — 0 missed', async () => {
    // Winter: 22:45 Paris (last evening tick) = 21:45Z. Now 23:30 Paris
    // (22:30Z) — past the last tick, between windows. This is the exact
    // scenario the OLD UTC model got wrong: at 22:30Z it expected UTC ticks at
    // 18/19/20h that crond never fires in winter → false red.
    const now = new Date('2026-01-15T22:30:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date('2026-01-15T21:45:00.000Z') }, // 22:45 Paris
      },
    ]);

    const report = await getCronHealthReport(now);
    const checkin = report.entries.find((e) => e.action === 'cron.checkin_reminders.scan');

    expect(checkin?.status).toBe('green');
  });

  it('classifies 2 missed ticks INSIDE a Paris window as amber (summer)', async () => {
    // Summer morning window. 07:15 Paris (05:15Z) ran; now 07:50 Paris (05:50Z)
    // → 07:30 + 07:45 Paris ticks missed (2) → amber.
    const midWindow = new Date('2026-07-04T05:50:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date('2026-07-04T05:15:00.000Z') }, // 07:15 Paris
      },
    ]);
    const amberReport = await getCronHealthReport(midWindow);
    expect(
      amberReport.entries.find((e) => e.action === 'cron.checkin_reminders.scan')?.status,
    ).toBe('amber');
  });

  it('classifies a whole missed Paris window as red (winter)', async () => {
    // Winter. Last ran yesterday evening (21:45 Paris = 20:45Z on the 14th).
    // Now 09:00 Paris on the 15th (08:00Z) → the entire morning window
    // (07:00-09:00 Paris) has passed with nothing → red.
    const morningAfter = new Date('2026-01-15T08:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date('2026-01-14T20:45:00.000Z') }, // 21:45 Paris (14th)
      },
    ]);
    const redReport = await getCronHealthReport(morningAfter);
    expect(redReport.entries.find((e) => e.action === 'cron.checkin_reminders.scan')?.status).toBe(
      'red',
    );
  });

  it('does NOT fabricate missed ticks the evening the OLD UTC model went red (regression)', async () => {
    // The prod incident: 2026-07-04 19:37Z, checkin_reminders flagged red under
    // the UTC model. In Paris that is 21:37 — mid evening-window. A tick fired
    // at 21:30 Paris (19:30Z, 7 min before) → 0 missed within jitter → green.
    const now = new Date('2026-07-04T19:37:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.checkin_reminders.scan',
        _max: { createdAt: new Date('2026-07-04T19:30:00.000Z') }, // 21:30 Paris
      },
    ]);
    const report = await getCronHealthReport(now);
    const checkin = report.entries.find((e) => e.action === 'cron.checkin_reminders.scan');
    expect(checkin?.status).toBe('green');
  });

  /**
   * Tour 12 — `greenMultiplier` absorbs GH Actions schedule jitter. The
   * health watcher is hourly but GH routinely skips whole hours under load
   * (observed 2026-07-04: 04:01 → 07:14 → 09:32). A 2h30 gap is normal
   * operation → green; past 3h → amber; past the 6h tolerance → red stays.
   */
  it('applies greenMultiplier: a 2h30-old hourly watcher heartbeat stays green, 4h reads amber', async () => {
    const now = new Date('2026-07-04T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      { action: 'cron.health.scan', _max: { createdAt: new Date(now.getTime() - 150 * MIN) } },
    ]);
    const greenReport = await getCronHealthReport(now);
    expect(greenReport.entries.find((e) => e.action === 'cron.health.scan')?.status).toBe('green');

    auditGroupByMock.mockResolvedValueOnce([
      { action: 'cron.health.scan', _max: { createdAt: new Date(now.getTime() - 4 * HOUR) } },
    ]);
    const amberReport = await getCronHealthReport(now);
    expect(amberReport.entries.find((e) => e.action === 'cron.health.scan')?.status).toBe('amber');
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

    // Every cron WITHOUT an `expectedSince` reads `never_ran` on a fresh deploy.
    // Tour 14 — the autoheal watchdog DOES carry `expectedSince` (2026-07-05),
    // which is in the FUTURE relative to this May-dated `now`, so its absence is
    // `pending` ("premier run à venir"), not `never_ran` — by design (same
    // pattern as the worker member_profile_monthly pipeline). Assert the split.
    const dated = report.entries.filter((e) => e.action !== 'cron.autoheal.heartbeat');
    expect(dated.every((e) => e.status === 'never_ran')).toBe(true);
    expect(report.entries.every((e) => e.lastRanAt === null)).toBe(true);
    expect(report.entries.every((e) => e.ageMs === null)).toBe(true);
    const autoheal = report.entries.find((e) => e.action === 'cron.autoheal.heartbeat');
    expect(autoheal?.status).toBe('pending');
    // `pending` is healthy and never escalates the masthead, but a genuine
    // `never_ran` on every other cron still surfaces the overall as never_ran.
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
   * RC#7 CRON-1 — purge-deleted now emits a unified `metadata.errors` key
   * (= materialiseErrors + purgeErrors). Before, a per-user RGPD erasure
   * failure landed only in the split `materialiseErrors`/`purgeErrors` keys
   * that health.ts never reads, so a stuck erasure stayed green forever. Pin
   * that the monitor now escalates the purge cron on a real error count.
   */
  it('escalates purge-deleted green→amber when a per-user erasure failed (RC#7 CRON-1)', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    // Ran 12h ago → green on age alone (period = 1 day).
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.purge_deleted.scan',
        _max: { createdAt: new Date(now.getTime() - 12 * HOUR) },
      },
    ]);
    // ...but a materialise/purge failed for 2 members (unified errors key).
    auditFindManyMock.mockResolvedValueOnce([
      { action: 'cron.purge_deleted.scan', metadata: { errors: 2 } },
    ]);

    const report = await getCronHealthReport(now);
    const scan = report.entries.find((e) => e.action === 'cron.purge_deleted.scan');

    expect(scan?.status).toBe('amber');
    expect(scan?.errorCount).toBe(2);
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
   * Tour 14 raised it 18 → 19 (the host autoheal watchdog heartbeat, P1-4 —
   * a self-healer nobody watches is the blind spot the worker layer had).
   */
  it('always returns exactly 19 entries (Tour 14 — added the autoheal watchdog heartbeat)', async () => {
    auditGroupByMock.mockResolvedValueOnce([]);
    const report = await getCronHealthReport();
    expect(report.entries).toHaveLength(19);
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
    // Tour 14 — host autoheal watchdog heartbeat (P1-4).
    expect(report.entries.map((e) => e.action)).toContain('cron.autoheal.heartbeat');
  });

  /**
   * Tour 14 (P1-4) — the host autoheal watchdog reports hourly on an always-on
   * host, so the tolerances are TIGHT (unlike the worker watchdog on a sleeping
   * PC): green ≤ 1.5h, amber ≤ 2h, red past 2h. A dead watchdog must go red so
   * cron-watch.yml opens the alert — the whole point of making self-healing
   * observable. A fresh row whose payload reported an escalation escalates the
   * entry green → amber via the shared metadata.errors read.
   */
  it('classifies the autoheal watchdog: fresh green, 100-min amber, 3h red', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');

    // period=1h, greenMultiplier default 1.5 → green ≤ 90min; tolerance ×2 → red past 2h.
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.autoheal.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 30 * MIN) },
      },
    ]);
    const fresh = await getCronHealthReport(now);
    expect(fresh.entries.find((e) => e.action === 'cron.autoheal.heartbeat')?.status).toBe('green');

    // 100 min: past the 90-min green boundary, under the 2h tolerance → amber.
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.autoheal.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 100 * MIN) },
      },
    ]);
    const late = await getCronHealthReport(now);
    expect(late.entries.find((e) => e.action === 'cron.autoheal.heartbeat')?.status).toBe('amber');

    // 3h: past the 2h tolerance → red (dead watchdog on an always-on host).
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.autoheal.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 3 * HOUR) },
      },
    ]);
    const dead = await getCronHealthReport(now);
    expect(dead.entries.find((e) => e.action === 'cron.autoheal.heartbeat')?.status).toBe('red');
    expect(dead.overall).toBe('red');
  });

  it('escalates a fresh autoheal heartbeat that reported an escalation to amber', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'cron.autoheal.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 20 * MIN) },
      },
    ]);
    // The route mirrors `escalations` into metadata.errors; a fresh row that
    // still had an escalation is not fully healthy.
    auditFindManyMock.mockResolvedValueOnce([
      { action: 'cron.autoheal.heartbeat', metadata: { errors: 2 } },
    ]);
    const report = await getCronHealthReport(now);
    const autoheal = report.entries.find((e) => e.action === 'cron.autoheal.heartbeat');
    expect(autoheal?.status).toBe('amber');
    expect(autoheal?.errorCount).toBe(2);
  });

  /**
   * Tour 14 — before the deploy that ships the heartbeat converges the host, no
   * row exists yet. With `expectedSince`, that absence reads `pending` (calm
   * "premier run à venir"), NOT `never_ran` — so a freshly-merged expectation
   * never drags the masthead to "Pas démarré" for the window between merge and
   * the first hourly POST.
   */
  it("classifies the autoheal watchdog as 'pending' before its first-run deadline", async () => {
    // expectedSince 2026-07-05, tolerance 2h → deadline ~2026-07-05T02:00Z.
    const now = new Date('2026-07-05T00:30:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([]);
    const report = await getCronHealthReport(now);
    const autoheal = report.entries.find((e) => e.action === 'cron.autoheal.heartbeat');
    expect(autoheal?.status).toBe('pending');
    expect(autoheal?.lastRanAt).toBeNull();
  });
});

describe('getWorkerHealthReport', () => {
  /**
   * Why this matters : the worker board is fixed to the 6 pipelines that
   * install-worker.ps1 actually registers + the tour-12 watchdog heartbeat.
   * Adding a pipeline (or renaming a slug) must force an explicit
   * WORKER_EXPECTATIONS update — and `seance.batch.pulled` must NOT appear
   * (pulled on demand, no period, an age-based status would lie).
   */
  it('returns exactly the 6 installed pipelines + watchdog, never the on-demand séances slug', async () => {
    auditGroupByMock.mockResolvedValueOnce([]);
    const report = await getWorkerHealthReport();
    expect(report.entries.map((e) => e.action)).toEqual([
      'onboarding.batch.pulled',
      'verification.batch.pulled',
      'calendar.batch.pulled',
      'weekly_report.batch.pulled',
      'monthly_debrief.batch.pulled',
      'member_profile_monthly.batch.pulled',
      'worker.watchdog.heartbeat',
    ]);
    expect(report.entries.map((e) => e.action)).not.toContain('seance.batch.pulled');
  });

  /**
   * Why this matters : a PC that is on and a worker that ticks must read
   * all-green — the operator's "everything is generating" glance.
   */
  it("returns 'green' when every pipeline pulled within 1.5× its period", async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'onboarding.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * MIN) },
      },
      {
        // Tour 13 — verification now ticks every 20 min (was daily), so a
        // healthy fixture pulls within minutes, like onboarding.
        action: 'verification.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * MIN) },
      },
      { action: 'calendar.batch.pulled', _max: { createdAt: new Date(now.getTime() - 2 * DAY) } },
      {
        action: 'weekly_report.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 2 * DAY) },
      },
      {
        action: 'monthly_debrief.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * DAY) },
      },
      {
        action: 'member_profile_monthly.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * DAY) },
      },
      {
        action: 'worker.watchdog.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 20 * MIN) },
      },
    ]);

    const report = await getWorkerHealthReport(now);

    expect(report.overall).toBe('green');
    expect(report.entries.every((e) => e.status === 'green')).toBe(true);
  });

  /**
   * Why this matters : the onboarding pipeline ticks every 20 min but its host
   * is a personal PC that sleeps at night. The status semantics are the whole
   * point of the wide tolerance — a 3h gap (evening off) must read amber/calm,
   * while a 30h gap means the task itself is broken (the PC was necessarily on
   * at some point in 24h) and must read red.
   */
  it('classifies an overnight-off PC as amber and a dead worker as red (onboarding)', async () => {
    const now = new Date('2026-07-10T08:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'onboarding.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 3 * HOUR) },
      },
    ]);
    const overnight = await getWorkerHealthReport(now);
    expect(overnight.entries.find((e) => e.action === 'onboarding.batch.pulled')?.status).toBe(
      'amber',
    );

    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'onboarding.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 30 * HOUR) },
      },
    ]);
    const dead = await getWorkerHealthReport(now);
    expect(dead.entries.find((e) => e.action === 'onboarding.batch.pulled')?.status).toBe('red');
    expect(dead.overall).toBe('red');
  });

  /**
   * Tour 12 — member_profile_monthly (J-E, day-2 batch) has never run before
   * its first scheduled occurrence (Aug 2). With `expectedSince` (install date
   * 2026-07-02) + tolerance (60d), a missing row on Jul 10 is `pending` —
   * calm "premier run à venir" — and MUST NOT drag `overall` down: the old
   * `never_ran` classification put "Pas démarré" on the masthead for a month
   * about a pipeline behaving exactly as designed.
   */
  it("classifies a pipeline whose first run is not due yet as 'pending' (not never_ran)", async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        action: 'onboarding.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * MIN) },
      },
      {
        // Tour 13 — verification now ticks every 20 min (was daily), so a
        // healthy fixture pulls within minutes, like onboarding.
        action: 'verification.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * MIN) },
      },
      { action: 'calendar.batch.pulled', _max: { createdAt: new Date(now.getTime() - 2 * DAY) } },
      {
        action: 'weekly_report.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 2 * DAY) },
      },
      {
        action: 'monthly_debrief.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * DAY) },
      },
      {
        action: 'worker.watchdog.heartbeat',
        _max: { createdAt: new Date(now.getTime() - 20 * MIN) },
      },
    ]);

    const report = await getWorkerHealthReport(now);
    const profile = report.entries.find((e) => e.action === 'member_profile_monthly.batch.pulled');

    expect(profile?.status).toBe('pending');
    expect(profile?.lastRanAt).toBeNull();
    expect(profile?.firstRunDeadline).not.toBeNull();
    // pending is healthy: with every other pipeline green, the board is green.
    expect(report.overall).toBe('green');
  });

  /**
   * Tour 12 — the flip side of `pending`: once `expectedSince + tolerance`
   * has passed with still no row, the honest status IS `never_ran` (the task
   * was installed, its first occurrence is overdue, something is broken).
   */
  it("flips pending to 'never_ran' once the first-run deadline has passed", async () => {
    // onboarding: expectedSince 2026-07-02, tolerance 24h → deadline Jul 3.
    const now = new Date('2026-07-10T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([]);

    const report = await getWorkerHealthReport(now);
    const onboarding = report.entries.find((e) => e.action === 'onboarding.batch.pulled');

    expect(onboarding?.status).toBe('never_ran');
    expect(report.overall).toBe('never_ran');
  });

  /**
   * Why this matters : the pull endpoints write `metadata.errors` like the
   * server crons do. A worker that ticks on time but fails per member must
   * escalate green → amber through the shared builder — pin that the worker
   * board inherits the escalation, not just the age check.
   */
  it('escalates a fresh pull that reported errors to amber', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    auditGroupByMock.mockResolvedValueOnce([
      {
        // Tour 13 — verification now ticks every 20 min (was daily), so a
        // healthy fixture pulls within minutes, like onboarding.
        action: 'verification.batch.pulled',
        _max: { createdAt: new Date(now.getTime() - 10 * MIN) },
      },
    ]);
    auditFindManyMock.mockResolvedValueOnce([
      { action: 'verification.batch.pulled', metadata: { errors: 3 } },
    ]);

    const report = await getWorkerHealthReport(now);
    const verification = report.entries.find((e) => e.action === 'verification.batch.pulled');

    expect(verification?.status).toBe('amber');
    expect(verification?.errorCount).toBe(3);
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

describe('getDiskHealth', () => {
  /**
   * Why this matters : the whole point of the probe is to reach RED before the
   * disk is actually full — Postgres and the backups stop together on a full
   * shared 40 GB volume. Pin the three buckets against the exact thresholds
   * (warn 5 GB, critical 2 GB) so a future threshold edit is a conscious change.
   */
  it('classifies ample free space as green (> 5 GB free)', () => {
    statfsSyncMock.mockReturnValueOnce(statfs(12, 40));
    const disk = getDiskHealth('/');

    expect(disk.status).toBe('green');
    expect(disk.freeBytes).toBe(12 * GIB);
    expect(disk.totalBytes).toBe(40 * GIB);
    // Probed the container root, not the injectable test default.
    expect(statfsSyncMock).toHaveBeenCalledWith('/');
  });

  it('classifies free space between 2 GB and 5 GB as amber', () => {
    statfsSyncMock.mockReturnValueOnce(statfs(3, 40));
    expect(getDiskHealth('/').status).toBe('amber');
  });

  it('classifies free space below the 2 GB critical floor as red', () => {
    statfsSyncMock.mockReturnValueOnce(statfs(1, 40));
    const disk = getDiskHealth('/');

    expect(disk.status).toBe('red');
    expect(disk.freeBytes).toBe(1 * GIB);
  });

  /**
   * Boundary pin: exactly 5 GB free is NOT below the warn threshold, so it
   * stays green — the classification uses strict `<`, matching preflight's
   * `-lt` comparison.
   */
  it('treats exactly 5 GB free as green (boundary is strict <)', () => {
    statfsSyncMock.mockReturnValueOnce(statfs(5, 40));
    expect(getDiskHealth('/').status).toBe('green');
  });

  /**
   * Why this matters : on an exotic platform (or a sandbox) statfsSync throws.
   * That is NOT an incident — it must degrade to `unknown` with null bytes so
   * the admin page renders a neutral note instead of red or a crashed render.
   */
  it("returns 'unknown' with null bytes when statfsSync throws", () => {
    statfsSyncMock.mockImplementationOnce(() => {
      throw new Error('ENOSYS: function not implemented, statfs');
    });
    const disk = getDiskHealth('/');

    expect(disk.status).toBe('unknown');
    expect(disk.freeBytes).toBeNull();
    expect(disk.totalBytes).toBeNull();
    // Thresholds are still echoed so the UI can explain the (absent) buckets.
    expect(disk.warnBytes).toBe(5 * GIB);
    expect(disk.criticalBytes).toBe(2 * GIB);
  });

  /**
   * Free space is `bavail × bsize` (blocks available to a non-root user), not
   * `bfree` — pin the exact arithmetic so a refactor can't silently swap the
   * field and over-report headroom that root-reserved blocks don't give us.
   */
  it('computes free/total bytes from bavail/blocks × bsize', () => {
    statfsSyncMock.mockReturnValueOnce({ bsize: 4096, blocks: 1000, bavail: 250, bfree: 300 });
    const disk = getDiskHealth('/');

    expect(disk.freeBytes).toBe(250 * 4096);
    expect(disk.totalBytes).toBe(1000 * 4096);
  });
});

describe('getVerificationBacklogHealth', () => {
  /**
   * Why this matters : with the 20-min worker, an uploaded proof should turn
   * done/failed within minutes. An EMPTY queue is the healthy steady state and
   * must read `idle` (calm), never an alarm — and never hit findFirst's data.
   */
  it("returns 'idle' with null age when nothing is pending", async () => {
    proofCountMock.mockResolvedValueOnce(0);
    proofFindFirstMock.mockResolvedValueOnce(null);

    const backlog = await getVerificationBacklogHealth(new Date('2026-07-10T12:00:00.000Z'));

    expect(backlog.status).toBe('idle');
    expect(backlog.pendingCount).toBe(0);
    expect(backlog.oldestPendingAgeMs).toBeNull();
    expect(backlog.oldestPendingAt).toBeNull();
  });

  /**
   * A fresh in-flight queue (oldest pending < 1h) is normal — the worker will
   * catch it on the next 20-min tick. Green, with the honest pending count.
   */
  it("returns 'green' when the oldest pending proof is younger than 1h", async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    proofCountMock.mockResolvedValueOnce(3);
    proofFindFirstMock.mockResolvedValueOnce({
      uploadedAt: new Date(now.getTime() - 20 * MIN),
    });

    const backlog = await getVerificationBacklogHealth(now);

    expect(backlog.status).toBe('green');
    expect(backlog.pendingCount).toBe(3);
    expect(backlog.oldestPendingAgeMs).toBe(20 * MIN);
    expect(backlog.oldestPendingAt).toBe(new Date(now.getTime() - 20 * MIN).toISOString());
  });

  /** Between 1h and 6h → amber (running late, worth an eye). */
  it("returns 'amber' when the oldest pending proof is between 1h and 6h old", async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    proofCountMock.mockResolvedValueOnce(1);
    proofFindFirstMock.mockResolvedValueOnce({ uploadedAt: new Date(now.getTime() - 2 * HOUR) });

    const backlog = await getVerificationBacklogHealth(now);
    expect(backlog.status).toBe('amber');
  });

  /**
   * Past 6h the 20-min worker would have caught it — the pipeline or the local
   * PC is stuck. Red, honestly (this is the signal the operator must act on).
   */
  it("returns 'red' when the oldest pending proof is older than 6h", async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    proofCountMock.mockResolvedValueOnce(2);
    proofFindFirstMock.mockResolvedValueOnce({ uploadedAt: new Date(now.getTime() - 7 * HOUR) });

    const backlog = await getVerificationBacklogHealth(now);
    expect(backlog.status).toBe('red');
    expect(backlog.oldestPendingAgeMs).toBe(7 * HOUR);
  });

  /**
   * Both queries are scoped to ACTIVE members (mirror the pull's own predicate)
   * and `pending` proofs only — a soft-deleted member's proof is never analysed
   * and must not redden the board. Pin the WHERE clauses.
   */
  it('scopes both queries to pending proofs of active members, oldest first', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    proofCountMock.mockResolvedValueOnce(1);
    proofFindFirstMock.mockResolvedValueOnce({ uploadedAt: new Date(now.getTime() - 30 * MIN) });

    await getVerificationBacklogHealth(now);

    expect(proofCountMock.mock.calls[0]?.[0]).toEqual({
      where: { ocrStatus: 'pending', member: { status: 'active' } },
    });
    expect(proofFindFirstMock.mock.calls[0]?.[0]).toEqual({
      where: { ocrStatus: 'pending', member: { status: 'active' } },
      orderBy: { uploadedAt: 'asc' },
      select: { uploadedAt: true },
    });
  });
});

describe('parseProcMounts', () => {
  it('parses device / mountpoint / fstype triples, ignoring the trailing dump/pass fields', () => {
    const body = [
      'overlay / overlay rw,relatime,lowerdir=/x 0 0',
      '/dev/sda1 /opt/fxmily/.uploads ext4 rw,relatime 0 0',
      '',
    ].join('\n');

    expect(parseProcMounts(body)).toEqual([
      { mountPoint: '/', fsType: 'overlay' },
      { mountPoint: '/opt/fxmily/.uploads', fsType: 'ext4' },
    ]);
  });

  it('decodes octal-escaped spaces (\\040) in mount points', () => {
    // A bind mount whose path contains a space is octal-escaped by the kernel.
    const body = 'tmpfs /mnt/with\\040space tmpfs rw 0 0';
    expect(parseProcMounts(body)).toEqual([{ mountPoint: '/mnt/with space', fsType: 'tmpfs' }]);
  });

  it('skips malformed lines with fewer than three fields', () => {
    const body = ['garbage', 'a b', '/dev/sdb /data xfs rw 0 0'].join('\n');
    expect(parseProcMounts(body)).toEqual([{ mountPoint: '/data', fsType: 'xfs' }]);
  });
});

describe('mountForPath', () => {
  const mounts = [
    { mountPoint: '/', fsType: 'overlay' },
    { mountPoint: '/opt', fsType: 'ext4' },
    { mountPoint: '/opt/fxmily/.uploads', fsType: 'xfs' },
  ];

  it('picks the LONGEST matching prefix (most specific mount wins)', () => {
    // The upload root lives under the deepest mount, not the '/' fallback.
    expect(mountForPath('/opt/fxmily/.uploads/proofs/x.png', mounts)).toEqual({
      mountPoint: '/opt/fxmily/.uploads',
      fsType: 'xfs',
    });
  });

  it('matches the mount point exactly (target === mountPoint)', () => {
    expect(mountForPath('/opt', mounts)).toEqual({ mountPoint: '/opt', fsType: 'ext4' });
  });

  it("falls back to '/' when no deeper mount covers the path", () => {
    expect(mountForPath('/app/.uploads', mounts)).toEqual({ mountPoint: '/', fsType: 'overlay' });
  });

  it('does NOT match a sibling whose name is a string-prefix but not a path-prefix', () => {
    // '/opt-backup' must not match the '/opt' mount (guards the naive
    // startsWith without a separator).
    expect(mountForPath('/opt-backup/x', mounts)).toEqual({ mountPoint: '/', fsType: 'overlay' });
  });

  it('returns null when no mount (not even /) is present', () => {
    expect(mountForPath('/x', [{ mountPoint: '/data', fsType: 'ext4' }])).toBeNull();
  });
});

describe('getUploadsPersistenceHealth', () => {
  const PROOF_PATH = '/proc/mounts';

  it("returns 'red' when the upload root is on the ephemeral overlay layer", () => {
    // No volume mounted on /app/.uploads → it falls to the overlay rootfs.
    readFileSyncMock.mockReturnValueOnce('overlay / overlay rw 0 0\n');

    const health = getUploadsPersistenceHealth(PROOF_PATH, '/app/.uploads');

    expect(health.status).toBe('red');
    expect(health.ephemeral).toBe(true);
    expect(health.fsType).toBe('overlay');
    expect(health.mountPoint).toBe('/');
    expect(health.uploadsRoot).toBe('/app/.uploads');
  });

  it("returns 'green' when the upload root is on a persistent volume", () => {
    readFileSyncMock.mockReturnValueOnce(
      ['overlay / overlay rw 0 0', '/dev/sda1 /app/.uploads ext4 rw 0 0'].join('\n'),
    );

    const health = getUploadsPersistenceHealth(PROOF_PATH, '/app/.uploads');

    expect(health.status).toBe('green');
    expect(health.ephemeral).toBe(false);
    expect(health.fsType).toBe('ext4');
    expect(health.mountPoint).toBe('/app/.uploads');
  });

  it('treats tmpfs as ephemeral (red)', () => {
    readFileSyncMock.mockReturnValueOnce(
      ['overlay / overlay rw 0 0', 'tmpfs /app/.uploads tmpfs rw 0 0'].join('\n'),
    );
    expect(getUploadsPersistenceHealth(PROOF_PATH, '/app/.uploads').status).toBe('red');
  });

  it("returns 'unknown' (neutral) when /proc/mounts cannot be read", () => {
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const health = getUploadsPersistenceHealth(PROOF_PATH, '/app/.uploads');

    expect(health.status).toBe('unknown');
    expect(health.ephemeral).toBe(false);
    expect(health.fsType).toBeNull();
    expect(health.mountPoint).toBeNull();
    // Even with no reading, the inspected root is reported for the operator.
    expect(health.uploadsRoot).toBe('/app/.uploads');
  });

  it("returns 'unknown' when the root cannot be attributed to any mount", () => {
    // A /proc/mounts with no '/' fallback and no covering mount.
    readFileSyncMock.mockReturnValueOnce('/dev/sda1 /data ext4 rw 0 0\n');

    const health = getUploadsPersistenceHealth(PROOF_PATH, '/app/.uploads');
    expect(health.status).toBe('unknown');
    expect(health.fsType).toBeNull();
  });
});
