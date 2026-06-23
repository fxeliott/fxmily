import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TradeFormWizard } from '@/components/journal/trade-form-wizard';

export const metadata = {
  title: 'Nouveau trade',
};

export const dynamic = 'force-dynamic';

export default async function NewTradePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="relative bg-[var(--bg)]">
      {/* S19 — ambient depth backplate (parité avec journal close, les formulaires
          track et pre-trade : la page était plate, seule du groupe journal sans mesh).
          Décoratif (aria-hidden, pointer-events:none, reduced-motion-safe). */}
      <DashboardAmbient />
      {/* S20 — max-w-xl (was 2xl) so the pre-trade banner shares the wizard's
          gutter (TradeFormWizard is internally max-w-xl); the banner was wider
          than the form below it = desktop misalignment. */}
      <div className="relative mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        {/* V2.3 — Pre-trade circuit breaker trigger (ADR-003 Trigger B).
          Optional banner ABOVE the trade form. Calm tone, non-coercive,
          one-tap dismiss via the inline "Continuer sans pause" link below
          isn't needed — the form is already visible, the user proceeds
          by scrolling. ADR-003 §Alt 3: NO Skip button INSIDE the wizard
          itself, but the entry IS skippable (the user can ignore the
          banner). Friction is the feature, not the only path.

          a11y: `aria-label` on the link describes the destination ;
          banner is keyboard-reachable + min 44px touch target. */}
        <aside
          className="rounded-card mb-6 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4"
          aria-labelledby="pre-trade-banner-heading"
        >
          <Link
            href="/pre-trade/new"
            className="focus-visible:rounded-card flex items-center gap-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-label="Faire la pause 30 secondes pré-trade avant de continuer"
          >
            <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
              <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                id="pre-trade-banner-heading"
                className="text-[13px] font-semibold text-[var(--t-1)]"
              >
                Pause 30 secondes avant ton trade ?
              </span>
              <span className="text-[12px] leading-relaxed text-[var(--t-2)]">
                4 questions courtes — raison, émotion, plan, stop-loss. Optionnel.
              </span>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-[var(--acc)]" aria-hidden="true" />
          </Link>
        </aside>

        <TradeFormWizard />
      </div>
    </main>
  );
}
