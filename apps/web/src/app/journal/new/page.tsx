import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { TradeFormWizard } from '@/components/journal/trade-form-wizard';
import { PreTradeTodayStatus } from '@/components/pre-trade/pre-trade-today-status';
import { getTodayPreTradeStatus } from '@/lib/pre-trade/service';

export const metadata = {
  title: 'Nouveau trade',
};

export const dynamic = 'force-dynamic';

export default async function NewTradePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // F2 — the member's set timezone drives the entry-time picker (pre-fill +
  // label) and the server-side wall-clock → UTC conversion on submit.
  const timezone = session.user.timezone || 'Europe/Paris';

  // P3 fix — reflect whether the day's pre-trade is already submitted so the
  // member never wonders (and never redoes it for nothing). Best-effort: a
  // load failure must never block the trade form, so we fall back to the calm
  // "todo" invitation (honest default — the recall is a nudge, not a gate).
  let preTradeStatus: Awaited<ReturnType<typeof getTodayPreTradeStatus>> = {
    done: false,
    at: null,
  };
  try {
    preTradeStatus = await getTodayPreTradeStatus(session.user.id, timezone);
  } catch {
    // Swallowed on purpose — the form must render regardless.
  }

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
        {/* P3 fix — reflect the day's pre-trade state ABOVE the trade form
          (replaces the V2.3 ADR-003 static "Pause 30s" banner, which never
          told the member whether the pre-trade was already done — they could
          redo it for nothing). Two calm states, Mark Douglas posture (§2):
          done → "fait à HHhMM" + link to the recap (/patterns) ; todo → the
          same non-coercive invitation to /pre-trade/new as before. Still
          optional, still skippable (the form is right below). */}
        <PreTradeTodayStatus status={preTradeStatus} timezone={timezone} />

        <TradeFormWizard timezone={timezone} />
      </div>
    </main>
  );
}
