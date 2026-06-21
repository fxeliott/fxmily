import { ArrowLeft, ArrowRight, Compass, Target } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { ProfileAnalysisPulse } from '@/components/profile/profile-analysis-pulse';
import { btnVariants } from '@/components/ui/btn';
import { getInterviewForUser, getProfileForUser } from '@/lib/onboarding-interview/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Mon profil',
};

export const dynamic = 'force-dynamic';

/**
 * V2.4 Phase B — `/profile` member-facing profile page (M3 directive).
 *
 * Standalone first-class route (Round 3 decision §D arbitrage #5 vs nested
 * `/account/profile`). Server Component, DS-v2 lime neutral.
 *
 * States :
 *   - No interview yet → CTA to start `/onboarding/interview`.
 *   - Interview in-flight → CTA to resume `/onboarding/interview/new`.
 *   - Interview completed but profile not analyzed yet (batch hasn't run) →
 *     calm pending placeholder "Ton profil est en cours d'analyse".
 *   - Profile analyzed → render summary + highlights + axes_prioritaires
 *     with EU AI Act 50(1) `<AIGeneratedBanner>` inline (deadline 2 août
 *     2026, pénalité €15M / 3% CA Article 99(4)).
 *
 * Posture §J / §16 — `MemberProfile.{highlights, axes_prioritaires}` are typed
 * `Json` server-side ; we render them defensively (string coercion + arrays).
 * Posture Mark Douglas — descriptif comportemental, jamais clinique ; the
 * AIGeneratedBanner reminds the membre that this complements, never replaces,
 * coaching humain.
 */
interface ProfileHighlight {
  key?: unknown;
  label?: unknown;
  evidence?: unknown;
}

