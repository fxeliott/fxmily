import { ChevronRight, Mail, MailWarning, MailX, Shield, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MemberTabs, MEMBER_TAB_LABEL, type MemberTabKey } from '@/components/admin/member-tabs';
import { MemberAdminNotesPanel } from '@/components/admin/member-admin-notes-panel';
import { MemberDouglasPanel } from '@/components/admin/member-douglas-panel';
import { MemberCorrectionsFollowupPanel } from '@/components/admin/member-corrections-followup-panel';
import { listAnnotationObjectivesForMember } from '@/lib/coaching/micro-objective';
import { MemberTradesList } from '@/components/admin/member-trades-list';
import { MemberCheckinsPanel } from '@/components/admin/member-checkins-panel';
import { MemberOffDaysPanel } from '@/components/admin/member-off-days-panel';
import { getOffDaySet, isOffDay } from '@/lib/checkin/off-days';
import { getMemberOffDayAdminSummary } from '@/lib/checkin/off-days-admin';
import { listMemberCheckinsAsAdmin } from '@/lib/checkin/service';
import { PreTradeAnalyticsCard } from '@/components/pre-trade/pre-trade-analytics-card';
import { PreTradeCorrelationCard } from '@/components/pre-trade/pre-trade-correlation-card';
import { MemberTrainingPanel } from '@/components/admin/member-training-panel';
import { MemberTrainingSessionsPanel } from '@/components/admin/member-training-sessions-panel';
import {
  MemberTrainingDebriefsPanel,
  type MemberTrainingDebriefItem,
} from '@/components/admin/member-training-debriefs-panel';
import { MemberWeeklyReportsPanel } from '@/components/admin/member-weekly-reports-panel';
import { MemberMonthlyDebriefsPanel } from '@/components/admin/member-monthly-debriefs-panel';
import { MemberMindsetChecksPanel } from '@/components/admin/member-mindset-checks-panel';
import { listReportsForMember } from '@/lib/weekly-report/service';
import { listMonthlyDebriefsForMember } from '@/lib/monthly-debrief/service';
import { listMeetingAttendanceForMember } from '@/lib/meeting/service';
import { MemberPresencePanel } from '@/components/admin/member-presence-panel';
import { MemberVerificationPanel } from '@/components/admin/member-verification-panel';
import { MemberModerationPanel } from '@/components/admin/member-moderation-panel';
import { listModerationHistory } from '@/lib/admin/member-moderation';
import { getLatestConstancyScore, listRecentConstancyScores } from '@/lib/verification/constancy';
import { getVerificationOverview, listDiscrepancies } from '@/lib/verification/service';
import { db } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/suppression';
import { loadMindsetDashboardData } from '@/lib/mindset/service';
import { currentParisWeekStart } from '@/lib/mindset/week';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { ScoreGaugeGrid } from '@/components/scoring/score-gauge-grid';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { listAdminNotesForMember } from '@/lib/admin/admin-notes-service';
import { countUnseenAnnotationsByMember } from '@/lib/admin/annotations-service';
import { aggregateMemberDeliveryStats, listMemberDeliveries } from '@/lib/admin/cards-service';
import { MemberNotFoundError, getMemberDetail } from '@/lib/admin/members-service';
import { getMembersAttention, isMemberDisengaged } from '@/lib/admin/attention-service';
import { MemberSynthesisBanner } from '@/components/admin/member-synthesis-banner';
import { listMemberTradesAsAdmin } from '@/lib/admin/trades-service';
import {
  listTrainingTradesAsAdmin,
  countTrainingTradesAsAdmin,
} from '@/lib/training/training-trade-admin-service';
import { listTrainingSessionsAsAdmin } from '@/lib/training/training-session-admin-service';
import { countTrainingAnnotationsByMember } from '@/lib/admin/training-annotation-service';
import { getProfileForUser, getInterviewForUser } from '@/lib/onboarding-interview/service';
import { MemberProfileViewerAdmin } from '@/components/admin/member-profile-viewer-admin';
import { listMonthlyReprofileSnapshotsForMember } from '@/lib/member-profile-monthly/admin-service';
import { MemberMonthlyProfileTrajectoryPanel } from '@/components/admin/member-monthly-profile-trajectory-panel';
import { getLatestCalendarForUser } from '@/lib/calendar/service';
import { MemberCalendarPanel } from '@/components/admin/member-calendar-panel';
import {
  listTrainingDebriefsForMember,
  loadTrainingDebriefStatsForWeeks,
} from '@/lib/training-debrief/service';
import { logAudit } from '@/lib/auth/audit';
import { getDashboardAnalytics } from '@/lib/scoring/dashboard-data';
import { getLatestBehavioralScore, type SerializedBehavioralScore } from '@/lib/scoring/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Profil membre · Admin',
};

