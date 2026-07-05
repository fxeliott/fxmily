import { ArrowLeft, CalendarOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { OffDaysManager, type UpcomingOffDay } from '@/components/account/off-days-manager';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

/**
 * `/account/rythme` — Tour 14 off-day (jour off) settings.
 *
 * Server Component, auth-gated to active members. Reads the authoritative
 * `weekendsOff` flag + the member's upcoming explicitly-declared off days
 * straight from the DB, formats the day labels in the member's timezone, and
 * hands them to the `<OffDaysManager>` island (which auto-saves via the off-day
 * Server Actions). Posture pont (SPEC §31.2) : an off day is a CHOICE of
 * process, never a lack — nothing here is punitive or red.
 */

export const metadata: Metadata = {
  title: 'Mon rythme',
  description:
    'Règle tes jours off : week-ends off par défaut et absences posées (vacances). Ces jours ne comptent jamais comme un check-in manqué.',
};
export const dynamic = 'force-dynamic';

export default async function AccountRythmePage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/rythme');
  }
  const timezone = session.user.timezone || 'Europe/Paris';
  const todayLocal = localDateOf(new Date(), timezone);

  // Authoritative reads: the weekend flag + the upcoming declared off days
  // (today onward, chronological). The @db.Date column is UTC-midnight-pinned,
  // so it filters cleanly against `parseLocalDate(todayLocal)`.
  const [userRow, offRows] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { weekendsOff: true },
    }),
    db.memberOffDay.findMany({
      where: { userId: session.user.id, date: { gte: parseLocalDate(todayLocal) } },
      select: { date: true, reason: true },
      orderBy: { date: 'asc' },
      take: 60,
    }),
  ]);

  // Format each day label in French from the UTC-midnight civil date (no tz
  // shift: the pinned date IS the civil day). `timeZone: 'UTC'` keeps the label
  // on the stored calendar day.
  const dateLabelFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const initialUpcoming: UpcomingOffDay[] = offRows.map((row) => {
    const iso = row.date.toISOString().slice(0, 10);
    return { date: iso, label: dateLabelFmt.format(row.date), reason: row.reason };
  });

  return (
    <main className="relative bg-[var(--bg)]">
      {/* S19.1 ambient anti-fade backplate (decorative, -z-10, reduced-motion-safe). */}
      <DashboardAmbient />
      <div className="page-stagger relative mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 lg:px-8">
        <header className="mb-6">
          <Link
            href="/account"
            className={btnVariants({ kind: 'ghost', size: 'm' })}
            aria-label="Retour à mon compte"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Mon compte
          </Link>
          <p className="t-eyebrow mt-4 text-[var(--acc-hi)]">Compte</p>
          <h1 className="t-h1 mt-1 flex items-center gap-3 text-[var(--t-1)]">
            <CalendarOff aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
            Mon rythme
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
            Un jour off est un choix, jamais un manque. Décide si tes week-ends comptent comme des
            jours off et pose tes absences à l’avance : ces jours ne comptent pas comme un check-in
            manqué et ne cassent pas ta série.
          </p>
        </header>

        <OffDaysManager
          initialWeekendsOff={userRow?.weekendsOff ?? true}
          initialUpcoming={initialUpcoming}
          todayLocal={todayLocal}
        />
      </div>
    </main>
  );
}
