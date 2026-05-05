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
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Inviter un membre
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Le membre recevra un email avec un lien personnel valable 7 jours.
        </p>
      </header>

      <InviteForm />
    </main>
  );
}
