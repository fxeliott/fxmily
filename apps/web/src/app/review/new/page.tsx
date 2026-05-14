import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { WeeklyReviewWizard } from '@/components/review/weekly-review-wizard';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';

export const dynamic = 'force-dynamic';

/**
 * V1.8 REFLECT — `/review/new` host page.
 *
 * Server Component shell that auth-gates the wizard. The actual UX lives
 * in `<WeeklyReviewWizard>` (Client component, Framer Motion + localStorage
 * draft + Server Action submit).
 *
 * Posture (Mark Douglas) : the page chrome is intentionally bare — no
 * KPI strip, no streak, no progress widgets. The wizard is the focal.
 */
export default async function NewWeeklyReviewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-2">
          <Link
            href="/review"
            className="t-cap rounded-pill inline-flex h-8 items-center gap-1 px-2.5 text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
          >
            ← Revues hebdomadaires
          </Link>
        </nav>

        <WeeklyReviewWizard />
      </main>
    </V18ThemeScope>
  );
}
