import { ArrowLeft, Target, Sparkles, Lightbulb, Check } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { getWeeklyReviewById } from '@/lib/weekly-review/service';

export const dynamic = 'force-dynamic';

// V1.9 TIER F — module-level formatters (cheaper than per-render in detail page).
const FMT_LONG_DATE_UTC = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const FMT_SUBMITTED_LONG_FR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

interface ReviewDetailProps {
  params: Promise<{ id: string }>;
}

/**
 * V1.8 REFLECT — `/review/[id]` read-only detail.
 *
 * Server Component. Closes the UX loop : timeline on `/review` links here.
 * Service `getWeeklyReviewById` user-scoped — returns null if the row
 * belongs to another member (anti-enumeration via 404).
 *
 * Posture : pure read-only view. No edit, no delete (V1.9 polish — admin
 * override path TBD). Process-language preserved — labels carbone wizard.
 */
export default async function ReviewDetailPage({ params }: ReviewDetailProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const { id } = await params;
  const review = await getWeeklyReviewById(session.user.id, id);
  if (!review) notFound();

  const formatLocalDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return FMT_LONG_DATE_UTC.format(dt);
  };

  const sections: Array<{
    title: string;
    content: string | null;
    icon: typeof Sparkles;
    eyebrow: string;
    /** Spans both columns — the next-step engagement deserves the emphasis
        and absorbs the orphan row when an even number of cards precede it. */
    emphasis?: boolean;
  }> = [
    {
      title: 'Ta plus grande victoire',
      content: review.biggestWin,
      icon: Sparkles,
      eyebrow: 'Process win',
    },
    {
      title: 'Ton plus grand piège',
      content: review.biggestMistake,
      icon: Lightbulb,
      eyebrow: 'Écart au plan',
    },
    {
      title: 'Ce qui a marché',
      content: review.bestPractice,
      icon: Check,
      eyebrow: 'Reverse-journaling',
    },
    {
      title: 'Leçon retenue',
      content: review.lessonLearned,
      icon: Target,
      eyebrow: 'Synthèse',
    },
    {
      title: 'Focus de la semaine suivante',
      content: review.nextWeekFocus,
      icon: Target,
      eyebrow: 'Engagement',
      emphasis: true,
    },
  ];

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-2">
          <Link
            href="/review"
            className="t-cap rounded-pill inline-flex h-8 items-center gap-1 px-2.5 text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
          >
            <ArrowLeft size={12} aria-hidden="true" /> Revues hebdomadaires
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <p className="t-eyebrow text-[var(--t-3)]">Revue hebdomadaire</p>
          <h1 className="t-h1 text-[var(--t-1)]">
            Semaine du{' '}
            <time dateTime={review.weekStart} className="font-mono">
              {formatLocalDate(review.weekStart)}
            </time>{' '}
            au{' '}
            <time dateTime={review.weekEnd} className="font-mono">
              {formatLocalDate(review.weekEnd)}
            </time>
          </h1>
          <p className="t-cap text-[var(--t-3)]">
            Soumise{' '}
            <time dateTime={review.submittedAt}>
              {FMT_SUBMITTED_LONG_FR.format(new Date(review.submittedAt))}
            </time>
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sections
            .filter((section) => Boolean(section.content))
            .map((section, i) => {
              const Icon = section.icon;
              return (
                <article
                  key={section.title}
                  className={`wow-rise rounded-card-lg flex flex-col border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] ${
                    section.emphasis ? 'lg:col-span-2' : ''
                  }`}
                  style={{ '--rise-delay': `${i * 70}ms` } as CSSProperties}
                  aria-labelledby={`section-${section.title}`}
                >
                  <header className="flex items-start gap-3">
                    <div
                      aria-hidden="true"
                      className="rounded-pill mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--b-acc)]"
                      style={{
                        // S19 — tokens (was fixed dark oklch → faint in light); both
                        // flip via .light .v18-theme (--acc-hi ~6.4:1 AA on the dim bg).
                        background: 'var(--acc-dim)',
                        color: 'var(--acc-hi)',
                      }}
                    >
                      <Icon size={15} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="t-eyebrow text-[var(--t-3)]">{section.eyebrow}</p>
                      <h2 id={`section-${section.title}`} className="t-h2 mt-0.5 text-[var(--t-1)]">
                        {section.title}
                      </h2>
                    </div>
                  </header>
                  <p className="t-body mt-3 whitespace-pre-wrap text-[var(--t-1)]">
                    {section.content}
                  </p>
                </article>
              );
            })}
        </div>
      </main>
    </V18ThemeScope>
  );
}
