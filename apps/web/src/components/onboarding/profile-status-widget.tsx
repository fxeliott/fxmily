import { ArrowRight, Check, Compass, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { HoverLift } from '@/components/ui/hover-lift';
import { getInterviewForUser, getProfileForUser } from '@/lib/onboarding-interview/service';

/**
 * V2.4 — Onboarding profile dashboard status widget (Session 2 hardening).
 *
 * The V2.4 profiling pipeline (30-question interview → batch local Claude Opus
 * 4.8 → 6 gates → `MemberProfile` → `/profile`) was fully built but UNREACHABLE
 * from the member journey : `/dashboard` carried zero link to
 * `/onboarding/interview` or `/profile`, so a freshly-onboarded member never
 * discovered the flagship "profilage initial" (SPEC §28). This widget is the
 * missing bridge — it surfaces the same four states the `/profile` page renders,
 * straight on the dashboard, so every member is routed into building their
 * profile.
 *
 * Server Component. Reads the member's interview + profile via the same
 * server-only service functions `/profile` uses (`getInterviewForUser` +
 * `getProfileForUser`) — zero new service code, zero new query shape.
 *
 * Four calm states (mirror `app/profile/page.tsx`), anti-Black-Hat (Yu-kai
 * Chou) — NO streak, NO score, NO shame, NO red-on-empty, NO forced redirect :
 *   1. no interview     → prominent calm CTA "Établis ton profil" → /onboarding/interview
 *   2. in progress      → calm "Reprends ton entretien"           → /onboarding/interview/new
 *   3. completed, no MP  → discreet "Ton profil se prépare" + lien /profile
 *   4. profile analyzed → discreet "Ton profil est prêt"          → /profile
 *
 * DS-v2 NEUTRAL/lime — never `--cy` (training) nor `.v18-theme` (REFLECT).
 * Posture §2 : the copy promises a behavioural/psychological profile and is
 * explicit that no market opinion is given.
 */
export async function ProfileStatusWidget({ userId }: { userId: string }) {
  const [interview, profile] = await Promise.all([
    getInterviewForUser(userId),
    getProfileForUser(userId),
  ]);

  // ── State 4 : profile analyzed → discreet ack + entry into /profile ──────────
  if (profile) {
    return (
      <div
        data-slot="profile-status-widget"
        data-state="ready"
        className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-eyebrow text-[var(--t-3)]">Mon profil</span>
            <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Ton profil est prêt</h3>
            <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
              Ta synthèse, tes traits saillants et tes axes prioritaires de coaching.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Link
            href="/profile"
            className="rounded-control inline-flex h-9 items-center gap-1.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 text-[12px] font-semibold text-[var(--acc-hi)] transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            Voir mon profil
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  // ── State 3 : interview completed but profile not analyzed yet ──────────────
  if (interview?.status === 'completed') {
    return (
      <div
        data-slot="profile-status-widget"
        data-state="pending"
        className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <Sparkles className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-eyebrow text-[var(--t-3)]">Mon profil</span>
            <h3 className="text-[15px] font-semibold text-[var(--t-1)]">Ton profil se prépare</h3>
            <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
              Tu as terminé ton entretien. Eliott et l&apos;IA relisent tes réponses — ton profil
              descriptif arrive bientôt.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Link
            href="/profile"
            className="rounded-control inline-flex h-9 items-center gap-1 border border-[var(--b-default)] px-3 text-[12px] text-[var(--t-3)] transition-colors hover:border-[var(--b-acc)] hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            Voir le détail
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  // ── States 1 & 2 : no interview / in progress → prominent calm CTA ──────────
  const inProgress = interview !== null;
  const href = inProgress ? '/onboarding/interview/new' : '/onboarding/interview';
  const title = inProgress ? 'Reprends ton entretien' : 'Établis ton profil de trader';
  const body = inProgress
    ? 'Tes réponses sont sauvegardées. Termine ton entretien quand tu te sens prêt·e pour activer ton profil personnalisé.'
    : 'Un entretien guidé (~30 questions) pour qu’Eliott te coache au plus juste. Tes réponses restent confidentielles — aucun avis sur le marché.';
  const cta = inProgress ? 'Reprendre' : 'Commencer';

  return (
    <HoverLift className="block">
      <Link
        href={href}
        data-slot="profile-status-widget"
        data-state={inProgress ? 'in-progress' : 'not-started'}
        className="rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
            <Compass className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-eyebrow text-[var(--acc-hi)]">Profil · Entretien onboarding</span>
            <h3 className="text-[15px] font-semibold text-[var(--t-1)]">{title}</h3>
            <p className="text-[12px] leading-relaxed text-[var(--t-2)]">{body}</p>
          </div>
          <span
            className="rounded-control mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 px-2.5 text-[12px] font-semibold text-[var(--acc-hi)]"
            aria-hidden="true"
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </div>
      </Link>
    </HoverLift>
  );
}
