import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { WeeklyFocusRecall } from '@/components/review/weekly-focus-recall';
import {
  WeeklyReviewWizard,
  type WeeklyReviewPrefill,
} from '@/components/review/weekly-review-wizard';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { listMyRecentReviews } from '@/lib/weekly-review/service';
import { currentWeekStartUTC, findCurrentWeekReview } from '@/lib/weekly-review/week';

export const dynamic = 'force-dynamic';

/**
 * V1.8 REFLECT — `/review/new` host page.
 *
 * Server Component shell that auth-gates the wizard. The actual UX lives
 * in `<WeeklyReviewWizard>` (Client component, Framer Motion + localStorage
 * draft + Server Action submit).
 *
 * P2 fix (mindset/new parity) : if the current week already has a review,
 * the wizard starts PREFILLED with the existing answers and a notice says
 * re-submitting updates it — the one-per-week upsert stops being a silent
 * overwrite path.
 *
 * Posture (Mark Douglas) : the page chrome is intentionally bare — no
 * KPI strip, no streak, no progress widgets. The wizard is the focal.
 */
export default async function NewWeeklyReviewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  // S15 #15 — week-level intention loop: recall the focus the member set in his
  // LAST review. Fetch the 2 newest and pick the most recent strictly BEFORE
  // this week's Monday, so re-editing the current week's review never echoes its
  // own focus back. Read-only, zero new column (reuses listMyRecentReviews).
  const thisWeek = currentWeekStartUTC();
  const recent = await listMyRecentReviews(session.user.id, 2);
  const previousFocus = recent.find((r) => r.weekStart < thisWeek)?.nextWeekFocus ?? null;

  // P2 fix — same 2-row fetch also answers "does this week already have a
  // review?" (newest-first, so the current week is always in the window).
  const existing = findCurrentWeekReview(recent, thisWeek);
  const prefill: WeeklyReviewPrefill | undefined = existing
    ? {
        biggestWin: existing.biggestWin,
        biggestMistake: existing.biggestMistake,
        bestPractice: existing.bestPractice,
        lessonLearned: existing.lessonLearned,
        nextWeekFocus: existing.nextWeekFocus,
      }
    : undefined;

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

        {existing ? (
          <section
            aria-label="Revue de la semaine déjà enregistrée"
            data-slot="review-edit-notice"
            className="rounded-card-lg border border-[var(--b-acc)] p-4"
            style={{
              background: 'linear-gradient(135deg, var(--acc-dim) 0%, var(--bg-2) 80%)',
            }}
          >
            <p className="t-eyebrow text-[var(--t-3)]">Reprendre ma revue</p>
            <p className="t-body mt-1 text-[var(--t-1)]">
              Tu as déjà une revue pour cette semaine : la soumettre à nouveau la met à jour.
            </p>
          </section>
        ) : null}

        <WeeklyFocusRecall focus={previousFocus} />

        <WeeklyReviewWizard {...(prefill ? { prefill } : {})} />
      </main>
    </V18ThemeScope>
  );
}
