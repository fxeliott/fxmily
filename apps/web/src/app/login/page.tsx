import Image from 'next/image';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

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
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="flex w-full max-w-sm flex-col gap-8">
        <header className="flex flex-col items-center gap-3">
          <Image
            src="/logo.png"
            width={56}
            height={56}
            alt="Fxmily"
            className="rounded-lg"
            priority
          />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Connexion
          </h1>
          <p className="text-center text-sm text-[var(--muted)]">
            Accède à ton espace de suivi Fxmily.
          </p>
        </header>

        {showOnboardingNotice ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
          >
            Compte créé. Connecte-toi pour continuer.
          </div>
        ) : null}

        <LoginForm />
      </section>
    </main>
  );
}
