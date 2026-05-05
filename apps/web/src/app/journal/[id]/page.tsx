import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TradeDetailView } from '@/components/journal/trade-detail-view';
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

  return (
    <TradeDetailView
      trade={trade}
      backHref="/journal"
      backLabel="Journal"
      closeHref={`/journal/${trade.id}/close`}
      footerSlot={<DeleteTradeButton tradeId={trade.id} />}
    />
  );
}
