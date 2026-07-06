import { ArrowRight, BrainCircuit, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ProcessLoop } from '@/components/illustrations/process-loop';
import { ABCDHero } from '@/components/reflect/abcd-hero';
import { V18CrisisBanner } from '@/components/review/crisis-banner';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { SubmitEchoCard } from '@/components/ui/submit-echo-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RecentRowCard } from '@/components/ui/recent-row-card';
import { safeTimeZone } from '@/lib/checkin/timezone';
import { echoProfileDims } from '@/lib/coaching/trade-echo';
import { buildReflectSubmitEcho } from '@/lib/coaching/submit-echo';
import { getProfileForUser } from '@/lib/onboarding-interview/service';
import { listRecentReflections } from '@/lib/reflection/service';
import { NextStepRail } from '@/components/nav/next-step-rail';

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
 *   1. Hero — glass `dash-hero` card (Tour 11 finding 1: migrated off the legacy
 *      V18 theme scope onto the app-wide DashboardAmbient so the module reads
 *      byte-identical to the rest of the app) with the ABCD SVG illustration.
 *   2. Optional crisis banner + a LIVING submit echo (finding 3): after a submit,
 *      a member-specific, register-declined reading of the act of naming a
 *      thought, replacing the old frozen paragraph.
 *   3. Recent reflections timeline (last 30 days) — Spotlight-lit RecentRowCards.
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
  const timezone = safeTimeZone(session.user.timezone);
  const fmtHm = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  // Tour 11 finding 3 — the living submit echo. Built ONLY on the post-submit
  // path (the freshest entry is the one we just wrote, newest-first order), and
  // declined by the member's coaching profile. Presence-only read of the
  // disputation (firewall §21.5 — never the free text). The profile query is
  // paid only when a submit actually just happened.
  let submitEcho = null;
  if (justSubmitted && !crisisLevel) {
    const profile = await getProfileForUser(session.user.id);
    const dims = echoProfileDims(profile);
    const latest = recent[0];
    submitEcho = buildReflectSubmitEcho({
      hasDisputation: latest ? latest.disputation.trim().length > 0 : false,
      learningStage: dims.learningStage,
      coachingRegister: dims.coachingRegister,
    });
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8 2xl:px-12">
        {/* HERO — Tour 11 finding 1 : glass dash-hero, illustration à droite. */}
        <section aria-labelledby="reflect-hero-heading" className="wow-reveal">
          <Card
            primary
            glass
            edge={false}
            className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-7"
          >
            <div className="relative grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-8">
              {/* ---- Gauche : intro ---- */}
              <div className="flex flex-col gap-3">
                {/* Tour 16 — accent maison : la boucle du process (Mark Douglas).
                    Petit repère visuel du hero, aligné à gauche, masqué en mobile
                    pour laisser respirer le titre. Décoratif (aria-hidden). */}
                <div aria-hidden className="hidden sm:mb-1 sm:block">
                  <ProcessLoop className="w-full max-w-[120px]" />
                </div>
                <p className="t-eyebrow-lg text-[var(--t-3)]">Module REFLECT</p>
                <h1
                  id="reflect-hero-heading"
                  className="f-display h-rise leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)]"
                  style={{
                    fontFeatureSettings: '"ss01" 1',
                    fontSize: 'clamp(1.9rem, 1.5rem + 1.6vw, 2.6rem)',
                  }}
                >
                  Quand la pensée
                  <br />
                  <span style={{ color: 'var(--acc-hi)' }}>vient en éclair</span>
                </h1>
                <p className="t-lead max-w-prose text-[var(--t-2)]">
                  Une réflexion structurée en quatre étapes :{' '}
                  <strong className="text-[var(--t-1)]">A</strong> (déclencheur) ·{' '}
                  <strong className="text-[var(--t-1)]">B</strong> (croyance) ·{' '}
                  <strong className="text-[var(--t-1)]">C</strong> (conséquence) ·{' '}
                  {/* Literal U+2019 (not &apos;) — the SWC compiler eats the
                      leading space of a JSXText holding an entity (Tour 15). */}
                  <strong className="text-[var(--t-1)]">D</strong> (mise en question). Le cadre ABCD
                  d’Ellis adapté au trading, pas un substitut à un suivi clinique.
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-3">
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
              </div>

              {/* ---- Droite : illustration ABCD ---- */}
              <div className="relative flex items-center justify-center">
                <ABCDHero className="w-full max-w-md" />
              </div>
            </div>
          </Card>
        </section>

        <NextStepRail currentPath="/reflect" />

        {/* CRISIS BANNER (conditional). `key={crisisLevel}` forces a clean
            remount when the level changes so `aria-live="polite"` re-announces
            only on region-change. Aligned with /review — the action redirect
            carries `?crisis=` and the landing mounts the banner here. */}
        {crisisLevel ? <V18CrisisBanner key={crisisLevel} level={crisisLevel} /> : null}

        {/* Tour 11 finding 3 — living submit echo (replaces the frozen paragraph). */}
        {submitEcho ? <SubmitEchoCard echo={submitEcho} /> : null}

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
              {recent.map((r) => {
                return (
                  <li key={r.id} className="h-full">
                    <RecentRowCard
                      href={`/reflect/${r.id}`}
                      ariaLabel={`Réflexion du ${FMT_REFLECT_DATE_LONG_UTC.format(
                        new Date(`${r.date}T00:00:00Z`),
                      )}`}
                      accentBar
                      className="h-full"
                    >
                      <header className="flex items-baseline justify-between gap-3">
                        <p className="t-eyebrow text-[var(--t-3)]">
                          <time dateTime={r.date}>
                            {FMT_REFLECT_DATE_LONG_UTC.format(new Date(`${r.date}T00:00:00Z`))}
                          </time>
                        </p>
                        <p className="t-cap font-mono text-[var(--t-3)]">
                          {fmtHm.format(new Date(r.createdAt))}
                        </p>
                      </header>
                      {/* Tour 11 (runtime audit) — the "Reframe" pill was dropped :
                          the D step is REQUIRED by the form, so the pill showed on
                          100% of rows — uniform noise, zero signal. The D line
                          below already carries the reframe itself. */}
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
                    </RecentRowCard>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
