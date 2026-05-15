import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { SleepHabitWizard } from '@/components/track/sleep-habit-wizard';
import { auth } from '@/auth';

/**
 * V2.1 TRACK — Sleep wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<SleepHabitWizard>` Client
 * Component which handles the 2-step flow + Server Action submit.
 */

export const dynamic = 'force-dynamic';

export default async function TrackSleepNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 outline-none"
    >
      <header className="space-y-2">
        <Link
          href="/track"
          className="inline-flex min-h-6 items-center gap-1.5 px-2 py-1.5 text-[13px] font-medium text-[var(--t-3)] hover:text-[var(--t-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour au suivi
        </Link>
        <p className="text-[12px] font-medium tracking-[0.10em] text-[var(--acc)] uppercase">
          Pilier sommeil
        </p>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--t-1)] sm:text-[28px]">
          Logger ton sommeil
        </h1>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Walker, <em>Why We Sleep</em>, ch. 5 — Steenbarger, <em>Trading Psychology 2.0</em>. La
          bande 6,5–9 h est l&apos;optimal de prise de décision et de régulation émotionnelle. En
          dessous de 5 h, tu trades avec un désavantage mesurable.
        </p>
      </header>

      <SleepHabitWizard />
    </main>
  );
}
