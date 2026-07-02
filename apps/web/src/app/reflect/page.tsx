import { ArrowRight, BrainCircuit, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ABCDHero } from '@/components/reflect/abcd-hero';
import { V18CrisisBanner } from '@/components/review/crisis-banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverLift } from '@/components/ui/hover-lift';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';
import { listRecentReflections } from '@/lib/reflection/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Réflexion' };

// V1.9 TIER F — the reflection DAY label is a civil-date pin, hoisted in the UTC
// frame. The submission-time (HH:mm) formatter is an INSTANT and is built per
// request inside the component (F2 — it must follow the member's session zone).
const FMT_REFLECT_DATE_LONG_UTC = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
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
  const crisisLevel =
    sp.crisis === 'high' || sp.crisis === 'medium' ? (sp.crisis as 'high' | 'medium') : null;
  const justSubmitted = sp.done === '1';

  const recent = await listRecentReflections(session.user.id, 30);

  // F2 — submission times (HH:mm) render in the member's own timezone. Built
  // once per request, reused across the ≤30 rows.
  const timezone = session.user.timezone || 'Europe/Paris';
  const fmtHm = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8 2xl:px-12">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="t-eyebrow text-[var(--t-3)]">Module REFLECT</p>
            <h1 className="t-display-fluid text-[var(--t-1)]">
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
              trading, pas un substitut à un suivi clinique.
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            <ABCDHero className="w-full max-w-lg" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/reflect/new"
              className="rounded-control inline-flex h-12 items-center gap-2 bg-[var(--acc-btn)] px-5 text-[14px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)] motion-safe:hover:-translate-y-px"
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

        {/* CRISIS BANNER (conditional). `key={crisisLevel}` forces a clean
            remount when the level changes so `aria-live="polite"` re-announces
            only on region-change. Aligned with /review — the action redirect
            carries `?crisis=` and the landing mounts the banner here. */}
        {crisisLevel ? <V18CrisisBanner key={crisisLevel} level={crisisLevel} /> : null}

        {justSubmitted && !crisisLevel ? (
          <div
            role="status"
            className="wow-rise rounded-card-lg border border-[var(--b-acc)] p-4"
            style={{
              background: 'linear-gradient(135deg, var(--acc-dim) 0%, var(--bg-2) 80%)',
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
            <p className="t-cap text-[var(--t-3)]">{recent.length} sur 30 derniers jours</p>
          </div>

          {recent.length === 0 ? (
            <Card primary className="py-2" data-empty="true">
              <EmptyState
                icon={Sparkles}
                headline="Aucune réflexion enregistrée."
                lead="La prochaine pensée éclair sera la bonne. Le formulaire ci-dessus t'attend."
              />
              <div className="flex justify-center pb-8">
                <Link
                  href="/reflect/new"
                  className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-4 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
                >
                  Démarrer une réflexion
                  <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
                </Link>
              </div>
            </Card>
          ) : (
            <ul
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
              data-slot="recent-reflections"
            >
              {recent.map((r) => (
                <li key={r.id} className="h-full">
                  <HoverLift className="block h-full">
                    <Link
                      href={`/reflect/${r.id}`}
                      aria-labelledby={`ref-${r.id}-date`}
                      className="rounded-card block h-full border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-[border-color,box-shadow] duration-150 hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
                    >
                      <header className="flex items-baseline justify-between gap-3">
                        <p className="t-eyebrow text-[var(--t-3)]" id={`ref-${r.id}-date`}>
                          <time dateTime={r.date}>
                            {FMT_REFLECT_DATE_LONG_UTC.format(new Date(`${r.date}T00:00:00Z`))}
                          </time>
                        </p>
                        <p className="t-cap font-mono text-[var(--t-3)]">
                          {fmtHm.format(new Date(r.createdAt))}
                        </p>
                      </header>
                      <dl className="mt-2 space-y-1.5">
                        <div className="flex items-baseline gap-2">
                          <dt className="t-eyebrow w-7 shrink-0 text-[var(--acc-2)]">A</dt>
                          <dd className="t-body line-clamp-1 text-[var(--t-2)]">
                            {r.triggerEvent}
                          </dd>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <dt className="t-eyebrow w-7 shrink-0 text-[var(--cy)]">D</dt>
                          <dd className="t-body line-clamp-1 text-[var(--t-1)]">{r.disputation}</dd>
                        </div>
                      </dl>
                    </Link>
                  </HoverLift>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </V18ThemeScope>
  );
}
