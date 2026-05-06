import { ArrowLeft, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberRow } from '@/components/admin/member-row';
import { Btn, btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listMembersForAdmin } from '@/lib/admin/members-service';
import { logAudit } from '@/lib/auth/audit';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Membres · Fxmily Admin',
};

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const members = await listMembersForAdmin();

  await logAudit({
    action: 'admin.members.listed',
    userId: session.user.id,
    metadata: { count: members.length },
  });

  const totalActive = members.filter((m) => m.status === 'active').length;
  const totalSuspended = members.filter((m) => m.status === 'suspended').length;
  const totalTradesAcrossMembers = members.reduce((s, m) => s + (m.tradesCount ?? 0), 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Pill tone="acc">ADMIN</Pill>
              <span className="t-eyebrow">Cohorte privée</span>
            </div>
            <h1
              className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Membres
            </h1>
          </div>

          <Link href="/admin/invite" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Inviter un membre
          </Link>
        </div>

        {/* Top stats strip */}
        <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-4">
          <StatCell
            label="Total"
            value={members.length}
            hint={members.length > 0 ? 'membres' : 'aucun encore'}
          />
          <StatCell
            label="Actifs"
            value={totalActive}
            hint="connectés"
            tone={totalActive > 0 ? 'ok' : 'mute'}
          />
          <StatCell
            label="Suspendus"
            value={totalSuspended}
            hint={totalSuspended > 0 ? 'à revoir' : '—'}
            tone={totalSuspended > 0 ? 'bad' : 'mute'}
          />
          <StatCell
            label="Trades cumulés"
            value={totalTradesAcrossMembers}
            hint="tous membres"
            tone={totalTradesAcrossMembers > 0 ? 'acc' : 'mute'}
          />
        </div>
      </header>

      {members.length === 0 ? (
        <Card primary className="py-2">
          <EmptyState
            icon={Users}
            headline="Pas encore de membres."
            lead="La cohorte se construit à l'invitation. Chaque membre actif peut activer un trader qu'il connaît."
            guides={[
              'Vérifie que l&apos;email du futur membre est correct.',
              'Le lien expire après 7 jours, il est unique et ne peut servir qu&apos;une fois.',
              'Tu peux inviter à nouveau quelqu&apos;un dont l&apos;invitation a expiré.',
            ]}
            tip="Cohorte privée = qualité &gt; quantité. Mieux vaut 30 traders sérieux que 300 curieux."
            ctaPrimary={
              <>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Envoyer la première invitation
              </>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} />
            </li>
          ))}
        </ul>
      )}

      {members.length === 0 ? (
        <div className="flex justify-center">
          <Link href="/admin/invite">
            <Btn kind="primary" size="m">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Envoyer la première invitation
            </Btn>
          </Link>
        </div>
      ) : null}
    </main>
  );
}

function StatCell({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'mute' | 'ok' | 'warn' | 'bad' | 'acc';
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'bad'
          ? 'text-[var(--bad)]'
          : tone === 'acc'
            ? 'text-[var(--acc)]'
            : tone === 'mute'
              ? 'text-[var(--t-3)]'
              : 'text-[var(--t-1)]';

  return (
    <div className="flex flex-col gap-1 border-b border-r border-[var(--b-default)] p-4 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r">
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          'f-mono text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
          valColor,
        )}
      >
        {value}
      </span>
      {hint ? <span className="t-mono-cap">{hint}</span> : null}
    </div>
  );
}
