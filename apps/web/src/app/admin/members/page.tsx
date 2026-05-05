import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberRow } from '@/components/admin/member-row';
import { logAudit } from '@/lib/auth/audit';
import { listMembersForAdmin } from '@/lib/admin/members-service';

export const metadata = {
  title: 'Membres',
};

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const members = await listMembersForAdmin();

  // Best-effort audit, never blocks the page render.
  await logAudit({
    action: 'admin.members.listed',
    userId: session.user.id,
    metadata: { count: members.length },
  });

  const totalActive = members.filter((m) => m.status === 'active').length;
  const totalSuspended = members.filter((m) => m.status === 'suspended').length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Tableau de bord
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-muted text-xs uppercase tracking-widest">Admin</p>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
              Membres
            </h1>
          </div>
          <Link
            href="/admin/invite"
            className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            + Inviter un membre
          </Link>
        </div>
        <p className="text-muted text-sm tabular-nums">
          {members.length} membre{members.length > 1 ? 's' : ''} · {totalActive} actif
          {totalActive > 1 ? 's' : ''}
          {totalSuspended > 0
            ? ` · ${totalSuspended} suspendu${totalSuspended > 1 ? 's' : ''}`
            : ''}
        </p>
      </header>

      {members.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] px-6 py-12 text-center">
          <p className="text-foreground text-sm">Aucun membre pour l&apos;instant.</p>
          <Link
            href="/admin/invite"
            className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Envoyer la première invitation
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
