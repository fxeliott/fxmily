import { ArrowLeft, Globe2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TimezoneSelect } from '@/components/account/timezone-select';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { db } from '@/lib/db';
import { buildTimezoneOptionGroups } from '@/lib/timezones';

/**
 * `/account/timezone` — F2 member timezone settings.
 *
 * Server Component, auth-gated to active members. Reads the CURRENT timezone
 * straight from the DB (authoritative — independent of any session staleness)
 * and builds the grouped IANA option list at the current instant (so offsets
 * reflect today's DST). The interactive picker is the `<TimezoneSelect>`
 * island, which auto-saves via `updateTimezoneAction`.
 */

export const metadata: Metadata = {
  title: 'Fuseau horaire',
  description:
    'Choisis ton fuseau horaire : tout ton espace Fxmily (check-ins, rappels, dates) s’adapte à l’heure de là où tu vis.',
};
export const dynamic = 'force-dynamic';

export default async function AccountTimezonePage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/timezone');
  }

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { timezone: true },
  });
  const currentTimezone = userRow?.timezone ?? 'Europe/Paris';
  const groups = buildTimezoneOptionGroups(new Date());

  return (
    <main className="relative bg-[var(--bg)]">
      {/* S19.1 ambient anti-fade backplate (decorative, -z-10, reduced-motion-safe). */}
      <DashboardAmbient />
      <div className="dash-stagger relative mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 lg:px-8">
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
            <Globe2 aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
            Fuseau horaire
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
            Fxmily s’adapte à l’heure de là où tu vis. Choisis ton fuseau : tes check-ins du matin
            et du soir, tes rappels et toutes les dates de ton espace suivront ton heure locale, pas
            celle de Paris.
          </p>
        </header>

        <section className="mb-8 space-y-3">
          <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
            Mon fuseau
          </h2>
          <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
            <TimezoneSelect initialTimezone={currentTimezone} groups={groups} />
          </div>
        </section>

        <section className="mb-8 space-y-3">
          <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
            Comment ça marche
          </h2>
          <div className="rounded-card space-y-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 text-sm text-[var(--t-2)]">
            <p>
              <strong className="text-[var(--t-1)]">Ton heure, partout.</strong> Le jour de tes
              check-ins, l’heure de tes rappels et l’affichage des dates suivent le fuseau choisi
              ici.
            </p>
            <p>
              <strong className="text-[var(--t-1)]">
                Les réunions restent à l’heure de Paris.
              </strong>{' '}
              Ce sont des rendez-vous communs en direct : leur horaire est le même pour tout le
              monde (heure française).
            </p>
            <p>
              <strong className="text-[var(--t-1)]">Modifiable à tout moment.</strong> Le changement
              s’applique immédiatement, sans avoir à te reconnecter.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
