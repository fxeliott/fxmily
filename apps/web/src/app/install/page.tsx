import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { auth } from '@/auth';
import { InstallGuide } from '@/components/pwa/install-guide';

export const metadata: Metadata = {
  title: "Installer l'application",
  description:
    "Ajoute Fxmily à ton écran d'accueil pour l'ouvrir en plein écran, en un geste, comme une vraie application.",
};

/**
 * `/install` — member-gated page hosting the platform-adapted install guide.
 *
 * Same session guard as `/guide` (active member, else redirect to `/login`).
 * The actual platform detection + steps live in the client `<InstallGuide>`.
 */
export default async function InstallPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Tableau de bord
        </Link>

        <InstallGuide />
      </div>
    </main>
  );
}
