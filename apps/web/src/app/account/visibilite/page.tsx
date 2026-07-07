import { ArrowLeft, Eye } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { LeaderboardVisibilityToggle } from '@/components/account/leaderboard-visibility-toggle';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { db } from '@/lib/db';

/**
 * `/account/visibilite` — leaderboard visibility (RGPD self-service).
 *
 * Server Component, auth-gated to active members. Reads the authoritative
 * `leaderboardOptOut` flag straight from the DB and hands it to the
 * `<LeaderboardVisibilityToggle>` island (which auto-saves via its Server
 * Action). Posture §2 : participating is the motivating default, opting out is
 * a calm, one-tap choice that never costs the member their own rank view.
 */

export const metadata: Metadata = {
  title: 'Visibilité au classement',
  description:
    'Choisis si ton prénom et ta photo apparaissent sur le classement des membres. Ton rang reste toujours visible pour toi.',
};
export const dynamic = 'force-dynamic';

export default async function AccountVisibilitePage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/visibilite');
  }

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { leaderboardOptOut: true },
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
            <Eye aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
            Visibilité au classement
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
            Le classement des membres se base sur le travail et la régularité, jamais sur les gains.
            Tu peux choisir d&apos;y apparaître ou de rester discret : dans tous les cas, ton propre
            rang reste visible pour toi seul.
          </p>
        </header>

        <LeaderboardVisibilityToggle initialOptOut={userRow?.leaderboardOptOut ?? false} />
      </div>
    </main>
  );
}
