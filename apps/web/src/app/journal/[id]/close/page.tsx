import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { CloseTradeForm } from '@/components/journal/close-trade-form';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { getTradeById } from '@/lib/trades/service';

export const metadata = {
  title: 'Clôturer le trade',
};

export const dynamic = 'force-dynamic';

interface CloseTradePageProps {
  params: Promise<{ id: string }>;
}

export default async function CloseTradePage({ params }: CloseTradePageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;
  const trade = await getTradeById(session.user.id, id);
  if (!trade) notFound();
  if (trade.isClosed) redirect(`/journal/${trade.id}`);

  // F2 — the member's set timezone drives the exit-time default + the server
  // wall-clock → UTC conversion on submit.
  const timezone = session.user.timezone || 'Europe/Paris';

  return (
    <main className="relative bg-[var(--bg)]">
      {/* S13 — ambient depth backplate (same zero-JS server component the hub /
          journal use). The opaque <main> masks the app-wide app-ambient → no
          double aurora; the relative content wrapper below sits above the -z-10
          mesh. Decorative: aria-hidden + pointer-events:none + reduced-motion. */}
      <DashboardAmbient />

      {/* `dash-stagger` cascades the back-link / hero / form / footnote in on
          load (wowRise, compositor-only, reduced-motion-safe). */}
      <div className="dash-stagger relative mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-3">
          <Link
            href={`/journal/${trade.id}`}
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Détail du trade
          </Link>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Pill tone="warn" dot="live">
                CLÔTURE
              </Pill>
              <span className="t-eyebrow">Étape finale · résultat</span>
            </div>
            <h1
              className="f-display h-rise text-[24px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[28px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Clôturer <span className="f-mono text-[var(--acc)]">{trade.pair}</span>
            </h1>
            <p className="t-lead">
              Renseigne le prix de sortie, le résultat et le lien TradingView de la sortie. Le R
              réalisé sera calculé automatiquement.
            </p>
          </div>
        </header>

        <Card primary className="p-5 sm:p-6">
          {/* F2 — the exit default is rendered in the member's SET timezone and
            the submitted wall-clock is converted to UTC server-side in that same
            timezone (symmetric, offset-stable). */}
          <CloseTradeForm tradeId={trade.id} enteredAtIso={trade.enteredAt} timezone={timezone} />
        </Card>

        <p className="t-foot text-center text-[var(--t-4)]">
          Une fois clôturé, ce trade ne peut plus être modifié, uniquement supprimé.
        </p>
      </div>
    </main>
  );
}
