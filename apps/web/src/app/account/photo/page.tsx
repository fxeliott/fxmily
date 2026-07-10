import { ArrowLeft, Trophy, UserCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AvatarSettings } from '@/components/account/avatar-settings';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { avatarUrlOf, initialsOf } from '@/lib/avatar/read-url';
import { db } from '@/lib/db';

/**
 * `/account/photo` — member profile-photo settings.
 *
 * Server Component, auth-gated to active members. Reads the CURRENT avatar
 * straight from the DB (authoritative) and hands the interactive upload/remove
 * to the `<AvatarSettings>` island, which talks to `/api/account/avatar`. The
 * photo is the same one shown on the leaderboard (face + first name), so the
 * copy makes that link explicit.
 */

export const metadata: Metadata = {
  title: 'Photo de profil',
  description:
    'Ajoute ou change ta photo de profil Fxmily. Elle apparaît sur le classement des membres, à côté de ton prénom.',
};
export const dynamic = 'force-dynamic';

export default async function AccountPhotoPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/photo');
  }

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, avatarKey: true, image: true },
  });

  const url = avatarUrlOf(userRow?.avatarKey ?? null, userRow?.image ?? null);
  const initials = initialsOf(userRow?.firstName ?? null, userRow?.lastName ?? null);
  const firstName = userRow?.firstName?.trim() || 'Membre';

  return (
    <main className="relative bg-[var(--bg)]">
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
            <UserCircle aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
            Photo de profil
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
            Mets un visage sur ton prénom. Ta photo apparaît sur le classement des membres et aide
            la communauté à se reconnaître. Tu peux la changer ou la retirer quand tu veux.
          </p>
        </header>

        <section className="mb-8 space-y-3">
          <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
            Ma photo
          </h2>
          <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5">
            <AvatarSettings initialUrl={url} initials={initials} firstName={firstName} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
            Où elle apparaît
          </h2>
          <Link
            href="/classement"
            className="rounded-card group flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
            >
              <Trophy className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-sm text-[var(--t-2)]">
              Sur le <span className="font-medium text-[var(--t-1)]">classement des membres</span>,
              à côté de ton prénom et de ton rang.
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
