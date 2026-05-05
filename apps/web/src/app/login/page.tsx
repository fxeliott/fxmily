import Image from 'next/image';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Alert } from '@/components/alert';

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
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center px-4 py-10">
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
          <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            Connexion
          </h1>
          <p className="text-muted text-center text-sm">Accède à ton espace de suivi Fxmily.</p>
        </header>

        {showOnboardingNotice ? (
          <Alert tone="success">Compte créé. Connecte-toi pour continuer.</Alert>
        ) : null}

        <LoginForm />
      </section>
    </main>
  );
}
