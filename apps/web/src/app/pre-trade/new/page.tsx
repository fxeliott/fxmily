import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PreTradeCheckWizard } from '@/components/pre-trade/pre-trade-wizard';

export const metadata = {
  title: 'Pause pré-trade · Fxmily',
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
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
          <p className="t-cap text-[var(--t-3)]">
            Tu peux fermer cette page à tout moment. Le wizard est un miroir, pas une barrière.
          </p>
        </div>
      </header>

      <PreTradeCheckWizard />
    </main>
  );
}
