import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TradeCloseEchoCard, TradeOpenEchoCard } from '@/components/journal/trade-close-echo';
import { TradeDetailView } from '@/components/journal/trade-detail-view';
import {
  listAnnotationsForTradeAsMember,
  markAnnotationsSeenForTrade,
} from '@/lib/annotations/member-service';
import { logAudit } from '@/lib/auth/audit';
import {
  buildTradeCloseEcho,
  buildTradeOpenEcho,
  echoProfileDims,
  ECHO_WINDOW_HOURS,
  LOSS_STREAK_ECHO_THRESHOLD,
  type TradeCloseEcho,
  type TradeOpenEcho,
} from '@/lib/coaching/trade-echo';
import { db } from '@/lib/db';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import { getTradeById, type SerializedTrade } from '@/lib/trades/service';
import { countOpenDiscrepanciesForTrade } from '@/lib/verification/service';

import { DeleteTradeButton } from './delete-button';

export const metadata = {
  title: 'Détail du trade',
};

export const dynamic = 'force-dynamic';

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TradeDetailPage({ params }: DetailPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // F2 — render absolute trade instants in the member's own timezone.
  const timezone = session.user.timezone || 'Europe/Paris';

  const { id } = await params;
  const trade = await getTradeById(session.user.id, id);
  if (!trade) notFound();

  // J4 — bulk-mark every still-unread annotation on this trade as seen.
  // Done before the read so the rendered list matches what the UI shows.
  // Best-effort audit log — the count is `0` when nothing was unread,
  // skipping the audit entry in that case to keep the log readable.
  const seen = await markAnnotationsSeenForTrade(session.user.id, id);
  if (seen.count > 0) {
    await logAudit({
      action: 'member.annotations.viewed',
      userId: session.user.id,
      metadata: { tradeId: id, markedCount: seen.count },
    });
  }

  const annotations = await listAnnotationsForTradeAsMember(session.user.id, id);

  // Tour 10 / Tour 11 — living echo: an immediate, member-specific reading of
  // what THIS trade says about their process (deterministic, enum-derived — see
  // lib/coaching/trade-echo.ts). Built ONLY here (member page): the admin trade
  // view never passes an echoSlot. A CLOSED trade gets the close echo; an OPEN
  // one gets the Tour 11 open echo (finding 1). Freshness gates run BEFORE the
  // profile/streak reads so archived trades pay zero extra queries.
  // Tour 11 — REFLECT bias tags are not on SerializedTrade; read them here in a
  // single ownership-scoped query (this page owns the read).
  const [echo, tags] = await Promise.all([
    buildEchoForTrade(session.user.id, trade),
    loadTradeTags(session.user.id, trade.id),
  ]);

  // S13 — ambient depth backplate for the MEMBER trade detail only. Mounted at
  // the page level (never inside the shared <TradeDetailView>, which the admin
  // route also renders) so the admin variant stays flat. The opaque host masks
  // the app-wide app-ambient → no double aurora; the transparent <main> the view
  // renders sits above the -z-10 mesh and reveals it through its gutters.
  // Decorative: aria-hidden + pointer-events:none + reduced-motion (DashboardAmbient).
  return (
    <div className="relative bg-[var(--bg)]">
      <DashboardAmbient />
      <TradeDetailView
        trade={trade}
        backHref="/journal"
        backLabel="Journal"
        closeHref={`/journal/${trade.id}/close`}
        annotations={annotations}
        currentUserId={session.user.id}
        timezone={timezone}
        tags={tags}
        echoSlot={renderEchoSlot(echo)}
        footerSlot={<DeleteTradeButton tradeId={trade.id} />}
      />
    </div>
  );
}

/** Discriminated echo result so the JSX can pick the matching card. */
type EchoResult =
  | { kind: 'close'; echo: TradeCloseEcho }
  | { kind: 'open'; echo: TradeOpenEcho }
  | null;

/** Render the correct living-echo card for whichever echo (if any) was built. */
function renderEchoSlot(result: EchoResult): React.ReactNode {
  if (!result) return null;
  if (result.kind === 'open') return <TradeOpenEchoCard echo={result.echo} />;
  return <TradeCloseEchoCard echo={result.echo} />;
}

