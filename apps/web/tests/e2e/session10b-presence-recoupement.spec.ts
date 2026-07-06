/**
 * S10 §30.8 — recoupement présence admin↔membre, E2E fonctionnel.
 *
 * Prouve la couture manquante du CONTEXTE GLOBAL : l'admin déclare la présence,
 * le membre la sienne, l'app CROISE les deux, détecte l'écart, l'intègre au
 * scoring (numérateur d'engagement honnête) et le surface des DEUX côtés.
 *
 * Phases :
 *   1. MEMBRE — over-claim (membre « complète » mais Eliott « absent ») : la note
 *      de recoupement s'affiche sur /reunions ET le taux d'assiduité NE compte
 *      PAS la complétion contredite (numérateur honnête §30.4/§30.8).
 *   2. MEMBRE — présent-non-déclaré (Eliott « présent », membre rien) : note de
 *      relance calme « confirme ta présence ».
 *   3. ADMIN — la VRAIE Server Action `markPresenceAction` persiste la présence
 *      (clic « Absent » sur /admin/members/[id]?tab=presence) → adminPresent=false
 *      en DB, puis le badge d'écart apparaît côté admin.
 *
 * Scar GG-CI (canon `v1-7-meeting-attendance-happy-path`) : les services
 * `lib/meeting/*` sont `import 'server-only'` → on seed via Prisma direct
 * (`@/lib/db`) ; le vrai service tourne dans le serveur Next rendu, pas dans le
 * runtime Playwright. Skip propre si Chromium absent.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from './fixtures';

import { db } from '@/lib/db';
import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import {
  cleanupTestUsers,
  seedAdminUser,
  seedMemberUser,
  type SeededUser,
} from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MEMBER_EMAIL = 's10b-recoupement.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'S10b-Recoup-Member-2026!';
const ADMIN_EMAIL = 's10b-recoupement.admin.e2e.test@fxmily.local';
const ADMIN_PASSWORD = 'S10b-Recoup-Admin-2026!';

let member: SeededUser | null = null;
let admin: SeededUser | null = null;
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
  const localDate = localDateOf(scheduledAt, 'Europe/Paris');
  const row = await db.meeting.create({
    data: { date: parseLocalDate(localDate), slot: 'midday', scheduledAt, status: 'scheduled' },
    select: { id: true },
  });
  createdMeetingIds.push(row.id);
  return row.id;
}

/** Seed one attendance row: member self-report + (optional) admin declaration. */
async function seedAttendance(
  meetingId: string,
  userId: string,
  data: {
    attendanceMode?: 'live' | 'replay' | null;
    contentReviewed?: boolean;
    adminPresent?: boolean | null;
  },
): Promise<void> {
  await db.meetingAttendance.create({
    data: {
      meetingId,
      userId,
      attendanceMode: data.attendanceMode ?? null,
      contentReviewed: data.contentReviewed ?? false,
      adminPresent: data.adminPresent ?? null,
    },
  });
}

test.describe('S10 §30.8 — recoupement présence admin↔membre', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'S10bRecoup',
      lastName: 'Member',
    });
    admin = await seedAdminUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstName: 'S10bRecoup',
      lastName: 'Admin',
    });
    // Backdate joinedAt 60d so a meeting 2-3 days ago is in the rolling 30d window.
    await db.user.update({
      where: { id: member.id },
      data: { joinedAt: new Date(Date.now() - 60 * MS_PER_DAY) },
    });
  });

  test.afterEach(async () => {
    // Clean meetings between tests (cascade deletes their attendances) so each
    // test sees exactly its own seeded slot — no cross-test ambiguity.
    if (createdMeetingIds.length > 0) {
      await db.meeting.deleteMany({ where: { id: { in: createdMeetingIds } } });
      createdMeetingIds.length = 0;
    }
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
    admin = null;
  });

  test('MEMBRE — over-claim: note de recoupement + taux honnête (complétion contredite non comptée)', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');
    const meetingId = await createTestMeeting(new Date(Date.now() - 2 * MS_PER_DAY));
    // Membre déclare COMPLET, Eliott marque ABSENT → écart over-claim.
    await seedAttendance(meetingId, member.id, {
      attendanceMode: 'live',
      contentReviewed: true,
      adminPresent: false,
    });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/reunions');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/reunions/);
    // Recoupement surfacé calmement (jamais rouge accusateur).
    await expect(page.getByText(/noté absent à cette réunion/i)).toBeVisible();
    // Numérateur honnête : 1 réunion programmée, 0 comptée (over-claim retiré).
    await expect(page.getByText(/0\s*\/\s*1\s*réunion/i)).toBeVisible();
    // Pas d'overlay d'erreur Next.
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('MEMBRE — présent-non-déclaré: relance calme « confirme ta présence »', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');
    const meetingId = await createTestMeeting(new Date(Date.now() - 2 * MS_PER_DAY));
    // Eliott marque PRÉSENT, le membre n'a rien déclaré.
    await seedAttendance(meetingId, member.id, { adminPresent: true });

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);
    await page.goto('/reunions');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/noté présent/i)).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('ADMIN — markPresenceAction persiste la présence + badge d’écart (Server Action réelle)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000); // /admin/members/[id] est une page lourde (cold compile D:).
    if (!member || !admin) throw new Error('seed missing');
    const meetingId = await createTestMeeting(new Date(Date.now() - 3 * MS_PER_DAY));
    // Membre a déclaré COMPLET ; Eliott n'a encore rien marqué (adminPresent null).
    await seedAttendance(meetingId, member.id, {
      attendanceMode: 'live',
      contentReviewed: true,
      adminPresent: null,
    });

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);
    await page.goto(`/admin/members/${member.id}?tab=presence`);
    await page.waitForLoadState('networkidle');

    // Le contrôle de marquage est rendu ; un seul créneau → un seul bouton « Absent ».
    const absentBtn = page.getByRole('button', { name: 'Absent' });
    await expect(absentBtn).toBeVisible();
    await absentBtn.click();

    // La VRAIE Server Action a persisté la déclaration admin = absent.
    await expect
      .poll(
        async () => {
          const row = await db.meetingAttendance.findUnique({
            where: { meetingId_userId: { meetingId, userId: member!.id } },
            select: { adminPresent: true },
          });
          return row?.adminPresent;
        },
        { timeout: 15_000, message: 'adminPresent should become false after markPresenceAction' },
      )
      .toBe(false);

    // Après revalidation, l'écart admin↔membre s'affiche côté admin.
    await expect(page.getByText(/Écart/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });

  test('ADMIN — /admin/health (S10a) rend la chaîne métier contre la vraie DB', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000); // page lourde + loader cohorte (cold compile D:).
    if (!admin) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, admin.email, admin.password);
    await page.goto('/admin/health');
    await page.waitForLoadState('networkidle');

    // Le loader getSystemHealthOverview a tourné sans erreur → titre + 4 sections.
    await expect(page.getByRole('heading', { name: 'La chaîne tourne' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chaîne de remplissage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Honnêteté & écarts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Présence réunions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mouvements de score' })).toBeVisible();
    // Lien croisé vers l'infra (séparation OPS/métier).
    await expect(page.getByRole('link', { name: /heartbeats des crons/i })).toBeVisible();
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
