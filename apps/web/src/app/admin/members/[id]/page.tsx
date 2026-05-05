import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberTabs, type MemberTabKey } from '@/components/admin/member-tabs';
import { MemberTradesList } from '@/components/admin/member-trades-list';
import { logAudit } from '@/lib/auth/audit';
import { MemberNotFoundError, getMemberDetail } from '@/lib/admin/members-service';
import { listMemberTradesAsAdmin } from '@/lib/admin/trades-service';

export const metadata = {
  title: 'Profil membre',
};

export const dynamic = 'force-dynamic';

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface DetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

function parseTab(value: string | undefined): Extract<MemberTabKey, 'overview' | 'trades'> {
  return value === 'trades' ? 'trades' : 'overview';
}

export default async function AdminMemberDetailPage({ params, searchParams }: DetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id: memberId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);

  let detail;
  try {
    detail = await getMemberDetail(memberId);
  } catch (err) {
    if (err instanceof MemberNotFoundError) notFound();
    throw err;
  }

  // Pre-load the trades list when the active tab needs them, to keep the
  // page render single-pass. Overview shows a snapshot count; trades tab
  // shows the full list.
  const trades =
    tab === 'trades' ? await listMemberTradesAsAdmin(memberId, { status: 'all' }) : null;

  await logAudit({
    action: 'admin.member.viewed',
    userId: session.user.id,
    metadata: { memberId, tab },
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/admin/members"
          className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Membres
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            {detail.displayName}
          </h1>
          {detail.role === 'admin' ? (
            <span className="border-accent/40 text-accent inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider">
              Admin
            </span>
          ) : null}
          {detail.status === 'suspended' ? (
            <span className="border-warning/40 text-warning inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider">
              Suspendu
            </span>
          ) : null}
        </div>
        <p className="text-muted text-sm">{detail.email}</p>
      </header>

      <MemberTabs memberId={memberId} active={tab} />

      {tab === 'overview' ? <OverviewTab detail={detail} /> : null}
      {tab === 'trades' && trades ? <MemberTradesList memberId={memberId} trades={trades} /> : null}
    </main>
  );
}

function OverviewTab({ detail }: { detail: Awaited<ReturnType<typeof getMemberDetail>> }) {
  return (
    <section className="bg-card flex flex-col gap-4 rounded-lg border border-[var(--border)] p-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Metric label="Trades total" value={detail.tradesCount} />
        <Metric label="Trades ouverts" value={detail.tradesOpenCount} tone="warning-if-positive" />
        <Metric label="Trades clôturés" value={detail.tradesClosedCount} />
        <Metric label="Inscrit le" value={DATETIME_FMT.format(new Date(detail.joinedAt))} mono />
        <Metric
          label="Dernière connexion"
          value={detail.lastSeenAt ? DATETIME_FMT.format(new Date(detail.lastSeenAt)) : '—'}
          mono
        />
        <Metric
          label="Dernier trade"
          value={detail.lastTradeAt ? DATETIME_FMT.format(new Date(detail.lastTradeAt)) : '—'}
          mono
        />
      </div>

      <p className="text-muted text-xs">
        Les onglets <strong>Check-ins</strong>, <strong>Mark Douglas</strong> et{' '}
        <strong>Notes admin</strong> arrivent dans les prochains jalons (J3.5 / J5 / J7).
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: number | string;
  tone?: 'warning-if-positive';
  mono?: boolean;
}) {
  const numericValue = typeof value === 'number' ? value : null;
  const toneClass =
    tone === 'warning-if-positive' && numericValue !== null && numericValue > 0
      ? 'text-warning'
      : 'text-foreground';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted text-xs">{label}</dt>
      <dd
        className={[
          'text-base tabular-nums',
          mono ? 'font-mono text-sm' : 'font-semibold',
          toneClass,
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
