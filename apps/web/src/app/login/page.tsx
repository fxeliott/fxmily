import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { Alert } from '@/components/alert';
import { BrandMark } from '@/components/brand/brand-mark';
import { Card } from '@/components/ui/card';

import { LoginAurora } from './login-aurora';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Connexion',
  // Phase T security — V1 closed cohort, no SEO discovery.
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ onboarding?: string | string[]; reset?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const onboardingFlag = Array.isArray(params.onboarding)
    ? params.onboarding[0]
    : params.onboarding;
  const showOnboardingNotice = onboardingFlag === 'success';
  const resetFlag = Array.isArray(params.reset) ? params.reset[0] : params.reset;
  const showResetNotice = resetFlag === 'success';

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-10">
      {/* S9.1 — premium drifting aurora backplate (decorative, zero JS). */}
      <LoginAurora />

      <section className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <Link
          href="/"
          className="wow-rise flex items-center justify-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="grid h-8 w-8 place-items-center rounded-[6px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <BrandMark className="w-[19px]" />
          </div>
          <span className="f-display text-[15px] font-semibold tracking-[-0.01em]">Fxmily</span>
        </Link>

        <Card
          primary
          className="wow-rise px-6 py-7"
          style={{ '--rise-delay': '90ms' } as CSSProperties}
        >
          <header className="mb-6 flex flex-col items-center gap-2">
            <h1
              className="f-display h-rise text-[34px] leading-[1.02] font-bold tracking-[-0.04em] text-[var(--t-1)] sm:text-[40px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Connexion
            </h1>
            <p className="t-body text-center text-[var(--t-3)]">Accède à ton espace de suivi.</p>
          </header>

          {showOnboardingNotice ? (
            <div className="mb-5">
              <Alert tone="success">Compte créé. Connecte-toi pour continuer.</Alert>
            </div>
          ) : null}

          {showResetNotice ? (
            <div className="mb-5">
              <Alert tone="success">
                Mot de passe mis à jour. Connecte-toi avec ton nouveau mot de passe.
              </Alert>
            </div>
          ) : null}

          <LoginForm />
        </Card>

        <p
          className="wow-rise text-center text-[11px] text-[var(--t-4)] tabular-nums"
          style={{ '--rise-delay': '170ms' } as CSSProperties}
        >
          Cohorte privée · accès uniquement par invitation
        </p>

        <p
          className="wow-rise text-center text-[11px] text-[var(--t-4)]"
          style={{ '--rise-delay': '230ms' } as CSSProperties}
        >
          Pas encore membre ?{' '}
          <Link href="/rejoindre" className="text-[var(--acc)] underline-offset-2 hover:underline">
            Faire une demande
          </Link>
        </p>
      </section>
    </main>
  );
}
