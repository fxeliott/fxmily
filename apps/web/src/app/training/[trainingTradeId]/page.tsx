import { ArrowLeft, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingAnnotationsSection } from '@/components/training/training-annotations-section';
import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { Card } from '@/components/ui/card';
import { selectStorage } from '@/lib/storage';
import {
  listTrainingAnnotationsForTrainingTradeAsMember,
  markTrainingAnnotationsSeenForTrainingTrade,
} from '@/lib/training/training-annotation-member-service';
import { getTrainingTradeById } from '@/lib/training/training-trade-service';

export const metadata = {
  title: 'Détail du backtest · Entraînement',
};

export const dynamic = 'force-dynamic';

interface MemberTrainingTradeDetailPageProps {
  params: Promise<{ trainingTradeId: string }>;
}

/** Defensive: a corrupted `entryScreenshotKey` must not crash the render. */
function safeReadUrl(key: string | null): string | null {
  if (!key) return null;
  try {
    return selectStorage().getReadUrl(key);
  } catch {
    return null;
  }
}

export default async function MemberTrainingTradeDetailPage({
  params,
}: MemberTrainingTradeDetailPageProps) {
  const session = await auth();
  // Modern member-wizard auth canon (mirrors /training landing): symmetric
  // with the J-T3 Server Actions' own status gate.
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { trainingTradeId } = await params;

  const trade = await getTrainingTradeById(trainingTradeId, session.user.id);
  if (!trade) notFound();

  // Mark every still-unread correction as seen BEFORE the read so the
  // rendered list matches the UI and the admin's "Non lue" badge clears on
  // their next refresh. Best-effort — a DB hiccup must not break the page.
  // No audit row here by design: reusing the real-edge `member.annotations.
  // viewed` slug for a backtest read would pollute the §21.5 isolation
  // signal, and `seenByMemberAt` on the row is the durable "seen" record.
  await markTrainingAnnotationsSeenForTrainingTrade(session.user.id, trainingTradeId).catch(
    () => undefined,
  );

  const annotations = await listTrainingAnnotationsForTrainingTradeAsMember(
    session.user.id,
    trainingTradeId,
  );

  const screenshotUrl = safeReadUrl(trade.entryScreenshotKey);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      {/* Hero — J4 TradeDetailView-parity focal point (h1 + identity), on the
          cyan training surface (§21.5 non-confusable). */}
      <header className="flex flex-col gap-3">
        <Link
          href="/training"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Mes backtests
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="f-mono text-[28px] leading-none font-semibold tracking-[0.01em] text-[var(--t-1)] sm:text-[32px]">
            {trade.pair}
          </h1>
          <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
            <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
            Mode entraînement
          </span>
        </div>
      </header>

      <TrainingTradeCard trade={trade} />

      {screenshotUrl ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="t-eyebrow-lg text-[var(--t-3)]">Ton analyse</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="Capture de ton analyse TradingView"
            className="rounded-card max-h-[32rem] w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
          />
        </Card>
      ) : null}

      <TrainingAnnotationsSection
        annotations={annotations}
        isAdmin={false}
        currentUserId={session.user.id}
      />
    </main>
  );
}
