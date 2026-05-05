import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

import { InviteForm } from './invite-form';

export const metadata = {
  title: 'Inviter un membre · Fxmily Admin',
};

export default async function AdminInvitePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'admin') redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-10 px-4 py-10">
      <header className="flex items-start gap-3">
        <Link
          href="/dashboard"
          aria-label="Retour au tableau de bord"
          className="focus-visible:outline-accent rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Image src="/logo.png" width={40} height={40} alt="" className="rounded-md" priority />
        </Link>
        <div className="flex flex-col gap-1">
          <p className="text-muted text-xs uppercase tracking-widest">Admin</p>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            Inviter un membre
          </h1>
          <p className="text-muted text-sm">
            Le membre recevra un email avec un lien personnel valable 7 jours.
          </p>
        </div>
      </header>

      <InviteForm />
    </main>
  );
}
