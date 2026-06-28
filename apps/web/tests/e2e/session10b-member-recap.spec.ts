/**
 * S10(b) — « Ton bilan » : le RÉCAP MEMBRE 5 AXES, E2E FONCTIONNEL.
 *
 * Prouve la couture de bout en bout : on SEED de vraies données (check-ins +
 * trades pour la progression, une réunion suivie pour la présence, un score de
 * constance) → le seam serveur `getMember5AxisRecap` les ré-agrège → la carte
 * `MemberRecapCard` rend les valeurs RÉELLES sur `/progression`. Aucun axe non
 * mesuré n'est fabriqué (la discipline, sans BehavioralScore seedé, reste cachée
 * — jamais un faux « 0 »).
 *
 * Axes prouvés au runtime (chacun seedé déterministiquement, SANS dépendre du
 * cron de scoring) :
 *   - PROGRESSION : check-ins + trades de la semaine → libellé count-only.
 *   - PRÉSENCE    : 1 réunion passée + attendance complète → « 1 sur 1 réunion ».
 *   - CONSTANCE   : ConstancyScore value=72 → « 72 / 100 ».
 *
 * Scar GG-CI (canon `s4-espace-membre-s3-surfaces`) : seed via Prisma direct
 * (`@/lib/db` + helpers purs), JAMAIS d'import `'server-only'` ; le vrai service
 * tourne dans le serveur Next rendu. Les `Meeting` sont admin-scoped (0 FK User)
 * → `cleanupTestUsers` ne les touche pas : on les nettoie par id en afterAll.
 * Skip propre si Chromium absent. Déterminisme : pas de `networkidle` superflu,
 * assertions auto-wait. chromium + mobile.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import {
  cleanupTestUsers,
  seedCheckinHistory,
  seedMemberUser,
  seedTradeHistory,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const PARIS_TZ = 'Europe/Paris';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MEMBER_EMAIL = 's10b-recap.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'S10b-Recap-Member-2026!';

let member: SeededUser | null = null;
const createdMeetingIds: string[] = [];

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run.`,
    };
  }
  return { ok: true };
}

/** Create a Meeting with `date` DERIVED from `scheduledAt` (invariant §30.7). */
async function createTestMeeting(scheduledAt: Date): Promise<string> {
  const localDate = localDateOf(scheduledAt, PARIS_TZ);
  const row = await db.meeting.create({
    data: { date: parseLocalDate(localDate), slot: 'midday', scheduledAt, status: 'scheduled' },
    select: { id: true },
  });
  createdMeetingIds.push(row.id);
  return row.id;
}

test.describe('S10(b) — récap membre 5 axes sur /progression (real DB)', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'S10bRecap',
      lastName: 'Member',
      timezone: PARIS_TZ,
    });
    // Backdate joinedAt 60d so a meeting 2 days ago sits in the rolling window
    // and the weekly slice has history to aggregate.
    await db.user.update({
      where: { id: member.id },
      data: { joinedAt: new Date(Date.now() - 60 * MS_PER_DAY) },
    });

    // PROGRESSION axis — 30d of check-ins + a handful of trades → the weekly
    // recap slice is non-null (count-only: streakDays / tradesTotal).
    await seedCheckinHistory(member.id, { days: 30, timezone: PARIS_TZ });
    await seedTradeHistory(member.id, { count: 20 });

    // PRÉSENCE axis — one past meeting in-window, member attended COMPLETE
    // (admin said nothing → adminPresent null → still counts) → 1 sur 1.
    const meetingId = await createTestMeeting(new Date(Date.now() - 2 * MS_PER_DAY));
    await db.meetingAttendance.create({
      data: {
        meetingId,
        userId: member.id,
        attendanceMode: 'live',
        contentReviewed: true,
        adminPresent: null,
      },
    });

    // CONSTANCE axis — a constancy score the recap surfaces as « 72 / 100 ».
    const monday = parseLocalDate(localDateOf(new Date(Date.now() - 1 * MS_PER_DAY), PARIS_TZ));
    await db.constancyScore.create({
      data: {
        memberId: member.id,
        value: 72,
        breakdown: { honesty: 60, regularity: 80, discipline: 76 },
        periodStart: monday,
        periodEnd: parseLocalDate(localDateOf(new Date(), PARIS_TZ)),
      },
    });
  });

  test.afterAll(async () => {
    if (createdMeetingIds.length > 0) {
      await db.meeting.deleteMany({ where: { id: { in: createdMeetingIds } } });
      createdMeetingIds.length = 0;
    }
    await cleanupTestUsers();
    member = null;
  });

  test('la carte « Ton bilan » rend les axes seedés avec les valeurs DB réelles', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000); // /progression est lourde (cold compile D:).
    if (!member) throw new Error('seed missing — beforeAll did not run');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/progression');

    // La carte récap est une region nommée par son heading (aria-labelledby).
    const recap = page.getByRole('region', { name: 'Où tu en es, sur tous tes axes' });
    await recap.scrollIntoViewIfNeeded();
    await expect(recap).toBeVisible();
    await expect(recap.getByText('Ton bilan', { exact: true })).toBeVisible();

    // PROGRESSION — l'axe est rendu (libellé count-only, jamais un P&L).
    await expect(recap.getByText('Progression', { exact: true })).toBeVisible();

    // PRÉSENCE — 1 réunion programmée, 1 suivie (complète) → « 1 sur 1 réunion ».
    await expect(recap.getByText('Présence aux réunions', { exact: true })).toBeVisible();
    await expect(recap.getByText(/1\s+sur\s+1\s+réunion/i)).toBeVisible();

    // CONSTANCE — le score seedé remonte tel quel. La valeur est un nœud-texte
    // suivi du mot-verdict (« en bonne voie ») dans le même span → regex partiel
    // scopé à la région (jamais `exact`, qui ne matcherait pas « 72 / 100<mot> »).
    await expect(recap.getByText('Constance & honnêteté', { exact: true })).toBeVisible();
    await expect(recap.getByText(/72\s*\/\s*100/)).toBeVisible();

    // Posture §2 : aucun axe non mesuré n'est fabriqué — sans BehavioralScore
    // seedé, l'axe « Discipline » est PROPREMENT absent (jamais un faux « 0 »).
    await expect(recap.getByText('Discipline', { exact: true })).toHaveCount(0);

    // Pas d'overlay d'erreur Next.
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
