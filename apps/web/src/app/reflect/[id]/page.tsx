import { ArrowLeft, HeartPulse, MessageCircleQuestion, Sparkles, Zap } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { getReflectionById } from '@/lib/reflection/service';

export const dynamic = 'force-dynamic';

// V1.9 TIER F — the entry DAY label is a civil-date pin (UTC frame). The
// submission-time (HH:mm) formatter is an INSTANT, built per request inside the
// component (F2 — it follows the member's session timezone).
const FMT_WEEKDAY_LONG_UTC = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

interface ReflectionDetailProps {
  params: Promise<{ id: string }>;
}

/**
 * V1.8 REFLECT — `/reflect/[id]` read-only ABCD entry detail.
 *
 * Server Component. Pattern carbone `/review/[id]/page.tsx`. Same posture :
 * pure read-only, no edit/delete V1.8 (V1.9 polish admin override TBD).
 *
 * Visual identity : per-letter color progression matches `<ABCDHero>` —
 * A=blue-700 (deepest, trigger), B=blue-600, C=blue-500, D=blue-300
 * (climax, resolution).
 */
export default async function ReflectionDetailPage({ params }: ReflectionDetailProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const { id } = await params;
  const entry = await getReflectionById(session.user.id, id);
  if (!entry) notFound();

  // F2 — the submission instant (HH:mm) renders in the member's own timezone.
  const timezone = session.user.timezone || 'Europe/Paris';
  const fmtHm = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  const formatLocalDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return FMT_WEEKDAY_LONG_UTC.format(dt);
  };

  // Per-letter cool progression A→D, 100% tokens so it flips in light/dark
  // (AA in both). A=indigo --acc-2, B=blue --acc, C=blue-hi --acc-hi, D=cyan
  // --cy ; mono-accent cool spectre, the only CTA stays --acc elsewhere.
  const sections = [
    {
      letter: 'A',
      title: `L'événement déclencheur`,
      eyebrow: 'Faits',
      icon: Zap,
      content: entry.triggerEvent,
      color: 'var(--acc-2)',
    },
    {
      letter: 'B',
      title: 'La pensée automatique',
      eyebrow: 'Belief',
      icon: MessageCircleQuestion,
      content: entry.beliefAuto,
      color: 'var(--acc)',
    },
    {
      letter: 'C',
      title: 'Émotion + comportement',
      eyebrow: 'Consequence',
      icon: HeartPulse,
      content: entry.consequence,
      color: 'var(--acc-hi)',
    },
    {
      letter: 'D',
      title: 'Le reframe',
      eyebrow: 'Disputation',
      icon: Sparkles,
      content: entry.disputation,
      color: 'var(--cy)',
    },
  ] as const;

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-2">
          <Link
            href="/reflect"
            className="t-cap rounded-pill inline-flex h-8 items-center gap-1 px-2.5 text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
          >
            <ArrowLeft size={12} aria-hidden="true" /> Réflexions ABCD
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <p className="t-eyebrow text-[var(--t-3)]">Réflexion ABCD</p>
          <h1 className="t-h1 text-[var(--t-1)] first-letter:capitalize">
            <time dateTime={entry.date}>{formatLocalDate(entry.date)}</time>
          </h1>
          <p className="t-cap text-[var(--t-3)]">
            Soumise{' '}
            <time dateTime={entry.createdAt}>{fmtHm.format(new Date(entry.createdAt))}</time>
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sections.map((s, i) => {
            const Icon = s.icon;
            return (
              <article
                key={s.letter}
                className="wow-rise rounded-card-lg flex flex-col border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)]"
                style={{ '--rise-delay': `${i * 70}ms` } as CSSProperties}
                aria-labelledby={`abcd-${s.letter}`}
              >
                <header className="flex items-start gap-3">
                  <div
                    aria-hidden="true"
                    className="rounded-pill flex h-11 w-11 shrink-0 items-center justify-center border"
                    style={{
                      background: 'var(--bg-2)',
                      borderColor: s.color,
                      color: s.color,
                    }}
                  >
                    <span className="font-display text-[16px] leading-none font-bold">
                      {s.letter}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="t-eyebrow flex items-center gap-1.5 text-[var(--t-3)]">
                      <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
                      {s.eyebrow}
                    </p>
                    <h2 id={`abcd-${s.letter}`} className="t-h2 mt-0.5 text-[var(--t-1)]">
                      {s.title}
                    </h2>
                  </div>
                </header>
                <p className="t-body mt-3 whitespace-pre-wrap text-[var(--t-1)]">{s.content}</p>
              </article>
            );
          })}
        </div>
      </main>
    </V18ThemeScope>
  );
}
