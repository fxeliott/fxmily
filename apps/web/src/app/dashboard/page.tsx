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
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Tableau de bord</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Salut {fullName}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Rôle : <strong className="text-[var(--foreground)]">{session.user.role}</strong>
          </p>
        </div>

        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--accent)]"
          >
            Se déconnecter
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-[var(--border)] bg-[color:rgb(15_22_38)] p-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          Bienvenue dans ton espace
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Le journal de trading et le suivi quotidien arrivent au prochain jalon.
        </p>
        {session.user.role === 'admin' ? (
          <a
            href="/admin/invite"
            className="mt-4 inline-block rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            Inviter un membre
          </a>
        ) : null}
      </section>
    </main>
  );
}