export const dynamic = 'force-dynamic';

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface DetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string }>;
}

/**
 * Trade ids are cuids — reject anything else BEFORE it reaches the Prisma
 * cursor (a forged `?cursor=` must degrade to page 1, never to a 500). Mirror
 * of `journal/page.tsx:parseCursor`.
 */
function parseCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

function parseTab(
  value: string | undefined,
): Extract<
  MemberTabKey,
  | 'overview'
  | 'trades'
  | 'training'
  | 'checkins'
  | 'off-days'
  | 'pretrade'
  | 'mark-douglas'
  | 'weekly-reports'
  | 'monthly-debrief'
  | 'mindset'
  | 'calendar'
  | 'profile'
  | 'trajectoire'
  | 'presence'
  | 'verification'
  | 'notes'
  | 'moderation'
> {
  if (value === 'trades') return 'trades';
  if (value === 'training') return 'training';
  if (value === 'checkins') return 'checkins';
  if (value === 'off-days') return 'off-days';
  if (value === 'pretrade') return 'pretrade';
  if (value === 'mark-douglas') return 'mark-douglas';
  if (value === 'weekly-reports') return 'weekly-reports';
  if (value === 'monthly-debrief') return 'monthly-debrief';
  if (value === 'mindset') return 'mindset';
  if (value === 'calendar') return 'calendar';
  if (value === 'profile') return 'profile';
  if (value === 'trajectoire') return 'trajectoire';
  if (value === 'presence') return 'presence';
  if (value === 'verification') return 'verification';
  if (value === 'notes') return 'notes';
  if (value === 'moderation') return 'moderation';
  return 'overview';
}

