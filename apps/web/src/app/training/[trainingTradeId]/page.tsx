import { ArrowLeft, ExternalLink, GraduationCap, Layers } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TrainingAnnotationsSection } from '@/components/training/training-annotations-section';
import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { selectStorage } from '@/lib/storage';
import {
  deriveTrainingReviewStatus,
  TRAINING_REVIEW_STATUS_META,
} from '@/lib/training/review-status';
import {
  listTrainingAnnotationsForTrainingTradeAsMember,
  markTrainingAnnotationsSeenForTrainingTrade,
} from '@/lib/training/training-annotation-member-service';
import { getTrainingSessionMeta } from '@/lib/training/training-session-service';
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

  // §254 — echo the parent session's practice context (symbol/timeframe/label)
  // when this backtest belongs to a session. Owner-scoped read; `null` (deleted
  // session race, or not owned) degrades to no chip, never an error. §21.5-safe:
  // these are practice context strings the member typed, never a P&L.
  const sessionMeta = trade.sessionId
    ? await getTrainingSessionMeta(trade.sessionId, session.user.id)
    : null;
  const sessionContext = sessionMeta
    ? [sessionMeta.symbol, sessionMeta.timeframe].filter(Boolean).join(' · ')
    : '';

  const screenshotUrl = safeReadUrl(trade.entryScreenshotKey);

  // S8 V2 §33-3 — review status derived at render (no migration). On this
  // surface the corrections were just marked seen, so the status is `seen`
  // (≥1 correction) or `pending` (none yet) — the `corrected` (unread) state
  // lives on the `/training` list as the "N non lues" pill.
  const reviewStatus = deriveTrainingReviewStatus(annotations);
  const reviewMeta = TRAINING_REVIEW_STATUS_META[reviewStatus];

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient tone="cyan" />
      <div className="dash-stagger relative mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
        {/* Hero — J4 TradeDetailView-parity focal point (h1 + identity), on the
            cyan training surface (§21.5 non-confusable). */}
        <header className="flex flex-col gap-3">
          <Link
            href={trade.sessionId ? `/training/sessions/${trade.sessionId}` : '/training'}
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            {trade.sessionId ? 'Retour à la séance' : 'Mes backtests'}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="f-mono h-rise text-[28px] leading-none font-semibold tracking-[0.01em] text-[var(--t-1)] sm:text-[32px]">
              {trade.pair}
            </h1>
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
              Mode entraînement
            </span>
            {/* S8 V2 §33-3 — review status. Calm tones only (mute/cy/ok) — a
                pending review is awaited, never a fault (Mark Douglas §2). */}
            <Pill tone={reviewMeta.tone}>{reviewMeta.label}</Pill>
          </div>

          {/* §254 — parent session context (label + practised symbol/timeframe),
              echoed so a backtest opened from a session keeps its frame. Sober,
              never a 2nd identity (§21.5). Only when the session resolves. */}
          {sessionMeta ? (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="mute">
                <Layers className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {sessionMeta.label?.trim() || 'Séance sans nom'}
              </Pill>
              {sessionContext ? <Pill tone="cy">{sessionContext}</Pill> : null}
            </div>
          ) : null}
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

        {/* F1 — the optional TradingView link, rendered INDEPENDENTLY of the
            screenshot (a backtest may carry a link with no capture). Clickable
            here (this page is not wrapped in an outer Link, so a real anchor is
            valid). Validated https tradingview.com only at the Zod edge, opened
            with rel="noopener noreferrer" (tab-nabbing / referrer-leak guard). */}
        {trade.tradingViewUrl ? (
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-eyebrow-lg text-[var(--t-3)]">Lien TradingView</h2>
            <a
              href={trade.tradingViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--cy)] underline-offset-2 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
            >
              <ExternalLink
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              Ouvrir mon analyse sur TradingView
            </a>
          </Card>
        ) : null}

        <TrainingAnnotationsSection
          annotations={annotations}
          isAdmin={false}
          currentUserId={session.user.id}
        />

        {/* Wayfinding — un détail de backtest n'est pas un cul-de-sac : on relance
            la pratique (noter le suivant) ou on revient à la liste. Liens
            SECONDAIRES cyan, jamais un 2e CTA primaire (§21.5 non-confusable). */}
        <footer className="flex flex-col gap-2 border-t border-[var(--b-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-center">
          <Link
            href={trade.sessionId ? `/training/new?sessionId=${trade.sessionId}` : '/training/new'}
            className={btnVariants({ kind: 'secondary', size: 'm' })}
          >
            <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.75} />
            Noter un nouveau backtest
          </Link>
          <Link href="/training" className={btnVariants({ kind: 'ghost', size: 'm' })}>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retour à mes backtests
          </Link>
        </footer>
      </div>
    </main>
  );
}
