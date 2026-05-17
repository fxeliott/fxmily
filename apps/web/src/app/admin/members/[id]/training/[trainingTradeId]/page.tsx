import { ArrowLeft } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AnnotateTrainingTradeButton } from '@/components/training/annotate-training-trade-button';
import { TrainingAnnotationsSection } from '@/components/training/training-annotations-section';
import { TrainingTradeCard } from '@/components/training/training-trade-card';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { listTrainingAnnotationsForTrainingTrade } from '@/lib/admin/training-annotation-service';
import { logAudit } from '@/lib/auth/audit';
import { selectStorage } from '@/lib/storage';
import { getTrainingTradeAsAdmin } from '@/lib/training/training-trade-admin-service';

export const metadata = {
  title: 'Backtest — vue admin',
};

export const dynamic = 'force-dynamic';

interface AdminTrainingTradeDetailPageProps {
  params: Promise<{ id: string; trainingTradeId: string }>;
}

/** Defensive: a corrupted `entryScreenshotKey` (admin-repair escape hatch)
 * must not crash the detail render. */
function safeReadUrl(key: string | null): string | null {
  if (!key) return null;
  try {
    return selectStorage().getReadUrl(key);
  } catch {
    return null;
  }
}

export default async function AdminTrainingTradeDetailPage({
  params,
}: AdminTrainingTradeDetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id: memberId, trainingTradeId } = await params;

  const trade = await getTrainingTradeAsAdmin(memberId, trainingTradeId);
  if (!trade) notFound();

  const annotations = await listTrainingAnnotationsForTrainingTrade(trainingTradeId);

  // §21.5: distinct slug from the real-edge `admin.trade.viewed`; PII-free
  // (no backtest P&L in metadata).
  await logAudit({
    action: 'admin.training_trade.viewed',
    userId: session.user.id,
    metadata: { memberId, trainingTradeId, annotationsCount: annotations.length },
  });

  const screenshotUrl = safeReadUrl(trade.entryScreenshotKey);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      {/* Hero — J4 admin-detail-parity focal point (h1 + admin/training
          context badge), cyan training surface (§21.5 non-confusable). */}
      <header className="flex flex-col gap-3">
        <Link
          href={`/admin/members/${memberId}?tab=training`}
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Backtests du membre
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="f-mono text-[28px] leading-none font-semibold tracking-[0.01em] text-[var(--t-1)] sm:text-[32px]">
            {trade.pair}
          </h1>
          <Pill tone="cy">Vue admin — entraînement</Pill>
        </div>
      </header>

      <TrainingTradeCard trade={trade} />

      {screenshotUrl ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="t-eyebrow-lg text-[var(--t-3)]">Analyse du backtest</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="Capture de l'analyse TradingView du backtest"
            className="rounded-card max-h-[32rem] w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
          />
        </Card>
      ) : null}

      <TrainingAnnotationsSection
        annotations={annotations}
        isAdmin
        currentUserId={session.user.id}
      />

      <div className="flex justify-end">
        <AnnotateTrainingTradeButton memberId={memberId} trainingTradeId={trainingTradeId} />
      </div>
    </main>
  );
}