export default async function AdminMemberDetailPage({ params, searchParams }: DetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id: memberId } = await params;
  const { tab: rawTab, cursor: rawCursor } = await searchParams;
  const tab = parseTab(rawTab);
  // Shared `?cursor=` param — only one of the two paginated tabs (trades /
  // training) is ever active at a time, so they cannot collide.
  const cursor = tab === 'trades' || tab === 'training' ? parseCursor(rawCursor) : undefined;

  let detail;
  try {
    detail = await getMemberDetail(memberId);
  } catch (err) {
    if (err instanceof MemberNotFoundError) notFound();
    throw err;
  }

  // Tour 11 (chantier G, FINDING 1) — hero rollup : how many of this member's
  // admin corrections are still unread. The unseen pill existed only per-trade,
  // forcing the coach to open every trade to know if a reframe landed. Fetched
  // unconditionally (the hero shows on every tab); a single indexed count.
  const unseenCorrections = await countUnseenAnnotationsByMember(memberId);

  // J2 — is this member's email on the suppression list (hard bounce / spam
  // complaint) ? If so, Resend refuses to re-send to it and every notification
  // silently drops. Surfaced in the hero as a red pill so the coach knows the
  // channel is dead. Single indexed findUnique on the normalized address; the
  // `reason` lets us tell « rejet définitif » from « plainte » below the email.
  const emailSuppression = await db.emailSuppression.findUnique({
    where: { email: normalizeEmail(detail.email) },
    select: { reason: true },
  });

  // Cursor-paginated (S7). A stale cursor (trade deleted since the link was
  // rendered) returns an empty list (Prisma 7 — no throw), handled by the
  // dead-end in MemberTradesList; a genuine DB error must surface, not loop.
  // The net catches ONLY when a cursor is in play, mirroring /journal (S4
  // review finding). `redirect` stays outside the catch — Next signals by
  // throwing NEXT_REDIRECT.
  let tradesPage: Awaited<ReturnType<typeof listMemberTradesAsAdmin>> | null = null;
  if (tab === 'trades') {
    try {
      tradesPage = await listMemberTradesAsAdmin(memberId, { status: 'all', limit: 50, cursor });
    } catch (err) {
      if (!cursor) throw err;
      tradesPage = null;
    }
    if (tradesPage === null) redirect(`/admin/members/${memberId}?tab=trades`);
  }

  // Cursor-paginated (S7 parity with the real-trade list). A stale cursor (a
  // backtest deleted since the link was rendered) returns an empty page,
  // handled by the dead-end in MemberTrainingPanel; a genuine DB error must
  // surface, not loop — the net catches ONLY when a cursor is in play (mirror
  // of the trades tab above). `redirect` stays outside the catch.
  let trainingPage: Awaited<ReturnType<typeof listTrainingTradesAsAdmin>> | null = null;
  if (tab === 'training') {
    try {
      trainingPage = await listTrainingTradesAsAdmin(memberId, { limit: 50, cursor });
    } catch (err) {
      if (!cursor) throw err;
      trainingPage = null;
    }
    if (trainingPage === null) redirect(`/admin/members/${memberId}?tab=training`);
  }

  // S8 verif-layer (perf) — the 4 remaining training-tab reads are mutually
  // independent, so run them as ONE parallel batch (were 4 serial awaits + an
  // N+1 over debrief weeks). The trades list stays separate above for its
  // cursor-stale redirect. The debrief stats are batched into 2 queries by
  // `loadTrainingDebriefStatsForWeeks` (closes backlog P2 MAJ-36 "N+1 onglet
  // training"). §21.5: every read is training-only and memberId-scoped; the
  // batched debrief loader keeps the same safe projection (no resultR/outcome).
  let trainingTradesTotal = 0;
  let trainingSessions: Awaited<ReturnType<typeof listTrainingSessionsAsAdmin>> | null = null;
  let trainingCorrectionsCount: Awaited<
    ReturnType<typeof countTrainingAnnotationsByMember>
  > | null = null;
  let trainingDebriefItems: MemberTrainingDebriefItem[] | null = null;
  if (tab === 'training') {
    [trainingTradesTotal, trainingSessions, trainingCorrectionsCount, trainingDebriefItems] =
      await Promise.all([
        countTrainingTradesAsAdmin(memberId),
        listTrainingSessionsAsAdmin(memberId),
        countTrainingAnnotationsByMember(memberId),
        (async (): Promise<MemberTrainingDebriefItem[]> => {
          const debriefs = await listTrainingDebriefsForMember(memberId, 12);
          const statsByWeek = await loadTrainingDebriefStatsForWeeks(
            memberId,
            debriefs.map((d) => d.weekStart),
          );
          // Every weekStart is a key of statsByWeek (built from the same list).
          return debriefs.map((debrief) => ({
            debrief,
            stats: statsByWeek.get(debrief.weekStart)!,
          }));
        })(),
      ]);
  }

  // S7 §22-23 — read-only daily check-ins for the supervision panel (separate
  // tab). Capped at the 30 most recent days (admin-only, not a hot path). §2:
  // check-ins carry no market content (mindset + declarative booleans only).
  const checkins = tab === 'checkins' ? await listMemberCheckinsAsAdmin(memberId) : null;

  // Tour 14 — mark the OFF days among the listed check-in days so an unfilled
  // slot on an off day reads « Jour off » (a chosen day) instead of « Non
  // rempli. » in the admin panel (§31.2). Same resolution as the member's
  // /checkin/history: one range query over [oldest, newest] listed date, then
  // the pure predicate flags each distinct listed date (weekend-off folded in).
  let checkinOffDates: Set<string> | undefined;
  if (checkins && checkins.length > 0) {
    const listedDates = [...new Set(checkins.map((c) => c.date))].sort();
    const offCtx = await getOffDaySet(memberId, listedDates[0]!, listedDates.at(-1)!);
    checkinOffDates = new Set<string>();
    for (const d of listedDates) {
      if (isOffDay(d, offCtx)) checkinOffDates.add(d);
    }
  }

  // C3 (tour 10) — the Mark Douglas tab also hosts « Suivi des corrections » : the
  // micro-objectives seeded by axis-tagged corrections (`sourceKind='annotation'`),
  // so the admin sees whether their corrections are kept. Batched into the same
  // parallel read (one extra indexed findMany, no added wall-clock).
  const douglasData =
    tab === 'mark-douglas'
      ? await Promise.all([
          listMemberDeliveries(memberId, { take: 30 }),
          aggregateMemberDeliveryStats(memberId),
          listAnnotationObjectivesForMember(memberId),
        ])
      : null;

  const weeklyReports = tab === 'weekly-reports' ? await listReportsForMember(memberId, 12) : null;

  // V1.4 — read-only monthly debriefs for the monthly-debrief tab
  // (SPEC §25.4/§25.6). Capped at 12 (admin-only, not a hot path, 30-member
  // scale). §21.5: read straight from `monthly_debriefs`, never recomputed
  // against `trades`/`training_trades`.
  const monthlyDebriefs =
    tab === 'monthly-debrief' ? await listMonthlyDebriefsForMember(memberId, 12) : null;

  // V1.5 — read-only mindset profile/trend for the mindset tab (SPEC §27.4).
  // Capped at 52 (admin-only, not a hot path, 30-member scale). §21.5/§27.7:
  // the profile/trend are computed PURELY from the member's own
  // `mindset_checks` rows — never a real-edge read, never recomputed against
  // `trades`/`training_trades`.
  const mindsetData =
    tab === 'mindset'
      ? await loadMindsetDashboardData(memberId, currentParisWeekStart(), 52)
      : null;

  const adminNotes = tab === 'notes' ? await listAdminNotesForMember(memberId) : null;

  // V2.4 Phase C — read-only MemberProfile for the admin profile tab (M3
  // directive 2026-05-27 closure §18 vision "admin voir tout"). PII-FREE
  // admin context : interview + profile read directly via service layer,
  // pseudonymLabel will be computed in the viewer for header. §27.7 / §J
  // posture invariants enforced via the same getProfileForUser used by /profile
  // member (single source of truth).
  const profileData =
    tab === 'profile'
      ? await Promise.all([getProfileForUser(memberId), getInterviewForUser(memberId)])
      : null;

  // J-E inc.3 — read-only monthly deep re-profiling trajectory for the
  // trajectoire tab (ADMIN-ONLY). §21.5: read straight from
  // `member_profile_monthly_snapshots`, never recomputed against trades. Capped
  // at 12 (admin-only, not a hot path, 30-member scale).
  const monthlyTrajectory =
    tab === 'trajectoire' ? await listMonthlyReprofileSnapshotsForMember(memberId) : null;

  // §26 J-C4 — read-only latest AdaptiveCalendar for the calendar tab. §2:
  // read straight from `adaptive_calendars` (no real-edge recompute). The
  // member's first-view disclosure stamp is NOT touched here (admin view).
  const calendar = tab === 'calendar' ? await getLatestCalendarForUser(memberId) : null;

  // V1.7 §30 J-M3 — read-only meeting attendance for the presence tab. Rate +
  // per-meeting detail over the rolling 30d window (cancelled slots greyed +
  // excluded from the rate, SPEC §30.4). Fetched only when the tab is active.
  const presence = tab === 'presence' ? await listMeetingAttendanceForMember(memberId) : null;

  // S3 §33 — read-only « réalité vs déclaré » panel (S7 output). Fetched only
  // when the tab is active; reuses the member-facing read services + raw
  // alert rows (admin sees everything, the member never sees the alert rows
  // directly — they receive the Douglas card).
  const verification =
    tab === 'verification'
      ? await Promise.all([
          getVerificationOverview(memberId),
          getLatestConstancyScore(memberId),
          listDiscrepancies(memberId),
          db.alert.findMany({
            where: { memberId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              triggerType: true,
              repeatCount: true,
              threshold: true,
              status: true,
              createdAt: true,
            },
          }),
          // S6 chantier E — recent weekly constancy scores (oldest→newest) so the
          // admin sees the trajectory under the snapshot card (parity with the
          // member-facing `/verification` layout). Same indexed read as the
          // snapshot, batched in this Promise.all (no extra round-trip cost).
          listRecentConstancyScores(memberId, 12),
        ])
      : null;

  // F5 (overhaul 2026-06-30) — append-only moderation history for the
  // admin-only Modération tab. Fetched only when the tab is active; bounded
  // by the service (take=50). Admin-only surface, never shown to the member.
  const moderationHistory = tab === 'moderation' ? await listModerationHistory(memberId) : null;

  // J3 "classement pour tous" SCOPE 4 — read-only admin visibility of the
  // member's self-declared off days in the forward cap window. Recomputes the
  // over-cap flag from live rows (same threshold as the declaration layer), so
  // the admin sees the atypical (past-cap, reason-required) declarations. This
  // exposes DECLARATIONS to curb leaderboard gaming, never trading performance
  // (firewall §21.5 untouched).
  const offDaySummary =
    tab === 'off-days' ? await getMemberOffDayAdminSummary(memberId, detail.timezone) : null;

  // J6.5 — pull behavioral scores + analytics in parallel for the overview tab.
  // Skipped on the trades tab to keep its render path lean. J6.6 H1 fix —
  // `detail.timezone` already contains the value (added to MemberDetail), so
  // we no longer need a separate `findUnique` round-trip here.
  const memberTimezone = detail.timezone;
  // J6-admin-scale (scope 3) — the synthesis banner sits above the tabs on EVERY
  // tab, so the triage signals + latest behavioral score are now loaded
  // unconditionally (not just on overview). Both reuse services the page/cohort
  // already rely on: getMembersAttention runs 4 bounded, indexed single-member
  // queries and getLatestBehavioralScore is cache()-wrapped (no double-fetch when
  // the overview tab reads it again). getDashboardAnalytics stays overview-only
  // (it is the heavy fan-out) — no new N+1, no new schema.
  const [attentionMap, latestScore, analytics] = await Promise.all([
    getMembersAttention([memberId]),
    getLatestBehavioralScore(memberId),
    tab === 'overview'
      ? getDashboardAnalytics(memberId, memberTimezone, '30d')
      : Promise.resolve(null),
  ]);
  // getMembersAttention zeroes every requested id, so the get() is always defined
  // for a passed id; the fallback keeps the type honest.
  const attention = attentionMap.get(memberId) ?? {
    tradesToComment: 0,
    openDiscrepancies: 0,
    constancyDeclining: false,
  };
  // Mirror the cohort-wide "décrochage" predicate (single-sourced in
  // attention-service) so the banner flags a drifting member exactly like
  // /admin/a-traiter does, without re-querying the cohort. The clock lives in
  // the service, keeping this Server Component render pure.
  const memberDisengaged = isMemberDisengaged(detail);

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
  // Deterministic per-member hue from the email hash, CLAMPED into the cool
  // band [210, 265] (blue→indigo) so the avatar gradient can NEVER drift into
  // purple/violet (mono-accent invariant §3) — the raw 0-359 hash regularly
  // landed in 270-300 (violet). The 56°-wide band keeps members visually
  // distinguishable while staying on-brand. Saturation is kept modest (22%) so
  // the chip reads premium, not candy. The gradient stops are theme-INVARIANT
  // (dark, 28%/18% HSL lightness) so the initials need a fixed light color:
  // var(--t-1) flips dark in light theme (measured 1.16:1, unreadable).
  let hash = 0;
  for (let i = 0; i < detail.email.length; i++) {
    hash = (hash * 31 + detail.email.charCodeAt(i)) % 360;
  }
  const hue = 210 + (hash % 56);

  // S12 — widened from max-w-3xl (768px) to max-w-6xl (1152px) + responsive
  // padding: the deepest supervision surface ("admin voit tout", 14 tabs) was
  // stranded in a narrow column on ultra-wide while every sibling admin surface
  // (members/reports lists, system, cards) uses a full shell (§23). 1152px (not
  // --w-app 1600px) is deliberate: it gives the lg: score/edge grids real room
  // and de-voids the page WITHOUT stranding the hand-bordered 3-col metric grid
  // or stretching the AI-report prose past a readable measure.
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:px-8">
      {/* Breadcrumb — « Admin › Membres › {Nom} › {Onglet} ». Parent levels are
          links; the member name + active tab are the trailing (current) crumbs.
          The tab crumb is omitted on the default `overview` (it IS this page). */}
      <nav
        aria-label="Fil d'Ariane"
        className="flex w-fit flex-wrap items-center gap-1 text-[12px] text-[var(--t-3)]"
      >
        <Link href="/admin" className="transition-colors hover:text-[var(--t-1)]">
          Admin
        </Link>
        <ChevronRight className="h-3 w-3 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden />
        <Link href="/admin/members" className="transition-colors hover:text-[var(--t-1)]">
          Membres
        </Link>
        <ChevronRight className="h-3 w-3 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden />
        {tab === 'overview' ? (
          <span aria-current="page" className="max-w-[14rem] truncate text-[var(--t-2)]">
            {detail.displayName}
          </span>
        ) : (
          <>
            <Link
              href={`/admin/members/${memberId}`}
              className="max-w-[14rem] truncate transition-colors hover:text-[var(--t-1)]"
            >
              {detail.displayName}
            </Link>
            <ChevronRight className="h-3 w-3 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden />
            <span aria-current="page" className="text-[var(--t-2)]">
              {MEMBER_TAB_LABEL[tab]}
            </span>
          </>
        )}
      </nav>

      {/* Hero header card */}
      <Card primary className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Avatar with initials + deterministic hash gradient */}
          <div
            className="rounded-card grid h-16 w-16 shrink-0 place-items-center border border-[var(--b-strong)] text-[20px] font-semibold text-white"
            style={{
              // Both stops stay in the cool band (217 teal → 265 indigo): the
              // 2nd stop shifts toward blue (hue-12), never up into violet.
              background: `linear-gradient(135deg, hsl(${hue}, 22%, 28%), hsl(${hue - 12}, 22%, 18%))`,
            }}
            aria-hidden
          >
            {initials}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className="f-display h-rise text-[24px] leading-[1.05] font-medium tracking-[-0.02em] break-words text-[var(--t-1)] sm:text-[28px]"
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
              {/* Tour 11 (chantier G, FINDING 1) — corrections still unread by
                  the member. Factual pointer, never a guilt counter (§31.2) :
                  hidden entirely at 0 (no « 0 corrections non lues »). Amber
                  (warn), never red (red is reserved for trade outcomes). */}
              {unseenCorrections > 0 ? (
                <Pill tone="warn">
                  <MailWarning className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                  {unseenCorrections} correction{unseenCorrections > 1 ? 's' : ''} non lue
                  {unseenCorrections > 1 ? 's' : ''}
                </Pill>
              ) : null}
              {/* J2 — the member's email hard-bounced or was marked as spam, so
                  Resend suppresses it and no email reaches them. Red pill (bad),
                  matching the danger tone; the reason sits below the address. */}
              {emailSuppression ? (
                <Pill tone="bad">
                  <MailX className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                  Email en échec
                </Pill>
              ) : null}
            </div>
            <p className="t-body flex min-w-0 items-center gap-1.5 font-mono text-[var(--t-2)] tabular-nums">
              <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--t-4)]" strokeWidth={1.75} />
              <span className="min-w-0 break-all">{detail.email}</span>
            </p>
            {emailSuppression ? (
              <p className="t-cap text-[var(--bad)]">
                {emailSuppression.reason === 'hard_bounce'
                  ? 'Rejet définitif (hard bounce) : les emails ne sont plus envoyés à cette adresse.'
                  : 'Signalé comme spam (plainte) : les emails ne sont plus envoyés à cette adresse.'}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Synthesis banner (J6-admin-scale scope 3) — key signals at a glance,
          above the tabs so it stays in view on every tab. */}
      <MemberSynthesisBanner
        memberId={memberId}
        lastSeenAt={detail.lastSeenAt}
        disengaged={memberDisengaged}
        attention={attention}
        score={latestScore}
      />

      {/* Tabs */}
      <MemberTabs memberId={memberId} active={tab} />

      {/* Content */}
      {tab === 'overview' ? (
        <OverviewTab detail={detail} latestScore={latestScore} analytics={analytics} />
      ) : null}
      {tab === 'trades' && tradesPage ? (
        <MemberTradesList
          memberId={memberId}
          trades={tradesPage.items}
          nextCursor={tradesPage.nextCursor}
          cursor={cursor}
          total={detail.tradesCount}
          annotationCountByTrade={tradesPage.annotationCountByTrade}
        />
      ) : null}
      {tab === 'training' && trainingPage ? (
        <div className="flex flex-col gap-8">
          {trainingSessions !== null ? (
            <section className="flex flex-col gap-3">
              <h2 className="t-h3 text-foreground">Séances de backtest</h2>
              <MemberTrainingSessionsPanel memberId={memberId} sessions={trainingSessions} />
            </section>
          ) : null}
          <section className="flex flex-col gap-3">
            <h2 className="t-h3 text-foreground">Tous les backtests</h2>
            <MemberTrainingPanel
              memberId={memberId}
              trades={trainingPage.items}
              nextCursor={trainingPage.nextCursor}
              cursor={cursor}
              total={trainingTradesTotal}
              correctionsCount={trainingCorrectionsCount ?? undefined}
            />
          </section>
          {trainingDebriefItems ? (
            <MemberTrainingDebriefsPanel items={trainingDebriefItems} />
          ) : null}
        </div>
      ) : null}
      {tab === 'checkins' && checkins !== null ? (
        <MemberCheckinsPanel
          checkins={checkins}
          {...(checkinOffDates ? { offDates: checkinOffDates } : {})}
        />
      ) : null}
      {tab === 'pretrade' ? (
        <div className="flex flex-col gap-4">
          <PreTradeAnalyticsCard userId={memberId} />
          <PreTradeCorrelationCard userId={memberId} />
        </div>
      ) : null}
      {tab === 'mark-douglas' && douglasData ? (
        <div className="flex flex-col gap-8">
          {/* C3 (tour 10) — « Suivi des corrections » : is the admin's coaching
              landing? Sits above the delivery timeline (both are Mark Douglas
              engagement surfaces). */}
          <section className="flex flex-col gap-3">
            <MemberCorrectionsFollowupPanel memberId={memberId} objectives={douglasData[2]} />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="t-h3 text-foreground">Fiches Mark Douglas</h2>
            <MemberDouglasPanel deliveries={douglasData[0]} stats={douglasData[1]} />
          </section>
        </div>
      ) : null}
      {tab === 'weekly-reports' && weeklyReports !== null ? (
        <MemberWeeklyReportsPanel reports={weeklyReports} />
      ) : null}
      {tab === 'monthly-debrief' && monthlyDebriefs !== null ? (
        <MemberMonthlyDebriefsPanel debriefs={monthlyDebriefs} />
      ) : null}
      {tab === 'mindset' && mindsetData !== null ? (
        <MemberMindsetChecksPanel data={mindsetData} />
      ) : null}
      {tab === 'calendar' ? <MemberCalendarPanel calendar={calendar} /> : null}
      {tab === 'profile' && profileData !== null ? (
        <MemberProfileViewerAdmin
          memberId={memberId}
          profile={profileData[0]}
          interview={profileData[1]}
        />
      ) : null}
      {tab === 'trajectoire' && monthlyTrajectory !== null ? (
        <MemberMonthlyProfileTrajectoryPanel snapshots={monthlyTrajectory} />
      ) : null}
      {tab === 'presence' && presence !== null ? (
        <MemberPresencePanel data={presence} memberId={memberId} />
      ) : null}
      {tab === 'verification' && verification !== null ? (
        <MemberVerificationPanel
          memberId={memberId}
          overview={verification[0]}
          constancy={verification[1]}
          discrepancies={verification[2]}
          alerts={verification[3]}
          history={verification[4]}
        />
      ) : null}
      {tab === 'notes' && adminNotes !== null ? (
        <MemberAdminNotesPanel memberId={memberId} notes={adminNotes} />
      ) : null}
      {tab === 'moderation' && moderationHistory !== null ? (
        <MemberModerationPanel
          memberId={memberId}
          memberName={detail.displayName}
          status={detail.status}
          role={detail.role}
          isSelf={session.user.id === memberId}
          hasAvatar={detail.hasAvatar}
          history={moderationHistory}
        />
      ) : null}
      {tab === 'off-days' && offDaySummary !== null ? (
        <MemberOffDaysPanel summary={offDaySummary} />
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
          value={detail.lastSeenAt ? DATETIME_FMT.format(new Date(detail.lastSeenAt)) : '-'}
          mono
        />
        <Metric
          label="Dernier trade"
          value={detail.lastTradeAt ? DATETIME_FMT.format(new Date(detail.lastTradeAt)) : '-'}
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

  // Colored top liseré + hover wash, per tone (carbone des StatCell admin).
  // Compositor-only : the numeric value micro-scales via transform (skipped on
  // `mono` cells, which hold dates/strings, not a hero number); the cell tints
  // via bg-color. The liseré is a child span so the dense 6-col nth-child
  // border-reset below is untouched (avoids the double-border trap §1).
  const accentBar =
    tone === 'ok'
      ? 'bg-[var(--ok)]'
      : tone === 'warn'
        ? 'bg-[var(--warn)]'
        : 'bg-[var(--b-strong)]';
  const hoverWash =
    tone === 'ok'
      ? 'hover:bg-[var(--ok-dim)]'
      : tone === 'warn'
        ? 'hover:bg-[var(--warn-dim)]'
        : 'hover:bg-[var(--bg-2)]';

  return (
    <div
      className={cn(
        'group/stat relative flex flex-col gap-1 overflow-hidden p-4 transition-colors duration-200',
        'border-r border-b border-[var(--b-default)] last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 [&:nth-child(2)]:border-b-0 sm:[&:nth-child(2)]:border-r [&:nth-child(3)]:border-r-0 sm:[&:nth-child(3)]:border-r-0 sm:[&:nth-child(3)]:border-b [&:nth-child(4)]:border-b-0 sm:[&:nth-child(4)]:border-r [&:nth-child(5)]:border-r [&:nth-child(5)]:border-b-0 [&:nth-child(6)]:border-r-0 [&:nth-child(6)]:border-b-0',
        hoverWash,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 transition-transform duration-300 ease-out group-hover/stat:scale-x-100 motion-reduce:transition-none',
          accentBar,
        )}
      />
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          mono
            ? 'f-mono text-[13px] tabular-nums'
            : 'f-mono origin-left text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums transition-transform duration-200 group-hover/stat:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover/stat:scale-100',
          valColor,
        )}
      >
        {value}
      </span>
    </div>
  );
}