function asHighlights(raw: unknown): ProfileHighlight[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is ProfileHighlight => typeof h === 'object' && h !== null);
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string');
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const [interview, profile] = await Promise.all([
    getInterviewForUser(session.user.id),
    getProfileForUser(session.user.id),
  ]);

  // A mock profile (batch ran without ANTHROPIC_API_KEY → placeholder sentinel
  // `mock:<model>`, claude-client.ts) is NOT the real Claude analysis (§30).
  // Surface it as "analyse en cours" so a member never mistakes the placeholder
  // for their real profile — the real one lands when the local `claude --print`
  // batch runs ($0, human-in-the-loop §5.4).
  const isMockProfile = !!profile?.claudeModelVersion?.startsWith('mock:');

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the masthead */}
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Tableau de bord
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Compass className="h-3.5 w-3.5" strokeWidth={2} />
              Mon profil
            </span>
            <h1 className="t-h1 text-[var(--t-1)]">Ton profil de trader.</h1>
          </div>
        </header>

        {/* ============================================================== */}
        {/* State : no interview started                                    */}
        {/* ============================================================== */}
        {!interview ? (
          <ProfilePlaceholder
            eyebrow="Entretien onboarding"
            title="Commence par te raconter."
            body={
              <>
                Un entretien guidé de 30 questions (~30 min) pour qu&apos;Eliott puisse te coacher
                au plus juste. Tes réponses restent confidentielles, l&apos;IA en tire un profil
                descriptif.
              </>
            }
            ctaHref="/onboarding/interview"
            ctaLabel="Commencer mon entretien"
          />
        ) : null}

        {/* ============================================================== */}
        {/* State : interview in-flight (no profile yet)                    */}
        {/* ============================================================== */}
        {interview && interview.status !== 'completed' && !profile ? (
          <ProfilePlaceholder
            eyebrow="Entretien en cours"
            title="Reprends où tu en étais."
            body={
              <>
                Tu as commencé ton entretien — tes réponses sont sauvegardées. Termine-le quand tu
                te sens prêt·e pour activer ton profil personnalisé.
              </>
            }
            ctaHref="/onboarding/interview/new"
            ctaLabel="Reprendre mon entretien"
          />
        ) : null}

        {/* ============================================================== */}
        {/* State : interview completed but analysis pending (batch hasn't  */}
        {/* run yet — calm pending placeholder)                             */}
        {/* ============================================================== */}
        {interview?.status === 'completed' && (!profile || isMockProfile) ? (
          <section
            className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-acc)] bg-[var(--bg-2)] p-6"
            aria-labelledby="profile-pending-heading"
          >
            <div className="flex items-start gap-3">
              <ProfileAnalysisPulse />
              <div className="min-w-0 flex-1">
                <p className="t-eyebrow-lg text-[var(--t-3)]">Analyse en cours</p>
                <h2 id="profile-pending-heading" className="t-h2 mt-1 text-[var(--t-1)]">
                  Ton profil est en cours d&apos;analyse.
                </h2>
                <p className="t-body mt-2 text-[var(--t-2)]">
                  Tu as terminé ton entretien. Eliott et l&apos;IA prennent le temps de relire tes
                  30 réponses — ton profil descriptif sera disponible dans les prochaines 24h.
                  Reviens demain.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* ============================================================== */}
        {/* State : profile analyzed — render content + AI banner            */}
        {/* (mock placeholder profiles are handled by the pending state above)*/}
        {/* ============================================================== */}
        {profile && !isMockProfile ? (
          <>
            <AIGeneratedBanner
              variant="inline"
              {...(profile.claudeModelVersion ? { modelName: profile.claudeModelVersion } : {})}
            />

            <section
              className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
              aria-labelledby="profile-summary-heading"
            >
              <header className="flex items-baseline justify-between gap-3">
                <h2 id="profile-summary-heading" className="t-h2 text-[var(--t-1)]">
                  Synthèse
                </h2>
                <span className="t-cap text-[var(--t-3)]">
                  Instrument v{profile.instrumentVersion}
                </span>
              </header>
              <p className="t-body leading-relaxed text-[var(--t-2)]">{profile.summary}</p>
            </section>

            {/* Highlights — durable traits / patterns Claude inferred. */}
            {(() => {
              const highlights = asHighlights(profile.highlights);
              if (highlights.length === 0) return null;
              return (
                <section
                  className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
                  aria-labelledby="profile-highlights-heading"
                >
                  <h2 id="profile-highlights-heading" className="t-h2 text-[var(--t-1)]">
                    Traits saillants
                  </h2>
                  <ul className="flex flex-col gap-4">
                    {highlights.map((h, i) => {
                      const label = typeof h.label === 'string' ? h.label : `Trait ${i + 1}`;
                      const evidence = asStringArray(h.evidence);
                      return (
                        <li
                          key={(typeof h.key === 'string' && h.key) || `h-${i}`}
                          className="wow-rise flex flex-col gap-2"
                          style={{ '--rise-delay': `${80 + i * 70}ms` } as React.CSSProperties}
                        >
                          <h3 className="t-body font-semibold text-[var(--t-1)]">{label}</h3>
                          {evidence.length > 0 ? (
                            <ul className="flex flex-col gap-1.5 border-l-2 border-[var(--b-acc)] pl-3">
                              {evidence.map((e, ei) => (
                                <li
                                  key={ei}
                                  className="t-cap text-[var(--t-2)] italic before:mr-2 before:content-['«'] after:ml-2 after:content-['»']"
                                >
                                  {e}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Axes prioritaires for the coaching path. */}
            {(() => {
              const axes = asStringArray(profile.axesPrioritaires);
              if (axes.length === 0) return null;
              return (
                <section
                  className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
                  aria-labelledby="profile-axes-heading"
                >
                  <div className="flex items-start gap-3">
                    <div
                      aria-hidden="true"
                      className="rounded-pill mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border"
                      style={{
                        background: 'var(--acc-dim)',
                        borderColor: 'var(--b-acc)',
                        color: 'var(--acc)',
                      }}
                    >
                      <Target className="h-4 w-4" strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 id="profile-axes-heading" className="t-h2 text-[var(--t-1)]">
                        Axes prioritaires
                      </h2>
                      <p className="t-cap mt-1 text-[var(--t-3)]">
                        Les points sur lesquels Eliott va te coacher en priorité.
                      </p>
                    </div>
                  </div>
                  <ol className="flex flex-col gap-2.5">
                    {axes.map((axis, i) => (
                      <li
                        key={i}
                        className="wow-rise t-body flex items-start gap-3 text-[var(--t-2)]"
                        style={{ '--rise-delay': `${80 + i * 70}ms` } as React.CSSProperties}
                      >
                        <span
                          aria-hidden="true"
                          className="rounded-pill mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--b-acc)] bg-[var(--acc-dim)] font-mono text-[11px] font-semibold text-[var(--acc)]"
                        >
                          {i + 1}
                        </span>
                        <span>{axis}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })()}

            <p className="t-cap text-center text-[var(--t-3)]">
              Profil analysé le{' '}
              {new Date(profile.analyzedAt).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ProfilePlaceholder — shared empty/in-flight state
// ---------------------------------------------------------------------------

interface ProfilePlaceholderProps {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  ctaHref: string;
  ctaLabel: string;
}

function ProfilePlaceholder({ eyebrow, title, body, ctaHref, ctaLabel }: ProfilePlaceholderProps) {
  return (
    <section
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby="profile-placeholder-heading"
    >
      <p className="t-eyebrow-lg text-[var(--t-3)]">{eyebrow}</p>
      <h2 id="profile-placeholder-heading" className="t-h2 text-[var(--t-1)]">
        {title}
      </h2>
      <p className="t-body text-[var(--t-2)]">{body}</p>
      <div>
        <Link href={ctaHref} className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
          {ctaLabel}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      </div>
    </section>
  );
}
