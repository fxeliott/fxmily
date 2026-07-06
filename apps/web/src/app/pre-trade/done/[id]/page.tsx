import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { PauseRing } from '@/components/pre-trade/pause-ring';
import { PreTradeEchoCard } from '@/components/pre-trade/pre-trade-echo-card';
import { buildPreTradeEcho } from '@/lib/coaching/pre-trade-echo';
import { echoProfileDims } from '@/lib/coaching/trade-echo';
import { db } from '@/lib/db';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import {
  PRE_TRADE_EMOTIONS,
  PRE_TRADE_REASONS,
  type PreTradeEmotion,
  type PreTradeReason,
} from '@/lib/schemas/pre-trade-check';

export const metadata = {
  title: 'Pause pré-trade',
};

export const dynamic = 'force-dynamic';

interface PreTradeDonePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Tour 11 — `/pre-trade/done/[id]` (finding 3).
 *
 * The pre-trade "pause de discipline" used to redirect to
 * `/dashboard?done=pre-trade`, where the param was DEAD (the dashboard never
 * read it): the 30s pause fell into the void, zero acknowledgement. This page
 * is the confirmation surface: it reloads the PreTradeCheck the member just
 * created (BOLA-safe: `where id + userId`) and renders a deterministic,
 * register-personalised echo of what they declared.
 *
 * POSTURE §2 / ADR-003: the echo is a MIRROR, never a barrier — we never tell
 * the member not to trade. From here they go back to journal their entry.
 */
export default async function PreTradeDonePage({ params }: PreTradeDonePageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { id } = await params;

  // BOLA guard — scope the read to the owner. A check that does not belong to
  // this member (or does not exist) is a 404, never someone else's data.
  const check = await db.preTradeCheck.findFirst({
    where: { id, userId: session.user.id },
    select: {
      reasonToTrade: true,
      emotionLabel: true,
      planAlignment: true,
      stopLossPredefined: true,
    },
  });
  if (!check) notFound();

  // Defensive: the DB columns are plain strings — re-narrow to the enum unions
  // before feeding the pure echo (a legacy/garbage value degrades to the safe
  // 'edge'/'calme' baseline rather than crashing the confirmation page).
  const reasonToTrade: PreTradeReason = (PRE_TRADE_REASONS as readonly string[]).includes(
    check.reasonToTrade,
  )
    ? (check.reasonToTrade as PreTradeReason)
    : 'edge';
  const emotionLabel: PreTradeEmotion = (PRE_TRADE_EMOTIONS as readonly string[]).includes(
    check.emotionLabel,
  )
    ? (check.emotionLabel as PreTradeEmotion)
    : 'calme';

  const profile = await getProfileForUser(session.user.id);
  const dims = echoProfileDims(profile);

  const echo = buildPreTradeEcho({
    reasonToTrade,
    emotionLabel,
    planAlignment: check.planAlignment,
    stopLossPredefined: check.stopLossPredefined,
    coachingRegister: dims.coachingRegister,
  });

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Tableau de bord
          </Link>

          <div className="flex items-start gap-4">
            <PauseRing className="mt-0.5 h-14 w-14 shrink-0 sm:h-16 sm:w-16" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="t-eyebrow-lg text-[var(--t-3)]">Pré-trade · Pause enregistrée</span>
              <h1
                className="f-display h-rise text-[26px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[30px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Ta pause est prise.
              </h1>
            </div>
          </div>
        </header>

        {/* Tour 11 — the living reading of what was just declared. */}
        <PreTradeEchoCard echo={echo} />

        {/* The pause is a mirror, not a barrier: the member decides. Two calm
            exits, never a "don't trade" injunction (ADR-003). */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/journal/new"
            className="rounded-control focus-visible:ring-ring inline-flex flex-1 items-center justify-center gap-2 border border-[var(--b-acc-strong)] bg-[var(--acc)] px-4 py-2.5 text-[14px] font-semibold text-[var(--acc-fg)] transition-colors hover:bg-[var(--acc-hi)] focus-visible:ring-2 focus-visible:outline-none"
          >
            Journaliser mon entrée
            <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </Link>
          <Link
            href="/dashboard"
            className="rounded-control inline-flex flex-1 items-center justify-center border border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-2.5 text-[14px] font-medium text-[var(--t-2)] transition-colors hover:text-[var(--t-1)]"
          >
            Retour au tableau
          </Link>
        </div>
      </div>
    </main>
  );
}
