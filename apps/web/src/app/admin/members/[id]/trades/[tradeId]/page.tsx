import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeDetailView } from '@/components/journal/trade-detail-view';
import { logAudit } from '@/lib/auth/audit';
import { getMemberTradeAsAdmin } from '@/lib/admin/trades-service';

export const metadata = {
  title: 'Trade — vue admin',
};

export const dynamic = 'force-dynamic';

interface AdminTradeDetailPageProps {
  params: Promise<{ id: string; tradeId: string }>;
}

export default async function AdminTradeDetailPage({ params }: AdminTradeDetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id: memberId, tradeId } = await params;

  const trade = await getMemberTradeAsAdmin(memberId, tradeId);
  if (!trade) notFound();

  await logAudit({
    action: 'admin.trade.viewed',
    userId: session.user.id,
    metadata: { memberId, tradeId, isClosed: trade.isClosed },
  });

  return (
    <TradeDetailView
      trade={trade}
      backHref={`/admin/members/${memberId}?tab=trades`}
      backLabel="Trades du membre"
      // Admins don't close trades on behalf of members — the close-out is
      // the member's reflection moment. Hide the CTA in admin view.
      closeHref={null}
      contextBadge="Vue admin"
      // Footer slot reserved for the J4 annotate-trade action.
    />
  );
}
