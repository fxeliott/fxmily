import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TradeCloseEchoCard } from '@/components/journal/trade-close-echo';
import { TradeDetailView } from '@/components/journal/trade-detail-view';
import {
  listAnnotationsForTradeAsMember,
  markAnnotationsSeenForTrade,
} from '@/lib/annotations/member-service';
import { logAudit } from '@/lib/auth/audit';
import {
  buildTradeCloseEcho,
  echoProfileDims,
  ECHO_WINDOW_HOURS,
  type TradeCloseEcho,
} from '@/lib/coaching/trade-echo';
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

  // Tour 10 — living close echo: an immediate, member-specific reading of what
  // THIS close says about their process (deterministic, enum-derived — see
  // lib/coaching/trade-echo.ts). Built ONLY here (member page): the admin trade
  // view never passes an echoSlot. The freshness gate runs BEFORE any DB read
  // so archived trades pay zero extra queries.
  const echo = await buildEchoForTrade(session.user.id, trade);

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
        echoSlot={echo ? <TradeCloseEchoCard echo={echo} /> : null}
        footerSlot={<DeleteTradeButton tradeId={trade.id} />}
      />
    </div>
  );
}

/**
 * Tour 10 — assemble the close-echo input. Freshness short-circuit FIRST
 * (open trade / close older than the window → null, no profile/discrepancy
 * read), then ONE parallel batch for the two inputs the echo personalises on.
 */
async function buildEchoForTrade(
  userId: string,
  trade: SerializedTrade,
): Promise<TradeCloseEcho | null> {
  if (!trade.closedAt) return null;
  const ageMs = Date.now() - Date.parse(trade.closedAt);
  if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > ECHO_WINDOW_HOURS * 60 * 60 * 1000) return null;

  const [profile, openDiscrepancyCount] = await Promise.all([
    getProfileForUser(userId),
    countOpenDiscrepanciesForTrade(userId, trade.id),
  ]);
  const dims = echoProfileDims(profile);

  return buildTradeCloseEcho({
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
    learningStage: dims.learningStage,
    coachingRegister: dims.coachingRegister,
    now: new Date(),
  });
}
