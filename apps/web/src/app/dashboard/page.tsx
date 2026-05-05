import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, signOut } from '@/auth';

export const metadata = {
  title: 'Dashboard · Fxmily',
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const fullName = session.user.name ?? session.user.email ?? 'Membre';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/dashboard"
            aria-label="Fxmily"
            className="focus-visible:outline-accent rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Image src="/logo.png" width={40} height={40} alt="" className="rounded-md" priority />
          </Link>
          <div className="flex flex-col gap-0.5">
            <p className="text-muted text-xs uppercase tracking-widest">Tableau de bord</p>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
              Salut {fullName}
            </h1>
            <p className="text-muted text-sm">
              Rôle : <strong className="text-foreground">{session.user.role}</strong>
            </p>
          </div>
        </div>

        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="text-foreground hover:border-accent focus-visible:outline-accent min-h-11 rounded-md border border-[var(--border)] px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Se déconnecter
          </button>
        </form>
      </header>

      <section className="bg-card rounded-lg border border-[var(--border)] p-6">
        <h2 className="text-foreground text-base font-semibold">Bienvenue dans ton espace</h2>
        <p className="text-muted mt-2 text-sm">
          Le journal de trading et le suivi quotidien arrivent au prochain jalon.
        </p>
        {session.user.role === 'admin' ? (
          <Link
            href="/admin/invite"
            className="bg-primary text-primary-foreground focus-visible:outline-accent mt-4 inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Inviter un membre
          </Link>
        ) : null}
      </section>
    </main>
  );
}
