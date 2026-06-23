import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { LoginAurora } from '@/app/login/login-aurora';
import { BrandMark } from '@/components/brand/brand-mark';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Reveal } from '@/components/ui/reveal';
import { findInvitationByToken } from '@/lib/auth/invitations';

import { OnboardingForm } from './onboarding-form';

export const metadata = {
  title: 'Bienvenue',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function OnboardingWelcomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (tokenParam ?? '').trim();

  if (!token) {
    return <InvalidTokenView reason="missing" />;
  }

  const lookup = await findInvitationByToken(token);
  if (!lookup.ok) {
    return <InvalidTokenView reason={lookup.reason} />;
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-[var(--bg)] px-4 py-10">
      {/* S18 — premium drifting aurora backplate, lifted to /login parity (the
          first post-invitation screen now reads as alive, not a flat opacity-25
          orb). Decorative, zero JS, aria-hidden, perf-gated on mobile. */}
      <LoginAurora />

      <section className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-6">
        <Reveal y={10}>
          <Link
            href="/"
            className="flex items-center justify-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[6px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <BrandMark className="h-4 w-4" />
            </span>
            <span className="f-display text-[15px] font-semibold tracking-[-0.01em]">Fxmily</span>
          </Link>
        </Reveal>

        <Reveal y={14} delay={90}>
          <Card primary className="px-6 py-7">
            <header className="mb-6 flex flex-col items-center gap-2">
              <div className="relative mb-1.5">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-[var(--acc-dim)] blur-xl"
                />
                <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]">
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} />
                </div>
              </div>
              <h1
                className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
                style={{ fontFeatureSettings: '"ss01" 1' }}
              >
                Bienvenue.
              </h1>
              <p className="t-body text-center text-[var(--t-3)]">
                Active ton accès. La discipline avant le marché.
              </p>
            </header>

            <OnboardingForm token={token} email={lookup.invitation.email} />
          </Card>
        </Reveal>

        <Reveal y={8} delay={180}>
          <p className="text-center text-[10px] text-[var(--t-4)] tabular-nums">
            Cohorte privée · Eliott t&apos;a invité personnellement
          </p>
        </Reveal>
      </section>
    </main>
  );
}

function InvalidTokenView({
  reason,
}: {
  reason: 'missing' | 'unknown' | 'expired' | 'already_used';
}) {
  const headline = reason === 'already_used' ? 'Lien déjà utilisé' : 'Lien invalide';

  const action = (() => {
    switch (reason) {
      case 'missing':
        return "Ce lien est incomplet. Vérifie l'URL reçue par email — elle doit contenir un token complet.";
      case 'unknown':
        return "Ce lien d'invitation n'existe pas ou n'est plus valide. Demande à Eliott une nouvelle invitation.";
      case 'expired':
        return 'Les invitations expirent au bout de 7 jours. Demande à Eliott un nouveau lien.';
      case 'already_used':
        return 'Tu as déjà créé ton compte avec ce lien. Connecte-toi pour accéder à ton espace.';
    }
  })();

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-10">
      {/* S20 — same premium backplate as the happy-path (was a generic faint
          `.aurora`): the error branch shouldn't read as a downgraded screen. */}
      <LoginAurora />
      <section className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-5">
        <Reveal>
          <Card primary className="py-2">
            <ErrorState headline={headline} action={action} />
          </Card>
        </Reveal>
        <div className="flex justify-center">
          {/* Phase P review WCAG B2 — Link wrapping Btn nests <a><button>
              (invalid HTML5 + double tab-stop). Use btnVariants on the
              Link directly so it renders as a single <a>. */}
          <Link href="/login" className={btnVariants({ kind: 'secondary', size: 'm' })}>
            Aller à la connexion
          </Link>
        </div>
      </section>
    </main>
  );
}
