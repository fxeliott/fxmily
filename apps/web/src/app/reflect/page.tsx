import { ArrowRight, BrainCircuit } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ABCDHero } from '@/components/reflect/abcd-hero';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { listRecentReflections } from '@/lib/reflection/service';

export const dynamic = 'force-dynamic';

// V1.9 TIER F — hoisted at module level (timeline can render up to 30 rows,
// each previously instantiated 2 formatters).
const FMT_REFLECT_DATE_LONG_UTC = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const FMT_HM_FR = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

interface ReflectLandingProps {
  searchParams: Promise<{ crisis?: string; done?: string }>;
}

/**
 * V1.8 REFLECT — `/reflect` landing.
 *
 * Server Component. Three sections :
 *   1. Hero — ABCD SVG illustration + intro copy + primary CTA.
 *   2. Recent reflections timeline (last 30 days, clamped service-side).
 *
 * Note : crisis banner is NOT mounted here (the redirect URL state is
 * checked on /reflect after a submit — landing for first-visit case
 * stays clean ; the action redirect carries the crisis banner via
 * `?crisis=` query param consumed below if present).
 *
 * Auth gate : redirect to /login if not active.
 */
export default async function ReflectLandingPage({ searchParams }: ReflectLandingProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  const sp = await searchParams;
  const justSubmitted = sp.done === '1';

  const recent = await listRecentReflections(session.user.id, 30);

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="t-eyebrow text-[var(--t-3)]">Module REFLECT</p>
            <h1
              className="t-display text-[var(--t-1)]"
              style={{ fontSize: 'clamp(36px, 7vw, 56px)' }}
            >
              Quand la pensée
              <br />
              <span style={{ color: 'var(--acc-hi)' }}>vient en éclair</span>
            </h1>
            <p className="t-lead max-w-prose text-[var(--t-2)]">
              Une réflexion CBT structurée en quatre étapes :{' '}
              <strong className="text-[var(--t-1)]">A</strong>déclencheur ·{' '}
              <strong className="text-[var(--t-1)]">B</strong>elief ·{' '}
              <strong className="text-[var(--t-1)]">C</strong>onséquence ·{' '}
              <strong className="text-[var(--t-1)]">D</strong>isputation. Cadre Ellis adapté au
              trading — pas un substitut à un suivi clinique.
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            <ABCDHero className="w-full max-w-lg" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/reflect/new"
              className="rounded-control inline-flex h-12 items-center gap-2 bg-[var(--acc)] px-5 text-[14px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]"
            >
              <BrainCircuit size={16} strokeWidth={2.2} aria-hidden="true" />
              Démarrer une réflexion
              <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-4 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
            >
              Retour au dashboard
            </Link>
          </div>
        </header>

        {justSubmitted ? (
          <div
            role="status"
            className="rounded-card-lg border border-[var(--b-acc)] p-4"
            style={{
              background:
                'linear-gradient(135deg, oklch(0.62 0.19 254 / 0.16) 0%, oklch(0.13 0.028 254 / 0.85) 80%)',
            }}
          >
            <p className="t-eyebrow text-[var(--t-3)]">Enregistrée</p>
            <p className="t-h3 mt-1 text-[var(--t-1)]">
              La pensée a été nommée. C&apos;est le premier pas du reframe.
            </p>
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-h2 text-[var(--t-1)]">Tes réflexions (30 derniers jours)</h2>
            <p className="t-cap text-[var(--t-3)]">{recent.length} réflexion·s</p>
          </div>

          {recent.length === 0 ? (
            <div
              className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
              data-empty="true"
            >
              <p className="t-body text-[var(--t-2)]">
                Aucune réflexion enregistrée. La prochaine pensée éclair sera la bonne.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5" data-slot="recent-reflections">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/reflect/${r.id}`}
                    aria-labelledby={`ref-${r.id}-date`}
                    className="rounded-card block border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  >
                    <header className="flex items-baseline justify-between gap-3">
                      <p className="t-eyebrow text-[var(--t-3)]" id={`ref-${r.id}-date`}>
                        <time dateTime={r.date}>
                          {FMT_REFLECT_DATE_LONG_UTC.format(new Date(`${r.date}T00:00:00Z`))}
                        </time>
                      </p>
                      <p className="t-cap font-mono text-[var(--t-3)]">
                        {FMT_HM_FR.format(new Date(r.createdAt))}
                      </p>
                    </header>
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex items-baseline gap-2">
                        <dt className="t-eyebrow w-7 shrink-0 text-[oklch(0.46_0.21_263)]">A</dt>
                        <dd className="t-body line-clamp-1 text-[var(--t-2)]">{r.triggerEvent}</dd>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <dt className="t-eyebrow w-7 shrink-0 text-[oklch(0.82_0.115_247)]">D</dt>
                        <dd className="t-body line-clamp-1 text-[var(--t-1)]">{r.disputation}</dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </V18ThemeScope>
  );
}