/**
 * Tour 10 / Tour 11 — assemble the living echo. Freshness short-circuits run
 * FIRST (stale/absent → null, zero extra reads). A CLOSED trade builds the
 * close echo (now with the anti-tilt loss-streak follow-up, finding 2); an
 * OPEN trade builds the Tour 11 open echo (finding 1).
 */
async function buildEchoForTrade(userId: string, trade: SerializedTrade): Promise<EchoResult> {
  const now = new Date();

  // OPEN trade — Tour 11 finding 1. Freshness keyed on the app-open instant
  // (Trade.createdAt), consistent with ECHO_WINDOW_HOURS. `enteredAt` is member
  // input and can be backdated, so it is NOT the freshness anchor.
  if (!trade.closedAt) {
    const openedMs = Date.parse(trade.createdAt);
    if (Number.isNaN(openedMs)) return null;
    const openAgeMs = now.getTime() - openedMs;
    if (openAgeMs < 0 || openAgeMs > ECHO_WINDOW_HOURS * 60 * 60 * 1000) return null;

    const profile = await getProfileForUser(userId);
    const dims = echoProfileDims(profile);
    const echo = buildTradeOpenEcho({
      openedAt: trade.createdAt,
      planRespected: trade.planRespected,
      emotionBefore: trade.emotionBefore,
      hasStopLoss: trade.stopLossPrice !== null,
      learningStage: dims.learningStage,
      coachingRegister: dims.coachingRegister,
      now,
    });
    return echo ? { kind: 'open', echo } : null;
  }

  // CLOSED trade — Tour 10 close echo (+ Tour 11 loss-streak follow-up).
  const ageMs = now.getTime() - Date.parse(trade.closedAt);
  if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > ECHO_WINDOW_HOURS * 60 * 60 * 1000) return null;

  const [profile, openDiscrepancyCount, recentConsecutiveLosses] = await Promise.all([
    getProfileForUser(userId),
    countOpenDiscrepanciesForTrade(userId, trade.id),
    // Only a loss can carry a streak line — skip the query otherwise.
    trade.outcome === 'loss'
      ? computeTrailingLossStreak(userId, trade.closedAt)
      : Promise.resolve(0),
  ]);
  const dims = echoProfileDims(profile);

  const echo = buildTradeCloseEcho({
    closedAt: trade.closedAt,
    outcome: trade.outcome,
    exitReason: trade.exitReason,
    planRespected: trade.planRespected,
    processComplete: trade.processComplete,
    slPerRule: trade.slPerRule,
    movedToBe: trade.movedToBe,
    partialAtTarget: trade.partialAtTarget,
    emotionDuring: trade.emotionDuring,
    openDiscrepancyCount,
    recentConsecutiveLosses,
    learningStage: dims.learningStage,
    coachingRegister: dims.coachingRegister,
    now,
  });
  return echo ? { kind: 'close', echo } : null;
}

/**
 * Tour 11 finding 2 — trailing run of consecutive losses ENDING at `closedAt`
 * (this trade included). Reads the member's most recent closed trades ordered
 * by `closedAt` desc and counts leading `loss` outcomes until a non-loss (win /
 * break_even) breaks the run. A light, bounded query (10 rows) — enough to
 * clear {@link LOSS_STREAK_ECHO_THRESHOLD} without scanning the whole journal.
 * A win/break-even earlier than this trade correctly caps the count.
 */
async function computeTrailingLossStreak(userId: string, closedAt: string): Promise<number> {
  const recent = await db.trade.findMany({
    where: { userId, closedAt: { not: null, lte: new Date(closedAt) } },
    orderBy: { closedAt: 'desc' },
    take: Math.max(10, LOSS_STREAK_ECHO_THRESHOLD + 1),
    select: { outcome: true },
  });
  let streak = 0;
  for (const t of recent) {
    if (t.outcome === 'loss') streak++;
    else break;
  }
  return streak;
}

/**
 * Tour 11 finding 3 — read the REFLECT bias tags for this trade in a single
 * ownership-scoped query (the shared `SerializedTrade` does not expose `tags`,
 * and the serializer lives outside this page's zone). Returns `[]` on any miss
 * so the view renders no tag block (never a fabricated empty state).
 */
async function loadTradeTags(userId: string, tradeId: string): Promise<string[]> {
  const row = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { tags: true },
  });
  return row?.tags ?? [];
}
