import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeDetailView } from '@/components/journal/trade-detail-view';
import {
  listAnnotationsForTradeAsMember,
  markAnnotationsSeenForTrade,
} from '@/lib/annotations/member-service';
import { logAudit } from '@/lib/auth/audit';
import { getTradeById } from '@/lib/trades/service';

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

  return (
    <TradeDetailView
      trade={trade}
      backHref="/journal"
      backLabel="Journal"
      closeHref={`/journal/${trade.id}/close`}
      annotations={annotations}
      currentUserId={session.user.id}
      footerSlot={<DeleteTradeButton tradeId={trade.id} />}
    />
  );
}
