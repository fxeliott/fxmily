import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { NutritionHabitWizard } from '@/components/track/nutrition-habit-wizard';
import { auth } from '@/auth';

/**
 * V2.1.1 TRACK — Nutrition wizard host (Server Component).
 *
 * Auth gate (status === 'active'). Renders the `<NutritionHabitWizard>`
 * Client Component which handles the 2-step flow + Server Action submit.
 */

export const dynamic = 'force-dynamic';

export default async function TrackNutritionNewPage() {
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
          className="inline-flex min-h-6 items-center gap-2 px-2 py-2 text-[13px] font-medium text-[var(--t-3)] hover:text-[var(--t-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour au suivi
        </Link>
        <p className="text-[12px] font-medium tracking-[0.10em] text-[var(--acc)] uppercase">
          Pilier nutrition
        </p>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--t-1)] sm:text-[28px]">
          Logger ta nutrition
        </h1>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Des repas réguliers stabilisent ta glycémie : moins d&apos;à-coups d&apos;énergie, moins
          de décisions impulsives en session. On note le nombre de repas et la qualité ressentie —
          aucun comptage de calories.
        </p>
      </header>

      <NutritionHabitWizard />
    </main>
  );
}
