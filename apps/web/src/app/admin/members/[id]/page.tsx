import { ArrowLeft, Mail, Shield, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberTabs, type MemberTabKey } from '@/components/admin/member-tabs';
import { MemberAdminNotesPanel } from '@/components/admin/member-admin-notes-panel';
import { MemberDouglasPanel } from '@/components/admin/member-douglas-panel';
import { MemberTradesList } from '@/components/admin/member-trades-list';
import { MemberWeeklyReportsPanel } from '@/components/admin/member-weekly-reports-panel';
import { listReportsForMember } from '@/lib/weekly-report/service';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { ScoreGaugeGrid } from '@/components/scoring/score-gauge-grid';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { listAdminNotesForMember } from '@/lib/admin/admin-notes-service';
import { aggregateMemberDeliveryStats, listMemberDeliveries } from '@/lib/admin/cards-service';
import { MemberNotFoundError, getMemberDetail } from '@/lib/admin/members-service';
import { listMemberTradesAsAdmin } from '@/lib/admin/trades-service';
import { logAudit } from '@/lib/auth/audit';
import { getDashboardAnalytics } from '@/lib/scoring/dashboard-data';
import { getLatestBehavioralScore, type SerializedBehavioralScore } from '@/lib/scoring/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Profil membre · Fxmily Admin',
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

function parseTab(
  value: string | undefined,
): Extract<MemberTabKey, 'overview' | 'trades' | 'mark-douglas' | 'weekly-reports' | 'notes'> {
  if (value === 'trades') return 'trades';
  if (value === 'mark-douglas') return 'mark-douglas';
  if (value === 'weekly-reports') return 'weekly-reports';
  if (value === 'notes') return 'notes';
  return 'overview';
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

  const trades =
    tab === 'trades' ? await listMemberTradesAsAdmin(memberId, { status: 'all' }) : null;

  const douglasData =
    tab === 'mark-douglas'
      ? await Promise.all([
          listMemberDeliveries(memberId, { take: 30 }),
          aggregateMemberDeliveryStats(memberId),
        ])
      : null;

  const weeklyReports = tab === 'weekly-reports' ? await listReportsForMember(memberId, 12) : null;

  const adminNotes = tab === 'notes' ? await listAdminNotesForMember(memberId) : null;

  // J6.5 — pull behavioral scores + analytics in parallel for the overview tab.
  // Skipped on the trades tab to keep its render path lean. J6.6 H1 fix —
  // `detail.timezone` already contains the value (added to MemberDetail), so
  // we no longer need a separate `findUnique` round-trip here.
  const memberTimezone = detail.timezone;
  const [latestScore, analytics] =
    tab === 'overview'
      ? await Promise.all([
          getLatestBehavioralScore(memberId),
          getDashboardAnalytics(memberId, memberTimezone, '30d'),
        ])
      : [null, null];

  await logAudit({
    action: 'admin.member.viewed',
    userId: session.user.id,
    metadata: { memberId, tab },
  });

  // Generate avatar initials + deterministic hue from email hash
  const initials =
    detail.displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || 'M';
  let hue = 0;
  for (let i = 0; i < detail.email.length; i++) {
    hue = (hue * 31 + detail.email.charCodeAt(i)) % 360;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      {/* Back link */}
      <Link
        href="/admin/members"
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Membres
      </Link>

      {/* Hero header card */}
      <Card primary className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Avatar with initials + deterministic hash gradient */}
          <div
            className="rounded-card grid h-16 w-16 shrink-0 place-items-center border border-[var(--b-strong)] text-[20px] font-semibold text-[var(--t-1)]"
            style={{
              background: `linear-gradient(135deg, hsl(${hue}, 28%, 28%), hsl(${(hue + 30) % 360}, 28%, 18%))`,
            }}
            aria-hidden
          >
            {initials}
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className="f-display h-rise text-[24px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[28px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                {detail.displayName}
              </h1>
              {detail.role === 'admin' ? (
                <Pill tone="acc">
                  <Shield className="h-2.5 w-2.5" strokeWidth={2} />
                  ADMIN
                </Pill>
              ) : null}
              {detail.status === 'suspended' ? (
                <Pill tone="warn">
                  <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2} />
                  SUSPENDU
                </Pill>
              ) : null}
            </div>
            <p className="t-body inline-flex items-center gap-1.5 font-mono text-[var(--t-2)] tabular-nums">
              <Mail className="h-3.5 w-3.5 text-[var(--t-4)]" strokeWidth={1.75} />
              {detail.email}
            </p>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <MemberTabs memberId={memberId} active={tab} />

      {/* Content */}
      {tab === 'overview' ? (
        <OverviewTab detail={detail} latestScore={latestScore} analytics={analytics} />
      ) : null}
      {tab === 'trades' && trades ? <MemberTradesList memberId={memberId} trades={trades} /> : null}
      {tab === 'mark-douglas' && douglasData ? (
        <MemberDouglasPanel deliveries={douglasData[0]} stats={douglasData[1]} />
      ) : null}
      {tab === 'weekly-reports' && weeklyReports !== null ? (
        <MemberWeeklyReportsPanel reports={weeklyReports} />
      ) : null}
      {tab === 'notes' && adminNotes !== null ? (
        <MemberAdminNotesPanel memberId={memberId} notes={adminNotes} />
      ) : null}
    </main>
  );
}

function OverviewTab({
  detail,
  latestScore,
  analytics,
}: {
  detail: Awaited<ReturnType<typeof getMemberDetail>>;
  latestScore: SerializedBehavioralScore | null;
  analytics: Awaited<ReturnType<typeof getDashboardAnalytics>> | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 6 metrics grid */}
      <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-3">
        <Metric label="Trades total" value={detail.tradesCount} />
        <Metric
          label="En cours"
          value={detail.tradesOpenCount}
          tone={detail.tradesOpenCount > 0 ? 'warn' : 'mute'}
        />
        <Metric
          label="Clôturés"
          value={detail.tradesClosedCount}
          tone={detail.tradesClosedCount > 0 ? 'ok' : 'mute'}
        />
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

      {/* J6.5 — Behavioral scores (admin read-only view) */}
      <ScoreGaugeGrid score={latestScore} />

      {/* J6.5 — Edge + survie cards */}
      {analytics && analytics.closedCount > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <ExpectancyCard expectancy={analytics.expectancy} />
          <DrawdownStreaksCard
            drawdown={analytics.drawdown}
            observedMaxLoss={analytics.streaks.observedMaxLoss}
            observedMaxWin={analytics.streaks.observedMaxWin}
          />
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  mono,
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'mute' | 'ok' | 'warn';
  mono?: boolean;
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'mute'
          ? 'text-[var(--t-3)]'
          : 'text-[var(--t-1)]';

  return (
    <div className="flex flex-col gap-1 border-r border-b border-[var(--b-default)] p-4 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 [&:nth-child(2)]:border-b-0 sm:[&:nth-child(2)]:border-r [&:nth-child(3)]:border-r-0 sm:[&:nth-child(3)]:border-r-0 sm:[&:nth-child(3)]:border-b [&:nth-child(4)]:border-b-0 sm:[&:nth-child(4)]:border-r [&:nth-child(5)]:border-r [&:nth-child(5)]:border-b-0 [&:nth-child(6)]:border-r-0 [&:nth-child(6)]:border-b-0">
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          mono
            ? 'f-mono text-[13px] tabular-nums'
            : 'f-mono text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          valColor,
        )}
      >
        {value}
      </span>
    </div>
  );
}
