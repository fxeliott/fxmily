import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { PauseRing } from '@/components/pre-trade/pause-ring';
import { PreTradeCheckWizard } from '@/components/pre-trade/pre-trade-wizard';
import type { CorrelationByReason } from '@/lib/pre-trade/correlation';
import { loadPreTradeCorrelationData } from '@/lib/pre-trade/service';
import { reportWarning } from '@/lib/observability';

export const metadata = {
  title: 'Pause pré-trade',
};

export const dynamic = 'force-dynamic';

/**
 * V2.3 — `/pre-trade/new` (ADR-003, jalon Session BB+CC).
 *
 * Server Component, DS-v2 NEUTRAL/lime. Auth-gated `status === 'active'`
 * — the wizard never runs for pending/banned accounts. The instrument
 * is a full-page wizard (ADR-003 §Alternatives Alt 1 reject: modal
 * dismiss-by-swipe defeats the friction-is-the-feature mechanism).
 *
 * No pre-submit summary, no Skip button, no read-only history feed —
 * the page IS the instrument (V1.5 mindset carbone). Friction = ~30s
 * for 4 one-tap questions (ADR-003 §Trade-offs).
 *
 * Posture §2 + ADR-003: zero free-text, zero crisis surface, zero
 * Black-Hat coercion (no rate-limit per day per ADR-003 Alt 4).
 */
export default async function NewPreTradeCheckPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  // Session 21 elevation — empirical mirror at the decision moment. The
  // member's own per-reason outcome stats (the Fxmily differentiator, already
  // shown post-hoc on /patterns) are surfaced AT the pause, the instant a
  // reason is picked. Best-effort: a load failure must never block the
  // discipline instrument itself, so we fall back to no mirror (honest
  // silence) rather than erroring the page.
  let correlation: CorrelationByReason | null = null;
  let correlationWindowDays = 30;
  try {
    const data = await loadPreTradeCorrelationData(session.user.id);
    correlation = data.perReason;
    correlationWindowDays = data.windowDays;
  } catch (err) {
    reportWarning('pre_trade', 'correlation_load_failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Tableau de bord
          </Link>

          <div className="flex items-start gap-4">
            {/* Breathing pause glyph — symbolises the 30s look, not a timer
                (ADR-003 miroir, pas barrière). Decorative, aria-hidden. */}
            <PauseRing className="mt-0.5 h-16 w-16 shrink-0 sm:h-20 sm:w-20" />

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Pré-trade · Pause de discipline
              </span>
              <h1
                id="ptw-heading"
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Avant d&apos;entrer, on regarde.
              </h1>
              <p className="t-cap text-[var(--t-3)]">Tu peux fermer cette page à tout moment.</p>
            </div>
          </div>
        </header>

        <PreTradeCheckWizard
          correlation={correlation}
          correlationWindowDays={correlationWindowDays}
        />
      </div>
    </main>
  );
}
