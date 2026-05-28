import { Compass, Sparkles, Target } from 'lucide-react';

import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import type {
  SerializedMemberProfile,
  SerializedOnboardingInterview,
} from '@/lib/onboarding-interview/service';
import { pseudonymizeMember } from '@/lib/weekly-report/builder';

/**
 * V2.4 Phase C — Admin pseudonymized view of MemberProfile (M3 directive
 * 2026-05-27 closure §18 vision "admin voir tout"). Renders under
 * `/admin/members/[id]?tab=profile`.
 *
 * Pattern carbone hybride :
 *   - **80% `/profile` member route** (V2.4 Phase B PR #191 LIVE) — same
 *     summary / highlights / axes_prioritaires sections and helpers
 *     (`asHighlights` / `asStringArray`), same null states (no interview /
 *     in-flight / completed-but-pending / analyzed) ; forks WITHOUT the
 *     membre-facing CTA links (admin can't act on member's behalf).
 *   - **15% V1.5.2 pseudonymization** — header shows `pseudonymLabel`
 *     (`member-XXXXXXXX` 8-char hex) instead of email/name. Carbone the
 *     boundary applied at Claude prompt time (`@/lib/weekly-report/builder`
 *     `pseudonymizeMember`). Admin context is INTERNAL but the consistency
 *     keeps a single source of truth for the membre identity surface +
 *     trains the admin eye on the pseudonymous label that travels to Claude.
 *   - **5% EU AI Act 50(1)** — `<AIGeneratedBanner variant="inline">` is the
 *     **6e site production** wired before 2026-08-02 deadline (5 V2.4 Phase B
 *     LIVE: `/admin/reports/[id]` + `MonthlyDebriefReader` + `/profile` +
 *     2 email inline HTML). Pénalité Article 99(4) €15M / 3% CA.
 *
 * Posture §J / §16 — `MemberProfile.{highlights, axes_prioritaires}` are typed
 * `Json` server-side ; defensive rendering (string coercion + array filter).
 * Posture Mark Douglas + §J anti-clinical — profile is descriptif
 * comportemental, jamais clinique (enforced AT prompt level by
 * `lib/onboarding-interview/safety.ts` + Zod `.strict()`).
 *
 * Admin context divergences vs `/profile` member :
 *   - Header shows `pseudonymLabel` (NOT real name) + interview status pill
 *   - Copy : "Profil du membre" vs "Ton profil"
 *   - No CTA buttons (admin can't start/resume interview on behalf)
 *   - Null states show informational message ("Le membre n'a pas encore
 *     démarré son entretien") instead of action prompts
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

interface MemberProfileViewerAdminProps {
  memberId: string;
  profile: SerializedMemberProfile | null;
  interview: SerializedOnboardingInterview | null;
}

export function MemberProfileViewerAdmin({
  memberId,
  profile,
  interview,
}: MemberProfileViewerAdminProps) {
  const pseudonymLabel = pseudonymizeMember(memberId);

  return (
    <div className="flex flex-col gap-6" data-slot="member-profile-viewer-admin">
      {/* Pseudonym header — admin eye trains on the Claude-prompt boundary
          identity, not the real member name (which is visible in the page hero
          above this tab). */}
      <header className="rounded-card-lg flex items-center justify-between gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="rounded-pill flex h-9 w-9 shrink-0 items-center justify-center border"
            style={{
              background: 'var(--acc-dim)',
              borderColor: 'var(--b-acc)',
              color: 'var(--acc)',
            }}
          >
            <Compass className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="t-eyebrow-lg text-[var(--t-3)]">Profil membre — boundary Claude</p>
            <p className="font-mono text-[13px] font-semibold text-[var(--t-1)]">
              {pseudonymLabel}
            </p>
          </div>
        </div>
        {interview ? (
          <span
            className="rounded-pill inline-flex items-center gap-1.5 border border-[var(--b-default)] bg-[var(--bg-3)] px-2.5 py-1 text-[11px] font-medium text-[var(--t-2)]"
            aria-label={`Statut entretien : ${interview.status}`}
          >
            Entretien&nbsp;:&nbsp;
            <span className="text-[var(--t-1)]">
              {interview.status === 'completed'
                ? 'terminé'
                : interview.status === 'in_progress'
                  ? 'en cours'
                  : 'démarré'}
            </span>
          </span>
        ) : (
          <span className="rounded-pill inline-flex items-center gap-1.5 border border-[var(--b-default)] bg-[var(--bg-3)] px-2.5 py-1 text-[11px] font-medium text-[var(--t-3)]">
            Pas encore démarré
          </span>
        )}
      </header>

      {/* ============================================================== */}
      {/* State : no interview started                                    */}
      {/* ============================================================== */}
      {!interview ? (
        <AdminPlaceholder
          eyebrow="Entretien onboarding"
          title="Le membre n'a pas encore démarré son entretien."
          body="Une fois qu'il aura répondu aux 30 questions, l'IA générera son profil descriptif et tu pourras le consulter ici."
        />
      ) : null}

      {/* ============================================================== */}
      {/* State : interview in-flight (no profile yet)                    */}
      {/* ============================================================== */}
      {interview && interview.status !== 'completed' && !profile ? (
        <AdminPlaceholder
          eyebrow="Entretien en cours"
          title="Le membre a commencé son entretien."
          body="Ses réponses sont sauvegardées au fur et à mesure. Le profil descriptif sera généré dès qu'il aura finalisé."
        />
      ) : null}

      {/* ============================================================== */}
      {/* State : interview completed but analysis pending (batch hasn't  */}
      {/* run yet — calm pending placeholder)                             */}
      {/* ============================================================== */}
      {interview?.status === 'completed' && !profile ? (
        <section
          className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-acc)] bg-[var(--bg-2)] p-6"
          aria-labelledby="profile-admin-pending-heading"
        >
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="rounded-pill mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border"
              style={{
                background: 'var(--acc-dim)',
                borderColor: 'var(--b-acc)',
                color: 'var(--acc)',
              }}
            >
              <Sparkles className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="t-eyebrow-lg text-[var(--t-3)]">Analyse en cours</p>
              <h2 id="profile-admin-pending-heading" className="t-h2 mt-1 text-[var(--t-1)]">
                Le profil sera disponible après le prochain batch IA.
              </h2>
              <p className="t-body mt-2 text-[var(--t-2)]">
                Le membre a finalisé son entretien le{' '}
                {interview.completedAt
                  ? new Date(interview.completedAt).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : '—'}
                . Le batch local Claude Max tournera dans les 24h pour générer le profil descriptif.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ============================================================== */}
      {/* State : profile analyzed — render content + AI banner (6e site)  */}
      {/* ============================================================== */}
      {profile ? (
        <>
          {/* 6e site EU AI Act 50(1) bannière obligatoire avant 2026-08-02. */}
          <AIGeneratedBanner
            variant="inline"
            {...(profile.claudeModelVersion ? { modelName: profile.claudeModelVersion } : {})}
          />

          <section
            className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
            aria-labelledby="profile-admin-summary-heading"
          >
            <header className="flex items-baseline justify-between gap-3">
              <h2 id="profile-admin-summary-heading" className="t-h2 text-[var(--t-1)]">
                Synthèse comportementale
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
                aria-labelledby="profile-admin-highlights-heading"
              >
                <h2 id="profile-admin-highlights-heading" className="t-h2 text-[var(--t-1)]">
                  Traits saillants
                </h2>
                <ul className="flex flex-col gap-4">
                  {highlights.map((h, i) => {
                    const label = typeof h.label === 'string' ? h.label : `Trait ${i + 1}`;
                    const evidence = asStringArray(h.evidence);
                    return (
                      <li
                        key={(typeof h.key === 'string' && h.key) || `h-${i}`}
                        className="flex flex-col gap-2"
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

          {/* Axes prioritaires for the coaching path — admin focuses here. */}
          {(() => {
            const axes = asStringArray(profile.axesPrioritaires);
            if (axes.length === 0) return null;
            return (
              <section
                className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
                aria-labelledby="profile-admin-axes-heading"
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
                    <h2 id="profile-admin-axes-heading" className="t-h2 text-[var(--t-1)]">
                      Axes prioritaires
                    </h2>
                    <p className="t-cap mt-1 text-[var(--t-3)]">
                      À utiliser pour orienter ton coaching personnalisé.
                    </p>
                  </div>
                </div>
                <ol className="flex flex-col gap-2.5">
                  {axes.map((axis, i) => (
                    <li key={i} className="t-body flex items-start gap-3 text-[var(--t-2)]">
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
  );
}

interface AdminPlaceholderProps {
  eyebrow: string;
  title: string;
  body: string;
}

function AdminPlaceholder({ eyebrow, title, body }: AdminPlaceholderProps) {
  return (
    <section
      className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby="profile-admin-placeholder-heading"
    >
      <p className="t-eyebrow-lg text-[var(--t-3)]">{eyebrow}</p>
      <h2 id="profile-admin-placeholder-heading" className="t-h2 text-[var(--t-1)]">
        {title}
      </h2>
      <p className="t-body text-[var(--t-2)]">{body}</p>
    </section>
  );
}
