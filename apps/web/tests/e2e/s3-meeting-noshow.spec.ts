/**
 * S3 §31 (vérification généralisée) — un NO-SHOW de réunion alimente la chaîne
 * anti-mensonge, prouvé EN RÉEL contre Postgres + le vrai cron.
 *
 * La spec nomme littéralement « sa présence aux réunions » (§22/§23) et exige
 * que le principe s'applique « à l'ensemble des données, pas seulement les
 * trades » (§31) : ne rien faire sans motif valable fait baisser la constance.
 * Avant ce jalon, seuls les check-ins (rituel) et les trades étaient confrontés.
 *
 * Scénario (cron POST réel → scanMeetingNoShowsForAllMembers) :
 *   - M_MISSED : réunion programmée, fenêtre de rattrapage CLOSE (-31 j), AUCUNE
 *     présence → DOIT créer une Discrepancy `meeting_missed_no_reason` liée ;
 *   - M_ATTENDED : même période, présence COMPLÈTE (replay + contenu lu) → AUCUN écart ;
 *   - M_CANCELLED : annulée (Eliott indispo) → JAMAIS d'accusation (§30.2/§33.6) ;
 *   - M_OPEN : récente (-10 j), fenêtre ENCORE OUVERTE → rattrapable, pas d'écart.
 * Puis : idempotence (2e run = 0 doublon) + le membre voit « Réunion manquée »
 * sur /verification et peut l'excuser.
 *
 * `date` est une sentinelle 2019 (jamais générée par le cron — anti-collision
 * sur @@unique(date,slot)) ; le scan ne lit QUE `scheduledAt`+`status`, donc la
 * date civile du fixture n'a aucune incidence. Nettoyé en after.
 *
 * Pré-requis (comme session10) : Postgres réel + CRON_SECRET — skip sinon.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const DAY = 24 * 60 * 60 * 1000;

function chromiumOk(): boolean {
  const exec = chromium.executablePath();
  return Boolean(exec && existsSync(exec));
}

test.describe.serial('S3 §31 — no-show réunion → écart de constance (real DB + real cron)', () => {
  let member: SeededUser | null = null;
  const cronSecret = process.env.CRON_SECRET;
  const meetingIds: string[] = [];
  let missedId = '';
  let attendedId = '';

  test.beforeAll(async () => {
    test.skip(!cronSecret, 'CRON_SECRET not configured — cannot exercise the real cron');
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'S3Meeting' });
    // Joined long before every fixture meeting → all are "expected" (the scan's
    // join-floor would otherwise exclude meetings held before the member existed).
    await db.user.update({
      where: { id: member.id },
      data: { joinedAt: new Date(Date.now() - 90 * DAY) },
    });

    const now = Date.now();
    // -31 j is inside the scan band [now−32d, now−30d) → window just closed.
    const closed = new Date(now - 31 * DAY);
    const closed2 = new Date(now - 31 * DAY + 8 * 3_600_000);
    const stillOpen = new Date(now - 10 * DAY); // window open (< 30 j) → rattrapable.

    const mk = async (
      dateSentinel: string,
      slot: 'midday' | 'evening',
      scheduledAt: Date,
      status: 'scheduled' | 'cancelled',
    ) => {
      const row = await db.meeting.create({
        data: { date: new Date(dateSentinel), slot, scheduledAt, status },
        select: { id: true },
      });
      meetingIds.push(row.id);
      return row.id;
    };

    missedId = await mk('2019-01-07T00:00:00.000Z', 'midday', closed, 'scheduled');
    attendedId = await mk('2019-01-07T00:00:00.000Z', 'evening', closed2, 'scheduled');
    const cancelledId = await mk('2019-01-08T00:00:00.000Z', 'midday', closed, 'cancelled');
    await mk('2019-01-09T00:00:00.000Z', 'midday', stillOpen, 'scheduled'); // open window
    void cancelledId;

    // Complete attendance on the attended meeting only (replay + content reviewed).
    await db.meetingAttendance.create({
      data: {
        meetingId: attendedId,
        userId: member.id,
        attendanceMode: 'replay',
        contentReviewed: true,
      },
    });
  });

  test.afterAll(async () => {
    if (meetingIds.length > 0) {
      await db.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    }
    await cleanupTestUsers();
    member = null;
  });

  test('1) le cron crée 1 écart « réunion manquée » lié, et seulement pour le vrai no-show (DB)', async ({
    request,
  }) => {
    if (!member || !cronSecret) throw new Error('precondition missing');

    const res = await request.post('/api/cron/verification-scan', {
      headers: { 'x-cron-secret': cronSecret },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      meetingNoShows: { meetingsClosed: number; discrepanciesCreated: number; errors: number };
    };
    expect(body.ok).toBe(true);
    expect(body.meetingNoShows.errors).toBe(0);

    // Exactly ONE meeting-miss discrepancy, linked to the missed meeting.
    const gaps = await db.discrepancy.findMany({
      where: { memberId: member.id, type: 'meeting_missed_no_reason' },
      select: { meetingId: true, status: true, severity: true },
    });
    expect(gaps.length, 'only the genuine no-show is flagged').toBe(1);
    expect(gaps[0]!.meetingId, 'linked to the missed meeting').toBe(missedId);
    expect(gaps[0]!.status).toBe('open');

    // The attended / cancelled / still-open meetings produced NO gap.
    const attendedGap = await db.discrepancy.count({
      where: { memberId: member.id, meetingId: attendedId },
    });
    expect(attendedGap, 'a complete attendance is never a gap').toBe(0);
  });

  test('2) idempotent — un 2e passage du cron ne duplique pas l’écart (DB)', async ({
    request,
  }) => {
    if (!member || !cronSecret) throw new Error('precondition missing');
    const res = await request.post('/api/cron/verification-scan', {
      headers: { 'x-cron-secret': cronSecret },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    const count = await db.discrepancy.count({
      where: { memberId: member.id, type: 'meeting_missed_no_reason' },
    });
    expect(count, 're-run never duplicates (member, meeting) dedup').toBe(1);
  });

  test('3) le MEMBRE voit « Réunion manquée » sur /verification et peut l’excuser (S3 → S4)', async ({
    page,
    request,
  }) => {
    test.skip(!chromiumOk(), 'Chromium not installed');
    if (!member) throw new Error('precondition missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/verification');

    const ecarts = page.getByRole('region', { name: 'Tes écarts' });
    await ecarts.scrollIntoViewIfNeeded();
    await expect(ecarts.getByText('Réunion manquée').first()).toBeVisible();
    // Calm posture §33.2 — never "vérifié à 100%", no error overlay.
    await expect(page.getByText(/vérifié à 100\s?%/i)).toHaveCount(0);
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('4) répétition — 3 no-shows non excusés → alerte psychologique (répétition only, S3 → S5)', async ({
    request,
  }) => {
    if (!member || !cronSecret) throw new Error('precondition missing');
    const closed = new Date(Date.now() - 31 * DAY); // in the scan band

    // Two MORE missed scheduled meetings (total 3 with the beforeAll one) → ≥ threshold 3.
    for (const [date, slot] of [
      ['2019-02-07T00:00:00.000Z', 'midday'],
      ['2019-02-07T00:00:00.000Z', 'evening'],
    ] as const) {
      const row = await db.meeting.create({
        data: { date: new Date(date), slot, scheduledAt: closed, status: 'scheduled' },
        select: { id: true },
      });
      meetingIds.push(row.id);
    }

    const res = await request.post('/api/cron/verification-scan', {
      headers: { 'x-cron-secret': cronSecret },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);

    const gaps = await db.discrepancy.count({
      where: { memberId: member.id, type: 'meeting_missed_no_reason' },
    });
    expect(gaps, 'three meetings missed without reason').toBe(3);

    // Repetition (≥3 in 14d) raises the alert; a single miss never would (§33.8).
    const alert = await db.alert.findFirst({
      where: { memberId: member.id, triggerType: 'meeting_missed_repeat' },
    });
    expect(alert, 'repeated no-shows must raise a discipline alert').not.toBeNull();
    expect(alert!.repeatCount).toBeGreaterThanOrEqual(3);
    // §2 firewall by construction — an alert is ALWAYS psychological, never trading advice.
    expect(alert!.category).toBe('psychological');
  });
});
