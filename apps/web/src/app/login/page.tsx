import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Alert } from '@/components/alert';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';

import { LoginForm } from './login-form';

export const metadata = {
  title: 'Connexion · Fxmily',
};

interface LoginPageProps {
  searchParams: Promise<{ onboarding?: string | string[] }>;
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

  return (
    <main className="aurora relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="orb pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, oklch(0.879 0.231 130 / 0.20) 0%, transparent 70%)',
        }}
      />

      <section className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <Link
          href="/"
          className="flex items-center justify-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="grid h-8 w-8 place-items-center rounded-[6px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[12px] font-bold text-[var(--acc)]">
            F
          </div>
          <span className="f-display text-[15px] font-semibold tracking-[-0.01em]">Fxmily</span>
        </Link>

        <Card primary className="px-6 py-7">
          <header className="mb-6 flex flex-col items-center gap-2">
            <h1
              className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
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

          <LoginForm />
        </Card>

        <p className="text-center text-[11px] tabular-nums text-[var(--t-4)]">
          Cohorte privée · accès uniquement par invitation
        </p>

        <p className="text-center text-[10px] tabular-nums text-[var(--t-4)]">
          <span className="inline-flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>?</Kbd>
            raccourcis
          </span>
        </p>
      </section>
    </main>
  );
}
